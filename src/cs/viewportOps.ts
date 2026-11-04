import { getEnabledElementByIds, utilities as csUtils, type Types } from '@cornerstonejs/core';
import { annotation, utilities as toolUtils } from '@cornerstonejs/tools';
import { RENDERING_ENGINE_ID } from './init';
import { useStore } from '../core/store';

export const vpId = (i: number) => `vp-${i}`;

export function getViewport(i: number): Types.IStackViewport | null {
  const ee = getEnabledElementByIds(vpId(i), RENDERING_ENGINE_ID);
  return (ee?.viewport as Types.IStackViewport) ?? null;
}

export function activeViewport() {
  return getViewport(useStore.getState().activeViewport);
}

export function currentImageId(vp: Types.IStackViewport | null): string | null {
  if (!vp) return null;
  try {
    return vp.getCurrentImageId() ?? null;
  } catch {
    return null;
  }
}

function hasImage(vp: Types.IStackViewport | null): vp is Types.IStackViewport {
  return !!vp && vp.getImageIds().length > 0;
}

export function rotate(delta: number) {
  const vp = activeViewport();
  if (!hasImage(vp)) return;
  const r = vp.getViewPresentation().rotation ?? 0;
  vp.setViewPresentation({ rotation: (((r + delta) % 360) + 360) % 360 });
  vp.render();
}

export function flip(dir: 'h' | 'v') {
  const vp = activeViewport();
  if (!hasImage(vp)) return;
  const cam = vp.getCamera();
  if (dir === 'h') vp.setCamera({ flipHorizontal: !cam.flipHorizontal });
  else vp.setCamera({ flipVertical: !cam.flipVertical });
  vp.render();
}

export function invert() {
  const vp = activeViewport();
  if (!hasImage(vp)) return;
  vp.setProperties({ invert: !vp.getProperties().invert });
  vp.render();
}

export function fit() {
  const vp = activeViewport();
  if (!hasImage(vp)) return;
  vp.setViewPresentation({ zoom: 1, pan: [0, 0] });
  vp.render();
}

export function resetView() {
  const vp = activeViewport();
  if (!hasImage(vp)) return;
  vp.resetCamera();
  vp.setViewPresentation({ rotation: 0, zoom: 1, pan: [0, 0] });
  const cam = vp.getCamera();
  if (cam.flipHorizontal) vp.setCamera({ flipHorizontal: false });
  if (vp.getCamera().flipVertical) vp.setCamera({ flipVertical: false });
  vp.resetProperties();
  vp.render();
}

export function setWindow(ww: number, wl: number) {
  const vp = activeViewport();
  if (!hasImage(vp) || !(ww > 0)) return;
  vp.setProperties({ voiRange: csUtils.windowLevel.toLowHighRange(ww, wl) });
  vp.render();
}

export function defaultWindow() {
  const vp = activeViewport();
  if (!hasImage(vp)) return;
  const inv = vp.getProperties().invert;
  vp.resetProperties();
  if (inv) vp.setProperties({ invert: inv });
  vp.render();
}

export function getWindow(vp: Types.IStackViewport | null): { ww: number; wl: number } | null {
  if (!hasImage(vp)) return null;
  const r = vp.getProperties().voiRange;
  if (!r) return null;
  const { windowWidth, windowCenter } = csUtils.windowLevel.toWindowLevel(r.lower, r.upper);
  return { ww: windowWidth, wl: windowCenter };
}

export const CT_PRESETS: { key: string; ww: number; wl: number }[] = [
  { key: 'presetSoft', ww: 400, wl: 40 },
  { key: 'presetLung', ww: 1500, wl: -600 },
  { key: 'presetBone', ww: 2000, wl: 400 },
  { key: 'presetBrain', ww: 80, wl: 40 },
  { key: 'presetAbdomen', ww: 350, wl: 50 },
  { key: 'presetLiver', ww: 160, wl: 60 },
  { key: 'presetMediastinum', ww: 350, wl: 40 },
];

export async function scrollBy(delta: number, i = useStore.getState().activeViewport) {
  const vp = getViewport(i);
  if (!hasImage(vp)) return;
  const n = vp.getImageIds().length;
  const idx = Math.min(n - 1, Math.max(0, vp.getCurrentImageIdIndex() + delta));
  await vp.setImageIdIndex(idx);
}

export async function scrollTo(idx: number, i = useStore.getState().activeViewport) {
  const vp = getViewport(i);
  if (!hasImage(vp)) return;
  const n = vp.getImageIds().length;
  await vp.setImageIdIndex(Math.min(n - 1, Math.max(0, idx)));
}

export function renderAllAnnotations() {
  const s = useStore.getState();
  toolUtils.triggerAnnotationRenderForViewportIds(Array.from({ length: s.layout }, (_, i) => vpId(i)));
}

export function setAllAnnotationsVisible(v: boolean) {
  for (const a of annotation.state.getAllAnnotations() as any[]) annotation.visibility.setAnnotationVisibility(a.annotationUID, v);
  renderAllAnnotations();
}

export function deleteSelectedAnnotations() {
  const sel = annotation.selection.getAnnotationsSelected() ?? [];
  for (const uid of sel) annotation.state.removeAnnotation(uid);
  renderAllAnnotations();
  return sel.length;
}

/** canvas (CSS px) → image pixel coordinates on the viewport's current image */
export function canvasToImage(vp: Types.IStackViewport, p: [number, number]): [number, number] | null {
  const id = currentImageId(vp);
  if (!id) return null;
  const w = vp.canvasToWorld(p as Types.Point2);
  const ip = csUtils.worldToImageCoords(id, w);
  return ip ? [ip[0], ip[1]] : null;
}

export function imageToCanvas(vp: Types.IStackViewport, imageId: string, p: [number, number]): [number, number] {
  const w = csUtils.imageToWorldCoords(imageId, p as Types.Point2);
  const c = vp.worldToCanvas(w!);
  return [c[0], c[1]];
}
