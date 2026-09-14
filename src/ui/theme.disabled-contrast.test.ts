/**
 * theme.disabled-contrast.test.ts — issue #259
 *
 * A disabled control used to be dimmed with `opacity: 0.5` applied to the whole
 * button, label and ground together. That composites the label against its own
 * ground at a ratio no token names: for a game overriding the accent palette it
 * lands at 2.77:1, below the WCAG 2.2 AA 4.5:1 minimum for text a player reads.
 *
 * This test does not check for a class name. It parses the real disabled rules
 * out of the real component sources, resolves every var() against a real palette
 * (the shipped dark and light token blocks, plus the overriding palette from the
 * ticket), applies any opacity multiplier the way a browser composites it, and
 * computes the WCAG contrast ratio of the resulting label against the resulting
 * ground.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { themeCSS } from './theme.js';

const __dir = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Colour maths — WCAG 2.x contrast, and the alpha composite a browser performs
// for `opacity` (render the element, then blend the whole result over what is
// behind it).
// ---------------------------------------------------------------------------

type RGB = readonly [number, number, number];

function parseColor(value: string): RGB {
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
    `Cannot read "${value}" as a solid colour. A disabled control must name a solid token for its ground and its ink so the pair can be measured.`,
  );
}

/** Blend `over` on top of `under` at alpha `a` (0-1). */
function composite(over: RGB, under: RGB, a: number): RGB {
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

function contrastRatio(a: RGB, b: RGB): number {
  const lumA = relativeLuminance(a);
  const lumB = relativeLuminance(b);
  return (Math.max(lumA, lumB) + 0.05) / (Math.min(lumA, lumB) + 0.05);
}

// ---------------------------------------------------------------------------
// Palettes — parsed from theme.ts, so the test tracks the shipped token values
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

const ROOT_TOKENS = parseTokenBlock(themeCSS, ':root {');
const LIGHT_TOKENS = parseTokenBlock(themeCSS, 'html[data-theme="light"] {');

const DARK_PALETTE: Palette = ROOT_TOKENS;
const LIGHT_PALETTE: Palette = { ...ROOT_TOKENS, ...LIGHT_TOKENS };

/**
 * The overriding palette from issue #259 — a warm accent on a near-black page.
 * This is the palette that composited a disabled action button's label to
 * 2.77:1 under the old `opacity: 0.5` rule.
 */
const OVERRIDE_PALETTE: Palette = {
  ...ROOT_TOKENS,
  '--bsg-bg': '#0d0b09',
  '--bsg-accent': '#d99a2b',
  '--bsg-accent-ink': '#0d0b09',
};

/** Resolve a CSS value that may be `var(--x)` or `var(--x, fallback)` to a colour. */
function resolve(value: string, palette: Palette, seen = new Set<string>()): string {
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
      `Token ${name} is used by a disabled rule but is not defined in theme.ts. Define it there so every palette carries a value for it.`,
    );
  }
  return resolve(next, palette, seen);
}

// ---------------------------------------------------------------------------
// Rule extraction — read the real CSS out of the real component
// ---------------------------------------------------------------------------

function styleOf(file: string): string {
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
function ruleBody(css: string, selector: string): Record<string, string> {
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
      `No rule "${selector}" found. Update this test's control list when a selector is renamed.`,
    );
  }
  return decls;
}

/**
 * A control the engine draws disabled rather than hiding, whose label is text a
 * player is meant to read.
 */
interface Control {
  label: string;
  file: string;
  /** The rule that paints the control in its normal state. */
  base: string;
  /** The rule that paints it disabled. */
  disabled: string;
  /** What sits behind the control, for compositing an opacity multiplier. */
  backdrop: string;
}

