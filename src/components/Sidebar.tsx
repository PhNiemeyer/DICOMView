import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Trash, User } from 'lucide-react';
import { useStore } from '../core/store';
import { fmtDicomDate, t } from '../core/i18n';
import { deletePatient, deleteStudy } from '../core/db';
import { dropStudyFromSession, ensureThumbnail } from '../cs/series';
import { forgetWork } from '../cs/registry';
import type { SeriesRec, StudyRec } from '../core/types';

const ICON = { size: 16, strokeWidth: 1.5 };

async function removeStudies(uids: string[]) {
  const st = useStore.getState();
  for (const u of uids) {
    dropStudyFromSession(u);
    forgetWork(u);
  }
  // free viewports showing them
  const serMap = new Map(st.series.map((s) => [s.seriesUID, s.studyUID]));
  st.set({ viewportSeries: st.viewportSeries.map((s) => (s && uids.includes(serMap.get(s)!) ? null : s)) });
}

export function PatientList() {
  const patients = useStore((s) => s.patients);
  const studies = useStore((s) => s.studies);
  const selectedStudy = useStore((s) => s.selectedStudy);
  const open = useStore((s) => s.leftOpen);
  useStore((s) => s.settings.lang);

  const grouped = useMemo(() => {
    return patients
      .map((p) => ({
        p,
        studies: studies.filter((s) => s.patientKey === p.key).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.time.localeCompare(a.time)),
      }))
      .filter((g) => g.studies.length)
      .sort((a, b) => (b.studies[0].date || '').localeCompare(a.studies[0].date || ''));
  }, [patients, studies]);

  if (!open)
    return (
      <aside className="side collapsed">
        <button className="icon-btn" aria-label={t('expand')} title={t('expand')} onClick={() => useStore.getState().set({ leftOpen: true })}>
          <ChevronRight {...ICON} />
        </button>
      </aside>
    );

  return (
    <aside className="side patients" aria-label={t('patients')}>
      <div className="side-head">
        <span className="eyebrow">{t('patients')}</span>
        <button className="icon-btn" aria-label={t('collapse')} title={t('collapse')} onClick={() => useStore.getState().set({ leftOpen: false })}>
          <ChevronLeft {...ICON} />
        </button>
      </div>
      <div className="side-scroll">
        {grouped.length === 0 && <p className="muted small pad">{t('emptyText')}</p>}
        {grouped.map(({ p, studies: ss }) => (
          <section key={p.key} className="pat">
            <div className="pat-head">
              <User {...ICON} className="muted" />
              <div className="pat-name">
                <div className="name">{p.name || t('unnamedPatient')}</div>
                <div className="small muted">
                  {[p.patientId, fmtDicomDate(p.birthDate), p.sex].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button
                className="icon-btn subtle"
                aria-label={t('removePatient')}
                title={t('removePatient')}
                onClick={async () => {
                  if (!confirm(t('confirmRemovePatient'))) return;
                  await removeStudies(ss.map((s) => s.studyUID));
                  await deletePatient(p.key);
                  await useStore.getState().refreshTree();
                }}
              >
                <Trash {...ICON} />
              </button>
            </div>
            <ul className="study-list">
              {ss.map((s) => (
                <StudyItem key={s.studyUID} s={s} selected={selectedStudy === s.studyUID} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}

function StudyItem({ s, selected }: { s: StudyRec; selected: boolean }) {
  return (
    <li>
      <div className={`study ${selected ? 'selected' : ''}`}>
        <button className="study-main" aria-current={selected} onClick={() => useStore.getState().set({ selectedStudy: s.studyUID, seriesOpen: true })}>
          <div className="study-date">{fmtDicomDate(s.date) || t('unknownDate')}</div>
          <div className="study-sub">
            {[s.bodyParts.join(', '), s.modalities.join('/')].filter(Boolean).join(' · ')}
          </div>
          <div className="study-desc">{s.description || t('noDescription')}</div>
        </button>
        <button
          className="icon-btn subtle"
          aria-label={t('removeStudy')}
          title={t('removeStudy')}
          onClick={async () => {
            if (!confirm(t('confirmRemoveStudy'))) return;
            await removeStudies([s.studyUID]);
            await deleteStudy(s.studyUID);
            await useStore.getState().refreshTree();
          }}
        >
          <Trash {...ICON} />
        </button>
      </div>
    </li>
  );
}

export function SeriesPanel() {
  const selectedStudy = useStore((s) => s.selectedStudy);
  const allSeries = useStore((s) => s.series);
  const open = useStore((s) => s.seriesOpen);
  const viewportSeries = useStore((s) => s.viewportSeries);
  const layout = useStore((s) => s.layout);
  useStore((s) => s.settings.lang);
  const series = useMemo(
    () =>
      allSeries
        .filter((s) => s.studyUID === selectedStudy)
        .sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9) || a.description.localeCompare(b.description)),
    [allSeries, selectedStudy],
  );
  if (!open)
    return (
      <aside className="side collapsed">
        <button className="icon-btn" aria-label={t('expand')} title={`${t('series')} – ${t('expand')}`} onClick={() => useStore.getState().set({ seriesOpen: true })}>
          <ChevronRight {...ICON} />
        </button>
      </aside>
    );
  return (
    <aside className="side series" aria-label={t('series')}>
      <div className="side-head">
        <span className="eyebrow">{t('series')}</span>
        <button className="icon-btn" aria-label={t('collapse')} title={t('collapse')} onClick={() => useStore.getState().set({ seriesOpen: false })}>
          <ChevronLeft {...ICON} />
        </button>
      </div>
      <div className="side-scroll">
        {!selectedStudy && <p className="muted small pad">{t('noSeries')}</p>}
        {series.map((s) => (
          <SeriesCard key={s.seriesUID} s={s} shownIn={viewportSeries.slice(0, layout).map((v, i) => (v === s.seriesUID ? i + 1 : 0)).filter(Boolean)} />
        ))}
      </div>
    </aside>
  );
}

const orientLabel: Record<string, string> = { AX: 'AX', COR: 'COR', SAG: 'SAG', OBL: 'OBL' };

function SeriesCard({ s, shownIn }: { s: SeriesRec; shownIn: number[] }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    let alive = true;
    ensureThumbnail(s).then((b) => {
      if (b && alive) {
        u = URL.createObjectURL(b);
        setUrl(u);
      }
    });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [s.seriesUID]);
  return (
    <button
      className={`series-card ${shownIn.length ? 'shown' : ''}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('application/x-bv-series', s.seriesUID)}
      onClick={() => {
        const st = useStore.getState();
        st.setViewportSeries(st.activeViewport, s.seriesUID);
      }}
      title={s.description}
    >
      <div className="thumb">{url ? <img src={url} alt="" /> : <div className="thumb-ph" />}</div>
      <div className="series-meta">
        <div className="series-title">{s.description || t('noDescription')}</div>
        <div className="small muted">
          {[s.modality, orientLabel[s.orientation], `${s.imageCount} ${s.imageCount === 1 ? t('image') : t('images')}`].filter(Boolean).join(' · ')}
        </div>
        {shownIn.length > 0 && <div className="small teal">▸ {shownIn.join(', ')}</div>}
      </div>
    </button>
  );
}
