/** Line colours: parsing upstream colour strings and choosing a legible text colour (WCAG). */

export const BLACK = '#000000';
export const WHITE = '#FFFFFF';

const RGBA = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i;
const HEX = /^#?([0-9a-f]{6})$/i;
const SRGB_LINEAR_THRESHOLD = 0.04045;
const LUMINANCE_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;
const CONTRAST_OFFSET = 0.05;
const MAX_CHANNEL = 255;

/** `rgba(1,255,1,1)` / `rgb()` / `#0fdcfc` / `0fdcfc` → `#RRGGBB`. Throws on anything else. */
export function parseColour(value: string): string {
  const text = value.trim();
  const hex = HEX.exec(text);
  if (hex?.[1]) return `#${hex[1].toUpperCase()}`;
  const rgba = RGBA.exec(text);
  if (rgba) {
    const channels = rgba.slice(1, 4).map(Number);
    if (channels.some((channel) => channel > MAX_CHANNEL)) {
      throw new RangeError(`Canal de color fuera de rango: '${value}'`);
    }
    return `#${channels.map((channel) => channel.toString(16).padStart(2, '0').toUpperCase()).join('')}`;
  }
  throw new RangeError(`Color no reconocido: '${value}'`);
}

export function relativeLuminance(hexColour: string): number {
  const rgb = parseColour(hexColour);
  const linear = [1, 3, 5].map((offset) => {
    const channel = parseInt(rgb.slice(offset, offset + 2), 16) / MAX_CHANNEL;
    return channel <= SRGB_LINEAR_THRESHOLD ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return LUMINANCE_WEIGHTS.reduce((sum, weight, index) => sum + weight * (linear[index] ?? 0), 0);
}

export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (a, b) => b - a,
  ) as [number, number];
  return (lighter + CONTRAST_OFFSET) / (darker + CONTRAST_OFFSET);
}

export function textColourFor(background: string): string {
  return contrastRatio(background, BLACK) >= contrastRatio(background, WHITE) ? BLACK : WHITE;
}
