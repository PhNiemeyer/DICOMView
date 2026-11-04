import type { Types } from '@cornerstonejs/core';
import type { Mask } from '../core/types';
import { imageToCanvas } from './viewportOps';

/** Corners of a mask (image px) in canvas CSS coordinates – follows zoom/pan/rotation/flip. */
export function maskPolygon(vp: Types.IStackViewport, imageId: string, m: Mask): [number, number][] {
  return [
    [m.x, m.y],
    [m.x + m.w, m.y],
    [m.x + m.w, m.y + m.h],
    [m.x, m.y + m.h],
  ].map((p) => imageToCanvas(vp, imageId, p as [number, number]));
}

/**
 * Draws opaque masks (no border) – used for the screen overlay AND the export.
 * In exports this replaces the pixels in the output raster.
 */
export function fillMasks(g: CanvasRenderingContext2D, vp: Types.IStackViewport, imageId: string, masks: Mask[], scale: number, offset: [number, number] = [0, 0]) {
  for (const m of masks) {
    const poly = maskPolygon(vp, imageId, m);
    g.save();
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = m.color;
    g.beginPath();
    poly.forEach(([x, y], i) => {
      const px = x * scale + offset[0];
      const py = y * scale + offset[1];
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    });
    g.closePath();
    g.fill();
    // a 1px same-colour stroke closes anti-aliasing seams at the edge
    g.strokeStyle = m.color;
    g.lineWidth = Math.max(1, scale);
    g.stroke();
    g.restore();
  }
}

export function pointInPoly(p: [number, number], poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
