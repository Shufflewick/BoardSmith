// @vitest-environment jsdom
/**
 * #1514, #1517, #1518: the board region reserves one row for the Action Panel,
 * or only the thin line while the player has it put down, and the rows above it
 * float over the board, so the board's size never depends on the panel's live
 * height (#13 holds by construction), and scroll room after the board lets the
 * player see what those rows cover.
 *
 * These assertions are made against the shells' real `<style scoped>` blocks
 * (parsed here, not reproduced), because the layout IS the CSS: a test that
 * restated the numbers would pass while the shell shipped different ones. The
 * on-screen geometry is measured in `scripts/action-bar-collapse-browser.mjs`.
 *
 * The bar keeps its own two-row cap (`--bsg-panel-max`); the one exception, a
 * typed editor that may grow the bar while it is open, is held in
 * ActionPanel.editor-grows-panel.test.ts.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import guide from '../../../docs/custom-ui-guide.md';

// Links the files this test reads by path, so `--changed` runs it when one alone changes; nothing loads (#1418).
import.meta.glob(['./GameShell.vue', './PlayShell.vue', './helpers/AnnotationLayer.vue']);

/**
 * BOTH HALVES OF THE SHELL, because since #170 the constraint spans the pair.
 *
 * The panel tokens, the action bar and the board region live in the shared
 * chrome (`PlayShell`); the bot demo control bar, which reads the same cap so
 * it never sits over the panel, stays with the table adapter. One
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
    '--bsg-panel-max': declaration('.game-shell__game', '--bsg-panel-max'),
    '--bsg-panel-reserved': declaration('.game-shell__game', '--bsg-panel-reserved'),
    '--bsg-action-bar-collapsed': declaration('.game-shell__game', '--bsg-action-bar-collapsed'),
    '--bsg-action-bar-line': declaration('.game-shell__game', '--bsg-action-bar-line'),
  };
  if (tier === 'base') return base;
  const overrides = Array.from(landscapeTokens().matchAll(/(--bsg-panel-[\w-]+)\s*:\s*([\s\S]*?);/g));
  expect(overrides.map(([, name]) => name), 'the landscape-short tier does not override the panel tokens')
    .toEqual(['--bsg-panel-pad', '--bsg-panel-max', '--bsg-panel-reserved']);
  for (const [, name, value] of overrides) base[name] = value.trim();
  return base;
}

const ENVIRONMENTS: Env[] = [
  { safeArea: 0 },   // no notch
  { safeArea: 34 },  // notched phone, portrait
  { safeArea: 21 },  // notched phone, landscape
];

describe('#1514, #1517: the board region reserves one constant row and the rest of the panel floats', () => {
  it('reserves the constant one-row token under the board, never a measured height', () => {
    // The fit reads the region's content box, so this padding is what keeps a
    // one-row bar off the board; a measured term here would refit on every pick.
    expect(declaration('.boardregion', 'padding')).toBe('var(--bsg-s1)');
    expect(declaration('.boardregion', 'padding-bottom')).toBe('var(--bsg-panel-reserved)');
  });

  it.each(ENVIRONMENTS)('reserves exactly one control row (safe-area $safeArea)', (env) => {
    const tokens = tokensFor('base');
    const row = px('var(--bsg-panel-row)', tokens, env);
    const pad = px('var(--bsg-panel-pad)', tokens, env);
    expect(px('var(--bsg-panel-reserved)', tokens, env)).toBe(row + 2 * pad + env.safeArea);
  });

  it('reserves only the thin line while the player has the bar put down (#1518)', () => {
    // Keyed on the player's preference, not on what is showing, so a question
    // opening the bar over it never refits the board (#13).
    expect(declaration('.game-shell__game.action-bar-minimized', '--bsg-panel-reserved')).toBe('var(--bsg-action-bar-collapsed)');
    expect(source).not.toContain('.game-shell__game.action-bar-collapsed {');
  });

  it.each(ENVIRONMENTS)('keeps the bar\'s cap when the reserve drops to the line (safe-area $safeArea)', (env) => {
    // A question opens the bar over the preference, and it must still get its full cap.
    for (const tier of ['base', 'landscape-short'] as const) {
      const up = tokensFor(tier);
      const down = { ...up, '--bsg-panel-reserved': 'var(--bsg-action-bar-collapsed)' };
      expect(px('var(--bsg-panel-max)', down, env), `${tier}: the cap followed the reserve`).toBe(px('var(--bsg-panel-max)', up, env));
    }
  });

  it('makes the bar at least as tall as the row reserved for it, so no band shows under a short bar (#1518)', () => {
    expect(declaration('.actionbar', 'min-height')).toBe('var(--bsg-panel-reserved)');
  });

  it('lets the player scroll the board clear of the bar, and keeps focus out from under it', () => {
    // Scroll room after the board, as tall as what the bar's cap adds to the
    // reserved row. A constant: room that followed the bar's live height shrank
    // as the bar re-wrapped, clamped the scroll and moved the board under the
    // player's cursor (#1514 review F1).
    expect(declaration('.boardregion::after', 'height')).toBe('calc(var(--bsg-panel-max) - var(--bsg-panel-reserved))');
    expect(declaration('.boardregion::after', 'flex')).toBe('none');
    // WCAG 2.4.11: a focused control scrolled into view lands above the bar, not under it.
    expect(declaration('.boardregion', 'scroll-padding-bottom')).toBe('var(--bsg-panel-max)');
  });

  it('does not feed action-panel measurements into board fitting', () => {
    expect(source).not.toContain('actionPanelHeight');
    expect(source).not.toContain('attachActionPanelObserver');
    expect(source).not.toContain('actionPanelResizeObserver');
    expect(source).not.toContain('actionbarEl');
    expect(source).not.toContain('--action-panel-h');
  });
});

describe('#1520: --bsg-panel-overlap, how far the panel reaches above the reserved row', () => {
  /** The overlap a game reads, for a bar `bar` px tall over the region's reserve. */
  const overlap = (bar: number, reserved: string) => px(declaration('.board-viewport', '--bsg-panel-overlap'),
    { ...tokensFor('base'), '--bsg-bar-clearance': `${bar}px`, '--bsg-panel-reserved': reserved }, { safeArea: 0 });

  it('is the bar\'s height above the reserve, and never below zero', () => {
    const up = declaration('.game-shell__game', '--bsg-panel-reserved');
    const down = declaration('.game-shell__game.action-bar-minimized', '--bsg-panel-reserved');
    expect(overlap(62, up), 'a one-row bar sits in the reserved row').toBe(0);
    expect(overlap(114, up), 'a two-row bar covers one row and its gap').toBe(52);
    expect(overlap(14, down), 'the line sits in the line the region reserves').toBe(0);
    expect(overlap(114, down), 'a question opening the bar over a put-down preference').toBe(100);
    expect(overlap(0, up), 'before the bar is first measured').toBe(0);
  });

  it('is documented in the custom UI guide, which the do-not-measure rule points to', () => {
    expect(guide).toContain('bottom: calc(var(--bsg-panel-overlap) + var(--bsg-s2));');
    expect(guide).toMatch(/Do \*\*not\*\* try to measure the Action Panel[^]*?\(#keep-an-overlay-above-the-action-panel\)/);
    expect(guide).toContain('### Keep an overlay above the Action Panel');
  });
});

