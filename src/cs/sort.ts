import type { InstanceRec } from '../core/types';

/** Sorts spatially using ImagePositionPatient projected on the slice normal, then instance number, then file name. */
export function sortInstances(list: InstanceRec[]): InstanceRec[] {
  const ref = list.find((i) => i.iop && i.iop.length === 6);
  const withPos = list.every((i) => i.ipp && i.ipp.length === 3);
  if (ref && withPos && list.length > 1) {
    const o = ref.iop!;
    const n = [o[1] * o[5] - o[2] * o[4], o[2] * o[3] - o[0] * o[5], o[0] * o[4] - o[1] * o[3]];
    const d = (i: InstanceRec) => i.ipp![0] * n[0] + i.ipp![1] * n[1] + i.ipp![2] * n[2];
    const sameOrient = list.every((i) => i.iop && i.iop.every((v, k) => Math.abs(v - o[k]) < 1e-3));
    if (sameOrient) {
      const dists = list.map(d);
      const distinct = new Set(dists.map((x) => x.toFixed(3))).size === dists.length;
      if (distinct) return [...list].sort((a, b) => d(a) - d(b) || cmpNum(a, b));
    }
  }
  return [...list].sort((a, b) => cmpNum(a, b) || a.acquisitionTime.localeCompare(b.acquisitionTime) || a.fileName.localeCompare(b.fileName, undefined, { numeric: true }));
}

function cmpNum(a: InstanceRec, b: InstanceRec) {
  if (a.instanceNumber == null || b.instanceNumber == null) return 0;
  return a.instanceNumber - b.instanceNumber;
}

