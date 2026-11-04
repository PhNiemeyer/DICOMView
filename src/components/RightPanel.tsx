import { useEffect, useState, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight, Pipette, Trash } from 'lucide-react';
import { eventTarget, Enums as CoreEnums } from '@cornerstonejs/core';
import { annotation, Enums as ToolEnums, LengthTool, CircleROITool, CobbAngleTool } from '@cornerstonejs/tools';
import { useStore } from '../core/store';
import { fmtNum, t, type DictKey } from '../core/i18n';
import { activeViewport, currentImageId, getWindow, renderAllAnnotations, setWindow } from '../cs/viewportOps';
import {
  baseCalibration,
  effectiveCalibration,
  getVersion,
  imageIdToKey,
  keyToInstance,
  masksFor,
  overrideCalibration,
  seriesImages,
  setOverride,
  subscribe,
  updateMasks,
} from '../cs/registry';
import { annotationPixelVector, type AngleMode } from '../cs/measure';
import { calibrationFromDistance, canApplyMagnification, nativeAspect } from '../cs/calibration';
import type { Calibration } from '../core/types';
import { persistAnnotation, styleFor } from '../cs/series';

const ICON = { size: 16, strokeWidth: 1.5 };
export const COLORS: { c: string; n: string }[] = [
  { c: '#000000', n: 'Schwarz/Black' },
  { c: '#FFFFFF', n: 'Weiß/White' },
  { c: '#E53935', n: 'Rot/Red' },
  { c: '#FDD835', n: 'Gelb/Yellow' },
  { c: '#43A047', n: 'Grün/Green' },
  { c: '#1E6FD9', n: 'Blau/Blue' },
  { c: '#57C8CE', n: 'Türkis/Turquoise' },
];
const WIDTHS = [1, 2, 3, 5];

function useTick() {
  const [, setN] = useState(0);
  useEffect(() => {
    const f = () => setN((n) => n + 1);
    const evs = [
      ToolEnums.Events.ANNOTATION_SELECTION_CHANGE,
      ToolEnums.Events.ANNOTATION_MODIFIED,
      ToolEnums.Events.ANNOTATION_COMPLETED,
      ToolEnums.Events.ANNOTATION_REMOVED,
      CoreEnums.Events.STACK_NEW_IMAGE,
      CoreEnums.Events.VOI_MODIFIED,
      CoreEnums.Events.IMAGE_RENDERED,
    ];
    evs.forEach((e) => eventTarget.addEventListener(e, f));
    // element events bubble to eventTarget in cornerstone for core events
    const iv = setInterval(f, 1000);
    return () => {
      evs.forEach((e) => eventTarget.removeEventListener(e, f));
      clearInterval(iv);
    };
  }, []);
}

export default function RightPanel() {
  const open = useStore((s) => s.rightOpen);
  const active = useStore((s) => s.activeViewport);
  useStore((s) => s.viewportSeries);
  useStore((s) => s.settings.lang);
  useSyncExternalStore(subscribe, getVersion);
  useTick();

  if (!open)
    return (
      <aside className="side right collapsed">
        <button className="icon-btn" aria-label={t('expand')} title={t('expand')} onClick={() => useStore.getState().set({ rightOpen: true })}>
          <ChevronLeft {...ICON} />
        </button>
      </aside>
    );

  const vp = activeViewport();
  const imageId = currentImageId(vp);
  const key = imageId ? imageIdToKey.get(imageId) : undefined;

  return (
    <aside className="side right" aria-label={t('properties')}>
      <div className="side-head">
        <span className="eyebrow">
          {t('properties')} · {t('activeViewport')} {active + 1}
        </span>
        <button className="icon-btn" aria-label={t('collapse')} title={t('collapse')} onClick={() => useStore.getState().set({ rightOpen: false })}>
          <ChevronRight {...ICON} />
        </button>
      </div>
      <div className="side-scroll panel-body">
        <WindowSection />
        <StyleSection />
        <SelectionSection />
        {key && <CalibrationSection key={key} instKey={key} />}
        {key && <MaskSection instKey={key} />}
        <OverlaySection />
      </div>
    </aside>
  );
}

