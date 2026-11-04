import { db, deleteStudy } from '../core/db';
import { markDataWritten, writesAllowed } from '../core/purge';
import type { InstanceRec, PatientRec, SeriesRec, StudyRec } from '../core/types';
import type { ImportErrorCode, ImportItemResult, WorkerOut } from './protocol';
import type { DicomHeaderInfo } from './dicomHeader';

export interface ImportFileItem {
  file: Blob;
  path: string;
}

export interface ImportIssue {
  path: string; // only the file path inside the user's selection – never patient data
  code: ImportErrorCode | 'dicomdir';
}

export interface ImportProgress {
  current: number;
  total: number;
  sub?: { current: number; total: number };
  name: string;
  imported: number;
  duplicates: number;
  issues: ImportIssue[];
  evictedStudies: number;
  stoppedReason?: 'limit' | 'cancelled' | 'zip-limit' | 'purged';
  done: boolean;
}

export interface PendingImage {
  hash: string;
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  path: string;
}

export interface ImportOptions {
  limitBytes: number;
  /** studies that must not be evicted (currently displayed / exporting) */
  protectedStudies: () => Set<string>;
  onProgress: (p: ImportProgress) => void;
  onEvicted: (count: number) => void;
}

export const MAX_FILE_BYTES = 600 * 1024 * 1024;

export class ImportJob {
  private worker: Worker | null = null;
  private cancelled = false;
  progress: ImportProgress = { current: 0, total: 0, name: '', imported: 0, duplicates: 0, issues: [], evictedStudies: 0, done: false };
  pendingImages: PendingImage[] = [];
  touchedStudies = new Set<string>();

  constructor(private opts: ImportOptions) {}

  cancel() {
    this.cancelled = true;
    this.worker?.terminate();
    this.worker = null;
    this.progress.stoppedReason = 'cancelled';
    this.finish();
  }

  private finish() {
    if (this.progress.done) return;
    this.progress.done = true;
    this.emit();
    this.resolveDone?.();
  }

  private resolveDone?: () => void;

  run(items: ImportFileItem[]): Promise<void> {
    return new Promise((resolve) => {
      this.resolveDone = resolve;
      this.progress.total = items.length;
      const w = new Worker(new URL('./importWorker.ts', import.meta.url), { type: 'module' });
      this.worker = w;
      w.onmessage = async (e: MessageEvent<WorkerOut>) => {
        const m = e.data;
        if (this.cancelled) return;
        switch (m.type) {
          case 'progress':
            this.progress.current = m.current;
            this.progress.name = m.name;
            this.progress.sub = undefined;
            this.emit();
            break;
          case 'progress-sub':
            this.progress.sub = { current: m.current, total: m.total };
            this.progress.name = m.name;
            this.emit();
            break;
          case 'item': {
            let cont = true;
            try {
              cont = await this.handle(m.result);
            } catch {
              this.progress.issues.push({ path: m.result.path, code: 'internal' });
            }
            if (this.cancelled) return;
            w.postMessage({ type: 'ack', continue: cont });
            this.emit();
            break;
          }
          case 'done':
          case 'fatal':
            if (m.type === 'fatal') this.progress.issues.push({ path: '', code: 'internal' });
            w.terminate();
            this.worker = null;
            this.finish();
            break;
        }
      };
      w.onerror = () => {
        this.progress.issues.push({ path: '', code: 'internal' });
        this.finish();
      };
      w.postMessage({ type: 'start', items, limitBytes: this.opts.limitBytes, maxFileBytes: MAX_FILE_BYTES });
    });
  }

  private emitT = 0;
  private emit() {
    const now = performance.now();
    if (!this.progress.done && now - this.emitT < 80) return;
    this.emitT = now;
    this.opts.onProgress({ ...this.progress, issues: [...this.progress.issues] });
  }

  private async handle(r: ImportItemResult): Promise<boolean> {
    if (!writesAllowed()) {
      this.progress.stoppedReason = 'purged';
      return false;
    }
    if (r.kind === 'error') {
      this.progress.issues.push({ path: r.path, code: r.code });
      if (r.code === 'zip-exceeds-limit') this.progress.stoppedReason = 'zip-limit';
      return true;
    }
    if (r.kind === 'dicomdir') {
      this.progress.issues.push({ path: r.path, code: 'dicomdir' });
      return true;
    }
    if (r.kind === 'image') {
      if (this.pendingImages.some((p) => p.hash === r.hash) || (await (await db()).getKey('instances', 'img:' + r.hash))) {
        this.progress.duplicates++;
        return true;
      }
      const ok = await this.ensureSpace(r.blob.size, null);
      if (!ok) return false;
      this.pendingImages.push({ hash: r.hash, blob: r.blob, mime: r.mime, width: r.width, height: r.height, path: r.path });
      this.progress.imported++;
      return true;
    }
    // DICOM
    const d = await db();
    if (await d.getKey('instances', r.info.instance.sopUID)) {
      this.progress.duplicates++;
      return true;
    }
    if (!(await this.ensureSpace(r.blob.size, r.info.study.uid))) return false;
    await storeDicom(r.blob, r.path, r.info);
    this.touchedStudies.add(r.info.study.uid);
    this.progress.imported++;
    return true;
  }

