/**
 * Pure WCAG relative-luminance contrast helper (no DOM dependency).
 *
 * Given a seat color, computes whether black or white ink reads more legibly
 * on it (WCAG 2.1 §1.4.3 relative luminance) and derives a `text-shadow` halo
 * that reinforces the chosen ink rather than fighting it (dark halo under
 * white ink, dropped entirely under black ink).
 *
 * Deliberately DOM-free: browser-only color-normalization APIs are not
 * implemented by plain jsdom and would require a native rendering-backed
 * dependency (forbidden without discussion per CLAUDE.md). A small
 * hand-rolled parser covering hex (#rgb/#rrggbb) and rgb()/rgba() is
 * sufficient — it is the only shape `STANDARD_PLAYER_COLORS` (all hex) and
 * typical custom game palettes use, and it fails loud (throws) on anything
 * else rather than silently guessing wrong contrast.
 */

export interface ContrastInk {
  ink: '#000000' | '#ffffff';
  textShadow: string;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX_LONG = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGB_FN = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/i;

function parseColor(input: string): Rgb {
  const trimmed = input.trim();

  const shortHex = trimmed.match(HEX_SHORT);
  if (shortHex) {
    return {
      r: parseInt(shortHex[1] + shortHex[1], 16),
      g: parseInt(shortHex[2] + shortHex[2], 16),
      b: parseInt(shortHex[3] + shortHex[3], 16),
    };
  }

  const longHex = trimmed.match(HEX_LONG);
  if (longHex) {
    return {
      r: parseInt(longHex[1], 16),
      g: parseInt(longHex[2], 16),
      b: parseInt(longHex[3], 16),
    };
  }

  const rgbFn = trimmed.match(RGB_FN);
  if (rgbFn) {
    return {
      r: Number(rgbFn[1]),
      g: Number(rgbFn[2]),
      b: Number(rgbFn[3]),
    };
  }

  throw new Error(
    `contrastInk: unsupported color value "${input}". ` +
      'Supported formats: #rgb, #rrggbb, rgb(r,g,b), rgba(r,g,b,a).'
  );
}

function srgbChannelToLinear(channel: number): number {
  const cs = channel / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const rl = srgbChannelToLinear(r);
  const gl = srgbChannelToLinear(g);
  const bl = srgbChannelToLinear(b);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const BLACK_LUMINANCE = relativeLuminance({ r: 0, g: 0, b: 0 });
const WHITE_LUMINANCE = relativeLuminance({ r: 255, g: 255, b: 255 });

/**
 * Compute the ink color (black or white) and derived text-shadow that reads
 * most legibly against `seatColor`, per WCAG 2.1 relative-luminance contrast.
 *
 * @throws {Error} if `seatColor` is not a `#rgb`, `#rrggbb`, `rgb()`, or
 *   `rgba()` string — fails loud rather than guessing wrong contrast.
 */
export function contrastInk(seatColor: string): ContrastInk {
  const rgb = parseColor(seatColor);
  const bgLuminance = relativeLuminance(rgb);

  const blackContrast = contrastRatio(bgLuminance, BLACK_LUMINANCE);
  const whiteContrast = contrastRatio(bgLuminance, WHITE_LUMINANCE);

  const ink = whiteContrast >= blackContrast ? '#ffffff' : '#000000';
  const textShadow = ink === '#ffffff' ? '0 1px 2px rgba(0,0,0,.5)' : 'none';

  return { ink, textShadow };
}
