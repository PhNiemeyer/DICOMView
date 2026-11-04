import { describe, expect, it } from 'vitest';
import { angle3, angleBetweenLines, circleDiameter, length } from '../src/cs/geometry';
import { calibrationFromDistance, canApplyMagnification, dicomCalibration, withMagnification } from '../src/cs/calibration';
import { detectType } from '../src/import/detect';
import { checkMprSuitability } from '../src/cs/mpr';
import { sortInstances } from '../src/cs/sort';
import { nextOccurrence } from '../src/core/purge';
import type { InstanceRec } from '../src/core/types';

const px = { sx: 1, sy: 1 };

describe('geometry', () => {
  it('length with anisotropic spacing', () => {
    expect(length([0, 0], [3, 4], px)).toBeCloseTo(5);
    expect(length([0, 0], [10, 0], { sx: 0.5, sy: 2 })).toBeCloseTo(5);
    expect(length([0, 0], [0, 10], { sx: 0.5, sy: 2 })).toBeCloseTo(20);
  });
  it('three-point angle', () => {
    expect(angle3([1, 0], [0, 0], [0, 1], px)).toBeCloseTo(90);
    expect(angle3([1, 0], [0, 0], [1, 1], px)).toBeCloseTo(45);
    expect(angle3([1, 0], [0, 0], [-1, 0], px)).toBeCloseTo(180);
  });
  it('angle between two non-touching lines: inner + supplementary', () => {
    const r = angleBetweenLines([0, 0], [10, 0], [50, 50], [60, 60], px);
    expect(r.inner).toBeCloseTo(45);
    expect(r.supplementary).toBeCloseTo(135);
    const r2 = angleBetweenLines([0, 0], [10, 0], [100, 0], [100 + 10 * Math.cos(Math.PI / 6), 10 * Math.sin(Math.PI / 6)], px);
    expect(r2.inner).toBeCloseTo(30);
    // direction of drawing must not matter
    const r3 = angleBetweenLines([10, 0], [0, 0], [100, 0], [100 + 10 * Math.cos(Math.PI / 6), 10 * Math.sin(Math.PI / 6)], px);
    expect(r3.inner).toBeCloseTo(30);
  });
  it('angle respects pixel aspect', () => {
    // 45° in pixel space, but y pixels are twice as tall -> atan(2)
    expect(angle3([1, 0], [0, 0], [1, 1], { sx: 1, sy: 2 })).toBeCloseTo((Math.atan(2) * 180) / Math.PI);
  });
  it('circle diameter', () => {
    expect(circleDiameter([0, 0], [10, 0], { sx: 0.1, sy: 0.1 })).toBeCloseTo(2);
  });
});

const inst = (p: Partial<InstanceRec>): InstanceRec => ({
  sopUID: Math.random().toString(), seriesUID: 's', studyUID: 'st', fileId: 'f', kind: 'dicom', fileName: '', numberOfFrames: 1, instanceNumber: null,
  rows: 128, columns: 128, ipp: null, iop: null, pixelSpacing: null, imagerPixelSpacing: null, ermf: null, pixelSpacingCalibrationType: '',
  sliceThickness: null, photometric: 'MONOCHROME2', transferSyntax: '', sopClassUID: '', acquisitionTime: '', ...p,
});