  /** Bytes reserved by images not yet assigned to a study. */
  private pendingBytes() {
    return this.pendingImages.reduce((a, p) => a + p.blob.size, 0);
  }

  /** Least-recently-used eviction; protects displayed studies and the studies of this import. */
  private async ensureSpace(bytes: number, studyUID: string | null): Promise<boolean> {
    const d = await db();
    const limit = this.opts.limitBytes;
    let studies = (await d.getAll('studies')) as StudyRec[];
    let used = studies.reduce((a, s) => a + s.bytes, 0) + this.pendingBytes();
    if (used + bytes <= limit) return true;
    const protectedSet = this.opts.protectedStudies();
    const candidates = studies
      .filter((s) => !protectedSet.has(s.studyUID) && !this.touchedStudies.has(s.studyUID) && s.studyUID !== studyUID)
      .sort((a, b) => a.lastAccessed - b.lastAccessed);
    // only evict if it actually makes enough room
    const freeable = candidates.reduce((a, s) => a + s.bytes, 0);
    if (used - freeable + bytes > limit) {
      this.progress.stoppedReason = 'limit';
      return false;
    }
    let evicted = 0;
    for (const s of candidates) {
      if (used + bytes <= limit) break;
      await deleteStudy(s.studyUID);
      used -= s.bytes;
      evicted++;
    }
    this.progress.evictedStudies += evicted;
    if (evicted) this.opts.onEvicted(evicted);
    return used + bytes <= limit;
  }
}

function uuid() {
  return crypto.randomUUID();
}

export function patientKeyFor(p: DicomHeaderInfo['patient'], studyUID: string) {
  // Identification by ID (+issuer, +birth date); identical names alone never merge.
  if (p.id) return `pid:${p.issuer}|${p.id}|${p.birthDate}`;
  return `study:${studyUID}`;
}

export function orientationOf(iop: number[] | null): SeriesRec['orientation'] {
  if (!iop || iop.length !== 6) return '';
  const n = [iop[1] * iop[5] - iop[2] * iop[4], iop[2] * iop[3] - iop[0] * iop[5], iop[0] * iop[4] - iop[1] * iop[3]];
  const a = n.map(Math.abs);
  const m = Math.max(...a);
  if (m < 0.8) return 'OBL';
  return a[2] === m ? 'AX' : a[1] === m ? 'COR' : 'SAG';
}

async function storeDicom(blob: Blob, path: string, info: DicomHeaderInfo) {
  markDataWritten();
  const d = await db();
  const fileId = uuid();
  const pKey = patientKeyFor(info.patient, info.study.uid);
  const tx = d.transaction(['files', 'instances', 'series', 'studies', 'patients'], 'readwrite');
  await tx.objectStore('files').put({ id: fileId, blob, size: blob.size, studyUID: info.study.uid });
  const inst: InstanceRec = {
    ...info.instance,
    fileId,
    fileName: path.split('/').pop() || '',
    studyUID: info.study.uid,
    seriesUID: info.series.uid,
    kind: 'dicom',
  };
  await tx.objectStore('instances').put(inst);

  const ser = ((await tx.objectStore('series').get(info.series.uid)) as SeriesRec | undefined) ?? {
    seriesUID: info.series.uid,
    studyUID: info.study.uid,
    number: info.series.number,
    description: info.series.description,
    modality: info.series.modality,
    bodyPart: info.series.bodyPart,
    orientation: orientationOf(info.instance.iop),
    kind: 'dicom' as const,
    imageCount: 0,
  };
  ser.imageCount += info.instance.numberOfFrames;
  await tx.objectStore('series').put(ser);

  const now = Date.now();
  const st = ((await tx.objectStore('studies').get(info.study.uid)) as StudyRec | undefined) ?? {
    studyUID: info.study.uid,
    patientKey: pKey,
    date: info.study.date,
    time: info.study.time,
    description: info.study.description,
    bodyParts: [],
    modalities: [],
    accession: info.study.accession,
    bytes: 0,
    lastAccessed: now,
    importedAt: now,
  };
  st.bytes += blob.size;
  st.lastAccessed = now;
  if (info.series.bodyPart && !st.bodyParts.includes(info.series.bodyPart)) st.bodyParts.push(info.series.bodyPart);
  if (info.series.modality && !st.modalities.includes(info.series.modality)) st.modalities.push(info.series.modality);
  await tx.objectStore('studies').put(st);

  if (!(await tx.objectStore('patients').get(pKey))) {
    const p: PatientRec = {
      key: pKey,
      name: info.patient.name,
      patientId: info.patient.id,
      birthDate: info.patient.birthDate,
      sex: info.patient.sex,
      source: 'dicom',
    };
    await tx.objectStore('patients').put(p);
  }
  await tx.done;
}

