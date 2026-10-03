import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the production build (`vite preview`), with the Ayuntamiento's API
 * replaced by the recorded fixtures (e2e/upstream.ts) and the clock frozen at recording time, so
 * every run sees the same buses.
 *
 * Screen projects mirror the devices the guide documents. `capturas` regenerates the guide's
 * screenshots (docs/guia/img) and only runs with SCREENSHOTS=1.
 */
const PORT = 4174;
const smartDisplay = (width: number, height: number, deviceScaleFactor = 1) => ({
  viewport: { width, height },
  deviceScaleFactor,
  hasTouch: true,
  locale: 'es-ES',
  timezoneId: 'Europe/Madrid',
});

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  webServer: {
    command: `pnpm exec vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'escritorio',
      testMatch: /web\.spec/,
      use: { ...devices['Desktop Chrome'], locale: 'es-ES' },
    },
    { name: 'movil', testMatch: /web\.spec/, use: { ...devices['Pixel 7'], locale: 'es-ES' } },
    // Smart displays: physical resolution minus ~56–64 px of browser toolbar, plus the scaled
    // densities a device may use. Sizes from docs/guia/05-echo-show.md and 05b-portal.md.
    // Echo Show 5 2nd gen (2021) and 3rd gen (2023): 5.5" 960×480, Silk on Fire OS.
    { name: 'echo-show-5-2a-gen', testMatch: /pantalla\.spec/, use: smartDisplay(960, 424) },
    { name: 'echo-show-8', testMatch: /pantalla\.spec/, use: smartDisplay(1280, 736) },
    { name: 'portal-8-10-horizontal', testMatch: /pantalla\.spec/, use: smartDisplay(1280, 736) },
    { name: 'portal-8-10-vertical', testMatch: /pantalla\.spec/, use: smartDisplay(800, 1216) },
    { name: 'portal-8-10-escalado', testMatch: /pantalla\.spec/, use: smartDisplay(853, 477, 1.5) },
    {
      name: 'portal-plus-2018-horizontal',
      testMatch: /pantalla\.spec/,
      use: smartDisplay(1920, 1016),
    },
    {
      name: 'portal-plus-2018-vertical',
      testMatch: /pantalla\.spec/,
      use: smartDisplay(1080, 1856),
    },
    { name: 'portal-plus-2021', testMatch: /pantalla\.spec/, use: smartDisplay(1440, 896, 1.5) },
    {
      name: 'capturas',
      testMatch: /capturas\.spec/,
      use: { ...devices['Desktop Chrome'], locale: 'es-ES' },
    },
  ],
});
