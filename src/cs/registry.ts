// Session registry: maps cornerstone imageIds to stable instance keys and
// holds per-image calibration and masks. Persisted per study in IndexedDB ("work").
import type { Calibration, DisplayImage, InstanceRec, Mask, SeriesRec, StudyWork } from '../core/types';
import { dicomCalibration, withMagnification } from './calibration';
import { getWork, putWork } from '../core/db';
import { writesAllowed } from '../core/purge';

export const imageIdToKey = new Map<string, string>();
export const keyToImageId = new Map<string, string>();
export const keyToInstance = new Map<string, InstanceRec>();
export const keyToSeries = new Map<string, SeriesRec>();
export const seriesImages = new Map<string, DisplayImage[]>(); // seriesUID → sorted images

const works = new Map<string, StudyWork>(); // studyUID → work
const listeners = new Set<() => void>();
let version = 0;

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function getVersion() {
  return version;
}
export function notify() {
  version++;
  listeners.forEach((f) => f());
}

export async function loadWork(studyUID: string) {
  if (!works.has(studyUID)) works.set(studyUID, await getWork(studyUID));
  return works.get(studyUID)!;
}
export function workOf(studyUID: string) {
  return works.get(studyUID);
}
export function forgetWork(studyUID: string) {
  works.delete(studyUID);
}

const saveTimers = new Map<string, number>();
export function saveWorkSoon(studyUID: string) {
  const w = works.get(studyUID);
  if (!w) return;
  clearTimeout(saveTimers.get(studyUID));
  saveTimers.set(
    studyUID,
    window.setTimeout(() => {
      if (writesAllowed()) void putWork(w);
    }, 400),
  );
}

export function baseCalibration(key: string): Calibration | null {
  const inst = keyToInstance.get(key);
  if (!inst) return null;
  return dicomCalibration(inst, keyToSeries.get(key)?.modality || '');
}

export function overrideCalibration(key: string): Calibration | undefined {
  const inst = keyToInstance.get(key);
  if (!inst) return undefined;
  return works.get(inst.studyUID)?.calibrations[key];
}

/** Effective calibration used for measurements (null → pixel values only). */
export function effectiveCalibration(key: string): Calibration | null {
  const o = overrideCalibration(key);
  if (o) {
    if (o.magnification11) {
      const b = baseCalibration(key);
      return b ? withMagnification(b) : null;
    }
    return o;
  }
  return baseCalibration(key);
}

export function calibrationForImageId(imageId: string): Calibration | null {
  const key = imageIdToKey.get(imageId);
  return key ? effectiveCalibration(key) : null;
}

export function setOverride(keys: string[], cal: Calibration | null) {
  for (const key of keys) {
    const inst = keyToInstance.get(key);
    if (!inst) continue;
    const w = works.get(inst.studyUID);
    if (!w) continue;
    if (cal) w.calibrations[key] = cal;
    else delete w.calibrations[key];
    saveWorkSoon(inst.studyUID);
  }
  notify();
}

export function masksFor(key: string): Mask[] {
  const inst = keyToInstance.get(key);
  if (!inst) return [];
  const w = works.get(inst.studyUID);
  if (!w) return [];
  return w.masks.filter((m) => (m.scope === 'image' ? m.target === key : m.target === inst.seriesUID));
}

export function allMasksOfStudy(studyUID: string) {
  return works.get(studyUID)?.masks ?? [];
}

export function updateMasks(studyUID: string, fn: (m: Mask[]) => Mask[]) {
  const w = works.get(studyUID);
  if (!w) return;
  w.masks = fn(w.masks);
  saveWorkSoon(studyUID);
  notify();
}
