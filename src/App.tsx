import { useEffect, useRef, useState } from 'react';
import { useStore, displayedStudies } from './core/store';
import { t } from './core/i18n';
import TopBar from './components/TopBar';
import Toolbar, { selectTool } from './components/Toolbar';
import { PatientList, SeriesPanel } from './components/Sidebar';
import Viewport from './components/Viewport';
import RightPanel from './components/RightPanel';
import ExportDialog from './components/ExportDialog';
import VideoPanel from './components/VideoPanel';
import MprView from './components/MprView';
import { AssignDialog, ImportPanel, SettingsDialog } from './components/Dialogs';
import { ImportJob, filesFromDataTransfer, filesFromInput, type ImportFileItem, type ImportProgress, type PendingImage } from './import/importer';
import { deleteSelectedAnnotations, fit, flip, invert, resetView, rotate, scrollBy, scrollTo, activeViewport, currentImageId } from './cs/viewportOps';
import { imageIdToKey, keyToInstance, updateMasks } from './cs/registry';
import { Upload } from 'lucide-react';
import type { ToolId } from './cs/init';

const KEY_TOOLS: Record<string, ToolId> = { s: 'scroll', w: 'window', z: 'zoom', p: 'pan', l: 'length', a: 'angle', c: 'cobb', o: 'circle', m: 'mask' };

export default function App() {
  const layout = useStore((s) => s.layout);
  const dialog = useStore((s) => s.dialog);
  const mprSeries = useStore((s) => s.mprSeries);
  const toasts = useStore((s) => s.toasts);
  const hasData = useStore((s) => s.studies.length > 0);
  useStore((s) => s.settings.lang);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [pending, setPending] = useState<PendingImage[]>([]);
  const jobRef = useRef<ImportJob | null>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    void useStore.getState().refreshTree();
  }, []);

  async function runImport(items: ImportFileItem[]) {
    if (!items.length || jobRef.current) return;
    const st = useStore.getState();
    const job = new ImportJob({
      limitBytes: st.settings.storageLimitMB * 1024 * 1024,
      protectedStudies: displayedStudies,
      onProgress: setProgress,
      onEvicted: () => void useStore.getState().refreshTree(),
    });
    jobRef.current = job;
    setProgress({ ...job.progress });
    await job.run(items);
    jobRef.current = null;
    await useStore.getState().refreshTree();
    const s = useStore.getState();
    if (!s.selectedStudy && s.studies.length) {
      const newest = [...s.studies].sort((a, b) => b.importedAt - a.importedAt)[0];
      s.set({ selectedStudy: newest.studyUID });
    }
    // open first series of first imported study in empty active viewport
    const first = [...job.touchedStudies][0];
    if (first && !s.viewportSeries[s.activeViewport]) {
      const ser = s.series.filter((x) => x.studyUID === first).sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9))[0];
      if (ser) {
        s.set({ selectedStudy: first });
        s.setViewportSeries(s.activeViewport, ser.seriesUID);
      }
    }
    if (job.pendingImages.length) setPending(job.pendingImages);
  }

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt.closest('input, select, textarea, [role=dialog]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const st = useStore.getState();
      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowLeft':
          e.preventDefault();
          void scrollBy(-1);
          return;
        case 'ArrowDown':
        case 'ArrowRight':
          e.preventDefault();
          void scrollBy(1);
          return;
        case 'PageUp':
          e.preventDefault();
          void scrollBy(-10);
          return;
        case 'PageDown':
          e.preventDefault();
          void scrollBy(10);
          return;
        case 'Home':
          void scrollTo(0);
          return;
        case 'End':
          void scrollTo(1e9);
          return;
        case 'Delete':
        case 'Backspace': {
          if (st.tool === 'mask' && st.selectedMaskId) {
            const id = currentImageId(activeViewport());
            const key = id && imageIdToKey.get(id);
            if (key) updateMasks(keyToInstance.get(key)!.studyUID, (ms) => ms.filter((m) => m.id !== st.selectedMaskId));
            st.set({ selectedMaskId: null });
          } else deleteSelectedAnnotations();
          e.preventDefault();
          return;
        }
        case 'Escape':
          st.set({ pipette: false, crop: st.tool === 'crop' ? null : st.crop });
          return;
      }
      const k = e.key.toLowerCase();
      if (KEY_TOOLS[k]) return selectTool(KEY_TOOLS[k]);
      if (k === 'i') invert();
      else if (k === 'r') rotate(e.shiftKey ? -90 : 90);
      else if (k === 'h') flip('h');
      else if (k === 'v') flip('v');
      else if (k === 'f') fit();
      else if (k === '0') resetView();
      else if (k === '1' || k === '2' || k === '4') st.set({ layout: parseInt(k, 10) as any, activeViewport: 0 });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');

  return (
    <div
      className="app"
      onDragEnter={(e) => {
        if (!isFileDrag(e)) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!isFileDrag(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDragOver={(e) => isFileDrag(e) && e.preventDefault()}
      onDrop={async (e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        await runImport(await filesFromDataTransfer(e.dataTransfer));
      }}
    >
      <TopBar onFiles={(l) => void runImport(filesFromInput(l))} />
      <div className="main">
        <PatientList />
        <SeriesPanel />
        <div className="center">
          <Toolbar />
          <div className={`grid l${layout}`}>
            {Array.from({ length: layout }, (_, i) => (
              <div key={i} data-vp={i} className="grid-cell">
                <Viewport index={i} />
              </div>
            ))}
            {!hasData && (
              <div className="empty-hint">
                <Upload size={36} strokeWidth={1.25} />
                <h2>{t('emptyTitle')}</h2>
                <p>{t('dropHint')}</p>
                <p className="small">{t('emptyText')}</p>
              </div>
            )}
          </div>
          {mprSeries && <MprView seriesUID={mprSeries} />}
        </div>
        <RightPanel />
      </div>
      {dragging && (
        <div className="drop-overlay">
          <Upload size={40} strokeWidth={1.25} />
          <div>{t('dropHere')}</div>
        </div>
      )}
      {progress && (
        <ImportPanel
          progress={progress}
          onCancel={() => jobRef.current?.cancel()}
          onClose={() => setProgress(null)}
        />
      )}
      {!progress && pending.length > 0 && <AssignDialog images={pending} onDone={() => setPending([])} />}
      {dialog === 'export' && <ExportDialog />}
      {dialog === 'video' && <VideoPanel />}
      {dialog === 'settings' && <SettingsDialog />}
      <div className="toasts" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast ${x.kind}`}>{x.text}</div>
        ))}
      </div>
    </div>
  );
}
