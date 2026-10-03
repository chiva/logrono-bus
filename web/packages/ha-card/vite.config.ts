import { defineConfig } from 'vite';

/**
 * One self-contained ES module (Lit included) that the Home Assistant integration ships and
 * registers, so installing the integration from HACS is all a user does. Same browser floor as
 * the web app: Home Assistant dashboards run on Echo Shows and old tablets too.
 */
export default defineConfig({
  build: {
    target: ['es2020', 'chrome80'],
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'logrono-bus-card.js',
    },
    // A single file: the integration serves exactly one script.
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
