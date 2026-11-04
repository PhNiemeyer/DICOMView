import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Contrast, Crosshair, Hand, ZoomIn } from 'lucide-react';
import { Enums, cache, setVolumesForViewports, volumeLoader, utilities as csUtils, type Types } from '@cornerstonejs/core';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { ToolGroupManager } from '@cornerstonejs/tools';
import { useStore } from '../core/store';
import { t, type DictKey } from '../core/i18n';
import { getEngine, MPR_TOOLGROUP, setMprPrimary, setMprTools } from '../cs/init';
import { imageIdsOf, openSeries } from '../cs/series';
import { checkMprSuitability } from '../cs/mpr';
import { CT_PRESETS } from '../cs/viewportOps';

const VIEWS = [
  { id: 'mpr-axial', o: Enums.OrientationAxis.AXIAL, label: 'mprAxial' },
  { id: 'mpr-coronal', o: Enums.OrientationAxis.CORONAL, label: 'mprCoronal' },
  { id: 'mpr-sagittal', o: Enums.OrientationAxis.SAGITTAL, label: 'mprSagittal' },
] as const;

const ICON = { size: 18, strokeWidth: 1.5 };

export default function MprView({ seriesUID }: { seriesUID: string }) {
  const series = useStore((s) => s.series.find((x) => x.seriesUID === seriesUID));
  const refs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const [error, setError] = useState<DictKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [tool, setTool] = useState<'crosshairs' | 'window' | 'zoom' | 'pan'>('crosshairs');
  const close = () => useStore.getState().set({ mprSeries: null });

  useEffect(() => {
    if (!series) return;
    let alive = true;
    const engine = getEngine();
    const volumeId = `cornerstoneStreamingImageVolume:bv-${seriesUID}-${Date.now()}`;
    const tg = ToolGroupManager.getToolGroup(MPR_TOOLGROUP)!;
    (async () => {
      const imgs = await openSeries(series);
      const problem = checkMprSuitability(imgs.map((i) => i.instance));
      if (problem) {
        setError(problem);
        setLoading(false);
        return;
      }
      const ids = imageIdsOf(imgs);
      // make DICOM metadata available (parses headers; pixel data is decoded by the volume loader)
      await Promise.all(
        ids.map((id) => {
          const url = id.slice('dicomfile:'.length);
          return dicomImageLoader.wadouri.dataSetCacheManager.load(url, dicomImageLoader.wadouri.loadFileRequest as any, id);
        }),
      );
      if (!alive) return;
      for (let k = 0; k < 3; k++) {
        engine.enableElement({ viewportId: VIEWS[k].id, element: refs[k].current!, type: Enums.ViewportType.ORTHOGRAPHIC, defaultOptions: { orientation: VIEWS[k].o, background: [0, 0, 0] } } as any);
        tg.addViewport(VIEWS[k].id, engine.id);
      }
      setMprTools();
      const volume = await volumeLoader.createAndCacheVolume(volumeId, { imageIds: ids });
      (volume as any).load();
      await setVolumesForViewports(engine, [{ volumeId }], VIEWS.map((v) => v.id));
      engine.renderViewports(VIEWS.map((v) => v.id));
      if (alive) setLoading(false);
    })().catch(() => {
      if (alive) {
        setError('mpr_geometry');
        setLoading(false);
      }
    });
    return () => {
      alive = false;
      for (const v of VIEWS) {
        try {
          tg.removeViewports(engine.id, v.id);
          engine.disableElement(v.id);
        } catch {
          /* not enabled */
        }
      }
      try {
        cache.removeVolumeLoadObject(volumeId);
      } catch {
        /* ignore */
      }
    };
  }, [seriesUID]);

  useEffect(() => {
    const ro = new ResizeObserver(() => getEngine().resize(true, true));
    refs.forEach((r) => r.current && ro.observe(r.current));
    return () => ro.disconnect();
  }, []);

  const pick = (tl: typeof tool) => {
    setTool(tl);
    setMprPrimary(tl);
  };
  const preset = (ww: number, wl: number) => {
    const engine = getEngine();
    for (const v of VIEWS) {
      const vp = engine.getViewport(v.id) as Types.IVolumeViewport | undefined;
      vp?.setProperties({ voiRange: csUtils.windowLevel.toLowHighRange(ww, wl) });
      vp?.render();
    }
  };

  return (
    <div className="mpr">
      <div className="toolbar">
        <button className="tb-btn" onClick={close}>
          <ArrowLeft {...ICON} />
          <span>{t('mprBack')}</span>
        </button>
        <div className="tb-sep" />
        {(
          [
            ['crosshairs', <Crosshair {...ICON} />, 'MPR'],
            ['window', <Contrast {...ICON} />, t('tWindow')],
            ['zoom', <ZoomIn {...ICON} />, t('tZoom')],
            ['pan', <Hand {...ICON} />, t('tPan')],
          ] as const
        ).map(([id, icon, label]) => (
          <button key={id} className={`tb-btn ${tool === id ? 'active' : ''}`} aria-pressed={tool === id} onClick={() => pick(id)}>
            {icon}
            <span>{label}</span>
          </button>
        ))}
        <div className="tb-sep" />
        <select className="tb-select" value="" aria-label={t('presets')} onChange={(e) => { const p = CT_PRESETS.find((x) => x.key === e.target.value); if (p) preset(p.ww, p.wl); }}>
          <option value="" disabled>{t('presets')}</option>
          {CT_PRESETS.map((p) => <option key={p.key} value={p.key}>{t(p.key as DictKey)} ({p.ww}/{p.wl})</option>)}
        </select>
        <span className="small muted pad">{series?.description}</span>
      </div>
      {error ? (
        <div className="mpr-error">
          <h2>{t('mprNotSuitable')}</h2>
          <p>{t(error)}</p>
          <button className="btn primary" onClick={close}>{t('mprBack')}</button>
        </div>
      ) : (
        <div className="mpr-grid">
          {VIEWS.map((v, k) => (
            <div className="viewport" key={v.id}>
              <div ref={refs[k]} className="vp-element" onContextMenu={(e) => e.preventDefault()} />
              <div className="vp-info tl">{t(v.label as DictKey)}</div>
            </div>
          ))}
          {loading && <div className="vp-loading">{t('mprLoading')}</div>}
        </div>
      )}
    </div>
  );
}
