export type DetectedType = 'dicom' | 'dicom-raw' | 'jpeg' | 'png' | 'bmp' | 'zip' | 'unknown';

/** Content-based type detection (file names/extensions are not trusted). */
export function detectType(head: Uint8Array): DetectedType {
  if (head.length >= 132 && head[128] === 0x44 && head[129] === 0x49 && head[130] === 0x43 && head[131] === 0x4d)
    return 'dicom';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'png';
  if (head.length >= 2 && head[0] === 0x42 && head[1] === 0x4d && head.length >= 26) {
    // 'BM' + plausible header size
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const dib = dv.getUint32(14, true);
    if ([12, 40, 52, 56, 64, 108, 124].includes(dib)) return 'bmp';
  }
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05) && (head[3] === 0x04 || head[3] === 0x06))
    return 'zip';
  if (looksLikeRawDicom(head)) return 'dicom-raw';
  return 'unknown';
}

/** Dataset without preamble, starting with group 0x0008 (or 0x0002). */
function looksLikeRawDicom(h: Uint8Array): boolean {
  if (h.length < 16) return false;
  const group = h[0] | (h[1] << 8);
  if (group !== 0x0008 && group !== 0x0002) return false;
  const elem = h[2] | (h[3] << 8);
  if (elem > 0x0100) return false;
  const vr = String.fromCharCode(h[4], h[5]);
  if (/^[A-Z]{2}$/.test(vr)) return true; // explicit VR
  const len = h[4] | (h[5] << 8) | (h[6] << 16) | (h[7] << 24);
  return len >= 0 && len < 1024; // implicit VR, plausible length
}
