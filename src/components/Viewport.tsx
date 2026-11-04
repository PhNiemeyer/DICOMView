import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Enums, eventTarget, type Types } from '@cornerstonejs/core';
import { ToolGroupManager } from '@cornerstonejs/tools';
import { getEngine, MAIN_TOOLGROUP } from '../cs/init';
import { useStore } from '../core/store';
import { fmtDicomDate, fmtNum, t } from '../core/i18n';
import { openSeries, imageIdsOf, releaseSeries } from '../cs/series';
import { canvasToImage, currentImageId, getViewport, getWindow, scrollTo, vpId } from '../cs/viewportOps';
import { effectiveCalibration, getVersion, imageIdToKey, keyToInstance, masksFor, subscribe, updateMasks } from '../cs/registry';
import { fillMasks, maskPolygon, pointInPoly } from '../cs/masks';
import { touchStudy } from '../core/db';
import type { Mask } from '../core/types';

interface Info {
  error?: boolean;
  index: number;
  total: number;
  ww?: number;
  wl?: number;
  zoom?: number;
  loading: boolean;
}

export default function Viewport({ index }: { index: number }) {
  const elRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const seriesUID = useStore((s) => s.viewportSeries[index]);
  const active = useStore((s) => s.activeViewport === index);
  const layout = useStore((s) => s.layout);
  const tool = useStore((s) => s.tool);
  const pipette = useStore((s) => s.pipette);
  const crop = useStore((s) => s.crop);
  const selectedMaskId = useStore((s) => s.selectedMaskId);
  const showPatient = useStore((s) => s.settings.showPatientOverlay);
  const seriesRec = useStore((s) => s.series.find((x) => x.seriesUID === seriesUID));
  const study = useStore((s) => s.studies.find((x) => x.studyUID === seriesRec?.studyUID));
  const patient = useStore((s) => s.patients.find((x) => x.key === study?.patientKey));
  const [info, setInfo] = useState<Info>({ index: 0, total: 0, loading: false });
  const [ready, setReady] = useState(false);
  const regVersion = useSyncExternalStore(subscribe, getVersion);

  // enable element
  useEffect(() => {
    const el = elRef.current!;
    const engine = getEngine();
    engine.enableElement({ viewportId: vpId(index), element: el, type: Enums.ViewportType.STACK, defaultOptions: { background: [0, 0, 0] } } as any);
    ToolGroupManager.getToolGroup(MAIN_TOOLGROUP)?.addViewport(vpId(index), engine.id);
    setReady(true);
    const ro = new ResizeObserver(() => {
      engine.resize(true, true);
      drawOverlay();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      ToolGroupManager.getToolGroup(MAIN_TOOLGROUP)?.removeViewports(engine.id, vpId(index));
      engine.disableElement(vpId(index));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // load series
  useEffect(() => {
    if (!ready) return;
    const vp = getViewport(index);
    if (!vp) return;
    let cancelled = false;
    if (!seriesRec) {
      void vp.setStack([]).catch(() => undefined);
      setInfo({ index: 0, total: 0, loading: false });
      return;
    }
    setInfo((i) => ({ ...i, loading: true }));
    (async () => {
      const imgs = await openSeries(seriesRec);
      if (cancelled) return;
      const ids = imageIdsOf(imgs);
      await touchStudy(seriesRec.studyUID);
      let error = false;
      try {
        await vp.setStack(ids, 0);
        vp.render();
      } catch {
        error = true; // shown in the viewport instead of failing silently
      }
      if (cancelled) return;
      setInfo({ index: 0, total: ids.length, loading: false, error, ...readVoi(vp) });
    })();
    const uid = seriesRec.seriesUID;
    return () => {
      cancelled = true;
      // release memory if no other viewport shows the series
      setTimeout(() => {
        const st = useStore.getState();
        if (!st.viewportSeries.slice(0, st.layout).includes(uid) && st.mprSeries !== uid) releaseSeries(uid);
      }, 0);
    };
  }, [ready, seriesRec?.seriesUID, index]);

  // events
  useEffect(() => {
    const el = elRef.current!;
    const onNew = () => {
      const vp = getViewport(index);
      if (!vp) return;
      setInfo((i) => ({ ...i, error: false, index: vp.getCurrentImageIdIndex(), total: vp.getImageIds().length }));
    };
    const onFail = (e: any) => {
      const vp = getViewport(index);
      if (vp && e.detail?.imageId === currentImageId(vp)) setInfo((i) => ({ ...i, error: true, loading: false }));
    };
    eventTarget.addEventListener(Enums.Events.IMAGE_LOAD_FAILED, onFail);
    const onVoi = () => {
      const vp = getViewport(index);
      if (vp) setInfo((i) => ({ ...i, ...readVoi(vp) }));
    };
    const onRender = () => {
      drawOverlay();
      onVoi();
    };
    el.addEventListener(Enums.Events.STACK_NEW_IMAGE, onNew);
    el.addEventListener(Enums.Events.VOI_MODIFIED, onVoi);
    el.addEventListener(Enums.Events.IMAGE_RENDERED, onRender);
    el.addEventListener(Enums.Events.CAMERA_MODIFIED, onRender);
    return () => {
      eventTarget.removeEventListener(Enums.Events.IMAGE_LOAD_FAILED, onFail);
      el.removeEventListener(Enums.Events.STACK_NEW_IMAGE, onNew);
      el.removeEventListener(Enums.Events.VOI_MODIFIED, onVoi);
      el.removeEventListener(Enums.Events.IMAGE_RENDERED, onRender);
      el.removeEventListener(Enums.Events.CAMERA_MODIFIED, onRender);
    };
  });

  useEffect(() => drawOverlay(), [regVersion, selectedMaskId, crop, tool, layout]);

  function readVoi(vp: Types.IStackViewport) {
    const w = getWindow(vp);
    let zoom: number | undefined;
    try {
      zoom = vp.getZoom();
    } catch {
      /* ignore */
    }
    return { ww: w?.ww, wl: w?.wl, zoom };
  }

  // ---------- mask / crop overlay ----------
  function drawOverlay() {
    const c = overlayRef.current;
    const el = elRef.current;
    if (!c || !el) return;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    const vp = getViewport(index);
    const imageId = currentImageId(vp);
    if (!vp || !imageId) return;
    const key = imageIdToKey.get(imageId);
    if (!key) return;
    const masks = masksFor(key);
    fillMasks(g, vp, imageId, masks, dpr);
    const st = useStore.getState();
    if (st.tool === 'mask') {
      for (const m of masks) {
        const poly = maskPolygon(vp, imageId, m);
        g.save();
        g.setLineDash(m.scope === 'series' ? [6 * dpr, 4 * dpr] : []);
        g.strokeStyle = m.id === st.selectedMaskId ? '#168B92' : 'rgba(87,200,206,0.8)';
        g.lineWidth = (m.id === st.selectedMaskId ? 2 : 1) * dpr;
        g.beginPath();
        poly.forEach(([x, y], i) => (i ? g.lineTo(x * dpr, y * dpr) : g.moveTo(x * dpr, y * dpr)));
        g.closePath();
        g.stroke();
        if (m.id === st.selectedMaskId)
          for (const [x, y] of poly) {
            g.fillStyle = '#ffffff';
            g.fillRect(x * dpr - 4 * dpr, y * dpr - 4 * dpr, 8 * dpr, 8 * dpr);
          }
        g.restore();
      }
    }
    if (st.crop && st.crop.viewportIndex === index) {
      g.save();
      g.strokeStyle = '#57C8CE';
      g.lineWidth = 1.5 * dpr;
      g.setLineDash([6 * dpr, 4 * dpr]);
      g.strokeRect(st.crop.x * dpr, st.crop.y * dpr, st.crop.w * dpr, st.crop.h * dpr);
      g.restore();
    }
  }

  const drag = useRef<null | { mode: 'new' | 'move' | 'resize' | 'crop'; start: [number, number]; startImg: [number, number]; mask?: Mask; corner?: number; studyUID?: string }>(null);

  const interactive = (tool === 'mask' || tool === 'crop' || pipette) && !!seriesRec;

  function local(e: React.PointerEvent): [number, number] {
    const r = elRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function onPointerDown(e: React.PointerEvent) {
    useStore.getState().set({ activeViewport: index });
    const vp = getViewport(index);
    const imageId = currentImageId(vp);
    if (!vp || !imageId) return;
    const p = local(e);
    const st = useStore.getState();
    if (st.pipette) {
      const canvas = vp.getCanvas();
      const dpr = canvas.width / canvas.clientWidth;
      const px = canvas.getContext('2d')?.getImageData(Math.round(p[0] * dpr), Math.round(p[1] * dpr), 1, 1).data;
      if (px) {
        const hex = '#' + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
        st.set({ maskColor: hex, pipette: false });
        if (st.selectedMaskId) {
          const key = imageIdToKey.get(imageId)!;
          updateMasks(keyToInstance.get(key)!.studyUID, (ms) => ms.map((m) => (m.id === st.selectedMaskId ? { ...m, color: hex } : m)));
        }
      }
      return;
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const ip = canvasToImage(vp, p);
    if (!ip) return;
    if (st.tool === 'crop') {
      drag.current = { mode: 'crop', start: p, startImg: ip };
      st.set({ crop: { viewportIndex: index, x: p[0], y: p[1], w: 0, h: 0 } });
      return;
    }
    const key = imageIdToKey.get(imageId)!;
    const inst = keyToInstance.get(key)!;
    const masks = masksFor(key);
    // handles of selected mask
    const sel = masks.find((m) => m.id === st.selectedMaskId);
    if (sel) {
      const poly = maskPolygon(vp, imageId, sel);
      const ci = poly.findIndex(([x, y]) => Math.hypot(x - p[0], y - p[1]) < 9);
      if (ci >= 0) {
        drag.current = { mode: 'resize', start: p, startImg: ip, mask: { ...sel }, corner: ci, studyUID: inst.studyUID };
        return;
      }
    }
    const hit = [...masks].reverse().find((m) => pointInPoly(p, maskPolygon(vp, imageId, m)));
    if (hit) {
      st.set({ selectedMaskId: hit.id });
      drag.current = { mode: 'move', start: p, startImg: ip, mask: { ...hit }, studyUID: inst.studyUID };
      return;
    }
    const m: Mask = {
      id: crypto.randomUUID(),
      scope: st.maskScope,
      target: st.maskScope === 'series' ? inst.seriesUID : key,
      seriesUID: inst.seriesUID,
      x: ip[0],
      y: ip[1],
      w: 0,
      h: 0,
      color: st.maskColor,
    };
    updateMasks(inst.studyUID, (ms) => [...ms, m]);
    st.set({ selectedMaskId: m.id });
    drag.current = { mode: 'new', start: p, startImg: ip, mask: m, studyUID: inst.studyUID };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const vp = getViewport(index);
    if (!vp) return;
    const p = local(e);
    if (d.mode === 'crop') {
      const x = Math.min(p[0], d.start[0]);
      const y = Math.min(p[1], d.start[1]);
      useStore.getState().set({ crop: { viewportIndex: index, x, y, w: Math.abs(p[0] - d.start[0]), h: Math.abs(p[1] - d.start[1]) } });
      return;
    }
    const ip = canvasToImage(vp, p);
    if (!ip || !d.mask) return;
    const m0 = d.mask;
    let next: Mask;
    if (d.mode === 'move') {
      next = { ...m0, x: m0.x + ip[0] - d.startImg[0], y: m0.y + ip[1] - d.startImg[1] };
    } else {
      // opposite corner fixed (image coordinates)
      const corners: [number, number][] = [
        [m0.x, m0.y],
        [m0.x + m0.w, m0.y],
        [m0.x + m0.w, m0.y + m0.h],
        [m0.x, m0.y + m0.h],
      ];
      const fixed = d.mode === 'new' ? d.startImg : corners[(d.corner! + 2) % 4];
      next = { ...m0, x: Math.min(fixed[0], ip[0]), y: Math.min(fixed[1], ip[1]), w: Math.abs(ip[0] - fixed[0]), h: Math.abs(ip[1] - fixed[1]) };
    }
    updateMasks(d.studyUID!, (ms) => ms.map((m) => (m.id === next.id ? next : m)));
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (d?.mode === 'new' && d.mask) {
      // discard accidental clicks
      updateMasks(d.studyUID!, (ms) => ms.filter((m) => m.id !== d.mask!.id || (m.w >= 2 && m.h >= 2)));
    }
    if (d?.mode === 'crop') {
      const c = useStore.getState().crop;
      if (c && (c.w < 8 || c.h < 8)) useStore.getState().set({ crop: null });
    }
  }

  const imageId = currentImageId(getViewport(index));
  const key = imageId ? imageIdToKey.get(imageId) : undefined;
  const cal = key ? effectiveCalibration(key) : null;

  return (
    <div
      className={`viewport ${active ? 'active' : ''}`}
      onPointerDownCapture={() => useStore.getState().activeViewport !== index && useStore.getState().set({ activeViewport: index })}
      onDragOver={(e) => e.dataTransfer.types.includes('application/x-bv-series') && e.preventDefault()}
      onDrop={(e) => {
        const uid = e.dataTransfer.getData('application/x-bv-series');
        if (uid) {
          e.preventDefault();
          e.stopPropagation();
          useStore.getState().setViewportSeries(index, uid);
          useStore.getState().set({ activeViewport: index });
        }
      }}
      aria-label={`${t('activeViewport')} ${index + 1}`}
    >
      <div ref={elRef} className="vp-element" onContextMenu={(e) => e.preventDefault()} />
      <canvas
        ref={overlayRef}
        className="vp-overlay"
        style={{ pointerEvents: interactive ? 'auto' : 'none', cursor: pipette ? 'crosshair' : tool === 'mask' || tool === 'crop' ? 'crosshair' : 'default' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={(e) => {
          // keep scrolling through the series while the overlay captures input
          if (!interactive) return;
          void scrollTo(info.index + Math.sign(e.deltaY), index);
        }}
      />
      {!seriesRec && <div className="vp-empty">{t('emptyViewport')}</div>}
      {seriesRec && (
        <>
          <div className="vp-info tl">
            {showPatient && patient && (
              <div className="patient-overlay">
                <div>{patient.name || t('unnamedPatient')}</div>
                <div>{patient.patientId}</div>
                <div>{fmtDicomDate(study?.date || '')}</div>
              </div>
            )}
            <div>{seriesRec.modality} {seriesRec.description}</div>
          </div>
          <div className="vp-info tr">
            {info.total > 0 && (
              <div>
                {t('slice')} {info.index + 1}/{info.total}
              </div>
            )}
            {info.ww != null && (
              <div>
                {t('ww')} {Math.round(info.ww)} · {t('wl')} {Math.round(info.wl!)}
              </div>
            )}
            {info.zoom != null && <div>{t('zoom')} {fmtNum(info.zoom, 2)}×</div>}
          </div>
          <div className="vp-info bl">
            {cal ? (
              <span className={cal.source.startsWith('manual') || cal.magnification11 ? 'cal-flag' : ''}>
                {calShort(cal)}
              </span>
            ) : (
              <span className="cal-flag">px</span>
            )}
          </div>
          {info.loading && <div className="vp-loading">{t('loading')}</div>}
          {info.error && <div className="vp-loading err-box">{t('decodeError')}</div>}
          {info.total > 1 && (
            <input
              className="vp-slider"
              type="range"
              min={0}
              max={info.total - 1}
              value={info.index}
              aria-label={t('slice')}
              onChange={(e) => void scrollTo(parseInt(e.target.value, 10), index)}
            />
          )}
        </>
      )}
      {layout > 1 && <div className="vp-number">{index + 1}</div>}
    </div>
  );
}

function calShort(c: NonNullable<ReturnType<typeof effectiveCalibration>>) {
  const base = c.source === 'manual-sphere' ? t('calSphere') : c.source === 'manual-distance' ? t('calDistance') : 'DICOM';
  return `${base}${c.magnification11 ? ' · ×1/1,1' : ''} · ${fmtNum(c.sx, 3)} mm/px`;
}
