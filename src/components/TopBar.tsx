import { useRef } from 'react';
import { Axis3d, Camera, FilePlus, FolderOpen, Settings, Video, Square, Columns2, Grid2x2, PanelRight } from 'lucide-react';
import { useStore, type Layout } from '../core/store';
import { nextPurgeAt } from '../core/purge';
import { t } from '../core/i18n';

const ICON = { size: 18, strokeWidth: 1.5 };

export default function TopBar({ onFiles }: { onFiles: (list: FileList | null) => void }) {
  const layout = useStore((s) => s.layout);
  const lang = useStore((s) => s.settings.lang);
  const autoPurge = useStore((s) => s.settings.autoPurge);
  const set = useStore((s) => s.set);
  const hasActive = useStore((s) => !!s.viewportSeries[s.activeViewport]);
  useStore((s) => s.studies.length);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const next = nextPurgeAt();

  const layouts: { l: Layout; icon: any; label: string }[] = [
    { l: 1, icon: <Square {...ICON} />, label: t('layout1') },
    { l: 2, icon: <Columns2 {...ICON} />, label: t('layout2') },
    { l: 4, icon: <Grid2x2 {...ICON} />, label: t('layout4') },
  ];

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-bar" />
        <span className="brand-name">{t('appName')}</span>
        <span className="brand-note">{t('notDiagnostic')}</span>
      </div>
      <div className="top-actions">
        <button className="top-btn" onClick={() => fileRef.current?.click()}>
          <FilePlus {...ICON} /> {t('importFiles')}
        </button>
        <button className="top-btn" onClick={() => dirRef.current?.click()}>
          <FolderOpen {...ICON} /> {t('importFolder')}
        </button>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
        <input ref={dirRef} type="file" multiple hidden {...({ webkitdirectory: '', directory: '' } as any)} onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
        <span className="top-sep" />
        <div className="seg dark" role="radiogroup" aria-label={t('layout')}>
          {layouts.map((x) => (
            <button
              key={x.l}
              role="radio"
              aria-checked={layout === x.l}
              aria-label={x.label}
              title={x.label}
              className={layout === x.l ? 'on' : ''}
              onClick={() => set({ layout: x.l, activeViewport: Math.min(useStore.getState().activeViewport, x.l - 1) })}
            >
              {x.icon}
            </button>
          ))}
        </div>
        <span className="top-sep" />
        <button className="top-btn" disabled={!hasActive} onClick={() => set({ mprSeries: useStore.getState().viewportSeries[useStore.getState().activeViewport] })}>
          <Axis3d {...ICON} /> {t('mpr')}
        </button>
        <button className="top-btn" disabled={!hasActive} onClick={() => set({ dialog: 'export' })}>
          <Camera {...ICON} /> {t('exportImage')}
        </button>
        <button className="top-btn" disabled={!hasActive} onClick={() => set({ dialog: 'video' })}>
          <Video {...ICON} /> {t('exportVideo')}
        </button>
        <span className="top-sep" />
        <button
          className={`purge-chip ${autoPurge ? '' : 'off'}`}
          onClick={() => set({ dialog: 'settings' })}
          title={t('autoPurge')}
        >
          {autoPurge ? (next ? t('autoPurgeOn', { t: new Date(next).toLocaleTimeString(lang === 'de' ? 'de-DE' : 'en-GB', { hour: '2-digit', minute: '2-digit' }) }) : t('autoPurgeNoData')) : t('autoPurgeOff').split('–')[0]}
        </button>
        <button className="top-btn" aria-label={t('language')} title={t('language')} onClick={() => useStore.getState().setSettings({ lang: lang === 'de' ? 'en' : 'de' })}>
          {lang === 'de' ? 'EN' : 'DE'}
        </button>
        <button className="top-btn icon" aria-label={t('settings')} title={t('settings')} onClick={() => set({ dialog: 'settings' })}>
          <Settings {...ICON} />
        </button>
        <button className="top-btn icon" aria-label={t('properties')} title={t('properties')} onClick={() => set({ rightOpen: !useStore.getState().rightOpen })}>
          <PanelRight {...ICON} />
        </button>
      </div>
    </header>
  );
}
