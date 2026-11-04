// Renders viewports for export at a chosen resolution (not a screen grab).
// Uses a separate, temporary RenderingEngine so the visible viewports are untouched.
import { Enums, RenderingEngine, type Types } from '@cornerstonejs/core';
import { ToolGroupManager, utilities as toolUtils } from '@cornerstonejs/tools';
import { EXPORT_TOOLGROUP, MEASUREMENT_TOOLS } from '../cs/init';
import { currentImageId, getViewport, imageToCanvas } from '../cs/viewportOps';
import { imageIdToKey, masksFor } from '../cs/registry';
import { fillMasks } from '../cs/masks';
import { useStore } from '../core/store';

export const MAX_SIDE = 8192;
export const MAX_PIXELS = 40_000_000;

export interface ExportOptions {
  area: 'active' | 'all' | 'crop';
  withMeasurements: boolean;
  /** 'original' → 1 output pixel per image pixel (of the active viewport), else factor vs. screen CSS size */
  scale: 'original' | number;
}

function nextFrame() {
  return new Promise<void>((r) => requestAnimationFrame(() => r()));
}

/** CSS px on screen per image pixel at the current zoom. */
export function screenPxPerImagePx(i: number): number | null {
  const vp = getViewport(i);
  const id = currentImageId(vp);
  if (!vp || !id) return null;
  const a = imageToCanvas(vp, id, [0, 0]);
  const b = imageToCanvas(vp, id, [1, 0]);
  return Math.hypot(b[0] - a[0], b[1] - a[1]) || null;
}

export function viewportCssSize(i: number) {
  const el = document.querySelector(`[data-vp="${i}"] .vp-element`) as HTMLElement | null;
  return el ? { w: el.clientWidth, h: el.clientHeight } : { w: 0, h: 0 };
}

export function viewportIndices(area: ExportOptions['area']) {
  const s = useStore.getState();
  if (area === 'all') return Array.from({ length: s.layout }, (_, i) => i);
  if (area === 'crop' && s.crop) return [s.crop.viewportIndex];
  return [s.activeViewport];
}

/** Computes factor + resulting output size, clamped to safe limits. */
export function planExport(opts: ExportOptions) {
  const s = useStore.getState();
  const idx = viewportIndices(opts.area);
  const ref = opts.area === 'crop' && s.crop ? s.crop.viewportIndex : s.activeViewport;
  let factor = typeof opts.scale === 'number' ? opts.scale : 1 / (screenPxPerImagePx(ref) ?? 1);
  const { w: cw, h: ch } = gridCss(idx);
  let ow = cw;
  let oh = ch;
  if (opts.area === 'crop' && s.crop) {
    ow = s.crop.w;
    oh = s.crop.h;
  }
  const clampF = Math.min(MAX_SIDE / Math.max(1, ow), MAX_SIDE / Math.max(1, oh), Math.sqrt(MAX_PIXELS / Math.max(1, ow * oh)));
  const clamped = factor > clampF;
  factor = Math.max(0.1, Math.min(factor, clampF));
  return { factor, width: Math.round(ow * factor), height: Math.round(oh * factor), clamped, indices: idx };
}

function gridCss(idx: number[]) {
  const sizes = idx.map(viewportCssSize);
  if (idx.length === 1) return sizes[0];
  const layout = useStore.getState().layout;
  const cols = layout === 4 ? 2 : layout;
  const rows = layout === 4 ? 2 : 1;
  const w = sizes[0].w * cols + GAP * (cols - 1);
  const h = sizes[0].h * rows + GAP * (rows - 1);
  return { w, h };
}
const GAP = 2;

let engineSeq = 0;

