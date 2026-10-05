import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { useRecordedUpstream } from './upstream.ts';

test.beforeEach(async ({ page }) => {
  await useRecordedUpstream(page);
});

const cards = (page: import('@playwright/test').Page) => page.locator('lb-card');

type Locator = import('@playwright/test').Locator;

/** Pixels between the middle of the map and the nearest of `markers`; polled while Leaflet animates. */
async function offCentre(map: Locator, markers: Locator): Promise<number> {
  const box = await map.boundingBox();
  if (!box) return Number.POSITIVE_INFINITY;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  let nearest = Number.POSITIVE_INFINITY;
  for (const marker of await markers.all()) {
    const mark = await marker.boundingBox();
    if (!mark) continue;
    const distance = Math.hypot(
      mark.x + mark.width / 2 - centre.x,
      mark.y + mark.height / 2 - centre.y,
    );
    nearest = Math.min(nearest, distance);
  }
  return nearest;
}

/** Choose a stop from the picker's list, keep its lines and go back to add another one. */
async function addStopAndComeBack(page: import('@playwright/test').Page, stop: RegExp) {
  await page.getByRole('button', { name: stop }).click();
  await page.getByRole('button', { name: 'Añadir al panel' }).click();
  await page.getByRole('button', { name: /Añadir otra parada/ }).click();
}

test('la portada explica qué es y lleva al ejemplo del Ayuntamiento', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: '¿Cuánto le falta a tu autobús?' })).toBeVisible();
  await page.getByRole('link', { name: 'Ver ejemplo: Ayuntamiento' }).click();
  await expect(page).toHaveURL(/p=101~100/);
  await expect(cards(page)).toHaveCount(8);
  await expect(page.getByRole('heading', { name: 'Ayuntamiento' })).toBeVisible();
});

test('el asistente crea un panel con las líneas elegidas', async ({ page }) => {
  await page.goto('./#asistente');
  await page.getByPlaceholder(/Nombre o número de parada/).fill('ayunta');
  await page.getByRole('button', { name: /Ayuntamiento · nº 101/ }).click();
  await page.getByRole('checkbox', { name: /7.*Enrique Granados/ }).uncheck();
  await page.getByRole('button', { name: 'Añadir al panel' }).click();
  await expect(page.getByRole('heading', { name: 'Tu panel' })).toBeVisible();
  await expect(page.getByText('2 → Manresa · 5 → Dinamarca · 10 → Manuel de Falla')).toBeVisible();
  await page.getByLabel('Título (opcional)').fill('Casa');
  await page.getByRole('button', { name: 'Abrir panel' }).click();
  await expect(page).toHaveURL(/p=101-2d\.5a\.10d/);
  await expect(page).toHaveURL(/titulo=Casa/);
  await expect(cards(page)).toHaveCount(3);
});

test('los campos de aspecto del asistente no se solapan', async ({ page }) => {
  await page.goto('./#asistente');
  await page.getByPlaceholder(/Nombre o número de parada/).fill('ayunta');
  await page.getByRole('button', { name: /Ayuntamiento · nº 101/ }).click();
  await page.getByRole('button', { name: 'Añadir al panel' }).click();
  const title = await page.getByLabel('Título (opcional)').boundingBox();
  const perCard = await page.getByLabel('Llegadas por tarjeta').boundingBox();
  if (!title || !perCard) throw new Error('Los campos de aspecto no se han dibujado');
  const sameRow = Math.abs(title.y - perCard.y) < 1;
  expect(sameRow ? title.x + title.width : title.y + title.height).toBeLessThanOrEqual(
    sameRow ? perCard.x : perCard.y,
  );
});

test('el mapa de paradas aplica los estilos de Leaflet', async ({ page }) => {
  await page.goto('./#asistente');
  await page.getByRole('button', { name: /Ver mapa/ }).click();
  const tilePane = page.locator('lb-stop-map .leaflet-tile-pane');
  await expect(tilePane).toBeAttached();
  await expect(tilePane).toHaveCSS('position', 'absolute');
  await expect(page.locator('lb-stop-map .leaflet-control-zoom-in')).toBeVisible();
});

