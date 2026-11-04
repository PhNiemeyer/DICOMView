import * as dicomParser from 'dicom-parser';
import type { InstanceRec } from '../core/types';

export interface DicomHeaderInfo {
  patient: { name: string; id: string; issuer: string; birthDate: string; sex: string };
  study: { uid: string; date: string; time: string; description: string; accession: string };
  series: { uid: string; number: number | null; description: string; modality: string; bodyPart: string };
  instance: Omit<InstanceRec, 'fileId' | 'fileName' | 'studyUID' | 'seriesUID' | 'kind'>;
  isDicomdir: boolean;
  hasImage: boolean;
}

const CHARSETS: Record<string, string> = {
  'ISO_IR 192': 'utf-8',
  'ISO_IR 100': 'windows-1252',
  'ISO_IR 101': 'iso-8859-2',
  'ISO_IR 144': 'iso-8859-5',
  'ISO_IR 6': 'windows-1252',
  '': 'windows-1252',
};

export function parseDicomHeader(bytes: Uint8Array, opts: { rawTs?: string } = {}): DicomHeaderInfo {
  const ds = dicomParser.parseDicom(
    bytes,
    opts.rawTs ? ({ untilTag: 'x7fe00010', TransferSyntaxUID: opts.rawTs } as any) : { untilTag: 'x7fe00010' },
  );
  const charset = (ds.string('x00080005') || '').split('\\').pop()!.trim();
  const decoder = new TextDecoder(CHARSETS[charset] ?? 'windows-1252');
  const s = (tag: string) => {
    const el = ds.elements[tag];
    if (!el || !el.length) return '';
    try {
      return decoder.decode(bytes.subarray(el.dataOffset, el.dataOffset + el.length)).replace(/\0/g, '').trim();
    } catch {
      return (ds.string(tag) || '').trim();
    }
  };
  const ascii = (tag: string) => (ds.string(tag) || '').trim();
  const nums = (tag: string, d = ds): number[] | null => {
    const v = d.string(tag);
    if (!v) return null;
    const arr = v.split('\\').map((x) => parseFloat(x));
    return arr.every((n) => Number.isFinite(n)) ? arr : null;
  };
  const int = (tag: string) => {
    const v = ascii(tag);
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };

  // Enhanced multi-frame: geometry in functional group sequences
  let iop = nums('x00200037');
  let ipp = nums('x00200032');
  let pixelSpacing = nums('x00280030');
  let sliceThickness = nums('x00180050')?.[0] ?? null;
  const shared = ds.elements['x52009229']?.items?.[0]?.dataSet;
  if (shared) {
    const po = shared.elements['x00209116']?.items?.[0]?.dataSet;
    const pm = shared.elements['x00289110']?.items?.[0]?.dataSet;
    if (!iop && po) iop = nums('x00200037', po);
    if (!pixelSpacing && pm) pixelSpacing = nums('x00280030', pm);
    if (sliceThickness == null && pm) sliceThickness = nums('x00180050', pm)?.[0] ?? null;
  }
  const perFrame = ds.elements['x52009230']?.items?.[0]?.dataSet;
  if (perFrame && !ipp) {
    const pp = perFrame.elements['x00209113']?.items?.[0]?.dataSet;
    if (pp) ipp = nums('x00200032', pp);
  }

  const sopClassUID = ascii('x00080016') || ascii('x00020002');
  const rows = ds.uint16('x00280010') || 0;
  const columns = ds.uint16('x00280011') || 0;
  const isDicomdir = sopClassUID === '1.2.840.10008.1.3.10' || !!ds.elements['x00041220'];

  return {
    patient: {
      name: s('x00100010').replace(/\^+/g, ' ').replace(/\s+/g, ' ').trim(),
      id: s('x00100020'),
      issuer: s('x00100021'),
      birthDate: ascii('x00100030'),
      sex: ascii('x00100040'),
    },
    study: {
      uid: ascii('x0020000d'),
      date: ascii('x00080020'),
      time: ascii('x00080030'),
      description: s('x00081030'),
      accession: s('x00080050'),
    },
    series: {
      uid: ascii('x0020000e'),
      number: int('x00200011'),
      description: s('x0008103e'),
      modality: ascii('x00080060'),
      bodyPart: s('x00180015'),
    },
    instance: {
      sopUID: ascii('x00080018') || ascii('x00020003'),
      sopClassUID,
      numberOfFrames: Math.max(1, int('x00280008') ?? 1),
      instanceNumber: int('x00200013'),
      rows,
      columns,
      ipp,
      iop,
      pixelSpacing,
      imagerPixelSpacing: nums('x00181164'),
      ermf: nums('x00181114')?.[0] ?? null,
      pixelSpacingCalibrationType: ascii('x00280a02'),
      sliceThickness,
      photometric: ascii('x00280004'),
      transferSyntax: ascii('x00020010') || opts.rawTs || '',
      acquisitionTime: ascii('x00080032') || ascii('x00080033'),
    },
    isDicomdir,
    hasImage: rows > 0 && columns > 0,
  };
}

