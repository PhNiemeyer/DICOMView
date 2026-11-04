// Image loader for JPEG/PNG/BMP stored in the local working set (scheme "bvimg:<fileId>").
// Decoding uses the browser's own image decoder; data is never uploaded.
import { metaData, utilities, registerImageLoader } from '@cornerstonejs/core';
import { getFile } from '../core/db';

const meta = new Map<string, { rows: number; columns: number; color: boolean }>();

export function registerLocalImageLoader() {
  registerImageLoader('bvimg', (imageId: string) => ({ promise: load(imageId) }) as any);
  metaData.addProvider((type: string, imageId: string) => {
    if (typeof imageId !== 'string' || !imageId.startsWith('bvimg:')) return undefined;
    const m = meta.get(imageId);
    if (!m) return undefined;
    switch (type) {
      case 'imagePlaneModule':
        return {
          frameOfReferenceUID: 'bvimg-' + imageId,
          rows: m.rows,
          columns: m.columns,
          imageOrientationPatient: [1, 0, 0, 0, 1, 0],
          rowCosines: [1, 0, 0],
          columnCosines: [0, 1, 0],
          imagePositionPatient: [0, 0, 0],
          pixelSpacing: undefined,
          rowPixelSpacing: undefined,
          columnPixelSpacing: undefined,
          usingDefaultValues: true,
        };
      case 'imagePixelModule':
        return {
          samplesPerPixel: m.color ? 3 : 1,
          photometricInterpretation: m.color ? 'RGB' : 'MONOCHROME2',
          rows: m.rows,
          columns: m.columns,
          bitsAllocated: 8,
          bitsStored: 8,
          highBit: 7,
          pixelRepresentation: 0,
        };
      case 'generalSeriesModule':
        return { modality: 'OT' };
      case 'generalImageModule':
        return { instanceNumber: 1 };
      case 'voiLutModule':
        return m.color ? undefined : { windowCenter: [127.5], windowWidth: [255] };
      case 'modalityLutModule':
        return { rescaleSlope: 1, rescaleIntercept: 0 };
      default:
        return undefined;
    }
  }, 9000);
}

async function load(imageId: string) {
  const fileId = imageId.slice('bvimg:'.length);
  const rec = await getFile(fileId);
  if (!rec) throw new Error('missing');
  const bmp = await createImageBitmap(rec.blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' } as any);
  const w = bmp.width;
  const h = bmp.height;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = (canvas as any).getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const rgba = g.getImageData(0, 0, w, h).data;
  const n = w * h;
  let gray = true;
  for (let i = 0; i < n * 4; i += 4) {
    if (rgba[i] !== rgba[i + 1] || rgba[i] !== rgba[i + 2]) {
      gray = false;
      break;
    }
  }
  const comps = gray ? 1 : 3;
  const data = new Uint8Array(n * comps);
  let min = 255;
  let max = 0;
  for (let i = 0, j = 0; i < n * 4; i += 4) {
    if (gray) {
      const v = rgba[i];
      data[j++] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    } else {
      data[j++] = rgba[i];
      data[j++] = rgba[i + 1];
      data[j++] = rgba[i + 2];
    }
  }
  if (!gray) {
    min = 0;
    max = 255;
  }
  meta.set(imageId, { rows: h, columns: w, color: !gray });
  const voxelManager = utilities.VoxelManager.createImageVoxelManager({ width: w, height: h, numberOfComponents: comps, scalarData: data, id: imageId } as any);
  return {
    imageId,
    intercept: 0,
    slope: 1,
    windowCenter: 127.5,
    windowWidth: 255,
    color: !gray,
    rgba: false,
    numberOfComponents: comps,
    minPixelValue: min,
    maxPixelValue: max,
    rows: h,
    columns: w,
    height: h,
    width: w,
    columnPixelSpacing: 1,
    rowPixelSpacing: 1,
    invert: false,
    getPixelData: () => data,
    voxelManager,
    sizeInBytes: data.byteLength,
    photometricInterpretation: gray ? 'MONOCHROME2' : 'RGB',
    dataType: 'Uint8Array',
  };
}

export function localImageSize(imageId: string) {
  return meta.get(imageId);
}