const CONTROLS: Control[] = [
  {
    label: 'ActionPanel action button',
    file: resolvePath(__dir, 'components/auto-ui/ActionPanel.vue'),
    base: '.action-btn',
    disabled: ".action-btn[aria-disabled='true']",
    backdrop: 'var(--bsg-surface)',
  },
  {
    label: 'ActionPanel choice button',
    file: resolvePath(__dir, 'components/auto-ui/ActionPanel.vue'),
    base: '.choice-btn',
    disabled: ".choice-btn[aria-disabled='true']",
    backdrop: 'var(--bsg-surface)',
  },
  {
    label: 'ActionPanel multi-select choice',
    file: resolvePath(__dir, 'components/auto-ui/ActionPanel.vue'),
    base: '.multi-select-choice',
    disabled: ".multi-select-choice[aria-disabled='true']",
    backdrop: 'var(--bsg-surface)',
  },
  {
    label: 'AutoUI Done button',
    file: resolvePath(__dir, 'components/auto-ui/DoneButton.vue'),
    base: '.done-button',
    disabled: ".done-button[aria-disabled='true']",
    backdrop: 'var(--bsg-surface)',
  },
  {
    label: 'shared Button helper',
    file: resolvePath(__dir, 'components/helpers/Button.vue'),
    base: '.btn',
    disabled: ".btn[aria-disabled='true']",
    backdrop: 'var(--bsg-surface)',
  },
  {
    label: 'ControlsMenu item',
    file: resolvePath(__dir, 'components/ControlsMenu.vue'),
    base: '.mi',
    disabled: '.mi:disabled',
    backdrop: 'var(--bsg-surface)',
  },
  {
    label: 'GameShell demo control',
    file: resolvePath(__dir, 'components/GameShell.vue'),
    base: '.bsg-demo-btn',
    disabled: '.bsg-demo-btn:disabled',
    backdrop: 'var(--bsg-surface-2)',
  },
  {
    label: 'GameHistory copy button',
    file: resolvePath(__dir, 'components/GameHistory.vue'),
    base: '.history-copy',
    disabled: '.history-copy:disabled',
    backdrop: 'var(--bsg-surface)',
  },
  {
    label: 'WaitingRoom join button',
    file: resolvePath(__dir, 'components/WaitingRoom.vue'),
    base: '.join-btn',
    disabled: '.join-btn:disabled',
    backdrop: 'var(--bsg-surface)',
  },
  {
    label: 'Debug rewind button',
    file: resolvePath(__dir, 'components/debug/HistoryTab.vue'),
    base: '.rewind-btn',
    disabled: '.rewind-btn:disabled',
    backdrop: 'var(--bsg-surface)',
  },
  {
    label: 'Debug deck action button',
    file: resolvePath(__dir, 'components/debug/DecksTab.vue'),
    base: '.deck-action-btn',
    disabled: '.deck-action-btn:disabled',
    backdrop: 'var(--bsg-surface)',
  },
  {
    label: 'Debug card action button',
    file: resolvePath(__dir, 'components/debug/DecksTab.vue'),
    base: '.card-action-btn',
    disabled: '.card-action-btn:disabled',
    backdrop: 'var(--bsg-surface)',
  },
  {
    label: 'Debug primary button',
    file: resolvePath(__dir, 'components/debug/DebugButton.vue'),
    base: '.debug-btn.primary',
    disabled: '.debug-btn.primary:disabled',
    backdrop: 'var(--bsg-surface)',
  },
];

const PALETTES: Array<{ name: string; palette: Palette }> = [
  { name: 'default dark', palette: DARK_PALETTE },
  { name: 'default light', palette: LIGHT_PALETTE },
  { name: 'overridden accent (issue #259)', palette: OVERRIDE_PALETTE },
];

