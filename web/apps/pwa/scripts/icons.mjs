// Renders public/icon.svg into the PNG sizes the web app manifest and iOS need.
// Uses Playwright's Chromium (already a dev dependency for the e2e suite), so no image toolchain
// is required. Run after editing icon.svg: `pnpm --filter @logrono-bus/pwa icons`.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { chromium } from '@playwright/test';

const PUBLIC_DIR = join(import.meta.dirname, '..', 'public');
const OUTPUTS = [
  { file: 'icon-192.png', size: 192, padding: 0 },
  { file: 'icon-512.png', size: 512, padding: 0 },
  // Maskable icons are cropped to a circle by Android: keep the drawing inside the safe zone.
  { file: 'icon-maskable-512.png', size: 512, padding: 0.1 },
];

const svg = await readFile(join(PUBLIC_DIR, 'icon.svg'), 'utf8');
const browser = await chromium.launch();
try {
  for (const { file, size, padding } of OUTPUTS) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const inset = Math.round(size * padding);
    await page.setContent(
      `<body style="margin:0;background:#8c1c2c">` +
        `<div style="padding:${inset}px;width:${size - 2 * inset}px;height:${size - 2 * inset}px">` +
        svg.replace('<svg ', '<svg width="100%" height="100%" ') +
        `</div></body>`,
    );
    await page.screenshot({ path: join(PUBLIC_DIR, file), omitBackground: false });
    await page.close();
    console.log(`escrito ${file}`);
  }
} finally {
  await browser.close();
}