function WindowSection() {
  const w = getWindow(activeViewport());
  const [ww, setWw] = useState('');
  const [wl, setWl] = useState('');
  useEffect(() => {
    if (w && document.activeElement?.tagName !== 'INPUT') {
      setWw(String(Math.round(w.ww)));
      setWl(String(Math.round(w.wl)));
    }
  }, [w?.ww, w?.wl]);
  if (!w) return null;
  const apply = () => setWindow(parseFloat(ww), parseFloat(wl));
  return (
    <section className="psec">
      <h3>{t('windowing')}</h3>
      <div className="row2">
        <label>
          <span>{t('windowWidth')}</span>
          <input type="number" value={ww} min={1} onChange={(e) => setWw(e.target.value)} onBlur={apply} onKeyDown={(e) => e.key === 'Enter' && apply()} />
        </label>
        <label>
          <span>{t('windowCenter')}</span>
          <input type="number" value={wl} onChange={(e) => setWl(e.target.value)} onBlur={apply} onKeyDown={(e) => e.key === 'Enter' && apply()} />
        </label>
      </div>
      <p className="hint">{t('brightnessContrastHint')}</p>
    </section>
  );
}

function Swatches({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {COLORS.map((c) => (
        <button
          key={c.c}
          role="radio"
          aria-checked={value.toLowerCase() === c.c.toLowerCase()}
          className={`swatch ${value.toLowerCase() === c.c.toLowerCase() ? 'on' : ''}`}
          style={{ background: c.c }}
          title={c.n}
          aria-label={c.n}
          onClick={() => onChange(c.c)}
        />
      ))}
    </div>
  );
}

function Widths({ value, onChange }: { value: number; onChange: (w: number) => void }) {
  return (
    <div className="widths" role="radiogroup" aria-label={t('lineWidth')}>
      {WIDTHS.map((w) => (
        <button key={w} role="radio" aria-checked={value === w} className={`wbtn ${value === w ? 'on' : ''}`} onClick={() => onChange(w)} title={`${w}px`}>
          <span style={{ height: w }} />
        </button>
      ))}
    </div>
  );
}

function StyleSection() {
  const color = useStore((s) => s.newColor);
  const lw = useStore((s) => s.newLineWidth);
  const mode = useStore((s) => s.newAngleMode);
  const set = useStore((s) => s.set);
  return (
    <section className="psec">
      <h3>{t('style')}</h3>
      <Swatches value={color} onChange={(c) => set({ newColor: c })} label={t('color')} />
      <Widths value={lw} onChange={(w) => set({ newLineWidth: w })} />
      <label className="field">
        <span>
          {t('tCobb')} – {t('angleMode')}
        </span>
        <select value={mode} onChange={(e) => set({ newAngleMode: e.target.value as AngleMode })}>
          <option value="acute">{t('angleAcute')}</option>
          <option value="obtuse">{t('angleObtuse')}</option>
          <option value="both">{t('angleBoth')}</option>
        </select>
      </label>
    </section>
  );
}

function selectedAnnotation(): any | null {
  const sel = annotation.selection.getAnnotationsSelected() ?? [];
  if (sel.length !== 1) return null;
  return annotation.state.getAnnotation(sel[0]) ?? null;
}

function SelectionSection() {
  const a = selectedAnnotation();
  if (!a)
    return (
      <section className="psec">
        <h3>{t('selection')}</h3>
        <p className="hint">{t('noSelection')}</p>
      </section>
    );
  const style = a.data.bvStyle ?? {};
  const update = (p: any) => {
    a.data.bvStyle = { ...style, ...p };
    annotation.config.style.setAnnotationStyles(a.annotationUID, a.data.bvStyle);
    persistAnnotation(a);
    renderAllAnnotations();
  };
  return (
    <section className="psec">
      <h3>{t('selection')}</h3>
      <Swatches value={style.color ?? ''} onChange={(c) => update(styleFor(c, style.lineWidth ?? '2'))} label={t('color')} />
      <Widths value={parseFloat(style.lineWidth ?? '2')} onChange={(w) => update(styleFor(style.color ?? '#57C8CE', w))} />
      {a.metadata.toolName === CobbAngleTool.toolName && (
        <label className="field">
          <span>{t('angleMode')}</span>
          <select
            value={a.data.bvAngleMode ?? 'acute'}
            onChange={(e) => {
              a.data.bvAngleMode = e.target.value;
              persistAnnotation(a);
              renderAllAnnotations();
            }}
          >
            <option value="acute">{t('angleAcute')}</option>
            <option value="obtuse">{t('angleObtuse')}</option>
            <option value="both">{t('angleBoth')}</option>
          </select>
        </label>
      )}
    </section>
  );
}

const srcKey = (c: Calibration): DictKey => `src_${c.source.replace(/-/g, '_')}` as DictKey;