/** Builds a minimal Part-10 header so a raw (preamble-less) DICOM dataset can be loaded. */
export function buildPart10Prefix(sopClassUID: string, sopUID: string, transferSyntax = '1.2.840.10008.1.2'): Uint8Array {
  const enc = new TextEncoder();
  const elems: Uint8Array[] = [];
  const pad = (v: string) => (v.length % 2 ? v + '\0' : v);
  const el = (elem: number, vr: string, value: Uint8Array) => {
    const head = new Uint8Array(8);
    const dv = new DataView(head.buffer);
    dv.setUint16(0, 0x0002, true);
    dv.setUint16(2, elem, true);
    head[4] = vr.charCodeAt(0);
    head[5] = vr.charCodeAt(1);
    if (vr === 'OB') {
      const h = new Uint8Array(12);
      h.set(head.subarray(0, 6));
      new DataView(h.buffer).setUint32(8, value.length, true);
      return concat([h, value]);
    }
    dv.setUint16(6, value.length, true);
    return concat([head, value]);
  };
  const str = (v: string) => enc.encode(pad(v));
  elems.push(el(0x0001, 'OB', new Uint8Array([0, 1])));
  elems.push(el(0x0002, 'UI', str(sopClassUID || '1.2.840.10008.5.1.4.1.1.7')));
  elems.push(el(0x0003, 'UI', str(sopUID)));
  elems.push(el(0x0010, 'UI', str(transferSyntax)));
  const body = concat(elems);
  const groupLen = new Uint8Array(12);
  const gdv = new DataView(groupLen.buffer);
  gdv.setUint16(0, 0x0002, true);
  gdv.setUint16(2, 0x0000, true);
  groupLen[4] = 'U'.charCodeAt(0);
  groupLen[5] = 'L'.charCodeAt(0);
  gdv.setUint16(6, 4, true);
  gdv.setUint32(8, body.length, true);
  const preamble = new Uint8Array(132);
  preamble.set(enc.encode('DICM'), 128);
  return concat([preamble, groupLen, body]);
}

function concat(parts: Uint8Array[]) {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const DEFLATE_TS = '1.2.840.10008.1.2.1.99';

/** Reads the File Meta group; returns transfer syntax and offset where the dataset starts. */
export function readMeta(bytes: Uint8Array): { ts: string; sopClass: string; sop: string; datasetStart: number } | null {
  try {
    const meta = (dicomParser as any).readPart10Header(bytes);
    const glEl = meta.elements['x00020000'];
    const gl = meta.uint32('x00020000');
    if (!glEl || !gl) return null;
    return {
      ts: (meta.string('x00020010') || '').trim(),
      sopClass: (meta.string('x00020002') || '').trim(),
      sop: (meta.string('x00020003') || '').trim(),
      datasetStart: glEl.dataOffset + glEl.length + gl,
    };
  } catch {
    return null;
  }
}
