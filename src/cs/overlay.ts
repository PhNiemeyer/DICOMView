// Semi-transparent overlay of two images ("Bilder semitransparent überlagern").
// The second image is rendered once at native resolution with its current display
// settings (window, invert) and masks, then drawn on top of the base image of the
// target viewport. It is anchored in the base image's pixel coordinates, so it follows
// zoom, pan, rotation and flip and is included in exports.
import { Enums, RenderingEngine, type Types } from '@cornerstonejs/core';
import { imageToCanvas } from './viewportOps';
import { imageIdToKey, keyToInstance, masksFor, effectiveCalibration } from './registry';
import { fillMasks } from './masks';

export interface OverlayTop {
  imageId: string;
  canvas: HTMLCanvasElement;
}

let seq = 0;

/** Renders an image like it is shown in `src` (VOI, invert, colormap), unrotated, at native size. */
export async function renderImageNative(src: Types.IStackViewport, imageId: string): Promise<HTMLCanvasElement> {
  const key = imageIdToKey.get(imageId);
  const inst = key ? keyToInstance.get(key) : undefined;
  const cols = inst?.columns || 512;
  const rows = inst?.rows || 512;
  const cal = key ? effectiveCalibration(key) : null;
  const aspect = cal ? cal.sy / cal.sx : 1; // physical height per pixel relative to width
  const w = cols;
  const h = Math.round(rows * aspect);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-${w + 60000}px;top:0;width:${w}px;height:${h}px;pointer-events:none;`;
  document.body.appendChild(host);
  const desc = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => 1 });
  const engine = new RenderingEngine(`bv-ovl-${++seq}`);
  const viewportId = `bv-ovl-vp-${seq}`;
  try {
    engine.enableElement({ viewportId, element: host, type: Enums.ViewportType.STACK, defaultOptions: { background: [0, 0, 0] } } as any);
    const vp = engine.getViewport(viewportId) as Types.IStackViewport;
    const rendered = new Promise<void>((r) => {
      const fn = () => {
        host.removeEventListener(Enums.Events.IMAGE_RENDERED, fn);
        r();
      };
      host.addEventListener(Enums.Events.IMAGE_RENDERED, fn);
      setTimeout(r, 4000);
    });
    await vp.setStack([imageId], 0);
    const p = src.getProperties();
    vp.setProperties({ voiRange: p.voiRange, invert: p.invert, VOILUTFunction: p.VOILUTFunction } as any);
    vp.setViewPresentation({ zoom: 1, pan: [0, 0], rotation: 0 });
    vp.render();
    await rendered;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const g = out.getContext('2d')!;
    g.drawImage(vp.getCanvas(), 0, 0, w, h);
    if (key) fillMasks(g, vp, imageId, masksFor(key), w / host.clientWidth);
  } finally {
    engine.destroy();
    host.remove();
    if (desc) Object.defineProperty(window, 'devicePixelRatio', desc);
    else delete (window as any).devicePixelRatio;
  }
  return out;
}

/**
 * Draws the top image over the base image currently displayed in `vp`.
 * The top image is fitted (contain, centered) into the base image's physical extent.
 */
export function drawOverlayImage(g: CanvasRenderingContext2D, vp: Types.IStackViewport, baseImageId: string, top: OverlayTop, alpha: number, scale: number, offset: [number, number] = [0, 0]) {
  const key = imageIdToKey.get(baseImageId);
  const inst = key ? keyToInstance.get(key) : undefined;
  if (!inst) return;
  const cols = inst.columns;
  const rows = inst.rows;
  const cal = key ? effectiveCalibration(key) : null;
  const sx = cal?.sx ?? 1;
  const sy = cal?.sy ?? 1;
  const tw = top.canvas.width;
  const th = top.canvas.height;
  const aTop = tw / th;
  // fit in base pixel coordinates while matching the physical aspect of the top image
  let wpx = cols;
  let hpx = (cols * sx) / (aTop * sy);
  if (hpx > rows) {
    hpx = rows;
    wpx = (aTop * rows * sy) / sx;
  }
  const x0 = (cols - wpx) / 2;
  const y0 = (rows - hpx) / 2;
  const P0 = imageToCanvas(vp, baseImageId, [x0, y0]);
  const P1 = imageToCanvas(vp, baseImageId, [x0 + wpx, y0]);
  const P2 = imageToCanvas(vp, baseImageId, [x0, y0 + hpx]);
  const t = (p: [number, number]): [number, number] => [p[0] * scale + offset[0], p[1] * scale + offset[1]];
  const [a0, a1, a2] = [t(P0), t(P1), t(P2)];
  g.save();
  g.globalAlpha = Math.max(0, Math.min(1, alpha));
  g.imageSmoothingEnabled = true;
  g.setTransform((a1[0] - a0[0]) / tw, (a1[1] - a0[1]) / tw, (a2[0] - a0[0]) / th, (a2[1] - a0[1]) / th, a0[0], a0[1]);
  g.drawImage(top.canvas, 0, 0);
  g.restore();
}
