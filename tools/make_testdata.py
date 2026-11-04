"""Generates synthetic test data (no real patients) + copies public pydicom samples.
Usage: python3 -I tools/make_testdata.py <outdir>"""
import os, sys, shutil, random, zipfile, io
import numpy as np
import pydicom
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid, CTImageStorage, SecondaryCaptureImageStorage
from PIL import Image, ImageDraw

out = sys.argv[1]
shutil.rmtree(out, ignore_errors=True)
os.makedirs(out)

def base(sop_class, patient_name, patient_id, study_uid, series_uid, modality, study_date, desc, series_desc, body):
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = sop_class
    meta.MediaStorageSOPInstanceUID = generate_uid()
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds = Dataset(); ds.file_meta = meta
    ds.SOPClassUID = sop_class; ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    ds.PatientName = patient_name; ds.PatientID = patient_id; ds.PatientBirthDate = '19800101'; ds.PatientSex = 'O'
    ds.StudyInstanceUID = study_uid; ds.SeriesInstanceUID = series_uid
    ds.StudyDate = study_date; ds.StudyTime = '101500'; ds.Modality = modality
    ds.StudyDescription = desc; ds.SeriesDescription = series_desc; ds.BodyPartExamined = body
    ds.SpecificCharacterSet = 'ISO_IR 192'
    return ds