/** Stores JPEG/PNG/BMP images into an existing or new patient/study. One series per image. */
export async function assignImages(
  images: PendingImage[],
  target: { patientKey?: string; newPatient?: { name: string; patientId: string }; studyUID?: string; newStudy?: { date: string; description: string } },
) {
  if (!writesAllowed() || images.length === 0) return;
  markDataWritten();
  const d = await db();
  const tx = d.transaction(['files', 'instances', 'series', 'studies', 'patients'], 'readwrite');
  let patientKey = target.patientKey;
  if (!patientKey) {
    patientKey = `manual:${uuid()}`;
    await tx.objectStore('patients').put({
      key: patientKey,
      name: target.newPatient?.name || '',
      patientId: target.newPatient?.patientId || '',
      birthDate: '',
      sex: '',
      source: 'manual',
    } satisfies PatientRec);
  }
  let studyUID = target.studyUID;
  const now = Date.now();
  let st: StudyRec | undefined = studyUID ? await tx.objectStore('studies').get(studyUID) : undefined;
  if (!st) {
    studyUID = `manual.${uuid()}`;
    st = {
      studyUID,
      patientKey,
      date: target.newStudy?.date?.replace(/-/g, '') || '',
      time: '',
      description: target.newStudy?.description || '',
      bodyParts: [],
      modalities: [],
      accession: '',
      bytes: 0,
      lastAccessed: now,
      importedAt: now,
    };
  }
  let n = 0;
  for (const img of images) {
    n++;
    const fileId = uuid();
    const seriesUID = `img.${img.hash.slice(0, 32)}.${uuid().slice(0, 8)}`;
    await tx.objectStore('files').put({ id: fileId, blob: img.blob, size: img.blob.size, studyUID: st.studyUID });
    await tx.objectStore('instances').put({
      sopUID: 'img:' + img.hash,
      seriesUID,
      studyUID: st.studyUID,
      fileId,
      kind: 'image',
      fileName: img.path.split('/').pop() || '',
      numberOfFrames: 1,
      instanceNumber: n,
      rows: img.height,
      columns: img.width,
      ipp: null,
      iop: null,
      pixelSpacing: null,
      imagerPixelSpacing: null,
      ermf: null,
      pixelSpacingCalibrationType: '',
      sliceThickness: null,
      photometric: 'RGB',
      transferSyntax: '',
      sopClassUID: '',
      acquisitionTime: '',
      mime: img.mime,
    } satisfies InstanceRec);
    await tx.objectStore('series').put({
      seriesUID,
      studyUID: st.studyUID,
      number: null,
      description: img.path.split('/').pop() || '',
      modality: img.mime.split('/')[1].toUpperCase(),
      bodyPart: '',
      orientation: '',
      kind: 'image',
      imageCount: 1,
    } satisfies SeriesRec);
    st.bytes += img.blob.size;
    const mod = img.mime.split('/')[1].toUpperCase();
    if (!st.modalities.includes(mod)) st.modalities.push(mod);
  }
  st.lastAccessed = now;
  await tx.objectStore('studies').put(st);
  await tx.done;
}

/** Collects files from a drag & drop event incl. nested folders. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<ImportFileItem[]> {
  const out: ImportFileItem[] = [];
  const entries: any[] = [];
  for (const item of Array.from(dt.items)) {
    const en = (item as any).webkitGetAsEntry?.();
    if (en) entries.push(en);
    else {
      const f = item.getAsFile();
      if (f) out.push({ file: f, path: f.name });
    }
  }
  const walk = async (en: any, prefix: string): Promise<void> => {
    if (en.isFile) {
      const f: File = await new Promise((res, rej) => en.file(res, rej));
      out.push({ file: f, path: prefix + f.name });
    } else if (en.isDirectory) {
      const reader = en.createReader();
      // readEntries returns batches of max. 100 entries
      for (;;) {
        const batch: any[] = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const c of batch) await walk(c, prefix + en.name + '/');
      }
    }
  };
  for (const en of entries) {
    try {
      await walk(en, '');
    } catch {
      /* unreadable entry – reported as missing */
    }
  }
  return out;
}

export function filesFromInput(list: FileList | null): ImportFileItem[] {
  if (!list) return [];
  return Array.from(list).map((f) => ({ file: f, path: (f as any).webkitRelativePath || f.name }));
}
