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
 * hand-rolled parser covers hex (#rgb/#rrggbb), rgb()/rgba(), hsl()/hsla(),
 * and the standard CSS named colors (`CSS_NAMED_COLORS`) — the shapes
 * `STANDARD_PLAYER_COLORS` (hex) and `createColorOption()`-based custom game
 * palettes (any legal CSS color string) can supply. It fails loud (throws) on
 * anything else rather than silently guessing wrong contrast — see this
 * module's callers (e.g. `PlayerToken.vue`) for how a render path should
 * handle that throw (degrade to a safe default ink, never crash).
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
const HSL_FN = /^hsla?\(\s*(-?[\d.]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*[\d.]+\s*)?\)$/i;

/**
 * The 148 standard CSS Color Module Level 4 named colors (147 legacy names +
 * `rebeccapurple`), lowercase name -> `#rrggbb`. Covers the common case of a
 * custom game author supplying `'crimson'`, `'tomato'`, etc. via
 * `createColorOption()`, which accepts any CSS color string with no format
 * restriction.
 */
const CSS_NAMED_COLORS: Record<string, string> = {
  aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4',
  azure: '#f0ffff', beige: '#f5f5dc', bisque: '#ffe4c4', black: '#000000',
  blanchedalmond: '#ffebcd', blue: '#0000ff', blueviolet: '#8a2be2', brown: '#a52a2a',
  burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00', chocolate: '#d2691e',
  coral: '#ff7f50', cornflowerblue: '#6495ed', cornsilk: '#fff8dc', crimson: '#dc143c',
  cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9', darkgreen: '#006400', darkgrey: '#a9a9a9', darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b', darkolivegreen: '#556b2f', darkorange: '#ff8c00', darkorchid: '#9932cc',
  darkred: '#8b0000', darksalmon: '#e9967a', darkseagreen: '#8fbc8f', darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f', darkslategrey: '#2f4f4f', darkturquoise: '#00ced1', darkviolet: '#9400d3',
  deeppink: '#ff1493', deepskyblue: '#00bfff', dimgray: '#696969', dimgrey: '#696969',
  dodgerblue: '#1e90ff', firebrick: '#b22222', floralwhite: '#fffaf0', forestgreen: '#228b22',
  fuchsia: '#ff00ff', gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff', gold: '#ffd700',
  goldenrod: '#daa520', gray: '#808080', green: '#008000', greenyellow: '#adff2f',
  grey: '#808080', honeydew: '#f0fff0', hotpink: '#ff69b4', indianred: '#cd5c5c',
  indigo: '#4b0082', ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa',
  lavenderblush: '#fff0f5', lawngreen: '#7cfc00', lemonchiffon: '#fffacd', lightblue: '#add8e6',
  lightcoral: '#f08080', lightcyan: '#e0ffff', lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3',
  lightgreen: '#90ee90', lightgrey: '#d3d3d3', lightpink: '#ffb6c1', lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa', lightskyblue: '#87cefa', lightslategray: '#778899', lightslategrey: '#778899',
  lightsteelblue: '#b0c4de', lightyellow: '#ffffe0', lime: '#00ff00', limegreen: '#32cd32',
  linen: '#faf0e6', magenta: '#ff00ff', maroon: '#800000', mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd', mediumorchid: '#ba55d3', mediumpurple: '#9370db', mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee', mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc', mediumvioletred: '#c71585',
  midnightblue: '#191970', mintcream: '#f5fffa', mistyrose: '#ffe4e1', moccasin: '#ffe4b5',
  navajowhite: '#ffdead', navy: '#000080', oldlace: '#fdf5e6', olive: '#808000',
  olivedrab: '#6b8e23', orange: '#ffa500', orangered: '#ff4500', orchid: '#da70d6',
  palegoldenrod: '#eee8aa', palegreen: '#98fb98', paleturquoise: '#afeeee', palevioletred: '#db7093',
  papayawhip: '#ffefd5', peachpuff: '#ffdab9', peru: '#cd853f', pink: '#ffc0cb',
  plum: '#dda0dd', powderblue: '#b0e0e6', purple: '#800080', rebeccapurple: '#663399',
  red: '#ff0000', rosybrown: '#bc8f8f', royalblue: '#4169e1', saddlebrown: '#8b4513',
  salmon: '#fa8072', sandybrown: '#f4a460', seagreen: '#2e8b57', seashell: '#fff5ee',
  sienna: '#a0522d', silver: '#c0c0c0', skyblue: '#87ceeb', slateblue: '#6a5acd',
  slategray: '#708090', slategrey: '#708090', snow: '#fffafa', springgreen: '#00ff7f',
  steelblue: '#4682b4', tan: '#d2b48c', teal: '#008080', thistle: '#d8bfd8',
  tomato: '#ff6347', turquoise: '#40e0d0', violet: '#ee82ee', wheat: '#f5deb3',
  white: '#ffffff', whitesmoke: '#f5f5f5', yellow: '#ffff00', yellowgreen: '#9acd32',
};

/** Convert HSL (h in degrees, s/l in 0-100) to RGB (0-255 per channel). */
function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const sat = s / 100;
  const light = l / 100;

  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;

  let r1 = 0, g1 = 0, b1 = 0;
  if (hue < 60) { r1 = c; g1 = x; b1 = 0; }
  else if (hue < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (hue < 180) { r1 = 0; g1 = c; b1 = x; }
  else if (hue < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (hue < 300) { r1 = x; g1 = 0; b1 = c; }
  else { r1 = c; g1 = 0; b1 = x; }

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

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
    const [r, g, b] = [rgbFn[1], rgbFn[2], rgbFn[3]].map(Number);
    // WR-03: reject out-of-gamut channels rather than silently clamping —
    // matches this function's "fail loud on anything else" contract. An
    // out-of-range channel (e.g. a stray extra digit, `rgb(2555,0,0)`) is a
    // plausible authoring typo, not a value we should guess an answer for.
    if ([r, g, b].some(c => c > 255)) {
      throw new Error(
        `contrastInk: rgb()/rgba() channel out of range (0-255) in "${input}".`
      );
    }
    return { r, g, b };
  }

  const hslFn = trimmed.match(HSL_FN);
  if (hslFn) {
    const [h, s, l] = [hslFn[1], hslFn[2], hslFn[3]].map(Number);
    if (s > 100 || l > 100) {
      throw new Error(
        `contrastInk: hsl()/hsla() saturation/lightness out of range (0-100%) in "${input}".`
      );
    }
    return hslToRgb(h, s, l);
  }

  const named = CSS_NAMED_COLORS[trimmed.toLowerCase()];
  if (named) {
    return parseColor(named);
  }

  throw new Error(
    `contrastInk: unsupported color value "${input}". ` +
      'Supported formats: #rgb, #rrggbb, rgb(r,g,b), rgba(r,g,b,a), hsl(h,s%,l%), hsla(h,s%,l%,a), and standard CSS named colors (e.g. "crimson").'
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
 * @throws {Error} if `seatColor` is not a `#rgb`, `#rrggbb`, `rgb()`,
 *   `rgba()`, `hsl()`/`hsla()`, or standard CSS named color string, or if a
 *   recognized format has an out-of-range channel/component — fails loud
 *   rather than guessing wrong contrast. Callers in a render path (e.g. a Vue
 *   `computed`) MUST catch this and degrade to a safe default ink; see
 *   `PlayerToken.vue` for the reference pattern.
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
