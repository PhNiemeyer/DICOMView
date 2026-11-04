import { it, expect } from 'vitest';
import fs from 'fs';
import zlib from 'zlib';
import { buildPart10Prefix, parseDicomHeader, readMeta } from '../src/import/dicomHeader';

it('deflated DICOM is re-encoded as explicit VR LE and parsable', () => {
  const p = 'testdata/samples/image_dfl.dcm';
  if (!fs.existsSync(p)) return;
  const b = new Uint8Array(fs.readFileSync(p));
  const meta = readMeta(b.subarray(0, 65536))!;
  expect(meta.ts).toBe('1.2.840.10008.1.2.1.99');
  const inflated = new Uint8Array(zlib.inflateRawSync(b.subarray(meta.datasetStart)));
  const prefix = buildPart10Prefix(meta.sopClass, meta.sop, '1.2.840.10008.1.2.1');
  const all = new Uint8Array(prefix.length + inflated.length);
  all.set(prefix);
  all.set(inflated, prefix.length);
  const info = parseDicomHeader(all);
  expect(info.hasImage).toBe(true);
});
