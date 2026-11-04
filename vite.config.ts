import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cornerstone's DICOM image loader ships WASM codecs and a module worker.
// They are bundled with the app (no CDN), see docs/ARCHITEKTUR.md.
export default defineConfig({
  // relative asset paths: works under any sub-path (e.g. GitHub Pages /dicomview/)
  base: './',
  plugins: [react()],
  // xmlbuilder2 (transitive dependency) expects Node's EventEmitter
  resolve: { alias: { events: 'events/' } },
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['@cornerstonejs/dicom-image-loader'],
    include: [
      'dicom-parser',
      // shared entries → one copy of Cornerstone's metadata/state modules in dev mode
      '@cornerstonejs/core',
      '@cornerstonejs/tools',
      '@cornerstonejs/metadata',
      '@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs',
      '@cornerstonejs/codec-charls/decodewasmjs',
      '@cornerstonejs/codec-openjpeg/decodewasmjs',
      '@cornerstonejs/codec-openjph/wasmjs',
    ],
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 },
  server: { port: 5173, host: true },
});