describe('calibration', () => {
  it('CT pixel spacing is object plane', () => {
    const c = dicomCalibration(inst({ pixelSpacing: [0.5, 0.7] }), 'CT')!;
    expect(c.source).toBe('dicom-pixel-spacing');
    expect(c.sx).toBe(0.7); // column spacing (horizontal)
    expect(c.sy).toBe(0.5);
    expect(canApplyMagnification(c, undefined)).toBe('already');
  });
  it('DX imager spacing allows 1.1, ERMF does not', () => {
    const c = dicomCalibration(inst({ imagerPixelSpacing: [0.1, 0.1] }), 'DX')!;
    expect(c.source).toBe('dicom-imager-spacing');
    expect(canApplyMagnification(c, undefined)).toBe('ok');
    const m = withMagnification(c);
    // 500 px line = 50 mm image length -> 45.45 mm object length
    expect(length([0, 0], [500, 0], m)).toBeCloseTo(50 / 1.1, 3);
    const e = dicomCalibration(inst({ imagerPixelSpacing: [0.1, 0.1], ermf: 1.1 }), 'DX')!;
    expect(e.source).toBe('dicom-ermf');
    expect(canApplyMagnification(e, undefined)).toBe('already');
  });
  it('JPEG has no basis for 1.1', () => {
    expect(dicomCalibration(inst({ kind: 'image' }), 'JPEG')).toBeNull();
    expect(canApplyMagnification(null, undefined)).toBe('no-basis');
  });
  it('manual calibrations block 1.1 and compute scale', () => {
    const c = calibrationFromDistance(200, 0, 25, 1, 'manual-sphere', '')!; // sphere 25 mm = 200 px
    expect(c.sx).toBeCloseTo(0.125);
    expect(length([0, 0], [100, 0], c)).toBeCloseTo(12.5);
    expect(canApplyMagnification({ sx: 0.1, sy: 0.1, source: 'dicom-imager-spacing' }, c)).toBe('already');
    const d = calibrationFromDistance(30, 40, 10, 1, 'manual-distance', '')!; // 50 px = 10 mm
    expect(d.sx).toBeCloseTo(0.2);
    const a = calibrationFromDistance(0, 50, 10, 2, 'manual-distance', '')!; // aspect kept
    expect(a.sy / a.sx).toBeCloseTo(2);
    expect(length([0, 0], [0, 50], a)).toBeCloseTo(10);
  });
});

describe('detect', () => {
  const b = (arr: number[], n = 200) => { const u = new Uint8Array(n); u.set(arr); return u; };
  it('recognises formats by content', () => {
    const d = new Uint8Array(200); d.set([0x44, 0x49, 0x43, 0x4d], 128);
    expect(detectType(d)).toBe('dicom');
    expect(detectType(b([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(detectType(b([0x89, 0x50, 0x4e, 0x47]))).toBe('png');
    expect(detectType(b([0x50, 0x4b, 0x03, 0x04]))).toBe('zip');
    expect(detectType(b([0x08, 0x00, 0x05, 0x00, 0x43, 0x53, 0x0a, 0x00]))).toBe('dicom-raw');
    expect(detectType(b([0x68, 0x65, 0x6c, 0x6c, 0x6f]))).toBe('unknown');
  });
});

describe('series geometry', () => {
  const ax = [1, 0, 0, 0, 1, 0];
  it('sorts by position, not instance number or name', () => {
    const list = [3, 1, 2, 0].map((z) => inst({ iop: ax, ipp: [0, 0, z], instanceNumber: 10 - z, fileName: `f${z}` }));
    expect(sortInstances(list).map((i) => i.ipp![2])).toEqual([0, 1, 2, 3]);
  });
  it('MPR suitability', () => {
    const ok = Array.from({ length: 20 }, (_, z) => inst({ iop: ax, ipp: [0, 0, z], pixelSpacing: [0.5, 0.5] }));
    expect(checkMprSuitability(ok)).toBeNull();
    expect(checkMprSuitability(ok.slice(0, 5))).toBe('mpr_few');
    const gap = ok.filter((_, i) => i !== 7);
    expect(checkMprSuitability(gap)).toBe('mpr_spacing');
    const mixed = ok.map((x, i) => (i === 3 ? { ...x, iop: [0, 1, 0, 0, 0, -1] } : x));
    expect(checkMprSuitability(mixed)).toBe('mpr_orient');
    expect(checkMprSuitability([inst({ kind: 'image' })])).toBe('mpr_kind');
  });
});

describe('daily purge time', () => {
  it('next 23:59 after a timestamp', () => {
    const t = new Date(2025, 2, 10, 14, 0).getTime();
    expect(new Date(nextOccurrence(t, '23:59')).toString()).toBe(new Date(2025, 2, 10, 23, 59).toString());
    const late = new Date(2025, 2, 10, 23, 59, 30).getTime();
    expect(new Date(nextOccurrence(late, '23:59')).toString()).toBe(new Date(2025, 2, 11, 23, 59).toString());
  });
});
