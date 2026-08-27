/**
 * Colour manipulation helpers for custom game UIs.
 *
 * Games theme their pieces from the engine-supplied `player.color`, which
 * means almost every custom board needs to derive a lighter highlight and a
 * darker edge from one seat colour. Before this module existed each game
 * pasted its own `lightenColor`/`darkenColor` pair, and the copies drifted
 * (issue #114). Import these instead:
 *
 * ```ts
 * import { lightenColor, darkenColor, isLightColor } from 'boardsmith/ui';
 * ```
 *
 * Colour parsing is shared with `./color-contrast.ts`, so these accept every
 * format `contrastInk()` accepts (hex, rgb()/rgba(), hsl()/hsla(), CSS named
 * colours) and reject everything else loudly rather than returning `NaN`.
 */

import { parseColor, contrastInk, type Rgb } from './color-contrast.js';

function assertAmount(amount: number, fn: string): void {
  if (!(amount >= 0 && amount <= 1)) {
    throw new Error(
      `${fn}: amount must be a fraction between 0 and 1, got ${amount}. ` +
        'Pass 0.1 for a 10% shift.'
    );
  }
}

function toCss({ r, g, b }: Rgb): string {
  return `rgb(${r}, ${g}, ${b})`;
}

function shift(color: string, amount: number, direction: 1 | -1): Rgb {
  const { r, g, b } = parseColor(color);
  const delta = direction * Math.round(255 * amount);
  const clamp = (channel: number) => Math.min(255, Math.max(0, channel + delta));
  return { r: clamp(r), g: clamp(g), b: clamp(b) };
}

/**
 * Lighten `color` by `amount` (0..1) of full scale, clamping at white.
 *
 * @throws {Error} if `color` is unparseable or `amount` is outside 0..1.
 */
export function lightenColor(color: string, amount: number): string {
  assertAmount(amount, 'lightenColor');
  return toCss(shift(color, amount, 1));
}

/**
 * Darken `color` by `amount` (0..1) of full scale, clamping at black.
 *
 * @throws {Error} if `color` is unparseable or `amount` is outside 0..1.
 */
export function darkenColor(color: string, amount: number): string {
  assertAmount(amount, 'darkenColor');
  return toCss(shift(color, amount, -1));
}

/**
 * Whether `color` is light enough that black ink reads better on it than
 * white, per the same WCAG relative-luminance comparison `contrastInk()` uses.
 * Use it to pick an overlay glyph colour for a seat-coloured piece.
 *
 * @throws {Error} if `color` is unparseable.
 */
export function isLightColor(color: string): boolean {
  return contrastInk(color).ink === '#000000';
}