def save(ds, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pydicom.dcmwrite(path, ds, enforce_file_format=True)

# 1) CT phantom: 40 axial slices, 128x128, 0.5 mm pixels, 1.0 mm slice spacing,
#    a sphere (r=10mm) + a burned-in white "text" block top-left. Files shuffled, no extension.
study = generate_uid(); series = generate_uid(); frame = generate_uid()
N, S = 40, 128
order = list(range(N)); random.seed(4); random.shuffle(order)
for fi, k in enumerate(order):
    ds = base(CTImageStorage, 'Muster^Anna', 'SYN-001', study, series, 'CT', '20250312', 'Knie rechts Phantom', 'CT Knie axial', 'KNEE')
    ds.FrameOfReferenceUID = frame
    ds.SeriesNumber = 2; ds.InstanceNumber = N - k  # deliberately reversed vs. position
    ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
    ds.ImagePositionPatient = [-32.0, -32.0, float(k) * 1.0]
    ds.PixelSpacing = [0.5, 0.5]; ds.SliceThickness = 1.0
    ds.Rows = S; ds.Columns = S; ds.SamplesPerPixel = 1; ds.PhotometricInterpretation = 'MONOCHROME2'
    ds.BitsAllocated = 16; ds.BitsStored = 16; ds.HighBit = 15; ds.PixelRepresentation = 1
    ds.RescaleSlope = 1; ds.RescaleIntercept = -1024; ds.WindowCenter = 40; ds.WindowWidth = 400
    yy, xx = np.mgrid[0:S, 0:S]
    x = -32 + xx * 0.5; y = -32 + yy * 0.5; z = k * 1.0 - 20
    img = np.full((S, S), 1024 - 1000, np.int16)  # air
    body = (x**2 + y**2) < 28**2
    img[body] = 1024 + 40
    sphere = (x**2 + y**2 + z**2) < 10**2
    img[sphere] = 1024 + 900
    img[4:12, 4:40] = 1024 + 3000  # burned-in "text"
    ds.PixelData = img.tobytes()
    save(ds, f'{out}/mixed/ct_phantom/sub{fi % 3}/IMG{fi:04d}')

# 2) Same patient name, different PatientID -> must stay separate
ds = base(SecondaryCaptureImageStorage, 'Muster^Anna', 'SYN-999', generate_uid(), generate_uid(), 'OT', '20240101', 'Andere Patientin gleicher Name', 'SC', 'KNEE')
ds.Rows = ds.Columns = 64; ds.SamplesPerPixel = 1; ds.PhotometricInterpretation = 'MONOCHROME2'
ds.BitsAllocated = 8; ds.BitsStored = 8; ds.HighBit = 7; ds.PixelRepresentation = 0
ds.PixelData = (np.arange(64*64) % 256).astype(np.uint8).tobytes()
save(ds, f'{out}/mixed/sc_same_name.dcm')

# 3) Projection X-ray (DX) with Imager Pixel Spacing 0.1 mm (detector plane), no ERMF.
#    A white line of exactly 500 px horizontally = 50.0 mm image length -> object 45.45 mm with 1.1.
st2 = generate_uid()
def dx(ermf, name, ps_type=None):
    ds = base('1.2.840.10008.5.1.4.1.1.1.1', 'Beispiel^Ben', 'SYN-002', st2, generate_uid(), 'DX', '20250610', 'Knie a.p.', name, 'KNEE')
    ds.SeriesNumber = 1 if ermf is None else 2
    ds.Rows = 800; ds.Columns = 1000; ds.SamplesPerPixel = 1; ds.PhotometricInterpretation = 'MONOCHROME1'
    ds.BitsAllocated = 16; ds.BitsStored = 12; ds.HighBit = 11; ds.PixelRepresentation = 0
    ds.ImagerPixelSpacing = [0.1, 0.1]
    if ermf: ds.EstimatedRadiographicMagnificationFactor = ermf
    img = np.full((800, 1000), 3000, np.uint16)
    img[398:402, 200:700] = 200   # 500 px line
    yy, xx = np.mgrid[0:800, 0:1000]
    img[((xx-500)**2 + (yy-600)**2) < 100**2] = 800  # sphere marker, diameter 200 px
    img[20:40, 20:300] = 0  # burned-in label (MONOCHROME1 -> bright)
    ds.PixelData = img.tobytes()
    return ds
save(dx(None, 'DX ohne ERMF'), f'{out}/mixed/dx/dx_noermf.dcm')
save(dx(1.1, 'DX mit ERMF 1,1'), f'{out}/mixed/dx/dx_ermf.dcm')

# 4) Older study of patient B (sorting by date)
ds = dx(None, 'DX Voraufnahme'); ds.StudyInstanceUID = generate_uid(); ds.StudyDate = '20230115'; ds.StudyDescription = 'Knie Voraufnahme'
save(ds, f'{out}/mixed/dx/older')

# 5) JPEG / PNG / BMP with known geometry: 100 px line, 200 px circle
im = Image.new('RGB', (600, 400), (20, 20, 20)); d = ImageDraw.Draw(im)
d.line([(100, 200), (200, 200)], fill=(255, 255, 255), width=3)
d.ellipse([300, 100, 500, 300], outline=(255, 255, 255), width=3)
d.rectangle([10, 10, 150, 30], fill=(240, 240, 240))
im.save(f'{out}/mixed/photo.jpg', quality=92)
im.convert('L').save(f'{out}/mixed/scan.png')
im.save(f'{out}/mixed/legacy.bmp')

# 6) Broken + unsupported files
open(f'{out}/mixed/notes.txt', 'w').write('kein Bild')
open(f'{out}/mixed/broken.dcm', 'wb').write(b'\0' * 128 + b'DICM' + os.urandom(300))
open(f'{out}/mixed/empty.dat', 'wb').close()

# 7) Public anonymised pydicom samples (compression coverage)
src = os.path.join(os.path.dirname(pydicom.data.__file__), 'test_files')
for f in ['CT_small.dcm', 'MR_small.dcm', 'MR_small_RLE.dcm', 'MR_small_jp2klossless.dcm', 'MR_small_jpeg_ls_lossless.dcm', 'JPEG2000.dcm', 'SC_rgb_jpeg_dcmtk.dcm', 'JPGExtended.dcm', 'JPEG-lossy.dcm', 'SC_rgb_rle.dcm', 'no_meta.dcm', 'ExplVR_LitEndNoMeta.dcm', 'MR_small_bigendian.dcm', 'image_dfl.dcm', 'examples_palette.dcm', 'SC_ybr_full_422_uncompressed.dcm', 'test-SR.dcm', 'examples_overlay.dcm']:
    p = os.path.join(src, f)
    if os.path.exists(p):
        os.makedirs(f'{out}/samples', exist_ok=True)
        try:
            # same instance in several encodings -> give each copy its own UIDs (no duplicate detection)
            ds = pydicom.dcmread(p)
            if 'SOPInstanceUID' in ds and hasattr(ds, 'file_meta') and 'TransferSyntaxUID' in ds.file_meta:
                ds.SOPInstanceUID = generate_uid(); ds.file_meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID
                ds.SeriesInstanceUID = generate_uid(); ds.SeriesDescription = f
                ds.save_as(f'{out}/samples/{f}', enforce_file_format=True)
                continue
        except Exception:
            pass
        shutil.copy(p, f'{out}/samples/{f}')

# 8) ZIP of the mixed folder (+ a nested zip) and a zip bomb candidate
def zipdir(d, zpath):
    with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(d):
            for f in files:
                z.write(os.path.join(root, f), os.path.relpath(os.path.join(root, f), d))
zipdir(f'{out}/mixed', f'{out}/mixed.zip')
with zipfile.ZipFile(f'{out}/bomb.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('zeros.bin', b'\0' * (300 * 1024 * 1024))
print('ok', out)
