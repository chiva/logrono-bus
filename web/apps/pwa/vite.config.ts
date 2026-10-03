import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * - `base: './'`: the same build works at the root of a server (Docker image), under a sub-path
 *   (GitHub Pages /logrono-bus/, Home Assistant ingress) and opened from any folder.
 * - `target`: the Echo Show's Silk browser lags behind desktop Chromium (the Echo Show 5 2nd gen
 *   runs Fire OS 7). Chrome 80 is the floor: syntax newer than that (private fields, `??=`,
 *   static blocks) is compiled down.
 * - The service worker only precaches the app shell. Arrivals are never cached by it: a stale
 *   "llega en 2 min" is worse than an honest error.
 */
export default defineConfig({
  base: './',
  build: {
    target: ['es2020', 'chrome80'],
    sourcemap: true,
    chunkSizeWarningLimit: 300,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg', 'favicon.svg'],
      manifest: {
        id: './',
        name: 'Logroño Bus · Próximos autobuses',
        short_name: 'Bus Logroño',
        description: 'Cuánto falta para tu autobús en Logroño, en tu móvil o en una pantalla.',
        lang: 'es',
        dir: 'ltr',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#0e1116',
        theme_color: '#8c1c2c',
        categories: ['travel', 'navigation', 'utilities'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallbackDenylist: [/^\/api\//, /^\/(livez|readyz|metrics|docs)/],
        runtimeCaching: [],
      },
    }),
  ],
});
