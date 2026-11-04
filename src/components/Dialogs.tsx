import { useEffect, useState } from 'react';
import { useStore } from '../core/store';
import { fmtDicomDate, t, type DictKey } from '../core/i18n';
import Modal from './Modal';
import type { ImportProgress, PendingImage } from '../import/importer';
import { assignImages } from '../import/importer';
import { usedBytes } from '../core/db';
import { nextPurgeAt, purgeAll } from '../core/purge';

// ---------------- import progress ----------------
export function ImportPanel({ progress, onCancel, onClose }: { progress: ImportProgress; onCancel: () => void; onClose: () => void }) {
  const pct = progress.total ? Math.round(((progress.current - (progress.done ? 0 : 1) + (progress.sub ? progress.sub.current / progress.sub.total : 0)) / progress.total) * 100) : 0;
  const stop: Record<string, DictKey> = { limit: 'stopLimit', cancelled: 'stopCancelled', 'zip-limit': 'stopZipLimit', purged: 'stopPurged' };
  return (
    <Modal title={progress.done ? t('importDone') : t('importing')} onClose={progress.done ? onClose : () => undefined}>
      {!progress.done && (
        <>
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${Math.max(2, pct)}%` }} />
          </div>
          <div className="small muted ellipsis">{progress.name}</div>
        </>
      )}
      <div className="stats">
        <div>{t('imported')}: <strong>{progress.imported}</strong></div>
        <div>{t('duplicates')}: <strong>{progress.duplicates}</strong></div>
        <div>{t('issues')}: <strong>{progress.issues.length}</strong></div>
      </div>
      {progress.evictedStudies > 0 && <p className="warn">{t('evicted', { n: progress.evictedStudies })}</p>}
      {progress.stoppedReason && <p className="err">{t(stop[progress.stoppedReason])}</p>}
      {progress.issues.length > 0 && (
        <ul className="issues">
          {progress.issues.slice(0, 300).map((i, k) => (
            <li key={k}>
              <span className="ellipsis">{i.path || '—'}</span>
              <span className="muted">{t(`err_${i.code}` as DictKey)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="modal-actions">
        {!progress.done ? (
          <button className="btn" onClick={onCancel}>{t('cancel')}</button>
        ) : (
          <button className="btn primary" onClick={onClose}>{t('ok')}</button>
        )}
      </div>
    </Modal>
  );
}

// ---------------- assign JPEG/PNG/BMP ----------------
export function AssignDialog({ images, onDone }: { images: PendingImage[]; onDone: () => void }) {
  const patients = useStore((s) => s.patients);
  const studies = useStore((s) => s.studies);
  const [pMode, setPMode] = useState<'existing' | 'new'>(patients.length ? 'existing' : 'new');
  const [pKey, setPKey] = useState(patients[0]?.key ?? '');
  const [pName, setPName] = useState('');
  const [pId, setPId] = useState('');
  const pStudies = studies.filter((s) => s.patientKey === pKey);
  const [sMode, setSMode] = useState<'existing' | 'new'>('new');
  const [sUID, setSUID] = useState('');
  const [sDate, setSDate] = useState(new Date().toISOString().slice(0, 10));
  const [sDesc, setSDesc] = useState('');

  useEffect(() => setSUID(pStudies[0]?.studyUID ?? ''), [pKey]);

  const submit = async (later = false) => {
    if (later) await assignImages(images, { newPatient: { name: t('later'), patientId: '' }, newStudy: { date: '', description: '' } });
    else
      await assignImages(images, {
        patientKey: pMode === 'existing' ? pKey : undefined,
        newPatient: pMode === 'new' ? { name: pName, patientId: pId } : undefined,
        studyUID: pMode === 'existing' && sMode === 'existing' ? sUID : undefined,
        newStudy: { date: sDate, description: sDesc },
      });
    await useStore.getState().refreshTree();
    onDone();
  };

  return (
    <Modal title={t('assignTitle')} onClose={() => submit(true)}>
      <p>{t('assignText', { n: images.length })}</p>
      <fieldset>
        <label className="check"><input type="radio" checked={pMode === 'existing'} disabled={!patients.length} onChange={() => setPMode('existing')} /> {t('existingPatient')}</label>
        {pMode === 'existing' && (
          <select value={pKey} onChange={(e) => setPKey(e.target.value)}>
            {patients.map((p) => <option key={p.key} value={p.key}>{p.name || t('unnamedPatient')} {p.patientId && `(${p.patientId})`}</option>)}
          </select>
        )}
        <label className="check"><input type="radio" checked={pMode === 'new'} onChange={() => setPMode('new')} /> {t('newPatient')}</label>
        {pMode === 'new' && (
          <div className="row2">
            <label><span>{t('patientName')}</span><input value={pName} onChange={(e) => setPName(e.target.value)} /></label>
            <label><span>{t('patientIdLabel')}</span><input value={pId} onChange={(e) => setPId(e.target.value)} /></label>
          </div>
        )}
      </fieldset>
      <fieldset>
        {pMode === 'existing' && pStudies.length > 0 && (
          <>
            <label className="check"><input type="radio" checked={sMode === 'existing'} onChange={() => setSMode('existing')} /> {t('existingStudy')}</label>
            {sMode === 'existing' && (
              <select value={sUID} onChange={(e) => setSUID(e.target.value)}>
                {pStudies.map((s) => <option key={s.studyUID} value={s.studyUID}>{fmtDicomDate(s.date) || t('unknownDate')} – {s.description || t('noDescription')}</option>)}
              </select>
            )}
          </>
        )}
        <label className="check"><input type="radio" checked={sMode === 'new' || pMode === 'new' || !pStudies.length} onChange={() => setSMode('new')} /> {t('newStudy')}</label>
        {(sMode === 'new' || pMode === 'new' || !pStudies.length) && (
          <div className="row2">
            <label><span>{t('studyDate')}</span><input type="date" value={sDate} onChange={(e) => setSDate(e.target.value)} /></label>
            <label><span>{t('studyDescription')}</span><input value={sDesc} onChange={(e) => setSDesc(e.target.value)} /></label>
          </div>
        )}
      </fieldset>
      <div className="modal-actions">
        <button className="btn" onClick={() => submit(true)}>{t('later')}</button>
        <button className="btn primary" onClick={() => submit(false)}>{t('assign')}</button>
      </div>
    </Modal>
  );
}

// ---------------- settings ----------------
export function SettingsDialog() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const [used, setUsed] = useState(0);
  useEffect(() => {
    void usedBytes().then(setUsed);
  }, []);
  const close = () => useStore.getState().set({ dialog: null });
  const next = nextPurgeAt();
  const mb = (b: number) => `${(b / 1024 / 1024).toFixed(0)} MB`;
  return (
    <Modal title={t('settings')} onClose={close}>
      <section className="psec">
        <h3>{t('language')}</h3>
        <div className="seg">
          {(['de', 'en'] as const).map((l) => (
            <button key={l} className={settings.lang === l ? 'on' : ''} aria-pressed={settings.lang === l} onClick={() => setSettings({ lang: l })}>
              {l === 'de' ? 'Deutsch' : 'English'}
            </button>
          ))}
        </div>
      </section>
      <section className="psec">
        <h3>{t('storage')}</h3>
        <div className="meter"><div style={{ width: `${Math.min(100, (used / (settings.storageLimitMB * 1048576)) * 100)}%` }} /></div>
        <div className="small">{t('used')}: {mb(used)} / {settings.storageLimitMB} MB</div>
        <label className="field">
          <span>{t('limit')} (MB)</span>
          <select value={settings.storageLimitMB} onChange={(e) => setSettings({ storageLimitMB: parseInt(e.target.value, 10) })}>
            {[256, 512, 1024, 2048, 4096].map((v) => <option key={v} value={v}>{v} MB</option>)}
          </select>
        </label>
        <p className="hint">{t('limitHint')}</p>
      </section>
      <section className="psec">
        <h3>{t('autoPurge')}</h3>
        <label className="check">
          <input type="checkbox" checked={settings.autoPurge} onChange={(e) => setSettings({ autoPurge: e.target.checked })} />
          <span>{t('autoPurge')}</span>
        </label>
        <label className="field">
          <span>{t('purgeTime')}</span>
          <input type="time" value={settings.purgeTime} onChange={(e) => e.target.value && setSettings({ purgeTime: e.target.value })} />
        </label>
        <p className={settings.autoPurge ? 'small' : 'warn'}>
          {settings.autoPurge ? (next ? t('autoPurgeOn', { t: new Date(next).toLocaleString() }) : t('autoPurgeNoData')) : t('autoPurgeOff')}
        </p>
        <button
          className="btn danger"
          onClick={async () => {
            if (!confirm(t('purgeConfirm'))) return;
            await purgeAll('manual');
            location.reload();
          }}
        >
          {t('purgeNow')}
        </button>
        <p className="hint">{t('purgeNote')}</p>
      </section>
      <section className="psec">
        <h3>{t('privacy')}</h3>
        <p className="hint">{t('privacyText')}</p>
        <p className="hint">{t('notDiagnostic')}</p>
      </section>
    </Modal>
  );
}
