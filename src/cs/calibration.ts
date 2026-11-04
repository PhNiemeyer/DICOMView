import type { Calibration, InstanceRec } from '../core/types';

const PROJECTION_MODALITIES = new Set(['CR', 'DX', 'MG', 'XA', 'RF', 'IO', 'PX', 'RG', 'DR']);

/**
 * Physical scale derived from DICOM tags, incl. its origin.
 * - PixelSpacing (0028,0030): patient/object plane for cross-sectional images, or when a
 *   Pixel Spacing Calibration Type is present / it differs from Imager Pixel Spacing.
 * - Imager Pixel Spacing (0018,1164) with ERMF (0018,1114): magnification already corrected.
 * - Imager Pixel Spacing alone: detector plane (image length) – magnification not corrected.
 */
export function dicomCalibration(inst: InstanceRec, modality: string): Calibration | null {
  if (inst.kind !== 'dicom') return null;
  const ps = valid(inst.pixelSpacing);
  const ips = valid(inst.imagerPixelSpacing);
  const projection = PROJECTION_MODALITIES.has(modality);
  if (ps && (!projection || !ips)) {
    if (projection && !inst.pixelSpacingCalibrationType)
      // Projection image with PixelSpacing only: plane unknown → treat as detector plane.
      return { sx: ps[1], sy: ps[0], source: 'dicom-imager-spacing', detail: '(0028,0030)' };
    return { sx: ps[1], sy: ps[0], source: 'dicom-pixel-spacing', detail: '(0028,0030)' };
  }
  if (ps && ips) {
    const same = Math.abs(ps[0] - ips[0]) < 1e-6 && Math.abs(ps[1] - ips[1]) < 1e-6;
    if (!same || inst.pixelSpacingCalibrationType)
      return {
        sx: ps[1],
        sy: ps[0],
        source: 'dicom-pixel-spacing',
        detail: inst.pixelSpacingCalibrationType ? `(0028,0030) ${inst.pixelSpacingCalibrationType}` : '(0028,0030)',
      };
  }
  if (ips) {
    if (inst.ermf && inst.ermf > 0)
      return { sx: ips[1] / inst.ermf, sy: ips[0] / inst.ermf, source: 'dicom-ermf', detail: `ERMF ${inst.ermf}` };
    return { sx: ips[1], sy: ips[0], source: 'dicom-imager-spacing', detail: '(0018,1164)' };
  }
  return null;
}

function valid(v: number[] | null): number[] | null {
  return v && v.length >= 2 && v[0] > 0 && v[1] > 0 ? v : null;
}

export const MAGNIFICATION = 1.1;

/** Can the 1.1 convention be applied? Only to a physically known image (detector) length. */
export function canApplyMagnification(base: Calibration | null, override: Calibration | undefined): 'ok' | 'no-basis' | 'already' {
  if (override && override.source.startsWith('manual')) return 'already';
  if (!base) return 'no-basis';
  if (base.source === 'dicom-imager-spacing') return 'ok';
  return 'already';
}

export function withMagnification(base: Calibration): Calibration {
  return { ...base, sx: base.sx / MAGNIFICATION, sy: base.sy / MAGNIFICATION, magnification11: true };
}

/** Pixel aspect ratio (sy/sx) of the native data; manual calibrations keep it. */
export function nativeAspect(base: Calibration | null): number {
  return base ? base.sy / base.sx : 1;
}

/**
 * Manual calibration from a marked distance in pixel coordinates.
 * dxPx/dyPx: vector in image pixels; realMM: true length. Keeps the native aspect ratio.
 */
export function calibrationFromDistance(dxPx: number, dyPx: number, realMM: number, aspect: number, source: Calibration['source'], detail: string): Calibration | null {
  // length = sqrt((dx*sx)^2 + (dy*sx*aspect)^2) = realMM
  const k = Math.sqrt(dxPx * dxPx + dyPx * dyPx * aspect * aspect);
  if (!(k > 0) || !(realMM > 0)) return null;
  const sx = realMM / k;
  return { sx, sy: sx * aspect, source, detail };
}
