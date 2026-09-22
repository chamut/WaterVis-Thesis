import { sites } from '@openai/sites-vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sites()],
  build: { rollupOptions: { input: { main: 'index.html', temporal: 'previews/spatial-grid-minimap-preview.html', multi: 'previews/multiparameter-grid-matrix-preview.html' } } },
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
});
