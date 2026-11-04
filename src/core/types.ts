export type InstanceKind = 'dicom' | 'image';

export interface PatientRec {
  key: string;
  name: string;
  patientId: string;
  birthDate: string;
  sex: string;
  source: 'dicom' | 'manual';
}

export interface StudyRec {
  studyUID: string;
  patientKey: string;
  date: string; // YYYYMMDD or ''
  time: string;
  description: string;
  bodyParts: string[];
  modalities: string[];
  accession: string;
  bytes: number;
  lastAccessed: number;
  importedAt: number;
}

export interface SeriesRec {
  seriesUID: string;
  studyUID: string;
  number: number | null;
  description: string;
  modality: string;
  bodyPart: string;
  orientation: '' | 'AX' | 'COR' | 'SAG' | 'OBL';
  kind: InstanceKind;
  imageCount: number;
}

export interface InstanceRec {
  sopUID: string;
  seriesUID: string;
  studyUID: string;
  fileId: string;
  kind: InstanceKind;
  fileName: string;
  numberOfFrames: number;
  instanceNumber: number | null;
  rows: number;
  columns: number;
  ipp: number[] | null;
  iop: number[] | null;
  pixelSpacing: number[] | null; // [row, col] mm
  imagerPixelSpacing: number[] | null;
  ermf: number | null; // Estimated Radiographic Magnification Factor
  pixelSpacingCalibrationType: string;
  sliceThickness: number | null;
  photometric: string;
  transferSyntax: string;
  sopClassUID: string;
  acquisitionTime: string;
  mime?: string;
}

export interface FileRec {
  id: string;
  blob: Blob;
  size: number;
  studyUID: string;
}

/** A physical calibration in mm per pixel (horizontal / vertical). */
export interface Calibration {
  sx: number;
  sy: number;
  source:
    | 'dicom-pixel-spacing'
    | 'dicom-imager-spacing'
    | 'dicom-ermf'
    | 'manual-sphere'
    | 'manual-distance';
  /** Magnification factor 1.1 applied on top of a detector-plane basis. */
  magnification11?: boolean;
  detail?: string;
}

export interface Mask {
  id: string;
  /** Instance key (sopUID#frame) for single-image masks, seriesUID for series masks */
  scope: 'image' | 'series';
  target: string;
  seriesUID: string;
  // image pixel coordinates (top-left origin)
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface StoredAnnotation {
  instanceKey: string;
  json: any;
}

export interface StudyWork {
  studyUID: string;
  annotations: StoredAnnotation[];
  calibrations: Record<string, Calibration>; // instanceKey → manual calibration
  masks: Mask[];
}

export type DisplayImage = {
  instanceKey: string; // sopUID#frame
  instance: InstanceRec;
  frame: number; // 1-based for multi-frame, 0 for single
};
