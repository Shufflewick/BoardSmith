/**
 * Every --bsg-* token has ONE kind: a colour, a length, or something else
 * (a font stack, a shadow, a duration...). This file holds that rule in two
 * places, because a token that means two things fails silently in the browser:
 * whichever declaration wins the cascade makes the other use an invalid value,
 * and the browser quietly drops it (#349: `--bsg-cell` was both a cell colour
 * and a cell edge, so empty grid cells rendered 0px wide).
 *
 * 1. Definitions: every declaration of a token in `themeCSS` (dark, light and
 *    static blocks) must be of the same kind.
 * 2. Uses: every `var(--bsg-*)` in the shipped UI source, the CLI scaffolds and
 *    the docs is classified by the CSS property it feeds. A token must never
 *    feed both a colour property and a length property, and the kind it is fed
 *    as must be the kind it is defined as.
 *
 * A local alias (`--cell: var(--bsg-cell-size)` then `width: var(--cell)`) is
 * followed one level within the same file, since that is how the board
 * renderers size their cells.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { themeCSS } from './theme.js';

type Kind = 'colour' | 'length' | 'other';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const COLOUR_VALUE =
  /^(#[0-9a-f]{3,8}|rgba?\(.*\)|hsla?\(.*\)|color-mix\(.*\)|transparent|currentcolor|white|black)$/i;
const LENGTH_VALUE = /^(-?\d*\.?\d+(px|rem|em|vh|vw|%)|0|calc\(.*\)|min\(.*\)|max\(.*\)|clamp\(.*\))$/i;

/** Properties whose whole value is a colour (or, for background, a paint). */
const COLOUR_PROPS = new Set([
  'color', 'background', 'background-color', 'fill', 'stroke', 'border-color',
  'outline-color', 'caret-color', 'accent-color', 'text-decoration-color',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'stop-color', 'column-rule-color',
]);

/** Properties whose whole value is a length. */
const LENGTH_PROPS = new Set([
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'inline-size', 'block-size', 'flex-basis', 'gap', 'row-gap', 'column-gap',
  'top', 'right', 'bottom', 'left', 'inset', 'font-size', 'border-radius',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'padding-inline', 'padding-block', 'margin', 'margin-top', 'margin-right',
  'margin-bottom', 'margin-left', 'margin-inline', 'margin-block',
  'grid-auto-rows', 'grid-auto-columns', 'border-width', 'outline-width',
  'outline-offset', 'stroke-width', 'letter-spacing', 'text-indent',
]);

function kebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** Every `--bsg-name: value;` declaration in the emitted theme stylesheet. */
function themeDefinitions(): Map<string, string[]> {
  const defs = new Map<string, string[]>();
  for (const m of themeCSS.matchAll(/(--bsg-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const values = defs.get(m[1]!) ?? [];
    values.push(m[2]!.replace(/\/\*.*?\*\//g, '').trim());
    defs.set(m[1]!, values);
  }
  return defs;
}

function kindOfValue(value: string, defs: Map<string, string[]>, seen = new Set<string>()): Kind {
  if (COLOUR_VALUE.test(value)) return 'colour';
  if (LENGTH_VALUE.test(value)) return 'length';
  const alias = /^var\((--bsg-[a-z0-9-]+)\)$/.exec(value);
  if (alias && !seen.has(alias[1]!)) {
    seen.add(alias[1]!);
    const target = defs.get(alias[1]!);
    if (target) return kindOfValue(target[0]!, defs, seen);
  }
  return 'other';
}

function sourceFiles(): string[] {
  const out: string[] = [];
  for (const root of ['src', 'docs']) {
    for (const entry of readdirSync(join(REPO, root), { recursive: true, encoding: 'utf8' })) {
      if (entry.split(/[\\/]/).includes('node_modules')) continue;
      if (/\.test\.ts$/.test(entry)) continue;
      if (/\.(vue|ts|md|css)$/.test(entry)) out.push(join(REPO, root, entry));
    }
  }
  return out;
}

interface Use { token: string; kind: 'colour' | 'length'; where: string }

const GRADIENT = /gradient\(([^)]*(?:\([^)]*\)[^)]*)*)\)/g;
const VAR_REF = /var\((--[a-z0-9-]+)\)/g;

interface Decl { prop: string; value: string }

/** Every `prop: value` in a file whose value reads a custom property. */
function declarationsIn(text: string): Decl[] {
  return [...text.matchAll(/([a-zA-Z-]+)\s*:\s*['"`]?([^;{}\n'"`]*var\(--[^;{}\n'"`]*)/g)]
    .map((m) => ({ prop: kebab(m[1]!), value: m[2]! }));
}

/** Local aliases in one file, e.g. `--cell: var(--bsg-cell-size)`. */
function aliasesIn(decls: Decl[]): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const { prop, value } of decls) {
    const m = /^var\((--bsg-[a-z0-9-]+)\)$/.exec(value.trim());
    if (m && prop.startsWith('--') && !prop.startsWith('--bsg-')) aliases.set(prop, m[1]!);
  }
  return aliases;
}

/** The --bsg-* tokens a fragment of a value reads, with aliases resolved. */
function tokensIn(fragment: string, aliases: Map<string, string>): string[] {
  return [...fragment.matchAll(VAR_REF)]
    .map((v) => aliases.get(v[1]!) ?? v[1]!)
    .filter((t) => t.startsWith('--bsg-'));
}

function propKind(prop: string): Use['kind'] | null {
  if (COLOUR_PROPS.has(prop)) return 'colour';
  return LENGTH_PROPS.has(prop) ? 'length' : null;
}

/** Classify each `var(--bsg-*)` a file feeds, by the property it feeds. */
function usesIn(file: string): Use[] {
  const where = relative(REPO, file);
  const decls = declarationsIn(readFileSync(file, 'utf8'));
  const aliases = aliasesIn(decls);
  const uses: Use[] = [];
  for (const { prop, value } of decls) {
    const at = `${where} (${prop})`;
    // Colour stops inside a gradient are colours, whatever property holds them.
    for (const g of value.matchAll(GRADIENT)) {
      for (const token of tokensIn(g[1]!, aliases)) uses.push({ token, kind: 'colour', where: at });
    }
    const kind = propKind(prop);
    if (!kind) continue;
    for (const token of tokensIn(value.replace(GRADIENT, ''), aliases)) uses.push({ token, kind, where: at });
  }
  return uses;
}

/** What is wrong with how one token is used, or null. */
function problemWith(token: string, uses: Use[], defs: Map<string, string[]>): string | null {
  const kinds = new Set(uses.map((u) => u.kind));
  if (kinds.size > 1) {
    const sample = (k: Use['kind']) => uses.find((u) => u.kind === k)!.where;
    return `${token} is used as a colour in ${sample('colour')} and as a length in ${sample('length')}`;
  }
  const defined = defs.get(token);
  if (!defined) return null;
  const definedKind = kindOfValue(defined[0]!, defs);
  const usedKind = uses[0]!.kind;
  if (definedKind === 'other' || definedKind === usedKind) return null;
  return `${token} is defined as a ${definedKind} but used as a ${usedKind} in ${uses[0]!.where}`;
}

describe('--bsg-* tokens each have one kind (#349)', () => {
  const defs = themeDefinitions();

  it('every declaration of a token in themeCSS is the same kind', () => {
    const mixed: string[] = [];
    for (const [token, values] of defs) {
      const kinds = new Set(values.map((v) => kindOfValue(v, defs)));
      if (kinds.size > 1) mixed.push(`${token}: ${values.join(' | ')}`);
    }
    expect(mixed, 'tokens declared with values of different kinds').toEqual([]);
  });

  it('no token is used as both a colour and a length, and each is used as the kind it is defined as', () => {
    const byToken = new Map<string, Use[]>();
    for (const file of sourceFiles()) {
      for (const use of usesIn(file)) {
        const list = byToken.get(use.token) ?? [];
        list.push(use);
        byToken.set(use.token, list);
      }
    }
    const problems = [...byToken].map(([token, uses]) => problemWith(token, uses, defs)).filter(Boolean);
    expect(problems).toEqual([]);

    // Guard the guard: the scan must see the board renderers' real uses.
    expect(byToken.get('--bsg-cell')?.some((u) => u.kind === 'colour')).toBe(true);
    expect(byToken.get('--bsg-cell-size')?.some((u) => u.kind === 'length')).toBe(true);
  });
});
