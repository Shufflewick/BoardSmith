/**
 * theme.destructive-contrast.test.ts — issue #268
 *
 * The Action Panel can now draw a verb a game marked `.destructive()` apart from
 * the rest. That claim is measurable, so it is measured here the way #259
 * measures the disabled pair: parse the real rule out of the real component,
 * resolve the var() chain against the shipped light and dark palettes plus an
 * overriding one, and compute the WCAG ratio of the label against its ground.
 *
 * WHY A DEDICATED TOKEN PAIR. The obvious move is to resolve the emphasis
 * through `--bsg-danger` or `--bsg-warn`. Both are general-purpose status
 * tokens a game theme remaps freely -- the ticket names a theme in the wild that
 * points `--bsg-warn` at its own accent-hover colour, which would have made this
 * feature silently do nothing. `--bsg-destructive-surface` and
 * `--bsg-destructive-ink` exist for this one control, so a theme that remaps
 * them is doing it deliberately, and they are a PAIR for the same reason the
 * disabled tokens are: overriding one of them alone cannot leave a label
 * stranded on a ground it does not contrast with.
 */

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import {
  contrastRatio,
  parseColor,
  resolve,
  ruleBody,
  styleOf,
  ROOT_TOKENS,
  PALETTES,
} from './theme-contrast.test-helper.js';

const __dir = dirname(fileURLToPath(import.meta.url));

const PANEL = resolvePath(__dir, 'components/auto-ui/ActionPanel.vue');
const DESTRUCTIVE = '.action-btn.destructive';

describe('The destructive action button is measurable (#268)', () => {
  const css = styleOf(PANEL);

  it('theme.ts defines a dedicated destructive ground token and ink token', () => {
    expect(
      ROOT_TOKENS['--bsg-destructive-surface'],
      'theme.ts must define --bsg-destructive-surface so a destructive verb has a named ground of its own',
    ).toBeDefined();
    expect(
      ROOT_TOKENS['--bsg-destructive-ink'],
      'theme.ts must define --bsg-destructive-ink so a destructive label has a named ink of its own',
    ).toBeDefined();
  });

  it('does not resolve its emphasis through --bsg-danger or --bsg-warn', () => {
    // A game theme remaps those two for its own status copy. Emphasis that rode
    // them would vanish on such a theme, which is the failure mode the ticket
    // asked whoever picked it up to avoid.
    for (const token of ['--bsg-danger', '--bsg-warn']) {
      expect(
        ROOT_TOKENS['--bsg-destructive-surface'],
        `--bsg-destructive-surface must not resolve through ${token}: a game that remaps it would silently lose the warning.`,
      ).not.toContain(token);
      expect(
        ROOT_TOKENS['--bsg-destructive-ink'],
        `--bsg-destructive-ink must not resolve through ${token}: a game that remaps it would silently lose the warning.`,
      ).not.toContain(token);
    }
  });

  it('is not dimmed by an opacity multiplier or a filter', () => {
    const decls = ruleBody(css, DESTRUCTIVE);
    expect(
      decls.opacity,
      `"${DESTRUCTIVE}" sets opacity: ${decls.opacity}. A multiplier composites the label against its own ground at a ratio no token names.`,
    ).toBeUndefined();
    expect(
      decls.filter,
      `"${DESTRUCTIVE}" sets filter: ${decls.filter}. A filter moves the painted colours away from the tokens that were measured.`,
    ).toBeUndefined();
  });

  it('carries the emphasis in more than colour', () => {
    // WCAG 1.4.1 aside: a player who cannot separate the hues must still be
    // warned. The rule draws an inset ring in the same ink as the label, so the
    // button has a different SHAPE from every other verb in the bar -- and the
    // markup adds a glyph and a screen-reader label on top of that (asserted in
    // ActionPanel.destructive.test.ts).
    const decls = ruleBody(css, DESTRUCTIVE);
    expect(
      decls.outline,
      `"${DESTRUCTIVE}" must draw a ring so the emphasis survives a player who cannot tell the hues apart.`,
    ).toBeDefined();
  });

  for (const { name, palette } of PALETTES) {
    it(`label clears 4.5:1 against its own ground — ${name}`, () => {
      const decls = ruleBody(css, DESTRUCTIVE);
      const ground = parseColor(resolve(decls.background, palette));
      const ink = parseColor(resolve(decls.color, palette));
      const ratio = contrastRatio(ground, ink);
      expect(
        ratio,
        `${name}: destructive label resolves to ${ratio.toFixed(2)}:1 against its own ground (need >= 4.5:1)`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  }

  for (const { name, palette } of PALETTES) {
    it(`the ring clears 3:1 against the button it encloses — ${name}`, () => {
      // The ring is a non-text indicator: WCAG 2.2 AA SC 1.4.11 puts its floor
      // at 3:1. It is drawn in the label's ink, so this rides the same pair.
      const decls = ruleBody(css, DESTRUCTIVE);
      const ground = parseColor(resolve(decls.background, palette));
      const ring = parseColor(resolve(decls['outline-color'] ?? decls.color, palette));
      const ratio = contrastRatio(ground, ring);
      expect(
        ratio,
        `${name}: destructive ring = ${ratio.toFixed(2)}:1 against its button (need >= 3:1)`,
      ).toBeGreaterThanOrEqual(3);
    });

    it(`is painted from a different plate than an ordinary verb, under every palette — ${name}`, () => {
      // Deliberately NOT a luminance ratio between the two plates. The dark
      // palette's accent and its destructive plate are both bright by design, so
      // a luminance measure would read them as identical while a sighted player
      // sees teal and red. Luminance is not what separates them, and it is not
      // what this feature leans on: the inset ring measured above is the carrier
      // that survives greyscale, and the glyph and screen-reader label are the
      // carriers that survive not seeing the button at all.
      //
      // What IS worth asserting is that the destructive plate does not collapse
      // into the accent -- including on a palette that moves the accent, which is
      // the case a dedicated token exists for.
      const destructive = resolve(ruleBody(css, DESTRUCTIVE).background, palette);
      const ordinary = resolve(ruleBody(css, '.action-btn').background, palette);
      expect(
        destructive,
        `${name}: the destructive plate resolves to the same colour as the ordinary accent plate (${destructive}), so the emphasis is invisible.`,
      ).not.toBe(ordinary);
    });
  }
});
