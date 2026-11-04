import { eventTarget, utilities as csUtils, cache } from '@cornerstonejs/core';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { annotation, Enums as ToolEnums } from '@cornerstonejs/tools';
import { db, getFile, getInstancesOfSeries, putThumb } from '../core/db';
import type { DisplayImage, InstanceRec, SeriesRec } from '../core/types';
import {
  imageIdToKey,
  keyToImageId,
  keyToInstance,
  keyToSeries,
  loadWork,
  notify,
  saveWorkSoon,
  seriesImages,
  workOf,
} from './registry';

const fileIdToUri = new Map<string, string>();

export function instanceKey(inst: InstanceRec, frame: number) {
  return frame ? `${inst.sopUID}#${frame}` : inst.sopUID;
}

export { sortInstances } from './sort';
import { sortInstances } from './sort';

async function uriForFile(fileId: string): Promise<string | null> {
  const existing = fileIdToUri.get(fileId);
  if (existing) return existing;
  const rec = await getFile(fileId);
  if (!rec) return null;
  const uri = dicomImageLoader.wadouri.fileManager.add(rec.blob);
  fileIdToUri.set(fileId, uri);
  return uri;
}

/** Builds (or returns cached) sorted imageIds for a series and registers the mapping. */
export async function openSeries(series: SeriesRec): Promise<DisplayImage[]> {
  const cached = seriesImages.get(series.seriesUID);
  if (cached) return cached;
  await loadWork(series.studyUID);
  const insts = sortInstances(await getInstancesOfSeries(series.seriesUID));
  const out: DisplayImage[] = [];
  for (const inst of insts) {
    if (inst.kind === 'image') {
      const imageId = `bvimg:${inst.fileId}`;
      register(imageId, inst, 0, series, out);
      continue;
    }
    const uri = await uriForFile(inst.fileId);
    if (!uri) continue;
    if (inst.numberOfFrames > 1) {
      for (let f = 1; f <= inst.numberOfFrames; f++) register(`${uri}?frame=${f}`, inst, f, series, out);
    } else register(uri, inst, 0, series, out);
  }
  seriesImages.set(series.seriesUID, out);
  restoreAnnotations(series.studyUID, out);
  return out;
}

function register(imageId: string, inst: InstanceRec, frame: number, series: SeriesRec, out: DisplayImage[]) {
  const key = instanceKey(inst, frame);
  imageIdToKey.set(imageId, key);
  keyToImageId.set(key, imageId);
  keyToInstance.set(key, inst);
  keyToSeries.set(key, series);
  out.push({ instanceKey: key, instance: inst, frame });
}

export function imageIdsOf(images: DisplayImage[]) {
  return images.map((i) => keyToImageId.get(i.instanceKey)!);
}

/** Releases parsed datasets / decoded images of a series that is no longer displayed. */
export function releaseSeries(seriesUID: string) {
  const imgs = seriesImages.get(seriesUID);
  if (!imgs) return;
  for (const im of imgs) {
    const id = keyToImageId.get(im.instanceKey);
    if (!id) continue;
    try {
      if (cache.getImageLoadObject(id)) cache.removeImageLoadObject(id, { force: true } as any);
    } catch {
      /* ignore */
    }
    if (id.startsWith('dicomfile:')) {
      const url = id.slice('dicomfile:'.length).split(/[?&]/)[0];
      try {
        if (dicomImageLoader.wadouri.dataSetCacheManager.isLoaded(url)) dicomImageLoader.wadouri.dataSetCacheManager.unload(url);
      } catch {
        /* ignore */
      }
    }
  }
}

// ---------- annotation persistence ----------
const restored = new Set<string>();

function restoreAnnotations(studyUID: string, images: DisplayImage[]) {
  const w = workOf(studyUID);
  if (!w) return;
  const keys = new Set(images.map((i) => i.instanceKey));
  for (const sa of w.annotations) {
    if (!keys.has(sa.instanceKey) || restored.has(sa.json.annotationUID)) continue;
    const json = structuredClone(sa.json);
    json.metadata.referencedImageId = keyToImageId.get(sa.instanceKey);
    restored.add(json.annotationUID);
    try {
      annotation.state.addAnnotation(json, json.metadata.FrameOfReferenceUID);
      if (json.data?.bvStyle) annotation.config.style.setAnnotationStyles(json.annotationUID, json.data.bvStyle);
    } catch {
      /* ignore broken entry */
    }
  }
}

