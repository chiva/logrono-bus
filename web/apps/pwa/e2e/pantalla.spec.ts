/** Screen mode on smart displays: everything visible at once, no scrolling, legible. */
import { expect, test } from '@playwright/test';

import { useRecordedUpstream } from './upstream.ts';

test.beforeEach(async ({ page }) => {
  await useRecordedUpstream(page);
});

for (const [label, selection, expectedCards] of [
  ['4 tarjetas', '101-2d.5a.10d~100-2a', 4],
  ['6 tarjetas', '101-2d.5a.7d.10d~100-2a.10a', 6],
] as const) {
  test(`modo pantalla con ${label}: todo cabe sin desplazarse`, async ({ page }) => {
    await page.goto(`./?v=1&p=${selection}&modo=kiosko&n=2&titulo=Casa`);
    const cards = page.locator('lb-card');
    await expect(cards).toHaveCount(expectedCards);
    await expect(page.getByRole('heading', { name: 'Casa' })).toBeVisible();
    await expect(page.locator('lb-kiosk time')).toHaveText('18:00');

    const viewport = page.viewportSize()!;
    const scroll = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      width: document.documentElement.scrollWidth,
    }));
    expect(scroll.height).toBeLessThanOrEqual(viewport.height);
    expect(scroll.width).toBeLessThanOrEqual(viewport.width);

    for (const card of await cards.all()) {
      const box = (await card.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      // Nothing inside a card may spill out of it.
      const overflow = await card.evaluate((element) => {
        const article = element.shadowRoot!.querySelector('article')!;
        return article.scrollHeight - article.clientHeight;
      });
      expect(overflow).toBeLessThanOrEqual(1);
      // Legible from across a room: a countdown is at least 28 px tall (cards with no bus due
      // show a sentence instead, at least 16 px).
      const sizes = await card.evaluate((element) => {
        const px = (selector: string) => {
          const node = element.shadowRoot!.querySelector(selector);
          return node ? parseFloat(getComputedStyle(node).fontSize) : null;
        };
        return { value: px('.value'), empty: px('.empty') };
      });
      if (sizes.value !== null) expect(sizes.value).toBeGreaterThanOrEqual(28);
      if (sizes.empty !== null) expect(sizes.empty).toBeGreaterThanOrEqual(16);
    }
  });
}

test('un toque muestra cómo salir del modo pantalla', async ({ page }) => {
  await page.goto('./?v=1&p=101-2d&modo=kiosko');
  await page.getByRole('heading', { level: 1 }).click();
  await page.getByRole('link', { name: 'Salir del modo pantalla' }).click();
  await expect(page).not.toHaveURL(/modo=kiosko/);
  await expect(page.getByRole('button', { name: /Modo pantalla/ })).toBeVisible();
});

test('al girar la pantalla (Portal+ 2018) las tarjetas se recolocan sin recargar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1016 });
  await page.goto('./?v=1&p=101-2d.5a.7d.10d~100-2a.10a&modo=kiosko&n=3');
  const columns = () =>
    page
      .locator('lb-card-grid')
      .evaluate(
        (grid) =>
          getComputedStyle(grid.shadowRoot!.querySelector('.grid')!).gridTemplateColumns.split(' ')
            .length,
      );
  await expect(page.locator('lb-card')).toHaveCount(6);
  await expect.poll(columns).toBe(3);
  await page.setViewportSize({ width: 1080, height: 1856 });
  await expect.poll(columns).toBe(2);
  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(scrollHeight).toBeLessThanOrEqual(1856);
});
