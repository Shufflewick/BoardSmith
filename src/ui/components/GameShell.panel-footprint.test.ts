// @vitest-environment jsdom
/**
 * #13: the Action Panel's footprint is a CONSTANT declared in CSS, and the board
 * region reserves it as layout — nothing measures the panel.
 *
 * These assertions are made against the shells' real `<style scoped>` blocks
 * (parsed here, not reproduced), because the reservation IS the CSS: a test that
 * restated the numbers would pass while the shell shipped different ones.
 *
 * What must hold, per tier:
 *   1. The tokens exist on `.game-shell__game` and every consumer reads them — no
 *      second magic number anywhere.
 *   2. Reachability: `.boardregion`'s padding-bottom + `.game-shell__zoom-container`'s
 *      margin-bottom >= `.actionbar`'s max-height, so even a panel grown to its
 *      ceiling can be scrolled clear of. Nothing may become unreachable.
 *   3. The reservation is SMALLER than the ceiling — otherwise the board is
 *      fitted above worst-case headroom on every load, which is the cost the
 *      2-row budget exists to avoid.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * BOTH HALVES OF THE SHELL, because since #170 the constraint spans the pair.
 *
 * The footprint tokens, the action bar and the board region live in the shared
 * chrome (`PlayShell`); the bot demo control bar, which reads the same reserved
 * quantity so it never sits over the panel, stays with the table adapter. The
 * reachability arithmetic below must hold ACROSS the two, and one definition of
 * each token must serve both -- which is exactly what reading them as one text
 * proves. `PlayShell` comes first so its declarations are the ones found.
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

/** The last declaration of `prop` inside the block that follows `selector`. */
function declaration(selector: string, prop: string): string {
  const at = source.indexOf(`\n${selector} {`);
  expect(at, `${selector} { … } not found in PlayShell.vue or GameShell.vue`).toBeGreaterThan(-1);
  const block = source.slice(at, source.indexOf('\n}', at));
  const m = block.match(new RegExp(`${prop}\\s*:\\s*([^;]+);`));
  expect(m, `${prop} not declared on ${selector}`).not.toBeNull();
  return m![1].trim();
}

/** The token block inside the landscape-short media query. */
function landscapeTokens(): string {
  const at = source.indexOf('@media (orientation: landscape) and (max-height: 600px)');
  expect(at).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf('\n}\n', source.indexOf('.game-shell__game {', at)));
}

type Env = { safeArea: number; dvh: number };

/** The zooms a fit can land on: the slider range's ends and a real measured fit.
 *  `zoom` scales the zoom container's margin, so clearance must hold at ALL of
 *  them — at 0.82 an undivided margin left the board's last 27px unreachable. */
const ZOOMS = [0.5, 0.824363, 1, 2];

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
    .replace(/([\d.]+)dvh/g, (_, n: string) => String((parseFloat(n) / 100) * env.dvh))
    .replace(/([\d.]+)px/g, '$1');
  const value = Function(`"use strict"; return (${out});`)() as number;
  expect(Number.isFinite(value), `"${expr}" did not resolve to a number`).toBe(true);
  return value;
}

/** Token table for a tier: base tokens, with the landscape block layered on top. */
function tokensFor(tier: 'base' | 'landscape-short', zoom = 1): Record<string, string> {
  const base: Record<string, string> = {
    '--zoom-level': String(zoom),
    '--bsg-panel-row': declaration('.game-shell__game', '--bsg-panel-row'),
    '--bsg-panel-gap': declaration('.game-shell__game', '--bsg-panel-gap'),
    '--bsg-panel-pad': declaration('.game-shell__game', '--bsg-panel-pad'),
    '--bsg-panel-max': declaration('.game-shell__game', '--bsg-panel-max'),
    '--bsg-panel-reserved': declaration('.game-shell__game', '--bsg-panel-reserved'),
  };
  if (tier === 'base') return base;
  const block = landscapeTokens();
  for (const name of ['--bsg-panel-max', '--bsg-panel-reserved'] as const) {
    const m = block.match(new RegExp(`${name}\\s*:\\s*([\\s\\S]*?);`));
    expect(m, `${name} not overridden in the landscape-short tier`).not.toBeNull();
    base[name] = m![1].trim();
  }
  return base;
}