test.describe('el mapa con tu ubicación', () => {
  /** Standing on stop 101, Ayuntamiento (contracts/fixtures/upstream/stops.json). */
  const AT_STOP_101 = { latitude: 42.46563, longitude: -2.439249, accuracy: 20 };
  test.use({ geolocation: AT_STOP_101, permissions: ['geolocation'] });

  const locateOnMap = async (page: import('@playwright/test').Page) => {
    await page.goto('./#asistente');
    await page.getByRole('button', { name: /Ver mapa/ }).click();
    await page.getByRole('button', { name: /Cerca de mí/ }).click();
    const map = page.locator('lb-stop-map');
    await expect(map.locator('path.here')).toBeVisible();
    const box = await map.boundingBox();
    if (!box) throw new Error('El mapa no se ha dibujado');
    return { map, centre: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
  };

  test('Cerca de mí marca dónde estás y centra el mapa ahí', async ({ page }) => {
    const { map, centre } = await locateOnMap(page);
    await expect(map.locator('path.here-accuracy')).toBeAttached();
    // Leaflet animates the zoom: wait for the dot to settle in the middle.
    await expect
      .poll(async () => {
        const dot = await map.locator('path.here').boundingBox();
        if (!dot) return Number.POSITIVE_INFINITY;
        return Math.hypot(dot.x + dot.width / 2 - centre.x, dot.y + dot.height / 2 - centre.y);
      })
      .toBeLessThan(2);
  });

  test('Cerca de mí abre el mapa centrado donde estás', async ({ page }) => {
    await page.goto('./#asistente');
    await page.getByRole('button', { name: /Cerca de mí/ }).click();
    const map = page.locator('lb-stop-map');
    await expect(map.locator('path.here')).toBeVisible();
    await expect(page.getByRole('button', { name: /Ocultar mapa/ })).toBeVisible();
    await expect.poll(() => offCentre(map, map.locator('path.here'))).toBeLessThan(2);
  });

  test('al añadir otra parada siguen tus paradas cercanas y el mapa donde estás', async ({
    page,
  }) => {
    await page.goto('./#asistente');
    await page.getByRole('button', { name: /Cerca de mí/ }).click();
    await expect(page.getByRole('heading', { name: 'Paradas cerca de ti' })).toBeVisible();
    await addStopAndComeBack(page, /Ayuntamiento · nº 101/);

    await expect(page.getByRole('heading', { name: 'Paradas cerca de ti' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Ayuntamiento · nº 100/ })).toBeVisible();
    const map = page.locator('lb-stop-map');
    await expect(map.locator('path.here')).toBeVisible();
    await expect.poll(() => offCentre(map, map.locator('path.stop'))).toBeLessThan(2);
  });

  test('la etiqueta de una parada muestra sus líneas y no queda bajo el cursor', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Sin puntero no hay etiqueta al pasar por encima');
    const { map, centre } = await locateOnMap(page);
    await page.mouse.move(centre.x, centre.y);
    const tooltip = map.locator('.leaflet-tooltip');
    await expect(tooltip).toContainText('Ayuntamiento · nº 101');
    await expect(tooltip.locator('.badge')).toHaveCount(4);
    await expect(tooltip.locator('.badge').first()).not.toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    );
    const box = await tooltip.boundingBox();
    if (!box) throw new Error('La etiqueta no se ha dibujado');
    const gap = Math.max(box.x - centre.x, centre.x - (box.x + box.width));
    expect(gap).toBeGreaterThanOrEqual(16);
  });
});

test.describe('fuera de Logroño', () => {
  test.use({
    geolocation: { latitude: 40.4168, longitude: -3.7038, accuracy: 20 },
    permissions: ['geolocation'],
  });

  test('Cerca de mí avisa de que no hay paradas y abre el mapa donde estás', async ({ page }) => {
    await page.goto('./#asistente');
    await page.getByRole('button', { name: /Cerca de mí/ }).click();
    await expect(page.getByRole('alert')).toContainText('¿Estás en Logroño?');
    const map = page.locator('lb-stop-map');
    await expect(map.locator('path.here')).toBeVisible();
    await expect.poll(() => offCentre(map, map.locator('path.here'))).toBeLessThan(2);
  });
});

test('el buscador recuerda la búsqueda y el mapa solo en la pestaña', async ({ page, context }) => {
  await page.goto('./#asistente');
  await page.getByRole('button', { name: /Ver mapa/ }).click();
  await page.getByPlaceholder(/Nombre o número de parada/).fill('ayunta');
  await addStopAndComeBack(page, /Ayuntamiento · nº 101/);

  await expect(page.getByPlaceholder(/Nombre o número de parada/)).toHaveValue('ayunta');
  await expect(page.getByRole('heading', { name: 'Resultados para «ayunta»' })).toBeVisible();
  const map = page.locator('lb-stop-map');
  await expect(map.locator('.leaflet-tile-pane')).toBeAttached();
  await expect.poll(() => offCentre(map, map.locator('path.stop'))).toBeLessThan(2);

  const otherTab = await context.newPage();
  await useRecordedUpstream(otherTab);
  await otherTab.goto('./#asistente');
  await expect(otherTab.getByPlaceholder(/Nombre o número de parada/)).toHaveValue('');
  await expect(
    otherTab.getByRole('heading', { name: 'Paradas junto al Ayuntamiento' }),
  ).toBeVisible();
  await expect(otherTab.getByRole('button', { name: /Ver mapa/ })).toBeVisible();
  await expect(otherTab.locator('lb-stop-map')).toHaveCount(0);
});

