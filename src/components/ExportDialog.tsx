import { useEffect, useRef, useState } from 'react';
import { useStore } from '../core/store';
import { t } from '../core/i18n';
import { downloadBlob, neutralFileName, planExport, renderExport, type ExportOptions } from '../export/render';
import { selectTool } from './Toolbar';
import Modal from './Modal';

export default function ExportDialog() {
  const crop = useStore((s) => s.crop);
  const layout = useStore((s) => s.layout);
  const [area, setArea] = useState<ExportOptions['area']>(crop ? 'crop' : 'active');
  const [withM, setWithM] = useState(true);
  const [scale, setScale] = useState<'original' | number>('original');
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [quality, setQuality] = useState(0.92);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const close = () => useStore.getState().set({ dialog: null });
  const opts: ExportOptions = { area, withMeasurements: withM, scale };
  const plan = planExport(opts);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    const tmr = setTimeout(async () => {
      try {
        const c = await renderExport(opts);
        if (!alive) return;
        canvasRef.current = c;
        // reduced preview
        const p = document.createElement('canvas');
        const k = Math.min(1, 900 / c.width, 600 / c.height);
        p.width = Math.max(1, Math.round(c.width * k));
        p.height = Math.max(1, Math.round(c.height * k));
        p.getContext('2d')!.drawImage(c, 0, 0, p.width, p.height);
        setPreview(p.toDataURL('image/png'));
      } finally {
        if (alive) setBusy(false);
      }
    }, 150);
    return () => {
      alive = false;
      clearTimeout(tmr);
    };
  }, [area, withM, scale, crop?.x, crop?.y, crop?.w, crop?.h]);

  const download = async () => {
    const c = canvasRef.current;
    if (!c) return;
    setBusy(true);
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    let src = c;
    if (format === 'jpeg') {
      // flatten on black (no alpha in JPEG)
      src = document.createElement('canvas');
      src.width = c.width;
      src.height = c.height;
      const g = src.getContext('2d')!;
      g.fillStyle = '#000';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(c, 0, 0);
    }
    const blob = await new Promise<Blob | null>((r) => src.toBlob(r, mime, format === 'jpeg' ? quality : undefined));
    setBusy(false);
    if (blob) downloadBlob(blob, neutralFileName(format === 'png' ? 'png' : 'jpg'));
  };

  return (
    <Modal title={t('exportTitle')} onClose={close} wide>
      <div className="export-grid">
        <div className="export-form">
          <fieldset>
            <legend>{t('area')}</legend>
            <label className="check"><input type="radio" checked={area === 'active'} onChange={() => setArea('active')} /> {t('areaActive')}</label>
            <label className="check"><input type="radio" checked={area === 'all'} disabled={layout === 1} onChange={() => setArea('all')} /> {t('areaAll')}</label>
            <label className="check"><input type="radio" checked={area === 'crop'} disabled={!crop} onChange={() => setArea('crop')} /> {t('areaCrop')}</label>
            {!crop && <p className="hint">{t('cropNone')}</p>}
            <button className="btn small" onClick={() => { selectTool('crop'); close(); }}>{t('chooseCrop')}</button>
          </fieldset>
          <label className="check"><input type="checkbox" checked={withM} onChange={(e) => setWithM(e.target.checked)} /> {t('withMeasurements')}</label>
          <p className="hint">{t('masksAlwaysOn')}</p>
          <label className="field">
            <span>{t('resolution')}</span>
            <select value={String(scale)} onChange={(e) => setScale(e.target.value === 'original' ? 'original' : parseFloat(e.target.value))}>
              <option value="original">{t('scaleOriginal')}</option>
              <option value="1">1× Bildschirm / screen</option>
              <option value="2">2×</option>
              <option value="3">3×</option>
              <option value="4">4×</option>
            </select>
          </label>
          <div className="strong">{plan.width} × {plan.height} px{plan.clamped ? ' (max.)' : ''}</div>
          <label className="field">
            <span>{t('format')}</span>
            <select value={format} onChange={(e) => setFormat(e.target.value as any)}>
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
            </select>
          </label>
          {format === 'jpeg' && (
            <label className="field">
              <span>{t('quality')}: {Math.round(quality * 100)} %</span>
              <input type="range" min={0.5} max={1} step={0.01} value={quality} onChange={(e) => setQuality(parseFloat(e.target.value))} />
            </label>
          )}
          <label className="field">
            <span>{t('fileName')}</span>
            <code className="small">{neutralFileName(format === 'png' ? 'png' : 'jpg')}</code>
          </label>
        </div>
        <div className="export-preview">
          <div className="eyebrow">{t('preview')}</div>
          <div className="preview-box">{preview ? <img src={preview} alt={t('preview')} /> : null}{busy && <div className="vp-loading">{t('exporting')}</div>}</div>
          <p className="hint">{t('previewHint')}</p>
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={close}>{t('cancel')}</button>
        <button className="btn primary" disabled={busy || !canvasRef.current} onClick={download}>{t('download')}</button>
      </div>
    </Modal>
  );
}