function scaleText(c: Calibration | null) {
  if (!c) return t('calNone');
  const same = Math.abs(c.sx - c.sy) < 1e-9;
  return same ? `${fmtNum(c.sx, 4)} mm/px` : `${fmtNum(c.sx, 4)} × ${fmtNum(c.sy, 4)} mm/px`;
}

function CalibrationSection({ instKey }: { instKey: string }) {
  const [method, setMethod] = useState<'' | 'sphere' | 'distance' | 'mag'>('');
  const [mm, setMm] = useState('');
  const [pending, setPending] = useState<Calibration | null>(null);
  const [err, setErr] = useState('');
  const eff = effectiveCalibration(instKey);
  const base = baseCalibration(instKey);
  const over = overrideCalibration(instKey);
  const mag = canApplyMagnification(base, over);
  const inst = keyToInstance.get(instKey)!;

  const compute = () => {
    setErr('');
    const a = selectedAnnotation();
    const want = method === 'sphere' ? CircleROITool.toolName : LengthTool.toolName;
    if (!a || a.metadata.toolName !== want || imageIdToKey.get(a.metadata.referencedImageId) !== instKey) {
      setErr(method === 'sphere' ? t('needCircle') : t('needLine'));
      return;
    }
    const v = annotationPixelVector(a);
    const real = parseFloat(mm.replace(',', '.'));
    if (!v || !(real > 0)) return;
    const k = method === 'sphere' ? 2 : 1;
    const len = Math.hypot(v.dx * k, v.dy * k * nativeAspect(base));
    const cal = calibrationFromDistance(v.dx * k, v.dy * k, real, nativeAspect(base), method === 'sphere' ? 'manual-sphere' : 'manual-distance', `${fmtNum(len, 1)} px ≙ ${fmtNum(real, 2)} mm`);
    setPending(cal);
  };

  const seriesKeys = () => {
    const imgs = seriesImages.get(inst.seriesUID) ?? [];
    return imgs
      .filter((im) => im.instance.rows === inst.rows && im.instance.columns === inst.columns && JSON.stringify(baseCalibration(im.instanceKey)) === JSON.stringify(base))
      .map((im) => im.instanceKey);
  };

  return (
    <section className="psec">
      <h3>{t('calibration')}</h3>
      <div className={`cal-status ${eff ? '' : 'none'}`}>
        <div className="strong">{scaleText(eff)}</div>
        {eff && (
          <div className="small">
            {t('calSource')}: {t(srcKey(eff))} {eff.detail ? `– ${eff.detail}` : ''}
          </div>
        )}
        {eff?.magnification11 && <div className="small flag">{t('mag11Active')}</div>}
      </div>
      <div className="seg" role="tablist">
        {(['sphere', 'distance', 'mag'] as const).map((m) => (
          <button key={m} role="tab" aria-selected={method === m} className={method === m ? 'on' : ''} onClick={() => { setMethod(method === m ? '' : m); setPending(null); setErr(''); }}>
            {m === 'sphere' ? t('calSphere') : m === 'distance' ? t('calDistance') : t('calMag')}
          </button>
        ))}
      </div>
      {(method === 'sphere' || method === 'distance') && (
        <div className="cal-box">
          <p className="hint">{method === 'sphere' ? t('calSphereHelp') : t('calDistanceHelp')}</p>
          <label className="field">
            <span>{method === 'sphere' ? t('diameterMM') : t('lengthMM')}</span>
            <input inputMode="decimal" value={mm} onChange={(e) => { setMm(e.target.value); setPending(null); }} onKeyDown={(e) => e.key === 'Enter' && compute()} />
          </label>
          <button className="btn" onClick={compute}>{t('summary')}</button>
          {err && <p className="err">{err}</p>}
          {pending && (
            <div className="summary">
              <div>{t('markedPx')}: {pending.detail}</div>
              <div>{t('oldScale')}: {scaleText(eff)}</div>
              <div className="strong">{t('newScale')}: {scaleText(pending)}</div>
              <div className="small">{t('appliesToImage')}</div>
              <div className="btn-row">
                <button className="btn primary" onClick={() => { setOverride([instKey], pending); setPending(null); setMethod(''); }}>{t('apply')}</button>
                <button className="btn" onClick={() => setPending(null)}>{t('cancel')}</button>
              </div>
            </div>
          )}
        </div>
      )}
      {method === 'mag' && (
        <div className="cal-box">
          <p className="hint">{t('calMagHelp')}</p>
          {over?.magnification11 ? (
            <button className="btn" onClick={() => setOverride([instKey], null)}>{t('calMagRemove')}</button>
          ) : mag === 'ok' ? (
            <>
              <div className="summary">
                <div>{t('oldScale')}: {scaleText(base)}</div>
                <div className="strong">{t('newScale')}: {scaleText(base && { ...base, sx: base.sx / 1.1, sy: base.sy / 1.1 })}</div>
              </div>
              <button className="btn primary" onClick={() => setOverride([instKey], { ...base!, magnification11: true })}>{t('calMagApply')}</button>
            </>
          ) : (
            <p className="err">{mag === 'no-basis' ? t('calMagNoBasis') : t('calMagAlready')}</p>
          )}
        </div>
      )}
      {over && (
        <div className="btn-row">
          {!over.magnification11 && (
            <button className="btn" onClick={() => setOverride([instKey], null)}>{t('removeCalibration')}</button>
          )}
          <button
            className="btn"
            onClick={() => {
              const keys = seriesKeys();
              const total = (seriesImages.get(inst.seriesUID) ?? []).length;
              if (keys.length < total) return alert(t('transferNotPossible'));
              if (confirm(t('transferSeriesConfirm', { n: keys.length }))) setOverride(keys, over);
            }}
          >
            {t('transferSeries')}
          </button>
        </div>
      )}
    </section>
  );
}

