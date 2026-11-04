/// <reference lib="webworker" />
// Import worker: content detection, ZIP extraction (with limits) and DICOM header parsing
// run off the UI thread. Nothing is sent anywhere – results are posted back to the page.
import { BlobReader, ZipReader, configure } from '@zip.js/zip.js';
import { inflateSync } from 'fflate';
import { detectType } from './detect';
import { buildPart10Prefix, parseDicomHeader, readMeta, DEFLATE_TS } from './dicomHeader';
import type { WorkerIn, WorkerOut, ImportItemResult } from './protocol';

configure({ useWebWorkers: false, useCompressionStream: true });

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let ackResolve: ((cont: boolean) => void) | null = null;

const MAX_ZIP_DEPTH = 2;
const MAX_ENTRIES = 50_000;
const MAX_RATIO = 250; // uncompressed / compressed, per entry with relevant size
const RATIO_MIN_SIZE = 32 * 1024 * 1024;

ctx.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg.type === 'ack') {
    ackResolve?.(msg.continue);
    ackResolve = null;
    return;
  }
  if (msg.type === 'start') {
    try {
      let index = 0;
      for (const item of msg.items) {
        index++;
        post({ type: 'progress', current: index, total: msg.items.length, name: item.path });
        const cont = await handleBlob(item.file, item.path, msg.limitBytes, msg.maxFileBytes, 0);
        if (!cont) break;
      }
    } catch (err) {
      post({ type: 'fatal', code: 'internal' });
    }
    post({ type: 'done' });
  }
};

function post(m: WorkerOut) {
  ctx.postMessage(m);
}

/** Posts a result and waits until the page has stored it (back pressure + budget control). */
function emit(r: ImportItemResult): Promise<boolean> {
  return new Promise((resolve) => {
    ackResolve = resolve;
    post({ type: 'item', result: r });
  });
}

async function readHead(blob: Blob, n: number) {
  return new Uint8Array(await blob.slice(0, n).arrayBuffer());
}

