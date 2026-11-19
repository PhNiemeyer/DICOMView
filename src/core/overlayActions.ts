import { useStore, OVERLAY_OFF } from './store';
import { t } from './i18n';
import { currentImageId, getViewport, scrollTo } from '../cs/viewportOps';
import { renderImageNative } from '../cs/overlay';
import { downloadBlob, renderExport } from '../export/render';

export function setOverlayMode(on: boolean) {
  const st = useStore.getState();
  if (!on) {
    st.set({ overlay: OVERLAY_OFF, overlayExportOpen: false });
    return;
  }
  // always start in a side-by-side view: left = image selection, right = overlay
  st.set({ overlay: { ...OVERLAY_OFF, active: true, stage: 'pick1', vpIndex: 1 }, layout: 2, activeViewport: 0 });
}

/** Button in the left viewport: take the current image as base (1st) or overlay (2nd) image. */
export async function pickFromLeft() {
  const st = useStore.getState();
  const vp = getViewport(0);
  const imageId = currentImageId(vp);
  const seriesUID = st.viewportSeries[0];
  if (!vp || !imageId || !seriesUID) return;
  const index = vp.getCurrentImageIdIndex();
  if (st.overlay.stage === 'pick1') {
    if (st.viewportSeries[1] === seriesUID) void scrollTo(index, 1);
    else st.setViewportSeries(1, seriesUID, index);
    st.set({ overlay: { ...st.overlay, stage: 'pick2', base: { imageId, seriesUID, index }, top: undefined } });
    return;
  }
  const canvas = await renderImageNative(vp, imageId);
  const cur = useStore.getState().overlay;
  if (!cur.active) return;
  useStore.getState().set({ overlay: { ...cur, stage: 'ready', top: { imageId, canvas } }, activeViewport: 1 });
}

/** Button in the right viewport: continue with the overlay in a single field. */
export function adoptOverlay() {
  const st = useStore.getState();
  const o = st.overlay;
  if (!o.base || !o.top) return;
  if (st.viewportSeries[0] === o.base.seriesUID) {
    void scrollTo(o.base.index, 0);
  } else {
    st.setViewportSeries(0, o.base.seriesUID, o.base.index);
  }
  useStore.getState().set({ overlay: { ...o, stage: 'final', vpIndex: 0 }, layout: 1, activeViewport: 0 });
}

export function setOverlayAlpha(alpha: number) {
  const st = useStore.getState();
  st.set({ overlay: { ...st.overlay, alpha } });
}

/** JPEG export of the overlaid view (original resolution of the base image). */
export async function exportOverlay(withAnnotations: boolean) {
  const st = useStore.getState();
  if (st.overlay.stage !== 'final') return;
  const canvas = await renderExport({ area: 'active', withMeasurements: withAnnotations, scale: 'original' });
  const flat = document.createElement('canvas');
  flat.width = canvas.width;
  flat.height = canvas.height;
  const g = flat.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, flat.width, flat.height);
  g.drawImage(canvas, 0, 0);
  const blob = await new Promise<Blob | null>((r) => flat.toBlob(r, 'image/jpeg', 0.92));
  if (!blob) return;
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const name = `dicomview_ueberlagerung_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.jpg`;
  downloadBlob(blob, name);
  st.toast(t('overlayExported'));
}
