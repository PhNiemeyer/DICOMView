import { openDB, type IDBPDatabase } from 'idb';
import type { FileRec, InstanceRec, PatientRec, SeriesRec, StudyRec, StudyWork } from './types';

// Local working set (IndexedDB). Never leaves the device.
const DB_NAME = 'bildviewer-workspace';
const VERSION = 1;

let dbp: Promise<IDBPDatabase> | null = null;

export function db() {
  if (!dbp) {
    dbp = openDB(DB_NAME, VERSION, {
      upgrade(d) {
        d.createObjectStore('files', { keyPath: 'id' }).createIndex('studyUID', 'studyUID');
        const inst = d.createObjectStore('instances', { keyPath: 'sopUID' });
        inst.createIndex('seriesUID', 'seriesUID');
        inst.createIndex('studyUID', 'studyUID');
        d.createObjectStore('series', { keyPath: 'seriesUID' }).createIndex('studyUID', 'studyUID');
        d.createObjectStore('studies', { keyPath: 'studyUID' }).createIndex('patientKey', 'patientKey');
        d.createObjectStore('patients', { keyPath: 'key' });
        d.createObjectStore('thumbs');
        d.createObjectStore('work', { keyPath: 'studyUID' });
      },
      blocking() {
        // another tab wants to delete/upgrade the DB: let it.
        void closeDb();
      },
    });
  }
  return dbp;
}

export async function closeDb() {
  if (dbp) {
    const d = await dbp.catch(() => null);
    d?.close();
    dbp = null;
  }
}

/** Removes the whole database (used by the daily purge and "delete all"). */
export async function deleteWholeDb(): Promise<void> {
  await closeDb();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve(); // other connections get "blocking" and close
  });
}

export async function getAllTree() {
  const d = await db();
  const [patients, studies, series] = await Promise.all([
    d.getAll('patients') as Promise<PatientRec[]>,
    d.getAll('studies') as Promise<StudyRec[]>,
    d.getAll('series') as Promise<SeriesRec[]>,
  ]);
  return { patients, studies, series };
}

export async function getInstancesOfSeries(seriesUID: string): Promise<InstanceRec[]> {
  const d = await db();
  return d.getAllFromIndex('instances', 'seriesUID', seriesUID);
}

export async function getFile(id: string): Promise<FileRec | undefined> {
  const d = await db();
  return d.get('files', id);
}

export async function getThumb(seriesUID: string): Promise<Blob | undefined> {
  const d = await db();
  return d.get('thumbs', seriesUID);
}

export async function putThumb(seriesUID: string, blob: Blob) {
  const d = await db();
  await d.put('thumbs', blob, seriesUID);
}

export async function usedBytes(): Promise<number> {
  const d = await db();
  const studies = (await d.getAll('studies')) as StudyRec[];
  return studies.reduce((a, s) => a + (s.bytes || 0), 0);
}

export async function touchStudy(studyUID: string) {
  const d = await db();
  const tx = d.transaction('studies', 'readwrite');
  const s = (await tx.store.get(studyUID)) as StudyRec | undefined;
  if (s) {
    s.lastAccessed = Date.now();
    await tx.store.put(s);
  }
  await tx.done;
}

/** Removes a study incl. files, instances, series, thumbnails, work data; removes empty patients. */
export async function deleteStudy(studyUID: string) {
  const d = await db();
  const tx = d.transaction(['files', 'instances', 'series', 'studies', 'patients', 'thumbs', 'work'], 'readwrite');
  const study = (await tx.objectStore('studies').get(studyUID)) as StudyRec | undefined;
  for (const k of await tx.objectStore('files').index('studyUID').getAllKeys(studyUID)) await tx.objectStore('files').delete(k);
  for (const k of await tx.objectStore('instances').index('studyUID').getAllKeys(studyUID)) await tx.objectStore('instances').delete(k);
  for (const k of await tx.objectStore('series').index('studyUID').getAllKeys(studyUID)) {
    await tx.objectStore('series').delete(k);
    await tx.objectStore('thumbs').delete(k);
  }
  await tx.objectStore('work').delete(studyUID);
  await tx.objectStore('studies').delete(studyUID);
  if (study) {
    const remaining = await tx.objectStore('studies').index('patientKey').count(study.patientKey);
    if (remaining === 0) await tx.objectStore('patients').delete(study.patientKey);
  }
  await tx.done;
}

export async function deletePatient(patientKey: string) {
  const d = await db();
  const keys = (await d.getAllKeysFromIndex('studies', 'patientKey', patientKey)) as string[];
  for (const k of keys) await deleteStudy(k);
  await d.delete('patients', patientKey);
}

export async function getWork(studyUID: string): Promise<StudyWork> {
  const d = await db();
  const w = (await d.get('work', studyUID)) as StudyWork | undefined;
  return w ?? { studyUID, annotations: [], calibrations: {}, masks: [] };
}

export async function putWork(w: StudyWork) {
  const d = await db();
  // only store if the study still exists (prevents re-saving purged data)
  const exists = await d.getKey('studies', w.studyUID);
  if (exists) await d.put('work', w);
}
