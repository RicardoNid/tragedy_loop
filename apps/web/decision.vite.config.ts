import { defineConfig } from 'vite';
export default defineConfig({
  build: { outDir: 'dist/decision', rollupOptions: { input: 'decision.html' } },
});
