/**
 * theme-contrast.test-helper.ts — the measuring apparatus shared by every
 * computed-contrast test (#259, #268).
 *
 * A contrast claim about shipped chrome is only worth anything if it is measured
 * against the REAL rules and the REAL tokens, so this reads the CSS out of the
 * `.vue` sources and the palettes out of `theme.ts` rather than restating either.
 * It lives in one module because the maths is the same wherever it is applied,
 * and a second copy of a WCAG implementation is a second chance to get it wrong.
 */
import { readFileSync } from 'node:fs';
import { themeCSS } from './theme.js';

// ---------------------------------------------------------------------------
// Colour maths — WCAG 2.x contrast, and the alpha composite a browser performs
// for `opacity` (render the element, then blend the whole result over what is
// behind it).
// ---------------------------------------------------------------------------

type RGB = readonly [number, number, number];

export function parseColor(value: string): RGB {
  const hex = value.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    return [
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
      parseInt(hex[3] + hex[3], 16),
    ];
  }
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }
  throw new Error(
    `Cannot read "${value}" as a solid colour. A control whose contrast is claimed must name a solid token for its ground and its ink so the pair can be measured.`,
  );
}

/** Blend `over` on top of `under` at alpha `a` (0-1). */
export function composite(over: RGB, under: RGB, a: number): RGB {
  return [
    over[0] * a + under[0] * (1 - a),
    over[1] * a + under[1] * (1 - a),
    over[2] * a + under[2] * (1 - a),
  ];
}

function toLinear(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]: RGB): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const lumA = relativeLuminance(a);
  const lumB = relativeLuminance(b);
  return (Math.max(lumA, lumB) + 0.05) / (Math.min(lumA, lumB) + 0.05);
}

// ---------------------------------------------------------------------------
// Palettes — parsed from theme.ts, so a test tracks the shipped token values
// ---------------------------------------------------------------------------

type Palette = Record<string, string>;

/** Every `--token: value;` declaration inside the first block opened by `selector`. */
function parseTokenBlock(css: string, selector: string): Palette {
  const idx = css.indexOf(selector);
  if (idx === -1) return {};
  const open = css.indexOf('{', idx);
  let depth = 1;
  let i = open + 1;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    i++;
  }
  const body = css.slice(open + 1, i - 1);
  const tokens: Palette = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

export const ROOT_TOKENS = parseTokenBlock(themeCSS, ':root {');
const LIGHT_TOKENS = parseTokenBlock(themeCSS, 'html[data-theme="light"] {');

const DARK_PALETTE: Palette = ROOT_TOKENS;
const LIGHT_PALETTE: Palette = { ...ROOT_TOKENS, ...LIGHT_TOKENS };

/**
 * The overriding palette from issue #259 — a warm accent on a near-black page.
 * A game theme reaches for the accent tokens first and usually stops there, so
 * this is the shape of override every chrome claim has to survive.
 */
const OVERRIDE_PALETTE: Palette = {
  ...ROOT_TOKENS,
  '--bsg-bg': '#0d0b09',
  '--bsg-accent': '#d99a2b',
  '--bsg-accent-ink': '#0d0b09',
};

export const PALETTES: ReadonlyArray<{ name: string; palette: Palette }> = [
  { name: 'default dark', palette: DARK_PALETTE },
  { name: 'default light', palette: LIGHT_PALETTE },
  { name: 'overridden accent (issue #259)', palette: OVERRIDE_PALETTE },
];

/** Resolve a CSS value that may be `var(--x)` or `var(--x, fallback)` to a colour. */
export function resolve(value: string, palette: Palette, seen = new Set<string>()): string {
  const varMatch = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/.exec(value.trim());
  if (!varMatch) return value.trim();
  const [, name, fallback] = varMatch;
  if (seen.has(name)) {
    throw new Error(`Token ${name} resolves to itself. Break the cycle in theme.ts.`);
  }
  seen.add(name);
  const next = palette[name] ?? fallback;
  if (next === undefined) {
    throw new Error(
      `Token ${name} is used by a shipped rule but is not defined in theme.ts. Define it there so every palette carries a value for it.`,
    );
  }
  return resolve(next, palette, seen);
}

// ---------------------------------------------------------------------------
// Rule extraction — read the real CSS out of the real component
// ---------------------------------------------------------------------------

export function styleOf(file: string): string {
  const content = readFileSync(file, 'utf-8');
  return [...content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1])
    .join('\n')
    // Comments carry braces and prose; stripping them keeps selector matching honest.
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Declarations that apply to `selector`, in cascade order: every rule whose
 * selector list contains it, later rules winning.
 */
export function ruleBody(css: string, selector: string): Record<string, string> {
  const decls: Record<string, string> = {};
  let found = false;
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]
      .split(',')
      .map((s) => s.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    if (!selectors.includes(selector)) continue;
    found = true;
    for (const d of m[2].matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
      decls[d[1]] = d[2].replace(/!important/, '').trim();
    }
  }
  if (!found) {
    throw new Error(
      `No rule "${selector}" found. Update the test's control list when a selector is renamed.`,
    );
  }
  return decls;
}
