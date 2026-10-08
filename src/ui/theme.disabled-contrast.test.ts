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
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import {
  composite,
  contrastRatio,
  parseColor,
  resolve,
  ruleBody,
  styleOf,
  ROOT_TOKENS,
  PALETTES,
} from './theme-contrast.test-helper.js';

const __dir = dirname(fileURLToPath(import.meta.url));

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
