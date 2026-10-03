/** Spanish text helpers, mirroring `logrono_bus.text`. */

const LOWERCASE_PARTICLES = new Set(['a', 'de', 'del', 'el', 'en', 'la', 'las', 'los', 'y']);

/** Search key: case- and accent-insensitive, whitespace collapsed. */
export function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

/** Title-case an upper-case upstream name the way Spanish signage writes it. */
export function titleEs(text: string): string {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words
    .map((word, index) =>
      index > 0 && LOWERCASE_PARTICLES.has(word)
        ? word
        : word.slice(0, 1).toUpperCase() + word.slice(1),
    )
    .join(' ');
}