const ENVIRONMENTS: Env[] = [
  { safeArea: 0, dvh: 812 },   // no notch, portrait phone
  { safeArea: 34, dvh: 812 },  // notched phone
  { safeArea: 21, dvh: 390 },  // notched phone, landscape-short
];

describe('#13: the Action Panel reserves a constant, token-derived footprint', () => {
  it('the shell declares the panel tokens and every consumer reads them', () => {
    expect(declaration('.game-shell__game', '--bsg-panel-row')).toBe('44px'); // WCAG 2.5.8
    expect(declaration('.game-shell__game', '--bsg-panel-gap')).toBe(declaration('.actionbar', 'gap'));

    expect(declaration('.actionbar', 'max-height')).toBe('var(--bsg-panel-max)');
    expect(declaration('.boardregion', 'padding-bottom')).toBe('var(--bsg-panel-reserved)');
    // Divided by --zoom-level: `zoom` scales this element's margin too, so an
    // undivided margin under-delivers clearance at any zoom below 1.
    expect(declaration('.game-shell__zoom-container', 'margin-bottom'))
      .toBe('calc((var(--bsg-panel-max) - var(--bsg-panel-reserved)) / var(--zoom-level))');
    // The demo control bar clears the SAME quantity — not a second magic number.
    expect(declaration('.bsg-demo-controls', 'bottom')).toContain('var(--bsg-panel-reserved)');
  });

  it('leaves no unresolved panel magic numbers in the stylesheet', () => {
    for (const prop of ['max-height', 'padding-bottom', 'margin-bottom', 'bottom']) {
      for (const value of declarations(prop)) {
        expect(value, `${prop}: ${value} — restates the 5-row panel cap by hand`)
          .not.toMatch(/5\s*\*\s*44px|22dvh/);
      }
    }
    // The removed measured-height property must not survive anywhere.
    expect(source).not.toContain('--action-panel-h');
  });

  it.each(ENVIRONMENTS)(
    'reserves 2 rows and keeps the whole ceiling reachable (safe-area $safeArea, $dvh dvh)',
    (env) => {
      for (const tier of ['base', 'landscape-short'] as const) {
        for (const zoom of ZOOMS) {
          const tokens = tokensFor(tier, zoom);
          const max = px(declaration('.actionbar', 'max-height'), tokens, env);
          const reserved = px(declaration('.boardregion', 'padding-bottom'), tokens, env);
          // `zoom` scales the container's own margin, so the clearance the player
          // actually gets is the declared margin times the zoom.
          const margin =
            px(declaration('.game-shell__zoom-container', 'margin-bottom'), tokens, env) * zoom;

          // Reachability: total clearance below the board covers the panel's ceiling.
          expect(reserved + margin, `${tier} @ zoom ${zoom}: board content would be unreachable`)
            .toBeGreaterThanOrEqual(max - 0.001);
          // …and the reservation itself is strictly cheaper than that ceiling.
          expect(reserved).toBeGreaterThan(0);
          expect(reserved).toBeLessThan(max);
          expect(margin).toBeGreaterThanOrEqual(0);
        }
      }
    },
  );

  it('reserves exactly two control rows at the base tier', () => {
    const tokens = tokensFor('base');
    const env = { safeArea: 0, dvh: 812 };
    const row = px('var(--bsg-panel-row)', tokens, env);
    const gap = px('var(--bsg-panel-gap)', tokens, env);
    const pad = px('var(--bsg-panel-pad)', tokens, env);
    expect(px(declaration('.boardregion', 'padding-bottom'), tokens, env))
      .toBe(2 * row + gap + 2 * pad);
    // The ceiling is unchanged from the pre-#13 five-row cap.
    expect(px(declaration('.actionbar', 'max-height'), tokens, env))
      .toBe(5 * row + 4 * gap + 2 * pad);
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
});

/**
 * #230: A MINIMIZED ACTION BAR HAS TO ACTUALLY GIVE THE BOARD THE SPACE BACK.
 *
 * A collapse that only changed the DOM would leave the board fitted above the
 * same two reserved rows and the same five-row ceiling -- the panel would be
 * gone and the hole where it used to be would still be there. That is the exact
 * failure a component test cannot see, so the arithmetic is asserted here
 * against the shell's real stylesheet, the same way the expanded footprint is.
 *
 * The collapsed state overrides BOTH tokens to the one collapsed-row quantity,
 * which is what makes the invariant hold by construction: the reservation IS the
 * ceiling while the bar is down, so nothing can be covered and there is no
 * clearance left to scroll for.
 */
describe('#230: minimizing the bar reserves one row and gives the rest back', () => {
  it('declares the collapsed row once and derives it from the panel metrics', () => {
    // Derived from the same row/padding tokens as the expanded footprint, so
    // there is ONE definition of a control row in the stylesheet.
    const collapsed = declaration('.game-shell__game', '--bsg-action-bar-collapsed');
    expect(collapsed).toContain('var(--bsg-panel-row)');
    expect(collapsed).toContain('var(--bsg-panel-pad)');
    expect(collapsed).toContain('env(safe-area-inset-bottom)');
  });

  it('caps the ceiling at it, and lets the reservation follow', () => {
    // ONE override, not two. Every declaration of the reservation is already
    // clamped to the ceiling by its own `min(...)`, so capping the ceiling
    // brings the reservation with it in every tier and the pair cannot drift.
    // A second override would be a second place to disagree.
    expect(declaration('.game-shell__game.action-bar-collapsed', '--bsg-panel-max'))
      .toBe('var(--bsg-action-bar-collapsed)');
    for (const tier of ['base', 'landscape-short'] as const) {
      expect(
        tokensFor(tier)['--bsg-panel-reserved'],
        `the ${tier} reservation is not clamped to the ceiling, so collapsing would ` +
        'reserve more board than the collapsed bar occupies',
      ).toContain('var(--bsg-panel-max)');
    }
    expect(source).not.toMatch(
      /\.game-shell__game\.action-bar-collapsed \{[^}]*--bsg-panel-reserved/,
    );
  });

  it('keeps the collapsed bar to a single un-wrapping row', () => {
    // Without this the one row could wrap into a two-row box taller than the
    // reservation, and the "minimized" bar would cover the board again.
    expect(declaration('.actionbar.collapsed', 'flex-wrap')).toBe('nowrap');
  });

  it.each(ENVIRONMENTS)(
    'covers nothing and costs less board than the open bar (safe-area $safeArea, $dvh dvh)',
    (env) => {
      for (const tier of ['base', 'landscape-short'] as const) {
        for (const zoom of ZOOMS) {
          const open = tokensFor(tier, zoom);
          // The collapsed state as the browser resolves it: the ceiling is
          // overridden and the tier's own reservation expression is left alone,
          // so what this computes is what the clamp actually produces.
          const down: Record<string, string> = {
            ...open,
            '--bsg-action-bar-collapsed': declaration('.game-shell__game', '--bsg-action-bar-collapsed'),
            '--bsg-panel-max': declaration('.game-shell__game.action-bar-collapsed', '--bsg-panel-max'),
          };

          const max = px(declaration('.actionbar', 'max-height'), down, env);
          const reserved = px(declaration('.boardregion', 'padding-bottom'), down, env);
          const margin =
            px(declaration('.game-shell__zoom-container', 'margin-bottom'), down, env) * zoom;

          // The bar cannot grow past what the board already reserved for it, so
          // there is nothing to scroll clear of and nothing hidden under it.
          expect(reserved, `${tier} @ zoom ${zoom}: the collapsed bar covers board`).toBe(max);
          expect(margin).toBe(0);

          // The CEILING always drops, in every tier: an open bar can grow over
          // the board up to five rows, and a bar that is down cannot grow at
          // all. That is the space the player gets back.
          expect(px(declaration('.actionbar', 'max-height'), open, env),
            `${tier}: the bar can still grow over the board while minimized`)
            .toBeGreaterThan(max);
          // The RESERVATION drops too wherever the open bar reserved more than
          // one row -- everywhere except the landscape-short tier, which already
          // budgets a single row because height is the scarce axis there.
          const openReserved = px(declaration('.boardregion', 'padding-bottom'), open, env);
          expect(reserved, `${tier}: minimizing cost the board space`)
            .toBeLessThanOrEqual(openReserved);
          if (tier === 'base') {
            expect(reserved, 'minimizing gave the board no space back')
              .toBeLessThan(openReserved);
          }
        }
      }
    },
  );
});
