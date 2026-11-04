// Persistent preferences WITHOUT any patient reference (localStorage).
// Everything patient-related lives in IndexedDB and is removed by the purge.

export type Lang = 'de' | 'en';

export interface Settings {
  lang: Lang;
  storageLimitMB: number;
  autoPurge: boolean;
  /** Time of the daily purge, local device time, "HH:MM". */
  purgeTime: string;
  showPatientOverlay: boolean;
  defaultColor: string;
  defaultLineWidth: number;
}

const KEY = 'bildviewer.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  lang: navigatorLang(),
  storageLimitMB: 1024,
  autoPurge: true,
  purgeTime: '23:59',
  showPatientOverlay: false,
  defaultColor: '#57C8CE',
  defaultLineWidth: 2,
};

function navigatorLang(): Lang {
  try {
    return (navigator.language || 'de').toLowerCase().startsWith('de') ? 'de' : 'en';
  } catch {
    return 'de';
  }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...pickKnown(parsed) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function pickKnown(o: any): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (o && k in o && typeof o[k] === typeof DEFAULT_SETTINGS[k]) (out as any)[k] = o[k];
  }
  return out;
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage may be unavailable – settings then only live for this session */
  }
}
