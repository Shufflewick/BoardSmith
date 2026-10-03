// @vitest-environment jsdom
/**
 * #13 / #444: the Action Panel's footprint is a CONSTANT declared in CSS, the
 * board region reserves it as layout, nothing measures the panel, and the panel
 * can never grow past it.
 *
 * These assertions are made against the shells' real `<style scoped>` blocks
 * (parsed here, not reproduced), because the reservation IS the CSS: a test that
 * restated the numbers would pass while the shell shipped different ones.
 *
 * What must hold, per tier:
 *   1. The token exists on `.game-shell__game` and every consumer reads it — no
 *      second magic number anywhere.
 *   2. The panel's ceiling IS the reservation (#444). The board is fitted above
 *      the reserved strip and never refits (#13), so a panel taller than the strip
 *      would cover the bottom of a board that fitted itself correctly. The panel
 *      lays out inside the strip and, only as a last resort, scrolls inside it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * BOTH HALVES OF THE SHELL, because since #170 the constraint spans the pair.
 *
 * The footprint token, the action bar and the board region live in the shared
 * chrome (`PlayShell`); the bot demo control bar, which reads the same reserved
 * quantity so it never sits over the panel, stays with the table adapter. One
 * definition of the token must serve both -- which is exactly what reading them
 * as one text proves. `PlayShell` comes first so its declarations are the ones
 * found.
 */
const source = [
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'PlayShell.vue'), 'utf-8'),
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'GameShell.vue'), 'utf-8'),
].join('\n');

/** Every declaration of `prop` in the file, in source order (later wins per tier). */
function declarations(prop: string): string[] {
  const re = new RegExp(`(?:^|[;{]\\s*)${prop}\\s*:\\s*([^;]+);`, 'g');
  return Array.from(source.matchAll(re), (m) => m[1].trim());
}

/** The block that follows `selector`, up to its closing brace. */
function block(selector: string): string {
  const at = source.indexOf(`\n${selector} {`);
  expect(at, `${selector} { … } not found in PlayShell.vue or GameShell.vue`).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf('\n}', at));
}

/** The last declaration of `prop` inside the block that follows `selector`. */
function declaration(selector: string, prop: string): string {
  const m = block(selector).match(new RegExp(`${prop}\\s*:\\s*([^;]+);`));
  expect(m, `${prop} not declared on ${selector}`).not.toBeNull();
  return m![1].trim();
}

/** The token block inside the landscape-short media query. */
function landscapeTokens(): string {
  const at = source.indexOf('@media (orientation: landscape) and (max-height: 600px)');
  expect(at).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf('\n}\n', source.indexOf('.game-shell__game {', at)));
}

type Env = { safeArea: number };