/** Renders one viewport into a new canvas of (cssW*factor × cssH*factor). */
export async function renderViewport(i: number, factor: number, withMeasurements: boolean): Promise<HTMLCanvasElement> {
  const src = getViewport(i);
  const { w: cssW, h: cssH } = viewportCssSize(i);
  const out = document.createElement('canvas');
  out.width = Math.round(cssW * factor);
  out.height = Math.round(cssH * factor);
  const g = out.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, out.width, out.height);
  const imageId = currentImageId(src);
  if (!src || !imageId) return out;

  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-${cssW + 50000}px;top:0;width:${cssW}px;height:${cssH}px;pointer-events:none;`;
  document.body.appendChild(host);
  const desc = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => factor });
  const engine = new RenderingEngine(`bv-export-${++engineSeq}`);
  const viewportId = `bv-export-vp-${engineSeq}`;
  const tg = ToolGroupManager.getToolGroup(EXPORT_TOOLGROUP)!;
  try {
    engine.enableElement({ viewportId, element: host, type: Enums.ViewportType.STACK, defaultOptions: { background: [0, 0, 0] } } as any);
    const vp = engine.getViewport(viewportId) as Types.IStackViewport;
    const rendered = new Promise<void>((r) => {
      const h = () => {
        host.removeEventListener(Enums.Events.IMAGE_RENDERED, h);
        r();
      };
      host.addEventListener(Enums.Events.IMAGE_RENDERED, h);
      setTimeout(r, 4000);
    });
    await vp.setStack([imageId], 0);
    const props = src.getProperties();
    vp.setProperties({ voiRange: props.voiRange, invert: props.invert, VOILUTFunction: props.VOILUTFunction } as any);
    vp.setViewPresentation(src.getViewPresentation());
    const cam = src.getCamera();
    vp.setCamera({ flipHorizontal: cam.flipHorizontal, flipVertical: cam.flipVertical });
    vp.render();
    await rendered;
    await nextFrame();
    g.drawImage(vp.getCanvas(), 0, 0, out.width, out.height);

    // masks: replace pixels opaquely (independent of "with measurements")
    const key = imageIdToKey.get(imageId);
    if (key) fillMasks(g, vp, imageId, masksFor(key), factor);

    if (withMeasurements) {
      tg.addViewport(viewportId, engine.id);
      for (const n of MEASUREMENT_TOOLS) tg.setToolEnabled(n);
      toolUtils.triggerAnnotationRenderForViewportIds([viewportId]);
      await nextFrame();
      await nextFrame();
      const svg = host.querySelector('svg') as SVGSVGElement | null;
      if (svg) await drawSvg(g, svg, cssW, cssH, out.width, out.height);
    }
  } finally {
    try {
      tg.removeViewports(engine.id, viewportId);
    } catch {
      /* ignore */
    }
    engine.destroy();
    host.remove();
    if (desc) Object.defineProperty(window, 'devicePixelRatio', desc);
    else delete (window as any).devicePixelRatio;
  }
  return out;
}

export function serializeSvg(svg: SVGSVGElement, w: number, h: number) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
  return new XMLSerializer().serializeToString(clone);
}

export function svgToImage(str: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
  });
}

async function drawSvg(g: CanvasRenderingContext2D, svg: SVGSVGElement, cssW: number, cssH: number, w: number, h: number) {
  try {
    const img = await svgToImage(serializeSvg(svg, cssW, cssH));
    g.drawImage(img, 0, 0, w, h);
  } catch {
    /* annotation rasterisation failed – image without measurements */
  }
}

/** Full export composition according to options. */
export async function renderExport(opts: ExportOptions): Promise<HTMLCanvasElement> {
  const plan = planExport(opts);
  const s = useStore.getState();
  const tiles: { i: number; c: HTMLCanvasElement }[] = [];
  for (const i of plan.indices) tiles.push({ i, c: await renderViewport(i, plan.factor, opts.withMeasurements) });
  if (opts.area === 'crop' && s.crop) {
    const c = s.crop;
    const out = document.createElement('canvas');
    out.width = plan.width;
    out.height = plan.height;
    out.getContext('2d')!.drawImage(tiles[0].c, c.x * plan.factor, c.y * plan.factor, c.w * plan.factor, c.h * plan.factor, 0, 0, out.width, out.height);
    return out;
  }
  if (tiles.length === 1) return tiles[0].c;
  const cols = s.layout === 4 ? 2 : s.layout;
  const out = document.createElement('canvas');
  out.width = plan.width;
  out.height = plan.height;
  const g = out.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, out.width, out.height);
  const tw = tiles[0].c.width;
  const th = tiles[0].c.height;
  const gap = GAP * plan.factor;
  tiles.forEach(({ c }, k) => g.drawImage(c, (k % cols) * (tw + gap), Math.floor(k / cols) * (th + gap)));
  return out;
}

export function neutralFileName(ext: string) {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `bildviewer_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