test('el mapa vuelve a abrirse en la zona donde lo dejaste', async ({ page }) => {
  const storedView = () =>
    page.evaluate(
      () =>
        (JSON.parse(sessionStorage.getItem('logrono-bus:mapa:v1') ?? '{}') as { view?: object })
          .view,
    );
  await page.goto('./#asistente');
  await page.getByRole('button', { name: /Ver mapa/ }).click();
  const map = page.locator('lb-stop-map');
  await expect(map.locator('.leaflet-tile-pane')).toBeAttached();
  const box = await map.boundingBox();
  if (!box) throw new Error('El mapa no se ha dibujado');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 - 100, { steps: 10 });
  await page.mouse.up();
  await expect.poll(storedView).toMatchObject({ zoom: 15 });
  const dragged = (await storedView()) as { lat: number; lon: number; zoom: number };
  expect(dragged.lat).not.toBeCloseTo(42.4655, 3);

  await page.reload();
  await expect(map.locator('.leaflet-tile-pane')).toBeAttached();
  await map.locator('.leaflet-control-zoom-in').click();
  // Zooming in keeps the centre: it can only match if the map reopened where it was dragged.
  await expect.poll(storedView).toMatchObject({ zoom: 16 });
  const reopened = (await storedView()) as { lat: number; lon: number };
  expect(reopened.lat).toBeCloseTo(dragged.lat, 5);
  expect(reopened.lon).toBeCloseTo(dragged.lon, 5);
});

test('tras elegir una parada sin buscar, el buscador muestra las de su alrededor', async ({
  page,
}) => {
  await page.goto('./#asistente');
  await expect(page.getByRole('heading', { name: 'Paradas junto al Ayuntamiento' })).toBeVisible();
  await addStopAndComeBack(page, /Ayuntamiento · nº 100/);

  await expect(
    page.getByRole('heading', { name: 'Paradas junto a Ayuntamiento · nº 100' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Ayuntamiento · nº 101/ })).toBeVisible();
  await expect(page.locator('lb-stop-map')).toHaveCount(0);
});

