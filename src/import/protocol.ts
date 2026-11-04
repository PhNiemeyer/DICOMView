import type { DicomHeaderInfo } from './dicomHeader';

export type ImportErrorCode =
  | 'empty'
  | 'unsupported'
  | 'too-large'
  | 'dicom-corrupt'
  | 'dicom-no-image'
  | 'dicom-missing-uid'
  | 'image-corrupt'
  | 'zip-corrupt'
  | 'zip-nested'
  | 'zip-encrypted'
  | 'zip-ratio'
  | 'zip-too-many'
  | 'zip-exceeds-limit'
  | 'zip-entry-corrupt'
  | 'duplicate'
  | 'internal';

export type ImportItemResult =
  | { kind: 'dicom'; path: string; blob: Blob; info: DicomHeaderInfo }
  | { kind: 'image'; path: string; blob: Blob; mime: string; width: number; height: number; hash: string }
  | { kind: 'dicomdir'; path: string }
  | { kind: 'error'; path: string; code: ImportErrorCode; bytes?: number };

export type WorkerIn =
  | { type: 'start'; items: { file: Blob; path: string }[]; limitBytes: number; maxFileBytes: number }
  | { type: 'ack'; continue: boolean };

export type WorkerOut =
  | { type: 'progress'; current: number; total: number; name: string }
  | { type: 'progress-sub'; current: number; total: number; name: string }
  | { type: 'zip'; path: string; entries: number; declaredBytes: number }
  | { type: 'item'; result: ImportItemResult }
  | { type: 'fatal'; code: string }
  | { type: 'done' };
