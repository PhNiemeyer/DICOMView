import { deleteWholeDb } from './db';
import { loadSettings } from './settings';

// Daily deletion of the local working set.
// - The due time is derived from the moment data was first written ("workspaceSince"),
//   so a closed browser / sleeping device is handled on the next start or resume.
// - Not only a background timer: checked at start (before any image is shown),
//   on tab activation, focus, pageshow and periodically.
// - Tabs coordinate via a Web Lock, BroadcastChannel and an epoch counter in localStorage.

const SINCE_KEY = 'bildviewer.workspaceSince';
const EPOCH_KEY = 'bildviewer.purgeEpoch';
const CHANNEL = 'bildviewer-purge';

let myEpoch = readEpoch();
let channel: BroadcastChannel | null = null;

function readEpoch(): number {
  try {
    return parseInt(localStorage.getItem(EPOCH_KEY) || '0', 10) || 0;
  } catch {
    return 0;
  }
}

export function getWorkspaceSince(): number | null {
  try {
    const v = localStorage.getItem(SINCE_KEY);
    return v ? parseInt(v, 10) : null;
  } catch {
    return null;
  }
}

/** Call whenever patient data is written to the working set. */
export function markDataWritten() {
  try {
    if (!localStorage.getItem(SINCE_KEY)) localStorage.setItem(SINCE_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/** True while this tab still belongs to the current (non-purged) epoch. */
export function writesAllowed(): boolean {
  return readEpoch() === myEpoch;
}

export function nextOccurrence(after: number, hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  const d = new Date(after);
  d.setHours(h || 0, m || 0, 0, 0);
  if (d.getTime() <= after) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Next scheduled deletion (ms) or null when nothing is stored / disabled. */
export function nextPurgeAt(): number | null {
  const s = loadSettings();
  if (!s.autoPurge) return null;
  const since = getWorkspaceSince();
  if (!since) return null;
  return nextOccurrence(since, s.purgeTime);
}

export function purgeIsDue(now = Date.now()): boolean {
  const t = nextPurgeAt();
  return t !== null && now >= t;
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as any).locks;
  if (locks?.request) return locks.request('bildviewer-purge', fn);
  return fn();
}

/**
 * Removes the app-managed working set: IndexedDB (images, metadata, lists, thumbnails,
 * measurements, calibrations, masks), Cache Storage and sessionStorage.
 * Persistent settings without patient reference (language etc.) are kept.
 */
export async function purgeAll(reason: 'auto' | 'manual'): Promise<void> {
  await withLock(async () => {
    try {
      localStorage.setItem(EPOCH_KEY, String(readEpoch() + 1));
      localStorage.removeItem(SINCE_KEY);
      localStorage.setItem('bildviewer.lastPurge', JSON.stringify({ at: Date.now(), reason }));
    } catch {
      /* ignore */
    }
    try {
      channel?.postMessage({ type: 'purged' });
    } catch {
      /* ignore */
    }
    await deleteWholeDb();
    try {
      if ('caches' in self) for (const k of await caches.keys()) await caches.delete(k);
    } catch {
      /* ignore */
    }
    try {
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
  });
}

/** Startup gate: must run before anything patient-related is rendered. */
export async function startupCheck(): Promise<void> {
  if (purgeIsDue()) await purgeAll('auto');
  myEpoch = readEpoch();
}

/**
 * Installs runtime checks. `onPurged` must drop all in-memory patient data
 * (we reload the page, which is the most reliable way).
 */
export function installPurgeWatch(onPurged: () => void) {
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e) => {
      if (e.data?.type === 'purged') onPurged();
    };
  } catch {
    /* Safari < 15.4 – storage event below still works */
  }
  window.addEventListener('storage', (e) => {
    if (e.key === EPOCH_KEY && readEpoch() !== myEpoch) onPurged();
  });

  let running = false;
  const check = async () => {
    if (running) return;
    if (readEpoch() !== myEpoch) return onPurged();
    if (purgeIsDue()) {
      running = true;
      await purgeAll('auto');
      onPurged();
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
  window.addEventListener('focus', () => void check());
  window.addEventListener('pageshow', () => void check());
  window.addEventListener('pointerdown', () => void check(), { capture: true, passive: true });
  setInterval(check, 10_000);
  return check;
}