/** Resolve a CSS length expression built from our tokens to a number of px. */
function px(expr: string, tokens: Record<string, string>, env: Env): number {
  let out = expr;
  for (let i = 0; i < 10 && out.includes('var('); i++) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, name: string) => {
      const value = tokens[name];
      if (value === undefined) throw new Error(`unknown token ${name} in "${expr}"`);
      return `(${value})`;
    });
  }
  out = out
    .replace(/env\(safe-area-inset-bottom\)/g, `${env.safeArea}px`)
    .replace(/calc\(/g, '(')
    .replace(/min\(/g, 'Math.min(')
    .replace(/max\(/g, 'Math.max(')
    .replace(/([\d.]+)px/g, '$1');
  const value = Function(`"use strict"; return (${out});`)() as number;
  expect(Number.isFinite(value), `"${expr}" did not resolve to a number`).toBe(true);
  return value;
}

/** Token table for a tier: base tokens, with the landscape block layered on top. */
function tokensFor(tier: 'base' | 'landscape-short'): Record<string, string> {
  const base: Record<string, string> = {
    '--bsg-panel-row': declaration('.game-shell__game', '--bsg-panel-row'),
    '--bsg-panel-gap': declaration('.game-shell__game', '--bsg-panel-gap'),
    '--bsg-panel-pad': declaration('.game-shell__game', '--bsg-panel-pad'),
    '--bsg-panel-reserved': declaration('.game-shell__game', '--bsg-panel-reserved'),
    '--bsg-action-bar-collapsed': declaration('.game-shell__game', '--bsg-action-bar-collapsed'),
  };
  if (tier === 'base') return base;
  const m = landscapeTokens().match(/--bsg-panel-reserved\s*:\s*([\s\S]*?);/);
  expect(m, '--bsg-panel-reserved not overridden in the landscape-short tier').not.toBeNull();
  base['--bsg-panel-reserved'] = m![1].trim();
  return base;
}

const ENVIRONMENTS: Env[] = [
  { safeArea: 0 },   // no notch
  { safeArea: 34 },  // notched phone, portrait
  { safeArea: 21 },  // notched phone, landscape
];

describe('#13 / #444: the Action Panel stays inside a constant, token-derived footprint', () => {
  it('the shell declares the panel tokens and every consumer reads them', () => {
    expect(declaration('.game-shell__game', '--bsg-panel-row')).toBe('44px'); // WCAG 2.5.8
    expect(declaration('.game-shell__game', '--bsg-panel-gap')).toBe(declaration('.actionbar', 'gap'));

    expect(declaration('.boardregion', 'padding-bottom')).toBe('var(--bsg-panel-reserved)');
    // The demo control bar clears the SAME quantity — not a second magic number.
    expect(declaration('.bsg-demo-controls', 'bottom')).toContain('var(--bsg-panel-reserved)');
  });

  it('caps the panel at the reservation itself, so it can never cover the board (#444)', () => {
    // The same token, not an equal number: two tokens that happen to agree are
    // two places to disagree later.
    expect(declaration('.actionbar', 'max-height')).toBe('var(--bsg-panel-reserved)');
    // The cap is on the border box. Under content-box the bar's padding and
    // border would sit on top of the cap and cover the board by that much.
    expect(declaration('.actionbar', 'box-sizing')).toBe('border-box');
  });

  it('has no separate ceiling and no scroll room under the board', () => {
    // A ceiling above the reservation is what let the panel cover the board
    // (#444), and the zoom container's bottom margin existed only to scroll
    // clear of it.
    expect(source).not.toContain('--bsg-panel-max');
    expect(() => declaration('.game-shell__zoom-container', 'margin-bottom')).toThrow();
    // The removed measured-height property must not survive anywhere.
    expect(source).not.toContain('--action-panel-h');
  });

  it.each(ENVIRONMENTS)('reserves exactly two control rows at the base tier (safe-area $safeArea)', (env) => {
    const tokens = tokensFor('base');
    const row = px('var(--bsg-panel-row)', tokens, env);
    const gap = px('var(--bsg-panel-gap)', tokens, env);
    const pad = px('var(--bsg-panel-pad)', tokens, env);
    expect(px(declaration('.boardregion', 'padding-bottom'), tokens, env))
      .toBe(2 * row + gap + 2 * pad + env.safeArea);
  });

  it.each(ENVIRONMENTS)('reserves one control row on a short landscape screen (safe-area $safeArea)', (env) => {
    const tokens = tokensFor('landscape-short');
    const row = px('var(--bsg-panel-row)', tokens, env);
    const pad = px('var(--bsg-panel-pad)', tokens, env);
    expect(px(declaration('.boardregion', 'padding-bottom'), tokens, env))
      .toBe(row + 2 * pad + env.safeArea);
  });

  it('does not feed action-panel measurements into board fitting', () => {
    expect(source).not.toContain('actionPanelHeight');
    expect(source).not.toContain('attachActionPanelObserver');
    // The suite has to catch this class of leftover on its own: `vue-tsc --noEmit`
    // in this repo does NOT typecheck SFC scripts (verified by planting an
    // undefined identifier in this file — no error), so a stale reference to a
    // deleted binding compiles here and only explodes in a consuming game.
    expect(source).not.toContain('actionPanelResizeObserver');
    expect(source).not.toContain('actionbarEl');
  });

  it('leaves no hand-written panel heights in the stylesheet', () => {
    for (const prop of ['max-height', 'padding-bottom', 'bottom']) {
      for (const value of declarations(prop)) {
        expect(value, `${prop}: ${value} — restates a panel height by hand`)
          .not.toMatch(/\d\s*\*\s*44px/);
      }
    }
  });
});

/**
 * #230: A MINIMIZED ACTION BAR HAS TO ACTUALLY GIVE THE BOARD THE SPACE BACK.
 *
 * A collapse that only changed the DOM would leave the board fitted above the
 * same two reserved rows -- the panel would be gone and the hole where it used
 * to be would still be there. That is the exact failure a component test cannot
 * see, so the arithmetic is asserted here against the shell's real stylesheet,
 * the same way the open footprint is.
 *
 * The collapsed state overrides the one token to the collapsed-row quantity.
 * The bar's cap is that same token, so nothing can be covered by construction.
 */
describe('#230: minimizing the bar reserves one row and gives the rest back', () => {
  it('declares the collapsed row once and derives it from the panel metrics', () => {
    // Derived from the same row/padding tokens as the open footprint, so there
    // is ONE definition of a control row in the stylesheet.
    const collapsed = declaration('.game-shell__game', '--bsg-action-bar-collapsed');
    expect(collapsed).toContain('var(--bsg-panel-row)');
    expect(collapsed).toContain('var(--bsg-panel-pad)');
    expect(collapsed).toContain('env(safe-area-inset-bottom)');
  });

  it('overrides the reservation, and only that, while the bar is down', () => {
    expect(declaration('.game-shell__game.action-bar-collapsed', '--bsg-panel-reserved'))
      .toBe('var(--bsg-action-bar-collapsed)');
  });

  it('keeps the collapsed bar to a single un-wrapping row', () => {
    // Without this the one row could wrap into a two-row box, which the cap
    // would then clip to one row and scroll.
    expect(declaration('.actionbar.collapsed', 'flex-wrap')).toBe('nowrap');
  });

  it.each(ENVIRONMENTS)(
    'costs no more board than the open bar, and less at the base tier (safe-area $safeArea)',
    (env) => {
      for (const tier of ['base', 'landscape-short'] as const) {
        const open = tokensFor(tier);
        const down = { ...open, '--bsg-panel-reserved': declaration('.game-shell__game.action-bar-collapsed', '--bsg-panel-reserved') };
        const openReserved = px(declaration('.boardregion', 'padding-bottom'), open, env);
        const downReserved = px(declaration('.boardregion', 'padding-bottom'), down, env);
        expect(downReserved, `${tier}: minimizing cost the board space`).toBeLessThanOrEqual(openReserved);
        // The landscape-short tier already budgets a single row, because height
        // is the scarce axis there; everywhere else minimizing gives space back.
        if (tier === 'base') expect(downReserved).toBeLessThan(openReserved);
      }
    },
  );
});
