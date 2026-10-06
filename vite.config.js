import { sites } from '@openai/sites-vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves project sites below /<repository>/.
  // Keep local development at / so the existing localhost URLs still work.
  base: process.env.GITHUB_ACTIONS ? '/WaterVis-Thesis/' : '/',
  plugins: [sites()],
  build: { rollupOptions: { input: { main: 'index.html', temporal: 'previews/spatial-grid-minimap-preview.html', multi: 'previews/multiparameter-grid-matrix-preview.html', timeline: 'previews/map-timeline-preview.html' } } },
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
});
