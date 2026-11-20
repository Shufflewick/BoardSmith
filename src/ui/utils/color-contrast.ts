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
 * hand-rolled parser covers the CSS Color 4 colours that need no page to
 * resolve: hex, rgb(), hsl(), hwb(), lab(), lch(), oklab(), oklch(), color()
 * and the named colors (`CSS_NAMED_COLORS`), since boardsmith.json's
 * `colorPalette` accepts any legal CSS color string. It fails loud (throws) on
 * anything else rather than silently guessing wrong contrast. A render path
 * calls `seatInk()` instead, which degrades to a safe default ink rather than
 * crashing.
 */

import { devWarn } from '../../utils/dev.js';

export interface ContrastInk {
  ink: '#000000' | '#ffffff';
  textShadow: string;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** A colour with its alpha, 0 (clear) to 1 (opaque). */
export interface Rgba extends Rgb {
  a: number;
}

/** `over` drawn on the opaque `under`, as the browser composites it. */
export function composite(over: Rgba, under: Rgb): Rgb {
  return {
    r: over.r * over.a + under.r * (1 - over.a),
    g: over.g * over.a + under.g * (1 - over.a),
    b: over.b * over.a + under.b * (1 - over.a),
  };
}

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FN = /^([a-z-]+)\((.*)\)$/i;

/**
 * The 148 standard CSS Color Module Level 4 named colors (147 legacy names +
 * `rebeccapurple`), lowercase name -> `#rrggbb`, plus `transparent`. Covers the common case of a
 * custom game author supplying `'crimson'`, `'tomato'`, etc. in
 * boardsmith.json's `colorPalette`, which accepts any CSS color string with no
 * format restriction.
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
  transparent: '#00000000', white: '#ffffff', whitesmoke: '#f5f5f5', yellow: '#ffff00', yellowgreen: '#9acd32',
};

type Vec3 = [number, number, number];
type Matrix = [Vec3, Vec3, Vec3];

function multiply(m: Matrix, [x, y, z]: Vec3): Vec3 {
  return m.map(([a, b, c]) => a * x + b * y + c * z) as Vec3;
}

/** An sRGB-style transfer function, applied to each channel's magnitude so negatives mirror. */
function signed(f: (abs: number) => number): (v: Vec3) => Vec3 {
  return (v) => v.map((c) => Math.sign(c) * f(Math.abs(c))) as Vec3;
}

// Matrices and transfer curves are the CSS Color 4 sample code's (drafts.csswg.org/css-color-4/conversions.js).
const linSrgb = signed((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
const gamSrgb = signed((c) => (c > 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c));

const SRGB_TO_XYZ: Matrix = [
  [506752 / 1228815, 87881 / 245763, 12673 / 70218],
  [87098 / 409605, 175762 / 245763, 12673 / 175545],
  [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
];
const XYZ_TO_SRGB: Matrix = [
  [12831 / 3959, -329 / 214, -1974 / 3959],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [705 / 12673, -2585 / 12673, 705 / 667],
];
const D50_TO_D65: Matrix = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
const D50: Vec3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

/** Each `color()` space, to CIE XYZ relative to D65. */
const COLOR_SPACES: Record<string, (v: Vec3) => Vec3> = {
  srgb: (v) => multiply(SRGB_TO_XYZ, linSrgb(v)),
  'srgb-linear': (v) => multiply(SRGB_TO_XYZ, v),
  'display-p3': (v) => multiply([
    [608311 / 1250200, 189793 / 714400, 198249 / 1000160],
    [35783 / 156275, 247089 / 357200, 198249 / 2500400],
    [0, 32229 / 714400, 5220557 / 5000800],
  ], linSrgb(v)),
  'a98-rgb': (v) => multiply([
    [573536 / 994567, 263643 / 1420810, 187206 / 994567],
    [591459 / 1989134, 6239551 / 9945670, 374412 / 4972835],
    [53769 / 1989134, 351524 / 4972835, 4929758 / 4972835],
  ], signed((c) => Math.pow(c, 563 / 256))(v)),
  'prophoto-rgb': (v) => multiply(D50_TO_D65, multiply([
    [0.7977666449006423, 0.13518129740053308, 0.0313477341283922],
    [0.2880748288194013, 0.711835234241873, 0.00008993693872564],
    [0, 0, 0.8251046025104602],
  ], signed((c) => (c <= 16 / 512 ? c / 16 : Math.pow(c, 1.8)))(v))),
  rec2020: (v) => multiply([
    [63426534 / 99577255, 20160776 / 139408157, 47086771 / 278816314],
    [26158966 / 99577255, 472592308 / 697040785, 8267143 / 139408157],
    [0, 19567812 / 697040785, 295819943 / 278816314],
  ], signed((c) => Math.pow(c, 2.4))(v)),
  xyz: (v) => v,
  'xyz-d65': (v) => v,
  'xyz-d50': (v) => multiply(D50_TO_D65, v),
};

function labToXyz([l, a, b]: Vec3): Vec3 {
  const k = 24389 / 27;
  const e = 216 / 24389;
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const xyz: Vec3 = [
    fx ** 3 > e ? fx ** 3 : (116 * fx - 16) / k,
    l > k * e ? fy ** 3 : l / k,
    fz ** 3 > e ? fz ** 3 : (116 * fz - 16) / k,
  ];
  return multiply(D50_TO_D65, xyz.map((c, i) => c * D50[i]) as Vec3);
}

function oklabToXyz(lab: Vec3): Vec3 {
  const lms = multiply([
    [1, 0.3963377773761749, 0.2158037573099136],
    [1, -0.1055613458156586, -0.0638541728258133],
    [1, -0.0894841775298119, -1.2914855480194092],
  ], lab);
  return multiply([
    [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
    [-0.0405757452148008, 1.112286803280317, -0.0717110580655164],
    [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
  ], lms.map((c) => c ** 3) as Vec3);
}

/** A polar lightness/chroma/hue triple as its rectangular lightness/a/b. */
function polar([l, c, h]: Vec3): Vec3 {
  const rad = (h * Math.PI) / 180;
  return [l, Math.max(0, c) * Math.cos(rad), Math.max(0, c) * Math.sin(rad)];
}

/** HSL (h in degrees, s/l in 0-100) as sRGB, 0-1 per channel. */
function hslToSrgb(h: number, s: number, l: number): Vec3 {
  const sat = s / 100;
  const light = l / 100;
  const f = (n: number) => {
    const k = (n + ((h % 360) + 360) % 360 / 30) % 12;
    return light - sat * Math.min(light, 1 - light) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** HWB (h in degrees, w/b in 0-100) as sRGB, 0-1 per channel. */
function hwbToSrgb(h: number, w: number, b: number): Vec3 {
  const white = w / 100;
  const black = b / 100;
  if (white + black >= 1) {
    const gray = white / (white + black);
    return [gray, gray, gray];
  }
  return hslToSrgb(h, 100, 50).map((c) => c * (1 - white - black) + white) as Vec3;
}

const NUMBER = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|rad|grad|turn)?$/i;
const TURN: Record<string, number> = { deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 };

type Component = { kind: 'none' } | { kind: 'number' | 'percent' | 'angle'; value: number };

function component(text: string): Component | undefined {
  if (text.toLowerCase() === 'none') return { kind: 'none' };
  const m = text.match(NUMBER);
  if (!m) return undefined;
  const unit = m[2]?.toLowerCase();
  if (unit === undefined) return { kind: 'number', value: Number(m[1]) };
  if (unit === '%') return { kind: 'percent', value: Number(m[1]) };
  return { kind: 'angle', value: Number(m[1]) * TURN[unit] };
}

/**
 * The components and alpha of a colour function's arguments, in the legacy
 * comma form (`rgb(1, 2, 3, 0.5)`) or the space form (`rgb(1 2 3 / 50%)`).
 */
function splitArgs(body: string, legacyAllowed: boolean): { parts: string[]; alpha?: string; legacy: boolean } | undefined {
  if (body.includes(',')) {
    if (!legacyAllowed) return undefined;
    const parts = body.split(',').map((p) => p.trim());
    if (parts.length !== 3 && parts.length !== 4) return undefined;
    return { parts: parts.slice(0, 3), alpha: parts[3], legacy: true };
  }
  const [channels, alpha, extra] = body.split('/');
  if (extra !== undefined || alpha?.trim() === '') return undefined;
  return { parts: channels.trim().split(/\s+/), alpha: alpha?.trim(), legacy: false };
}

/**
 * Parse any CSS Color 4 colour the library can resolve without a page into
 * 0-255 sRGB channels and its alpha. A colour outside sRGB is clipped to it.
 *
 * Shared with `./color.ts` so that every colour helper in the library agrees
 * on exactly which formats are legal and fails loud on the same inputs.
 *
 * @throws {Error} on an unsupported format or an out-of-range rgb()/hsl() component.
 */
export function parseColor(input: string): Rgba {
  const trimmed = input.trim();
  const named = CSS_NAMED_COLORS[trimmed.toLowerCase()];
  const hex = (named ?? trimmed).match(HEX);
  if (hex) return parseHex(hex[1]);
  const fn = trimmed.match(COLOR_FN);
  const parsed = fn ? parseFunction(fn[1].toLowerCase(), fn[2].trim(), input) : undefined;
  if (parsed) return parsed;
  throw new Error(
    `BoardSmith color parser: unsupported color value "${input}". ` +
      'Supported formats: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), rgba(), hsl(), hsla(), hwb(), lab(), lch(), oklab(), oklch(), ' +
      'color() in a predefined space (e.g. "color(display-p3 1 0.5 0)"), and standard CSS named colors (e.g. "crimson").'
  );
}

function parseHex(digits: string): Rgba {
  const long = digits.length <= 4 ? [...digits].map((d) => d + d).join('') : digits;
  const [r, g, b, a] = (long.match(/../g) ?? []).map((pair) => parseInt(pair, 16));
  return { r, g, b, a: a === undefined ? 1 : a / 255 };
}

function parseFunction(name: string, body: string, input: string): Rgba | undefined {
  const isLegacyName = /^(rgba?|hsla?)$/.test(name);
  let space: string | undefined;
  if (name === 'color') {
    const match = body.match(/^([a-z0-9-]+)\s+(.*)$/i);
    if (!match) return undefined;
    space = match[1].toLowerCase();
    body = match[2];
  }
  const args = splitArgs(body, isLegacyName);
  if (!args || args.parts.length !== 3) return undefined;
  const parts = args.parts.map(component);
  const alphaPart = args.alpha === undefined ? undefined : component(args.alpha);
  if (parts.some((p) => p === undefined) || (args.alpha !== undefined && alphaPart === undefined)) return undefined;
  const channels = parts as Component[];
  if (args.legacy && [...channels, alphaPart].some((p) => p?.kind === 'none')) return undefined;
  const a = alphaPart === undefined ? 1 : resolve(alphaPart, 1);
  if (a === undefined) return undefined;
  const srgb = toSrgb(name, space, channels, args.legacy, input);
  if (!srgb) return undefined;
  const [r, g, b] = srgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255));
  return { r, g, b, a: Math.min(1, Math.max(0, a)) };
}

/** A non-hue component as a number, a percentage scaled so 100% is `ref`; `none` is zero. */
function resolve(c: Component, ref: number): number | undefined {
  if (c.kind === 'none') return 0;
  if (c.kind === 'angle') return undefined;
  return c.kind === 'percent' ? (c.value / 100) * ref : c.value;
}

function hue(c: Component): number | undefined {
  if (c.kind === 'none') return 0;
  return c.kind === 'percent' ? undefined : c.value;
}

function triple(values: (number | undefined)[]): Vec3 | undefined {
  return values.every((v) => v !== undefined) ? (values as Vec3) : undefined;
}

function toSrgb(name: string, space: string | undefined, [c1, c2, c3]: Component[], legacy: boolean, input: string): Vec3 | undefined {
  switch (name) {
    case 'rgb':
    case 'rgba': {
      if (legacy && new Set([c1.kind, c2.kind, c3.kind]).size > 1) return undefined;
      const rgb = triple([c1, c2, c3].map((c) => resolve(c, 255)));
      if (rgb?.some((c) => c < 0 || c > 255)) {
        throw new Error(`BoardSmith color parser: rgb()/rgba() channel out of range (0-255) in "${input}".`);
      }
      return rgb?.map((c) => c / 255) as Vec3 | undefined;
    }
    case 'hsl':
    case 'hsla': {
      if (legacy && (c2.kind !== 'percent' || c3.kind !== 'percent')) return undefined;
      const hsl = triple([hue(c1), resolve(c2, 100), resolve(c3, 100)]);
      if (hsl && [hsl[1], hsl[2]].some((c) => c < 0 || c > 100)) {
        throw new Error(`BoardSmith color parser: hsl()/hsla() saturation/lightness out of range (0-100%) in "${input}".`);
      }
      return hsl && hslToSrgb(...hsl);
    }
    case 'hwb': {
      const hwb = triple([hue(c1), resolve(c2, 100), resolve(c3, 100)]);
      return hwb && hwbToSrgb(...hwb);
    }
    case 'lab':
    case 'lch': {
      const lab = name === 'lab'
        ? triple([resolve(c1, 100), resolve(c2, 125), resolve(c3, 125)])
        : triple([resolve(c1, 100), resolve(c2, 150), hue(c3)]);
      if (!lab) return undefined;
      lab[0] = Math.min(100, Math.max(0, lab[0]));
      return xyzToSrgb(labToXyz(name === 'lab' ? lab : polar(lab)));
    }
    case 'oklab':
    case 'oklch': {
      const lab = name === 'oklab'
        ? triple([resolve(c1, 1), resolve(c2, 0.4), resolve(c3, 0.4)])
        : triple([resolve(c1, 1), resolve(c2, 0.4), hue(c3)]);
      if (!lab) return undefined;
      lab[0] = Math.min(1, Math.max(0, lab[0]));
      return xyzToSrgb(oklabToXyz(name === 'oklab' ? lab : polar(lab)));
    }
    case 'color': {
      const toXyz = space === undefined ? undefined : COLOR_SPACES[space];
      const v = triple([c1, c2, c3].map((c) => resolve(c, 1)));
      return toXyz && v && xyzToSrgb(toXyz(v));
    }
  }
  return undefined;
}

function xyzToSrgb(xyz: Vec3): Vec3 {
  return gamSrgb(multiply(XYZ_TO_SRGB, xyz));
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
 * @throws {Error} if `seatColor` is not a colour `parseColor()` reads, or if
 *   an rgb()/hsl() colour has an out-of-range channel/component — fails loud
 *   rather than guessing wrong contrast. A render path uses `seatInk()`,
 *   which catches this.
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

/** WCAG 2.1 AA contrast for normal-size text (SC 1.4.3). */
const TEXT_CONTRAST = 4.5;

/**
 * Whether text in `color` reads on `background` at WCAG AA (4.5:1), judged on
 * the colour as drawn: a translucent one composited over the background.
 *
 * @throws {Error} if `color` is unparseable, as `contrastInk()` does.
 */
export function readsOn(color: string, background: Rgb): boolean {
  const drawn = composite(parseColor(color), background);
  return contrastRatio(relativeLuminance(drawn), relativeLuminance(background)) >= TEXT_CONTRAST;
}

/** The ink for a seat with no colour, drawn in the accent colour: white with a dark halo. */
const DEFAULT_SEAT_INK: ContrastInk = { ink: '#ffffff', textShadow: '0 1px 2px rgba(0,0,0,.5)' };

/**
 * The ink for text drawn on a player's colour, for any component that fills
 * with `player.color` (PlayerToken, GameOverCard, the Debug History badge), so
 * they all read alike.
 *
 * A seat with no colour gets the default white ink, matching the accent fill
 * those components fall back to. `player.color` is a plain string at the
 * `colorPalette` boundary, so it can be a legal CSS colour
 * `contrastInk()` cannot parse; rather than crash the render, that also gets
 * the default ink, with one warning per colour naming `renderer` so the game
 * author can see why.
 */
export function seatInk(color: string | undefined, renderer: string): ContrastInk {
  if (!color) return DEFAULT_SEAT_INK;
  try {
    return contrastInk(color);
  } catch (err) {
    devWarn(
      `${renderer}-unparseable-color:${color}`,
      `${renderer} received a color ("${color}") that contrastInk() can't parse, ` +
        `so it uses the default white ink instead. ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return DEFAULT_SEAT_INK;
  }
}
