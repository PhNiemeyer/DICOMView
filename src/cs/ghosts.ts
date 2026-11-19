// "Messungen über Einzelbild hinaus anzeigen": measurements of other images of the same
// series are drawn (dashed, display only) on the image currently shown. Editing stays on
// the source image. Used for the screen overlay and for screenshot/video export.
import { utilities as csUtils, type Types } from '@cornerstonejs/core';
import { annotation } from '@cornerstonejs/tools';
import { imageIdToKey, keyToInstance } from './registry';
import { imageToCanvas } from './viewportOps';
import { textForAnnotation } from './measure';
import { fontCss } from '../core/settings';

type P = [number, number];

export function ghostAnnotations(currentImageId: string): any[] {
  const curKey = imageIdToKey.get(currentImageId);
  const series = curKey && keyToInstance.get(curKey)?.seriesUID;
  if (!series) return [];
  const out: any[] = [];
  for (const a of annotation.state.getAllAnnotations() as any[]) {
    const src = a.metadata?.referencedImageId;
    if (!src || src === currentImageId) continue;
    const k = imageIdToKey.get(src);
    if (!k || keyToInstance.get(k)?.seriesUID !== series) continue;
    if (a.isVisible === false) continue;
    out.push(a);
  }
  return out;
}

/** Draws the ghosts into a 2D context. `scale` converts canvas CSS px to context px. */
export function drawGhosts(g: CanvasRenderingContext2D, vp: Types.IStackViewport, currentImageId: string, scale: number, offset: P = [0, 0]) {
  const list = ghostAnnotations(currentImageId);
  for (const a of list) {
    const src = a.metadata.referencedImageId;
    const pts: P[] = [];
    for (const w of a.data?.handles?.points ?? []) {
      const ip = csUtils.worldToImageCoords(src, w);
      if (!ip) continue;
      const c = imageToCanvas(vp, currentImageId, [ip[0], ip[1]]);
      pts.push([c[0] * scale + offset[0], c[1] * scale + offset[1]]);
    }
    if (pts.length < 2) continue;
    const st = a.data?.bvStyle ?? {};
    const color = st.color ?? '#57C8CE';
    const lw = parseFloat(st.lineWidth ?? '2') * scale;
    g.save();
    g.strokeStyle = color;
    g.lineWidth = lw;
    g.setLineDash([6 * scale, 4 * scale]);
    g.globalAlpha = 0.9;
    g.beginPath();
    const tool = a.metadata.toolName;
    if (tool === 'CircleROI') {
      const r = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
      g.arc(pts[0][0], pts[0][1], r, 0, Math.PI * 2);
    } else if (tool === 'CobbAngle' && pts.length >= 4) {
      g.moveTo(...pts[0]);
      g.lineTo(...pts[1]);
      g.moveTo(...pts[2]);
      g.lineTo(...pts[3]);
    } else {
      g.moveTo(...pts[0]);
      for (const p of pts.slice(1)) g.lineTo(...p);
    }
    g.stroke();
    // text (value from the source image)
    const lines = textForAnnotation(a);
    if (lines.length) {
      const size = parseFloat(st.textBoxFontSize ?? '15') * scale;
      g.setLineDash([]);
      g.globalAlpha = 1;
      g.font = `${size}px ${st.textBoxFontFamily ?? fontCss('Geist Variable')}`;
      const anchor = pts[pts.length - 1];
      const x = anchor[0] + 8 * scale;
      let y = anchor[1] - 6 * scale;
      const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 8 * scale;
      const h = lines.length * size * 1.25 + 4 * scale;
      g.fillStyle = 'rgba(8,43,67,0.72)';
      g.fillRect(x - 4 * scale, y - size, w, h);
      g.fillStyle = st.textBoxColor ?? '#ffffff';
      for (const l of lines) {
        g.fillText(l, x, y);
        y += size * 1.25;
      }
    }
    g.restore();
  }
}