describe('the Action Panel\'s own height cap', () => {
  it('declares the panel tokens on the shell and caps the bar with them', () => {
    expect(declaration('.game-shell__game', '--bsg-panel-row')).toBe('44px'); // WCAG 2.5.8
    expect(declaration('.game-shell__game', '--bsg-panel-gap')).toBe(declaration('.actionbar', 'gap'));
    expect(declaration('.actionbar', 'max-height')).toBe('var(--bsg-panel-max)');
    // On the border box, or the bar's padding would sit on top of the cap.
    expect(declaration('.actionbar', 'box-sizing')).toBe('border-box');
    // The demo control bar follows the bar's measured top, so it rides down with
    // a bar put down and up with one an editor grows (#1514 review F2).
    expect(declaration('.bsg-demo-controls', 'bottom')).toBe('calc(var(--bsg-bar-clearance) + var(--bsg-panel-gap))');
  });

  it.each(ENVIRONMENTS)('caps the bar at two control rows at the base tier (safe-area $safeArea)', (env) => {
    const tokens = tokensFor('base');
    const row = px('var(--bsg-panel-row)', tokens, env);
    const gap = px('var(--bsg-panel-gap)', tokens, env);
    const pad = px('var(--bsg-panel-pad)', tokens, env);
    expect(px('var(--bsg-panel-max)', tokens, env)).toBe(2 * row + gap + 2 * pad + env.safeArea);
  });

  it.each(ENVIRONMENTS)('caps the bar at the reserved row, the bar\'s own height, on a short landscape screen (safe-area $safeArea)', (env) => {
    const tokens = tokensFor('landscape-short');
    const row = px('var(--bsg-panel-row)', tokens, env);
    const pad = px('var(--bsg-panel-pad)', tokens, env);
    // The bar's padding on this tier, read from its own declarations (#1517 review F3).
    const at = source.indexOf('@media (orientation: landscape) and (max-height: 600px)');
    const bar = source.slice(at).match(/\.actionbar \{([^}]*)\}/)![1];
    expect(bar).toMatch(/padding-top:\s*var\(--bsg-panel-pad\);/);
    expect(bar).toMatch(/padding-bottom:\s*max\(var\(--bsg-panel-pad\), env\(safe-area-inset-bottom\)\);/);
    expect(px('var(--bsg-panel-reserved)', tokens, env)).toBe(row + pad + Math.max(pad, env.safeArea));
    expect(px('var(--bsg-panel-max)', tokens, env)).toBe(px('var(--bsg-panel-reserved)', tokens, env));
  });

  it('keeps the board region inside the stage on a short landscape screen', () => {
    // The tablet and desktop tiers give the region a min-height taller than
    // such a screen; kept, the region ran below the screen, out of scroll reach.
    const at = source.indexOf('@media (orientation: landscape) and (max-height: 600px)');
    const blockEnd = source.indexOf('\n}\n', at);
    const region = source.slice(at, blockEnd).match(/\.boardregion \{([^}]*)\}/);
    expect(region, '.boardregion is not reset in the landscape-short tier').not.toBeNull();
    expect(region![1]).toMatch(/min-height:\s*0;/);
    expect(at).toBeGreaterThan(source.indexOf('min-height: 480px;'));
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

describe('#230, #1439: the bar put down is a thin line', () => {
  it.each(ENVIRONMENTS)('is thinner than #1439\'s 28px, and still holds the toggle (#1444, safe-area $safeArea)', (env) => {
    // The toggle rides the line's top edge, half on the board, so the line must
    // hold its lower half or the toggle would hang off the bottom of the screen.
    const tokens = tokensFor('base');
    const line = px('var(--bsg-action-bar-collapsed)', tokens, env) - env.safeArea;
    expect(line).toBeLessThan(28);
    expect(line).toBeGreaterThanOrEqual(parseFloat(declaration('.bar-edge', 'height')) / 2);
  });

  it('draws the controls menu as bare dots along the line, with no outline or padding (#1439, #1444)', () => {
    expect(declaration('.actionbar.collapsed :deep(.menubtn)', 'height')).toBe('var(--bsg-action-bar-line)');
    expect(declaration('.actionbar.collapsed :deep(.menubtn)', 'border')).toBe('none');
    expect(declaration('.actionbar.collapsed :deep(.menubtn)', 'padding')).toBe('0');
    // The 20px icon is taller than the line; without this its track starts at the top and the dots sit low.
    expect(declaration('.actionbar.collapsed :deep(.menubtn)', 'align-content')).toBe('center');
    expect(declaration('.actionbar.collapsed :deep(.menubtn svg)', 'transform')).toBe('rotate(90deg)');
  });

  it('draws the dots\' and the toggle\'s focus rings inside them, where the screen edge cannot cut them off (#1444)', () => {
    expect(declaration('.actionbar.collapsed :deep(.menubtn):focus-visible', 'box-shadow')).toBe('inset 0 0 0 2px var(--bsg-accent)');
    expect(declaration('.action-bar-collapsed .bar-edge:focus-visible', 'box-shadow')).toBe('inset 0 0 0 2px var(--bsg-accent)');
  });

  it('keeps 24px hit areas on the line by extending the dots invisibly upward (#1444, WCAG 2.5.8)', () => {
    // The dots' hit area is a 24px box on the line's bottom edge, reaching up
    // over the board; the bar must not clip it or the extension would not take clicks.
    expect(declaration('.actionbar.collapsed :deep(.menubtn)', 'position')).toBe('relative');
    expect(declaration('.actionbar.collapsed :deep(.menubtn)::before', 'height')).toBe('24px');
    expect(declaration('.actionbar.collapsed :deep(.menubtn)::before', 'bottom')).toBe('0');
    expect(declaration('.actionbar.collapsed', 'overflow')).toBe('visible');
    expect(parseFloat(declaration('.bar-edge', 'width'))).toBeGreaterThanOrEqual(24);
    expect(parseFloat(declaration('.bar-edge', 'height'))).toBeGreaterThanOrEqual(24);
  });

  it('keeps the collapsed bar to a single un-wrapping row', () => {
    expect(declaration('.actionbar.collapsed', 'flex-wrap')).toBe('nowrap');
  });
});

describe('#1341, #1346: how the bubbles, the action bar, game modals and the demo controls stack', () => {
  const layerSource = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'helpers/AnnotationLayer.vue'), 'utf-8');
  const layerZ = (selector: string) => {
    const m = layerSource.match(new RegExp(`\\n${selector} \\{[^}]*z-index:\\s*(\\d+);`));
    expect(m, `z-index not declared on ${selector}`).not.toBeNull();
    return Number(m![1]);
  };
  const z = (selector: string) => Number(declaration(selector, 'z-index'));

  it('orders action bar < bubbles < game modal < bubbles about a target in the modal < demo controls', () => {
    const annotations = layerZ('.bsg-annotation-layer');
    const overModal = layerZ('.bsg-annotation-layer--over-modal');
    expect(annotations).toBeGreaterThan(z('.actionbar'));
    expect(z('.game-shell__game-modal-host')).toBeGreaterThan(annotations);
    expect(overModal).toBeGreaterThan(z('.game-shell__game-modal-host'));
    expect(z('.bsg-demo-controls')).toBeGreaterThan(overModal);
  });

  it('keeps the bar\'s edge toggle, which overhangs the board, above a game modal', () => {
    // Equal is enough: the toggle comes later in the page, so it wins a tie.
    expect(z('.bar-edge')).toBeGreaterThanOrEqual(z('.game-shell__game-modal-host'));
    expect(block('.actionbar-frame'), 'a z-index on the frame would trap the toggle under the modal').not.toMatch(/z-index/);
  });
});
