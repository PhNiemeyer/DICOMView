import type { InstanceRec } from '../core/types';
import type { DictKey } from '../core/i18n';

/** Checks whether a (spatially sorted) series is geometrically suitable for MPR. */
export function checkMprSuitability(list: InstanceRec[]): DictKey | null {
  if (!list.length || list.some((i) => i.kind !== 'dicom')) return 'mpr_kind';
  if (list.some((i) => i.numberOfFrames > 1)) return 'mpr_multiframe';
  if (list.length < 10) return 'mpr_few';
  if (list.some((i) => !i.iop || i.iop.length !== 6 || !i.ipp || i.ipp.length !== 3 || !i.pixelSpacing)) return 'mpr_geometry';
  if (list.some((i) => /RGB|YBR|PALETTE/i.test(i.photometric))) return 'mpr_color';
  const o = list[0].iop!;
  if (list.some((i) => i.iop!.some((v, k) => Math.abs(v - o[k]) > 1e-3))) return 'mpr_orient';
  const ps = list[0].pixelSpacing!;
  if (list.some((i) => i.rows !== list[0].rows || i.columns !== list[0].columns || Math.abs(i.pixelSpacing![0] - ps[0]) > 1e-4 || Math.abs(i.pixelSpacing![1] - ps[1]) > 1e-4))
    return 'mpr_size';
  const n = [o[1] * o[5] - o[2] * o[4], o[2] * o[3] - o[0] * o[5], o[0] * o[4] - o[1] * o[3]];
  const d = list.map((i) => i.ipp![0] * n[0] + i.ipp![1] * n[1] + i.ipp![2] * n[2]).sort((a, b) => a - b);
  const diffs = d.slice(1).map((v, k) => v - d[k]);
  if (diffs.some((x) => x < 0.01)) return 'mpr_spacing';
  const sorted = [...diffs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (diffs.some((x) => Math.abs(x - median) > 0.1 * median + 0.01)) return 'mpr_spacing';
  return null;
}