function MaskSection({ instKey }: { instKey: string }) {
  const scope = useStore((s) => s.maskScope);
  const color = useStore((s) => s.maskColor);
  const pipette = useStore((s) => s.pipette);
  const tool = useStore((s) => s.tool);
  const sel = useStore((s) => s.selectedMaskId);
  const set = useStore((s) => s.set);
  const masks = masksFor(instKey);
  const inst = keyToInstance.get(instKey)!;
  const setColor = (c: string) => {
    set({ maskColor: c });
    if (sel) updateMasks(inst.studyUID, (ms) => ms.map((m) => (m.id === sel ? { ...m, color: c } : m)));
  };
  return (
    <section className="psec">
      <h3>{t('masks')}</h3>
      <p className="hint">{t('maskHelp')}</p>
      <label className="field">
        <span>{t('maskScope')}</span>
        <select value={scope} onChange={(e) => set({ maskScope: e.target.value as any })}>
          <option value="image">{t('maskScopeImage')}</option>
          <option value="series">{t('maskScopeSeries')}</option>
        </select>
      </label>
      <div className="field">
        <span>{t('maskColor')}</span>
        <div className="mask-colors">
          <button className={`swatch ${color === '#000000' ? 'on' : ''}`} style={{ background: '#000' }} title={t('black')} aria-label={t('black')} onClick={() => setColor('#000000')} />
          <input type="color" value={color} aria-label={t('maskColor')} onChange={(e) => setColor(e.target.value)} />
          <button className={`btn small ${pipette ? 'primary' : ''}`} aria-pressed={pipette} onClick={() => set({ pipette: !pipette })} title={t('pipetteHint')}>
            <Pipette {...ICON} /> {t('pipette')}
          </button>
        </div>
        {pipette && <p className="hint">{t('pipetteHint')}</p>}
      </div>
      {tool !== 'mask' && (
        <button className="btn" onClick={() => { set({ tool: 'mask' }); }}>{t('tMask')}</button>
      )}
      <div className="small muted">{t('maskCount', { n: masks.length })}</div>
      <ul className="mask-list">
        {masks.map((m, i) => (
          <li key={m.id} className={m.id === sel ? 'on' : ''}>
            <button className="linkish" onClick={() => set({ selectedMaskId: m.id, tool: 'mask' })}>
              <span className="chip" style={{ background: m.color }} /> #{i + 1} {m.scope === 'series' && <em>{t('maskSeriesBadge')}</em>} {Math.round(m.w)}×{Math.round(m.h)} px
            </button>
            <button className="icon-btn subtle" aria-label={t('deleteMask')} title={t('deleteMask')} onClick={() => updateMasks(inst.studyUID, (ms) => ms.filter((x) => x.id !== m.id))}>
              <Trash {...ICON} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OverlaySection() {
  const show = useStore((s) => s.settings.showPatientOverlay);
  return (
    <section className="psec">
      <label className="check">
        <input type="checkbox" checked={show} onChange={(e) => useStore.getState().setSettings({ showPatientOverlay: e.target.checked })} />
        <span>{t('patientOverlay')}</span>
      </label>
      <p className="hint">{t('overlayNote')}</p>
    </section>
  );
}
