import { create } from 'zustand';
import { getAllTree } from './db';
import type { PatientRec, SeriesRec, StudyRec } from './types';
import { loadSettings, saveSettings, type Settings } from './settings';
import { setLang } from './i18n';
import type { ToolId } from '../cs/init';
import type { AngleMode } from '../cs/measure';

export type Layout = 1 | 2 | 4;

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'warn' | 'error';
}

export interface CropRect {
  viewportIndex: number;
  // canvas CSS coordinates within the viewport element
  x: number;
  y: number;
  w: number;
  h: number;
}

interface State {
  settings: Settings;
  patients: PatientRec[];
  studies: StudyRec[];
  series: SeriesRec[];
  selectedPatient: string | null;
  selectedStudy: string | null;
  layout: Layout;
  viewportSeries: (string | null)[];
  activeViewport: number;
  tool: ToolId;
  measurementsVisible: boolean;
  newColor: string;
  newLineWidth: number;
  newAngleMode: AngleMode;
  maskScope: 'image' | 'series';
  maskColor: string;
  pipette: boolean;
  selectedMaskId: string | null;
  crop: CropRect | null;
  leftOpen: boolean;
  seriesOpen: boolean;
  rightOpen: boolean;
  dialog: null | 'export' | 'video' | 'settings' | 'assign' | 'import';
  mprSeries: string | null;
  exportingStudies: Set<string>;
  toasts: Toast[];
  setSettings: (p: Partial<Settings>) => void;
  refreshTree: () => Promise<void>;
  set: (p: Partial<State>) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  setViewportSeries: (index: number, seriesUID: string | null) => void;
}

let toastId = 0;

export const useStore = create<State>((set, get) => {
  const settings = loadSettings();
  setLang(settings.lang);
  return {
    settings,
    patients: [],
    studies: [],
    series: [],
    selectedPatient: null,
    selectedStudy: null,
    layout: 1,
    viewportSeries: [null, null, null, null],
    activeViewport: 0,
    tool: 'scroll',
    measurementsVisible: true,
    newColor: settings.defaultColor,
    newLineWidth: settings.defaultLineWidth,
    newAngleMode: 'acute',
    maskScope: 'image',
    maskColor: '#000000',
    pipette: false,
    selectedMaskId: null,
    crop: null,
    leftOpen: true,
    seriesOpen: true,
    rightOpen: true,
    dialog: null,
    mprSeries: null,
    exportingStudies: new Set(),
    toasts: [],
    setSettings: (p) => {
      const s = { ...get().settings, ...p };
      saveSettings(s);
      if (p.lang) setLang(p.lang);
      set({ settings: s });
    },
    refreshTree: async () => {
      const { patients, studies, series } = await getAllTree();
      const st = get();
      const studyUIDs = new Set(studies.map((s) => s.studyUID));
      const seriesUIDs = new Set(series.map((s) => s.seriesUID));
      set({
        patients,
        studies,
        series,
        selectedStudy: st.selectedStudy && studyUIDs.has(st.selectedStudy) ? st.selectedStudy : null,
        viewportSeries: st.viewportSeries.map((s) => (s && seriesUIDs.has(s) ? s : null)),
        mprSeries: st.mprSeries && seriesUIDs.has(st.mprSeries) ? st.mprSeries : null,
      });
    },
    set: (p) => set(p as any),
    toast: (text, kind = 'info') => {
      const id = ++toastId;
      set({ toasts: [...get().toasts, { id, text, kind }] });
      setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), kind === 'info' ? 5000 : 10000);
    },
    setViewportSeries: (index, seriesUID) => {
      const v = [...get().viewportSeries];
      v[index] = seriesUID;
      set({ viewportSeries: v });
    },
  };
});

/** Studies currently shown (protected from automatic eviction). */
export function displayedStudies(): Set<string> {
  const s = useStore.getState();
  const out = new Set<string>(s.exportingStudies);
  const serMap = new Map(s.series.map((x) => [x.seriesUID, x.studyUID]));
  s.viewportSeries.slice(0, s.layout).forEach((uid) => uid && serMap.get(uid) && out.add(serMap.get(uid)!));
  if (s.mprSeries && serMap.get(s.mprSeries)) out.add(serMap.get(s.mprSeries)!);
  return out;
}
