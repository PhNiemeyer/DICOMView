import { useEffect, useRef, useState } from 'react';
import { Circle, Square, X } from 'lucide-react';
import { useStore } from '../core/store';
import { t } from '../core/i18n';
import { FPS, pickMime, preloadStacks, startRecording, type Recording } from '../export/video';
import { downloadBlob, neutralFileName, viewportCssSize, viewportIndices } from '../export/render';

/** Non-modal panel: the user keeps scrolling while recording. */
export default function VideoPanel() {
  const crop = useStore((s) => s.crop);
  const layout = useStore((s) => s.layout);
  const [area, setArea] = useState<'active' | 'all' | 'crop'>('active');
  const [withM, setWithM] = useState(true);
  const [maxSec, setMaxSec] = useState(120);
  const [state, setState] = useState<'idle' | 'preload' | 'rec' | 'saving'>('idle');
  const [pre, setPre] = useState({ d: 0, n: 0 });
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef<Recording | null>(null);
  const fmt = pickMime();
  const close = () => {
    recRef.current?.abort();
    useStore.getState().set({ dialog: null });
  };

  useEffect(() => {
    if (state !== 'rec') return;
    const t0 = Date.now();
    const iv = setInterval(() => setElapsed((Date.now() - t0) / 1000), 200);
    return () => clearInterval(iv);
  }, [state]);

  useEffect(() => () => recRef.current?.abort(), []);

  const indices = viewportIndices(area);
  const dpr = window.devicePixelRatio || 1;
  const size = (() => {
    if (area === 'crop' && crop) return { w: crop.w, h: crop.h };
    const v = viewportCssSize(indices[0]);
    if (area === 'all' && layout > 1) {
      const cols = layout === 4 ? 2 : layout;
      const rows = layout === 4 ? 2 : 1;
      return { w: v.w * cols + 2 * (cols - 1), h: v.h * rows + 2 * (rows - 1) };
    }
    return v;
  })();
  const resW = Math.round((size.w * dpr) / 2) * 2;
  const resH = Math.round((size.h * dpr) / 2) * 2;

  const start = async () => {
    if (!fmt) return;
    setState('preload');
    const st = useStore.getState();
    const studies = new Set(st.exportingStudies);
    indices.forEach((i) => {
      const s = st.series.find((x) => x.seriesUID === st.viewportSeries[i]);
      if (s) studies.add(s.studyUID);
    });
    st.set({ exportingStudies: studies });
    await preloadStacks(indices, (d, n) => setPre({ d, n }));
    recRef.current = startRecording({
      indices,
      crop: area === 'crop' && crop ? crop : null,
      withMeasurements: withM,
      maxSeconds: maxSec,
      onLimit: () => {
        useStore.getState().toast(t('videoLimitReached'), 'warn');
        void stopRef.current();
      },
    });
    setElapsed(0);
    setState('rec');
  };

  const stop = async () => {
    const r = recRef.current;
    if (!r) return;
    setState('saving');
    const blob = await r.stop();
    recRef.current = null;
    useStore.getState().set({ exportingStudies: new Set() });
    if (blob) downloadBlob(blob, neutralFileName(r.ext));
    setState('idle');
  };

  const stopRef = useRef(stop);
  stopRef.current = stop;

  const abort = () => {
    recRef.current?.abort();
    recRef.current = null;
    useStore.getState().set({ exportingStudies: new Set() });
    setState('idle');
  };

  const mm = Math.floor(elapsed / 60);
  const ss = Math.floor(elapsed % 60).toString().padStart(2, '0');

  return (
    <div className="float-panel" role="dialog" aria-label={t('videoTitle')}>
      <div className="modal-head">
        <h2>{t('videoTitle')}</h2>
        <button className="icon-btn" aria-label={t('close')} onClick={close}>
          <X size={18} strokeWidth={1.5} />
        </button>
      </div>
      {state === 'idle' && (
        <div className="panel-body">
          <p className="hint">{t('videoHelp')}</p>
          <fieldset>
            <legend>{t('area')}</legend>
            <label className="check"><input type="radio" checked={area === 'active'} onChange={() => setArea('active')} /> {t('areaActive')}</label>
            <label className="check"><input type="radio" checked={area === 'all'} disabled={layout === 1} onChange={() => setArea('all')} /> {t('areaAll')}</label>
            <label className="check"><input type="radio" checked={area === 'crop'} disabled={!crop} onChange={() => setArea('crop')} /> {t('areaCrop')}</label>
          </fieldset>
          <label className="check"><input type="checkbox" checked={withM} onChange={(e) => setWithM(e.target.checked)} /> {t('withMeasurements')}</label>
          <p className="hint">{t('masksAlwaysOn')} {t('cursorExcluded')}</p>
          <label className="field">
            <span>{t('maxDuration')}</span>
            <select value={maxSec} onChange={(e) => setMaxSec(parseInt(e.target.value, 10))}>
              {[30, 60, 120, 300, 600].map((s) => <option key={s} value={s}>{s} {t('seconds')}</option>)}
            </select>
          </label>
          <div className="small">
            {t('resolution')}: <strong>{resW} × {resH} px</strong> · {t('fps')}: <strong>{FPS} fps</strong> ({t('videoFormat')}: <strong>{fmt?.label ?? '—'}</strong>)
          </div>
          {fmt?.ext === 'webm' && <p className="err">{t('mp4Unavailable')}</p>}
          <div className="modal-actions">
            <button className="btn primary" disabled={!fmt} onClick={start}>
              <Circle size={14} strokeWidth={1.5} /> {t('start')}
            </button>
          </div>
        </div>
      )}
      {state === 'preload' && <div className="panel-body"><p>{t('preloading')} {pre.d}/{pre.n}</p></div>}
      {(state === 'rec' || state === 'saving') && (
        <div className="panel-body">
          <div className="rec-line"><span className="rec-dot" /> {t('recording')} <strong>{mm}:{ss}</strong> / {maxSec} {t('seconds')}</div>
          <div className="small">{resW} × {resH} px · {FPS} fps · {fmt?.label}</div>
          <div className="modal-actions">
            <button className="btn" onClick={abort} disabled={state === 'saving'}>{t('abort')}</button>
            <button className="btn primary" onClick={stop} disabled={state === 'saving'}>
              <Square size={14} strokeWidth={1.5} /> {t('stop')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
