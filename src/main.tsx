import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/600.css';
import './styles.css';
import { installPurgeWatch, startupCheck } from './core/purge';
import { initCornerstone } from './cs/init';
import { installAnnotationPersistence } from './cs/series';
import { useStore } from './core/store';
import App from './App';

async function boot() {
  // 1) Daily deletion check BEFORE anything patient-related is loaded or shown.
  await startupCheck();
  installPurgeWatch(() => {
    // another tab purged or the deadline passed: drop everything held in memory
    document.body.innerHTML = '';
    location.reload();
  });
  // 2) Rendering libraries (all bundled locally, no CDN)
  await initCornerstone();
  installAnnotationPersistence(() => {
    const s = useStore.getState();
    return { color: s.newColor, lineWidth: s.newLineWidth, angleMode: s.newAngleMode, visible: s.measurementsVisible };
  });
  if (new URLSearchParams(location.search).has('e2e')) {
    // Test hook for automated acceptance tests (local only, contains no data)
    const [ops, reg, tools, core, series] = await Promise.all([import('./cs/viewportOps'), import('./cs/registry'), import('@cornerstonejs/tools'), import('@cornerstonejs/core'), import('./cs/series')]);
    (window as any).__bv = { ops, reg, tools, core, series, store: useStore };
  }
  // calibration / mask changes → re-render measurement texts
  const [{ subscribe }, { renderAllAnnotations }] = await Promise.all([import('./cs/registry'), import('./cs/viewportOps')]);
  subscribe(() => renderAllAnnotations());
  createRoot(document.getElementById('root')!).render(<App />);
}

void boot();
