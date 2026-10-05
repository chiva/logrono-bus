/**
 * Screenshots for the guide (docs/guia/img). Run with `just screenshots`; skipped otherwise so the
 * images only change when someone means to change them. Animations are stopped at a fixed frame
 * (finite ones at their end, infinite ones at their start) so two runs give identical images.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { test } from '@playwright/test';

import { useRecordedUpstream } from './upstream.ts';

const OUT = join(import.meta.dirname, '../../../../docs/guia/img');
const PANEL = 'v=1&p=101-2d.5a.10d~100-2a&n=2';

test.skip(!process.env.SCREENSHOTS, 'solo con SCREENSHOTS=1 (just screenshots)');

const SHOTS = [
  { file: 'portada.png', url: './', viewport: { width: 1280, height: 800 } },
  { file: 'asistente-parada.png', url: './#asistente', viewport: { width: 1100, height: 900 } },
  { file: 'panel-movil.png', url: `./?${PANEL}`, viewport: { width: 390, height: 844 } },
  {
    file: 'panel-escritorio.png',
    url: `./?${PANEL}&titulo=Casa`,
    viewport: { width: 1280, height: 720 },
  },
  ...['auto', 'oscuro', 'alto-contraste', 'logrono', 'tinta'].map((tema) => ({
    file: `echo-show-5-${tema}.png`,
    url: `./?${PANEL}&modo=kiosko&titulo=Casa&tema=${tema}`,
    viewport: { width: 960, height: 480 },
  })),
  {
    file: 'portal-horizontal.png',
    url: `./?v=1&p=101-2d.5a.7d.10d~100-2a.10a&modo=kiosko&n=3&tema=logrono`,
    viewport: { width: 1280, height: 736 },
  },
  {
    file: 'portal-vertical.png',
    url: `./?v=1&p=101-2d.5a.7d.10d~100-2a.10a&modo=kiosko&n=3&tema=oscuro`,
    viewport: { width: 800, height: 1216 },
  },
  {
    file: 'portal-plus-horizontal.png',
    url: `./?v=1&p=101-2d.5a.7d.10d~100-2a.10a&modo=kiosko&n=3&titulo=Casa`,
    viewport: { width: 1920, height: 1016 },
  },
  {
    file: 'portal-plus-vertical.png',
    url: `./?v=1&p=101-2d.5a.7d.10d~100-2a.10a&modo=kiosko&n=3&titulo=Casa&tema=oscuro`,
    viewport: { width: 1080, height: 1856 },
  },
  {
    file: 'ajustes-pantalla.png',
    url: `./?${PANEL}&titulo=Casa`,
    viewport: { width: 1100, height: 900 },
    settings: true,
  },
  {
    file: 'echo-show-5-aviso.png',
    url: `./?${PANEL}&modo=kiosko&titulo=Casa&aviso=5&efecto=borde&tam=110&letra=legible`,
    viewport: { width: 960, height: 480 },
  },
  {
    file: 'echo-show-5-suave.png',
    url: `./?${PANEL}&modo=kiosko&titulo=Casa&color=suave&tema=oscuro&letra=redondeada`,
    viewport: { width: 960, height: 480 },
  },
  {
    file: 'recorrido-movil.png',
    url: './?v=1&p=101-10d',
    viewport: { width: 390, height: 844 },
    route: true,
  },
  {
    file: 'recorrido-echo-show-5.png',
    url: './?v=1&p=101-10d.2d&modo=kiosko&titulo=Casa',
    viewport: { width: 960, height: 480 },
    route: true,
  },
  {
    file: 'recorrido-portal-vertical.png',
    url: './?v=1&p=101-10d.2d&modo=kiosko&tema=oscuro',
    viewport: { width: 800, height: 1216 },
    route: true,
  },
  {
    // Ayuntamiento is the 9th stop of line 2 towards Manresa: with 8 before it, the start shows.
    file: 'recorrido-cabecera-movil.png',
    url: './?v=1&p=101-2d&previas=8',
    viewport: { width: 390, height: 844 },
    route: true,
    line: /Línea 2 hacia Manresa/,
  },
  {
    file: 'horario-movil.png',
    url: './?v=1&p=101-10d',
    viewport: { width: 390, height: 844 },
    route: true,
    timetable: true,
  },
  {
    file: 'horario-echo-show-5.png',
    url: './?v=1&p=101-10d.2d&modo=kiosko&titulo=Casa',
    viewport: { width: 960, height: 480 },
    route: true,
    timetable: true,
  },
];

for (const shot of SHOTS) {
  test(shot.file, async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await useRecordedUpstream(page, 'route' in shot ? { scene: 'noche' } : {});
    await page.setViewportSize(shot.viewport);
    await page.goto(shot.url);
    await page.waitForLoadState('networkidle');
    if ('settings' in shot) await page.getByRole('button', { name: /Aspecto/ }).click();
    if ('route' in shot) {
      const line = 'line' in shot ? shot.line : /Línea 10 hacia Manuel de Falla/;
      await page.getByRole('button', { name: line }).click();
      await page.locator('lb-route .track').waitFor();
      await page.waitForTimeout(1500);
    }
    if ('timetable' in shot) {
      await page.locator('lb-route').getByRole('button', { name: 'Horario' }).click();
      await page.locator('lb-route lb-timetable li.next').waitFor();
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, shot.file), animations: 'disabled' });
  });
}
