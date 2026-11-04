import { utilities as csUtils } from '@cornerstonejs/core';
import { annotation as csAnnotation } from '@cornerstonejs/tools';
import { fmtNum, t } from '../core/i18n';
import { calibrationForImageId } from './registry';
import { angle3, angleBetweenLines, circleDiameter, length, type P2, type Scale } from './geometry';

export function imageIdFromTarget(targetId: string): string | null {
  return targetId?.startsWith('imageId:') ? targetId.slice('imageId:'.length) : null;
}

function toImage(imageId: string, world: number[]): P2 | null {
  try {
    const p = csUtils.worldToImageCoords(imageId, world as any);
    return p ? [p[0], p[1]] : null;
  } catch {
    return null;
  }
}

/** The image an annotation belongs to (found via its data object; targetId formats vary). */
function imageIdOf(data: any, targetId: string | string[]): string | null {
  for (const a of csAnnotation.state.getAllAnnotations() as any[]) if (a.data === data) return a.metadata?.referencedImageId ?? null;
  const tid = Array.isArray(targetId) ? targetId[0] : targetId;
  return imageIdFromTarget(tid);
}

function ctx(data: any, targetId: string | string[]) {
  const imageId = imageIdOf(data, targetId);
  if (!imageId) return null;
  const pts = (data.handles?.points ?? []).map((w: number[]) => toImage(imageId, w));
  if (pts.some((p: P2 | null) => !p)) return null;
  const cal = calibrationForImageId(imageId);
  const scale: Scale = cal ? { sx: cal.sx, sy: cal.sy } : { sx: 1, sy: 1 };
  // angles always use the pixel aspect ratio of the calibration (or square pixels)
  const aspectScale: Scale = cal ? { sx: 1, sy: cal.sy / cal.sx } : { sx: 1, sy: 1 };
  return { pts: pts as P2[], cal, scale, aspectScale };
}

function lenText(v: number, cal: ReturnType<typeof calibrationForImageId>) {
  if (!cal) return `${fmtNum(v, 0)} ${t('pixelUnit')}`;
  return `${fmtNum(v, 1)} mm${cal.magnification11 ? ' (÷1,1)' : ''}`;
}

export function lengthText(data: any, targetId: string) {
  const c = ctx(data, targetId);
  if (!c || c.pts.length < 2) return [];
  return [lenText(length(c.pts[0], c.pts[1], c.scale), c.cal)];
}

export function angleText(data: any, targetId: string) {
  const c = ctx(data, targetId);
  if (!c || c.pts.length < 3) return [];
  const a = angle3(c.pts[0], c.pts[1], c.pts[2], c.aspectScale);
  return Number.isFinite(a) ? [`${fmtNum(a, 1)}°`] : [];
}

export type AngleMode = 'acute' | 'obtuse' | 'both';

export function cobbText(data: any, targetId: string) {
  const c = ctx(data, targetId);
  if (!c || c.pts.length < 4) return [];
  const { inner, supplementary } = angleBetweenLines(c.pts[0], c.pts[1], c.pts[2], c.pts[3], c.aspectScale);
  if (!Number.isFinite(inner)) return [];
  const mode: AngleMode = data.bvAngleMode ?? 'acute';
  const i = `${fmtNum(inner, 1)}° (${t('acuteShort')})`;
  const s = `${fmtNum(supplementary, 1)}° (${t('obtuseShort')})`;
  return mode === 'acute' ? [i] : mode === 'obtuse' ? [s] : [i, s];
}

export function circleText(data: any, targetId: string | string[]) {
  const c = ctx(data, targetId);
  if (!c || c.pts.length < 2) return [];
  return [`Ø ${lenText(circleDiameter(c.pts[0], c.pts[1], c.scale), c.cal)}`];
}

/** Pixel-space vector of a line/circle annotation on its image (for calibration). */
export function annotationPixelVector(ann: any): { dx: number; dy: number; imageId: string } | null {
  const imageId = ann?.metadata?.referencedImageId;
  const pts = ann?.data?.handles?.points;
  if (!imageId || !pts || pts.length < 2) return null;
  const a = toImage(imageId, pts[0]);
  const b = toImage(imageId, pts[1]);
  if (!a || !b) return null;
  return { dx: b[0] - a[0], dy: b[1] - a[1], imageId };
}