function persistStudyAnnotations(studyUID: string) {
  const w = workOf(studyUID);
  if (!w) return;
  const all = annotation.state.getAllAnnotations() as any[];
  const list: { instanceKey: string; json: any }[] = [];
  for (const a of all) {
    const key = imageIdToKey.get(a.metadata?.referencedImageId);
    if (!key) continue;
    if (keyToInstance.get(key)?.studyUID !== studyUID) continue;
    const json = JSON.parse(JSON.stringify({ annotationUID: a.annotationUID, metadata: a.metadata, data: { ...a.data, cachedStats: {} }, highlighted: false, isLocked: false, isVisible: true, invalidated: true }));
    list.push({ instanceKey: key, json });
  }
  w.annotations = list;
  saveWorkSoon(studyUID);
}

/** Own colour also while hovered/selected (selection is shown by handles and the properties panel). */
export function styleFor(color: string, lineWidth: number | string) {
  return { color, colorHighlighted: color, colorSelected: color, lineWidth: String(lineWidth), textBoxColor: '#ffffff', textBoxColorHighlighted: '#ffffff', textBoxColorSelected: '#ffffff' };
}

export function persistAnnotation(a: any) {
  const key = imageIdToKey.get(a?.metadata?.referencedImageId);
  if (key) persistStudyAnnotations(keyToInstance.get(key)!.studyUID);
}

export function installAnnotationPersistence(defaults: () => { color: string; lineWidth: number; angleMode: string; visible: boolean }) {
  eventTarget.addEventListener(ToolEnums.Events.ANNOTATION_COMPLETED, (evt: any) => {
    const a = evt.detail?.annotation;
    if (!a || a.data?.bvStyle) return;
    const d = defaults();
    a.data.bvStyle = styleFor(d.color, d.lineWidth);
    if (a.metadata?.toolName === 'CobbAngle') a.data.bvAngleMode = d.angleMode;
    annotation.config.style.setAnnotationStyles(a.annotationUID, a.data.bvStyle);
  });
  const handler = (evt: any) => {
    const a = evt.detail?.annotation;
    const imageId = a?.metadata?.referencedImageId;
    const key = imageId && imageIdToKey.get(imageId);
    if (a?.annotationUID) restored.add(a.annotationUID);
    if (key) persistStudyAnnotations(keyToInstance.get(key)!.studyUID);
    notify();
  };
  const E = ToolEnums.Events;
  [E.ANNOTATION_COMPLETED, E.ANNOTATION_MODIFIED, E.ANNOTATION_REMOVED].forEach((e) => eventTarget.addEventListener(e, handler));
}

/** Removes in-memory annotations of a deleted study. */
export function dropStudyFromSession(studyUID: string) {
  for (const a of annotation.state.getAllAnnotations() as any[]) {
    const key = imageIdToKey.get(a.metadata?.referencedImageId);
    if (key && keyToInstance.get(key)?.studyUID === studyUID) annotation.state.removeAnnotation(a.annotationUID);
  }
  for (const [uid, imgs] of seriesImages) {
    if (imgs[0]?.instance.studyUID === studyUID) {
      releaseSeries(uid);
      seriesImages.delete(uid);
    }
  }
}

// ---------- thumbnails ----------
export async function ensureThumbnail(series: SeriesRec): Promise<Blob | null> {
  const d = await db();
  const existing = (await d.get('thumbs', series.seriesUID)) as Blob | undefined;
  if (existing) return existing;
  const wasOpen = seriesImages.has(series.seriesUID);
  const imgs = await openSeries(series);
  if (!imgs.length) return null;
  const mid = imgs[Math.floor(imgs.length / 2)];
  const imageId = keyToImageId.get(mid.instanceKey)!;
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 160;
  try {
    await csUtils.loadImageToCanvas({ canvas, imageId, thumbnail: true, imageAspect: true } as any);
  } catch {
    return null;
  }
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
  if (!wasOpen) releaseSeries(series.seriesUID);
  if (blob && (await d.getKey('series', series.seriesUID))) await putThumb(series.seriesUID, blob);
  return blob;
}