test('el panel comparte su enlace con un código QR', async ({ page }) => {
  await page.goto('./?v=1&p=101-2d');
  await page.getByRole('button', { name: /Compartir/ }).click();
  await expect(page.getByRole('img', { name: 'Código QR con el enlace del panel' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Enlace del panel' })).toHaveValue(
    /\?v=1&p=101-2d$/,
  );
});

test('las tarjetas muestran línea, destino y minutos', async ({ page }) => {
  await page.goto('./?v=1&p=101-2d&n=2');
  const card = cards(page).first();
  await expect(card.locator('article')).toHaveAttribute(
    'aria-label',
    'Línea 2 hacia Manresa, parada Ayuntamiento: en 1 minuto, en 7 minutos. ¡Llega pronto!',
  );
});

test('un enlace roto explica qué pasa', async ({ page }) => {
  await page.goto('./?v=1&p=101-2q');
  await expect(page.getByRole('alert')).toContainText('Línea no válida');
  await expect(page.getByRole('link', { name: 'Crear un panel nuevo' })).toBeVisible();
});

test('si el servicio del Ayuntamiento falla, lo dice con claridad', async ({ page }) => {
  await page.unrouteAll();
  await useRecordedUpstream(page, { arrivalsStatus: 503 });
  await page.goto('./?v=1&p=101');
  await expect(page.locator('logrono-bus-board').getByRole('alert')).toContainText(
    'No se puede contactar con el servicio de autobuses',
  );
});

test('los temas cambian el estilo de las tarjetas', async ({ page }) => {
  await page.goto('./?v=1&p=101-2d&tema=tinta');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'tinta');
  await expect(cards(page).first()).toHaveAttribute('variant', 'strip');
  await page.goto('./?v=1&p=101-2d&tema=oscuro');
  await expect(cards(page).first()).toHaveAttribute('variant', 'fill');
});

const pseudoStyle = (page: import('@playwright/test').Page, pseudo: '::before' | '::after') =>
  cards(page)
    .first()
    .locator('article')
    .evaluate((article, which) => {
      const style = getComputedStyle(article, which);
      return {
        content: style.content,
        boxShadow: style.boxShadow,
        inset: [style.top, style.right, style.bottom, style.left],
        borderStyle: style.borderTopStyle,
        borderWidth: parseFloat(style.borderTopWidth),
      };
    }, pseudo);

test('el color intenso refuerza el borde aunque no haya sombra, como en Home Assistant', async ({
  page,
}) => {
  await page.goto('./?v=1&p=101-2d&color=intensa');
  await page.addStyleTag({ content: ':root { --lb-shadow: initial !important; }' });
  await expect(cards(page).first()).toHaveAttribute('intensity', 'intensa');
  const ring = await pseudoStyle(page, '::before');
  console.log('intensa ::before', ring);
  expect(ring.boxShadow).toContain('inset');
  expect(ring.inset).toEqual(['0px', '0px', '0px', '0px']);
});

test('el color intenso no añade refuerzo a las tarjetas con franja', async ({ page }) => {
  await page.goto('./?v=1&p=101-2d&color=intensa&tema=tinta');
  await expect(cards(page).first()).toHaveAttribute('variant', 'strip');
  const ring = await pseudoStyle(page, '::before');
  console.log('intensa strip ::before', ring);
  expect(ring.content).toBe('none');
});

test('el aviso dibuja el anillo pegado al borde de la tarjeta', async ({ page }) => {
  await page.goto('./?v=1&p=101-2d&aviso=2&efecto=borde');
  await expect(cards(page).first()).toHaveAttribute('alert', '');
  const ring = await pseudoStyle(page, '::after');
  console.log('aviso ::after', ring);
  expect(ring.inset).toEqual(['0px', '0px', '0px', '0px']);
  expect(ring.borderStyle).toBe('solid');
  expect(ring.borderWidth).toBeGreaterThan(0);
});

for (const [name, url] of [
  ['portada', './'],
  ['panel', './?v=1&p=101~100'],
  ['asistente', './#asistente'],
  ['acerca', './#acerca'],
] as const) {
  test(`accesibilidad (axe): ${name}`, async ({ page }) => {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
    ).toEqual([]);
  });
}

test('los ajustes de pantalla se aplican al momento, viajan en el enlace y se recuerdan', async ({
  page,
}) => {
  await page.goto('./?v=1&p=101-2d');
  await page.getByRole('button', { name: /Aspecto/ }).click();
  await page.getByRole('slider', { name: /Tamaño del texto/ }).fill('130');
  await page.getByRole('radio', { name: 'Suave' }).check();
  await page.getByRole('combobox', { name: 'Tipo de letra' }).selectOption('legible');
  await expect(page).toHaveURL(/tam=130/);
  await expect(page).toHaveURL(/color=suave/);
  await expect(page).toHaveURL(/letra=legible/);
  const board = page.locator('logrono-bus-board');
  await expect(board).toHaveAttribute('style', /--lb-text-scale: 1\.3/);
  await expect(page.locator('lb-card').first()).toHaveAttribute('intensity', 'suave');

  await page.getByRole('button', { name: /Guardar en este dispositivo/ }).click();
  await page.goto('./?v=1&p=100-2a');
  await expect(page.locator('logrono-bus-board')).toHaveAttribute('style', /--lb-text-scale: 1\.3/);
  await expect(page.locator('lb-card').first()).toHaveAttribute('intensity', 'suave');
});

test('el aviso resalta el autobús que está a punto de llegar', async ({ page }) => {
  await page.goto('./?v=1&p=101-2d.5a&aviso=3');
  await expect(page.locator('lb-card').first()).toHaveAttribute('alert', '');
  await expect(page.locator('lb-card').nth(1)).not.toHaveAttribute('alert', '');
});

test('ordenar por próxima llegada recoloca las tarjetas con una animación', async ({ page }) => {
  await page.goto('./?v=1&p=101-7d.10d.5a.2d');
  const labels = () =>
    page
      .locator('lb-card')
      .evaluateAll((cards) =>
        cards.map(
          (card) => (card as HTMLElement & { card: { line_label: string } }).card.line_label,
        ),
      );
  await expect.poll(labels).toEqual(['7', '10', '5', '2']);

  await page.getByRole('button', { name: /Aspecto/ }).click();
  await page.getByRole('combobox', { name: 'Orden de las tarjetas' }).selectOption('llegada');
  // The cards are already sliding to their new places.
  const moving = await page
    .locator('lb-card')
    .evaluateAll((cards) => cards.filter((card) => card.getAnimations().length > 0).length);
  expect(moving).toBeGreaterThan(0);
  await expect(page).toHaveURL(/orden=llegada/);
  await expect.poll(labels).toEqual(['2', '10', '5', '7']);

  await page.getByRole('combobox', { name: 'Orden de las tarjetas' }).selectOption('linea');
  await expect.poll(labels).toEqual(['2', '5', '7', '10']);
});

