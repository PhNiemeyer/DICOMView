// Video recording directly from the rendered viewport canvases (no screen capture).
import { Enums, eventTarget, imageLoader } from '@cornerstonejs/core';
import { Enums as ToolEnums } from '@cornerstonejs/tools';
import { currentImageId, getViewport } from '../cs/viewportOps';
import { imageIdToKey, masksFor } from '../cs/registry';
import { fillMasks } from '../cs/masks';
import { serializeSvg, svgToImage, viewportCssSize } from './render';
import { useStore } from '../core/store';

export const FPS = 30;
export const MAX_BYTES = 500 * 1024 * 1024;

export function pickMime(): { mime: string; ext: 'mp4' | 'webm'; label: string } | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const mp4 = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4'];
  for (const m of mp4) if (MediaRecorder.isTypeSupported(m)) return { mime: m, ext: 'mp4', label: 'MP4 (H.264)' };
  const webm = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const m of webm) if (MediaRecorder.isTypeSupported(m)) return { mime: m, ext: 'webm', label: 'WebM' };
  return null;
}

/** Ensures all images of the included stacks are decoded before recording starts. */
export async function preloadStacks(indices: number[], onProgress: (done: number, total: number) => void) {
  const ids = indices.flatMap((i) => getViewport(i)?.getImageIds() ?? []);
  let done = 0;
  await Promise.all(
    ids.map((id) =>
      imageLoader
        .loadAndCacheImage(id)
        .catch(() => undefined)
        .finally(() => onProgress(++done, ids.length)),
    ),
  );
}

export interface Recording {
  stop: () => Promise<Blob | null>;
  abort: () => void;
  width: number;
  height: number;
  ext: string;
  mime: string;
}

export function startRecording(opts: {
  indices: number[];
  crop: { x: number; y: number; w: number; h: number } | null;
  withMeasurements: boolean;
  maxSeconds: number;
  onLimit: () => void;
}): Recording {
  const fmt = pickMime()!;
  const dpr = window.devicePixelRatio || 1;
  const layout = useStore.getState().layout;
  const cols = opts.indices.length === 1 ? 1 : layout === 4 ? 2 : layout;
  const rows = opts.indices.length === 1 ? 1 : layout === 4 ? 2 : 1;
  const { w: cw, h: ch } = viewportCssSize(opts.indices[0]);
  const gap = opts.indices.length > 1 ? 2 : 0;
  let fullW = cw * cols + gap * (cols - 1);
  let fullH = ch * rows + gap * (rows - 1);
  const region = opts.crop ?? { x: 0, y: 0, w: fullW, h: fullH };
  // H.264 needs even dimensions
  const width = Math.max(2, Math.round((region.w * dpr) / 2) * 2);
  const height = Math.max(2, Math.round((region.h * dpr) / 2) * 2);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, width, height);

  // full composition canvas (grid at device resolution)
  const full = document.createElement('canvas');
  full.width = Math.round(fullW * dpr);
  full.height = Math.round(fullH * dpr);
  const fg = full.getContext('2d')!;

  let seq = 0;
  let drawnSeq = 0;
  let pending = false;
  const compose = async () => {
    pending = false;
    const my = ++seq;
    fg.fillStyle = '#000';
    fg.fillRect(0, 0, full.width, full.height);
    const svgs: { str: string; x: number; y: number }[] = [];
    opts.indices.forEach((i, k) => {
      const vp = getViewport(i);
      const ox = (k % cols) * (cw + gap) * dpr;
      const oy = Math.floor(k / cols) * (ch + gap) * dpr;
      if (!vp) return;
      const c = vp.getCanvas();
      fg.drawImage(c, ox, oy, cw * dpr, ch * dpr);
      const id = currentImageId(vp);
      const key = id && imageIdToKey.get(id);
      if (id && key) {
        fg.save();
        fg.beginPath();
        fg.rect(ox, oy, cw * dpr, ch * dpr);
        fg.clip();
        fillMasks(fg, vp, id, masksFor(key), dpr, [ox, oy]);
        fg.restore();
      }
      if (opts.withMeasurements) {
        const svg = (vp as any).element?.querySelector('svg') as SVGSVGElement | null;
        if (svg) svgs.push({ str: serializeSvg(svg, cw, ch), x: ox, y: oy });
      }
    });
    // snapshot image+mask state synchronously, then add vector annotations of the same moment
    const snap = document.createElement('canvas');
    snap.width = full.width;
    snap.height = full.height;
    snap.getContext('2d')!.drawImage(full, 0, 0);
    const imgs = await Promise.all(svgs.map((s) => svgToImage(s.str).catch(() => null)));
    if (my < drawnSeq) return; // a newer frame was already drawn
    drawnSeq = my;
    const sg = snap.getContext('2d')!;
    imgs.forEach((im, k) => im && sg.drawImage(im, svgs[k].x, svgs[k].y, cw * dpr, ch * dpr));
    g.fillStyle = '#000';
    g.fillRect(0, 0, width, height);
    g.drawImage(snap, region.x * dpr, region.y * dpr, region.w * dpr, region.h * dpr, 0, 0, width, height);
  };
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => void compose());
  };
  const events = [Enums.Events.IMAGE_RENDERED, ToolEnums.Events.ANNOTATION_RENDERED];
  events.forEach((e) => eventTarget.addEventListener(e, schedule));
  const elements = opts.indices.map((i) => (getViewport(i) as any)?.element as HTMLElement).filter(Boolean);
  elements.forEach((el) => el.addEventListener(Enums.Events.IMAGE_RENDERED, schedule));
  const unsub = useStore.subscribe(schedule);
  void compose();

  const stream = canvas.captureStream(FPS);
  const rec = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  let bytes = 0;
  let aborted = false;
  let resolveStop: ((b: Blob | null) => void) | null = null;
  rec.ondataavailable = (e) => {
    if (aborted || !e.data.size) return;
    chunks.push(e.data);
    bytes += e.data.size;
    if (bytes > MAX_BYTES && rec.state === 'recording') {
      opts.onLimit();
      if (rec.state === 'recording') rec.stop();
    }
  };
  rec.onstop = () => {
    cleanup();
    resolveStop?.(aborted ? null : new Blob(chunks, { type: fmt.mime.split(';')[0] }));
  };
  rec.start(1000);
  const timer = setTimeout(() => {
    if (rec.state === 'recording') {
      opts.onLimit();
      if (rec.state === 'recording') rec.stop();
    }
  }, opts.maxSeconds * 1000);
  const done = new Promise<Blob | null>((r) => (resolveStop = r));

  function cleanup() {
    clearTimeout(timer);
    events.forEach((e) => eventTarget.removeEventListener(e, schedule));
    elements.forEach((el) => el.removeEventListener(Enums.Events.IMAGE_RENDERED, schedule));
    unsub();
    stream.getTracks().forEach((t) => t.stop());
  }

  return {
    width,
    height,
    ext: fmt.ext,
    mime: fmt.mime,
    stop: async () => {
      if (rec.state === 'recording') rec.stop();
      return done;
    },
    abort: () => {
      aborted = true;
      chunks.length = 0;
      if (rec.state === 'recording') rec.stop();
    },
  };
}