describe('Disabled controls keep a measurable ground/ink pair (#259)', () => {
  it('the composite maths reproduces the 2.77:1 the ticket measured', () => {
    // Guards the measurement itself: accent ink on accent ground, the whole
    // button at opacity 0.5 over the page background, is what shipped.
    const ground = composite(parseColor('#d99a2b'), parseColor('#0d0b09'), 0.5);
    const ink = composite(parseColor('#0d0b09'), parseColor('#0d0b09'), 0.5);
    expect(contrastRatio(ground, ink)).toBeCloseTo(2.77, 2);
  });

  it('theme.ts defines a disabled ground token and a disabled ink token', () => {
    expect(
      ROOT_TOKENS['--bsg-disabled-surface'],
      'theme.ts must define --bsg-disabled-surface so a disabled control has a named ground',
    ).toBeDefined();
    expect(
      ROOT_TOKENS['--bsg-disabled-ink'],
      'theme.ts must define --bsg-disabled-ink so a disabled label has a named ink',
    ).toBeDefined();
  });

  for (const { name, palette } of PALETTES) {
    it(`--bsg-disabled-ink on --bsg-disabled-surface clears 4.5:1 — ${name}`, () => {
      const ground = parseColor(resolve('var(--bsg-disabled-surface)', palette));
      const ink = parseColor(resolve('var(--bsg-disabled-ink)', palette));
      const ratio = contrastRatio(ground, ink);
      expect(
        ratio,
        `${name}: disabled ink on disabled surface = ${ratio.toFixed(2)}:1 (need >= 4.5:1)`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  }

  for (const control of CONTROLS) {
    describe(control.label, () => {
      const css = styleOf(control.file);

      it('does not dim itself with an opacity multiplier or a filter', () => {
        // Both rules matter: a multiplier on the base rule reaches the disabled
        // state through the cascade just as surely as one on the disabled rule.
        for (const selector of [control.base, control.disabled]) {
          const decls = ruleBody(css, selector);
          expect(
            decls.opacity,
            `${control.label}: "${selector}" sets opacity: ${decls.opacity}. Dimming with a multiplier composites the label against its own ground at a ratio no token names. Use --bsg-disabled-surface and --bsg-disabled-ink instead.`,
          ).toBeUndefined();
          expect(
            decls.filter,
            `${control.label}: "${selector}" sets filter: ${decls.filter}. A filter moves the painted colours away from the tokens that were measured.`,
          ).toBeUndefined();
        }
      });

      for (const { name, palette } of PALETTES) {
        it(`label clears 4.5:1 against its own ground — ${name}`, () => {
          const base = ruleBody(css, control.base);
          const disabled = ruleBody(css, control.disabled);

          const groundValue = disabled.background ?? base.background;
          const inkValue = disabled.color ?? base.color;
          expect(
            groundValue,
            `${control.label}: neither "${control.base}" nor "${control.disabled}" names a ground. A disabled control needs a defined surface token.`,
          ).toBeDefined();
          expect(
            inkValue,
            `${control.label}: neither "${control.base}" nor "${control.disabled}" names an ink. A disabled label needs a defined ink token.`,
          ).toBeDefined();

          const backdrop = parseColor(resolve(control.backdrop, palette));
          let ground =
            groundValue === 'none'
              ? backdrop
              : parseColor(resolve(groundValue, palette));
          let ink = parseColor(resolve(inkValue, palette));

          // A browser paints the element, then composites the whole result over
          // the backdrop at `opacity`. Reproduce that before measuring.
          const alphaValue = disabled.opacity ?? base.opacity;
          const alpha = alphaValue ? Number(alphaValue) : 1;
          if (alpha < 1) {
            ground = composite(ground, backdrop, alpha);
            ink = composite(ink, backdrop, alpha);
          }

          const ratio = contrastRatio(ground, ink);
          expect(
            ratio,
            `${control.label} (${name}): disabled label resolves to ${ratio.toFixed(2)}:1 against its own ground (need >= 4.5:1)`,
          ).toBeGreaterThanOrEqual(4.5);
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// The disabled multi-select checkbox is an indicator, not text: WCAG 2.2 AA puts
// its floor at 3:1 (SC 1.4.11). It was dimmed by the same multiplier, so it gets
// the same token pair and the same measurement.
// ---------------------------------------------------------------------------

describe('Disabled multi-select checkbox (#259)', () => {
  const css = styleOf(resolvePath(__dir, 'components/auto-ui/ActionPanel.vue'));
  const BOX = '.multi-select-choice input[type="checkbox"][aria-disabled=\'true\']';
  const CHECK = `${BOX}:checked::after`;

  it('is not dimmed by an opacity multiplier', () => {
    const decls = ruleBody(css, BOX);
    expect(
      decls.opacity,
      `The disabled checkbox sets opacity: ${decls.opacity}. Use --bsg-disabled-surface and --bsg-disabled-ink so the indicator stays measurable.`,
    ).toBeUndefined();
  });

  for (const { name, palette } of PALETTES) {
    it(`check mark clears 3:1 against the disabled box — ${name}`, () => {
      const ground = parseColor(resolve(ruleBody(css, BOX).background, palette));
      const mark = parseColor(resolve(ruleBody(css, CHECK).color, palette));
      const ratio = contrastRatio(ground, mark);
      expect(
        ratio,
        `${name}: disabled check mark = ${ratio.toFixed(2)}:1 against its box (need >= 3:1)`,
      ).toBeGreaterThanOrEqual(3);
    });
  }
});