async function handleBlob(blob: Blob, path: string, limitBytes: number, maxFileBytes: number, depth: number): Promise<boolean> {
  const name = path.split('/').pop() || path;
  if (blob.size === 0) return emit({ kind: 'error', path, code: 'empty' });
  if (/^(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(name) || /(^|\/)__MACOSX\//.test(path)) return true;

  const head = await readHead(blob, 512);
  const type = detectType(head);

  if (type === 'zip') {
    if (depth >= MAX_ZIP_DEPTH) return emit({ kind: 'error', path, code: 'zip-nested' });
    return handleZip(blob, path, limitBytes, maxFileBytes, depth);
  }
  if (blob.size > maxFileBytes) return emit({ kind: 'error', path, code: 'too-large' });

  if (type === 'dicom') {
    // Deflated Explicit VR Little Endian: inflate locally and store as Explicit VR LE
    const meta = readMeta(await readHead(blob, 64 * 1024));
    if (meta?.ts === DEFLATE_TS) {
      try {
        // fflate tolerates the trailing padding byte some writers append (DecompressionStream does not)
        const inflated = inflateSync(new Uint8Array(await blob.slice(meta.datasetStart).arrayBuffer()));
        blob = new Blob([buildPart10Prefix(meta.sopClass, meta.sop.replace(/\0/g, ''), '1.2.840.10008.1.2.1') as BlobPart, inflated as BlobPart], { type: 'application/dicom' });
      } catch {
        return emit({ kind: 'error', path, code: 'dicom-corrupt' });
      }
    }
  }
  if (type === 'dicom' || type === 'dicom-raw') {
    try {
      const explicitRaw = type === 'dicom-raw' && /^[A-Z]{2}$/.test(String.fromCharCode(head[4], head[5]));
      const rawTs = explicitRaw ? '1.2.840.10008.1.2.1' : '1.2.840.10008.1.2';
      const info = await parseHeaderAdaptive(blob, type === 'dicom-raw' ? rawTs : undefined);
      if (info.isDicomdir) return emit({ kind: 'dicomdir', path });
      if (!info.hasImage) return emit({ kind: 'error', path, code: 'dicom-no-image' });
      if (!info.study.uid || !info.series.uid || !info.instance.sopUID)
        return emit({ kind: 'error', path, code: 'dicom-missing-uid' });
      let out: Blob = blob;
      if (type === 'dicom-raw') {
        const prefix = buildPart10Prefix(info.instance.sopClassUID, info.instance.sopUID, rawTs);
        out = new Blob([prefix as BlobPart, blob], { type: 'application/dicom' });
        info.instance.transferSyntax = rawTs;
      }
      return emit({ kind: 'dicom', path, blob: out, info });
    } catch {
      return emit({ kind: 'error', path, code: 'dicom-corrupt' });
    }
  }
  if (type === 'jpeg' || type === 'png' || type === 'bmp') {
    try {
      const mime = type === 'jpeg' ? 'image/jpeg' : type === 'png' ? 'image/png' : 'image/bmp';
      const typed = new Blob([blob], { type: mime });
      const bmp = await createImageBitmap(typed);
      const width = bmp.width;
      const height = bmp.height;
      bmp.close();
      const hash = await sha256(typed);
      return emit({ kind: 'image', path, blob: typed, mime, width, height, hash });
    } catch {
      return emit({ kind: 'error', path, code: 'image-corrupt' });
    }
  }
  return emit({ kind: 'error', path, code: 'unsupported' });
}

async function parseHeaderAdaptive(blob: Blob, rawTs?: string) {
  const sizes = [2 * 1024 * 1024, 32 * 1024 * 1024, blob.size];
  let lastErr: unknown;
  for (const n of sizes) {
    const bytes = new Uint8Array(await blob.slice(0, Math.min(n, blob.size)).arrayBuffer());
    try {
      return parseDicomHeader(bytes, { rawTs });
    } catch (e) {
      lastErr = e;
      if (n >= blob.size) break;
    }
  }
  throw lastErr;
}

async function sha256(blob: Blob) {
  const buf = await blob.arrayBuffer();
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function handleZip(blob: Blob, path: string, limitBytes: number, maxFileBytes: number, depth: number) {
  let reader: ZipReader<unknown> | null = null;
  try {
    reader = new ZipReader(new BlobReader(blob));
    const entries = await reader.getEntries();
    const files = entries.filter((en) => !en.directory);
    if (files.length > MAX_ENTRIES) {
      return emit({ kind: 'error', path, code: 'zip-too-many' });
    }
    // Decide on declared uncompressed size (central directory), not on the archive size.
    const declared = files.reduce((a, en) => a + (en.uncompressedSize || 0), 0);
    post({ type: 'zip', path, entries: files.length, declaredBytes: declared });
    if (declared > limitBytes) {
      return emit({ kind: 'error', path, code: 'zip-exceeds-limit', bytes: declared });
    }
    let i = 0;
    for (const en of files) {
      i++;
      const epath = `${path}/${en.filename}`;
      post({ type: 'progress-sub', current: i, total: files.length, name: epath });
      if (en.encrypted) {
        if (!(await emit({ kind: 'error', path: epath, code: 'zip-encrypted' }))) return false;
        continue;
      }
      if (en.uncompressedSize > maxFileBytes) {
        if (!(await emit({ kind: 'error', path: epath, code: 'too-large' }))) return false;
        continue;
      }
      if (
        en.uncompressedSize > RATIO_MIN_SIZE &&
        en.compressedSize > 0 &&
        en.uncompressedSize / en.compressedSize > MAX_RATIO
      ) {
        if (!(await emit({ kind: 'error', path: epath, code: 'zip-ratio' }))) return false;
        continue;
      }
      let extracted: Blob;
      try {
        extracted = await extractLimited(en, en.uncompressedSize);
      } catch {
        if (!(await emit({ kind: 'error', path: epath, code: 'zip-entry-corrupt' }))) return false;
        continue;
      }
      if (!(await handleBlob(extracted, epath, limitBytes, maxFileBytes, depth + 1))) return false;
    }
    return true;
  } catch {
    return emit({ kind: 'error', path, code: 'zip-corrupt' });
  } finally {
    await reader?.close().catch(() => undefined);
  }
}

/** Extracts an entry while counting real output bytes; aborts if the declared size is exceeded. */
async function extractLimited(entry: any, declared: number): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const hardLimit = declared + 1024;
  const controller = new AbortController();
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      total += chunk.length;
      if (total > hardLimit) {
        controller.abort();
        throw new Error('size-mismatch');
      }
      chunks.push(chunk);
    },
  });
  await entry.getData(writable, { signal: controller.signal });
  return new Blob(chunks as BlobPart[]);
}
