import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  // keepNames: annotations (right-click → Input) show real component names instead of minified letters.
  // (valid esbuild option, missing from vite's ESBuildOptions type)
  esbuild: { keepNames: true } as never,
  build: { outDir: 'dist' },
});