test('al tocar una tarjeta se ve el recorrido y dónde está el autobús', async ({ page }) => {
  await page.unrouteAll();
  await useRecordedUpstream(page, { scene: 'noche' });
  await page.goto('./?v=1&p=101-10d.2d');
  await page.getByRole('button', { name: /Línea 10 hacia Manuel de Falla/ }).click();
  const route = page.locator('lb-route');
  await expect(route.getByText('→ Manuel de Falla')).toBeVisible();
  await expect(route.locator('.stop.target .name')).toHaveText('Ayuntamiento');
  // Default: 4 stops before yours, with "…" on both sides (the line goes on past Ayuntamiento).
  await expect(route.locator('.stop')).toHaveCount(5);
  await expect(route.locator('.more.before')).toHaveCount(1);
  await expect(route.locator('.more.after')).toHaveCount(1);
  await expect(route.locator('.bus:not(.earlier) .pill')).toHaveText('🚌 2 min');
  // The bus waiting at the start of the line is further back: it waits on the "…".
  await expect(route.locator('.bus.earlier .pill')).toHaveText('🚌 17 min');
  await expect(route.getByRole('img')).toHaveAttribute('aria-label', /a 3 paradas, 2 minutos/);
  await route.getByRole('button', { name: 'Volver' }).click();
  await expect(route).toHaveCount(0);
});

test('el número de paradas previas del recorrido se elige en el enlace', async ({ page }) => {
  await page.unrouteAll();
  await useRecordedUpstream(page, { scene: 'noche' });
  await page.goto('./?v=1&p=101-10d&previas=2');
  await page.getByRole('button', { name: /Línea 10 hacia Manuel de Falla/ }).click();
  const route = page.locator('lb-route');
  await expect(route.locator('.stop')).toHaveCount(3);
  await expect(route.locator('.stop .name')).toHaveText([
    'Hospital San Millán',
    'Alcalde Emilio Francés',
    'Ayuntamiento',
  ]);
});

test('el horario de la línea: salidas de hoy, la próxima marcada', async ({ page }) => {
  await page.unrouteAll();
  await useRecordedUpstream(page, { scene: 'noche' });
  await page.goto('./?v=1&p=101-10d');
  await page.getByRole('button', { name: /Línea 10 hacia Manuel de Falla/ }).click();
  const route = page.locator('lb-route');
  await route.getByRole('button', { name: 'Horario' }).click();
  const timetable = route.locator('lb-timetable');
  // 22:30:36 in Logroño: the 22:30 departure from Artesanos is leaving this minute, so it is still
  // the next one; 23:00 is the last of the day.
  await expect(timetable.locator('.status')).toHaveText('Próxima salida 22:30 · cada 30 min');
  await expect(timetable.locator('li.next')).toHaveText('22:30');
  await expect(timetable.locator('li').last()).toHaveText('23:00');
  await expect(timetable.getByText('Salidas de Artesanos hacia Manuel de Falla.')).toBeVisible();
  await route.getByRole('button', { name: 'Recorrido' }).click();
  await expect(route.locator('.stop.target .name')).toHaveText('Ayuntamiento');
});

test('sin autobuses, la tarjeta dice si el servicio ha terminado', async ({ page }) => {
  await page.unrouteAll();
  const requested = await useRecordedUpstream(page, {
    arrivals: 'vacio',
    at: new Date('2026-10-03T21:30:00Z'), // 23:30 in Logroño
  });
  await page.goto('./?v=1&p=101-10d.2d');
  await expect(page.locator('lb-card').first()).toContainText(
    'Servicio terminado · última salida 23:00',
  );
  await expect(page.locator('lb-card').nth(1)).toContainText(
    'Servicio terminado · última salida 22:30',
  );
  // Tapping opens the timetable straight away, and asks for no bus positions.
  await page.getByRole('button', { name: /Línea 10 hacia Manuel de Falla/ }).click();
  await expect(page.locator('lb-route lb-timetable .status')).toHaveText(
    'Servicio terminado · última salida 23:00',
  );
  expect(requested.filter((path) => path.startsWith('vehicleMonitoring'))).toEqual([]);
  expect(requested.filter((path) => path.startsWith('productionTimetable')).sort()).toEqual([
    'productionTimetable/byLine/10',
    'productionTimetable/byLine/2',
  ]);
});
