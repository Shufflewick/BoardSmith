/**
 * EVERY WIDTH MEDIA QUERY NAMES A TIER BY ITS HALF-OPEN RANGE (#1621).
 *
 * A zoomed or high-DPR viewport can be 639.5px wide. Whole-pixel edges such as
 * `(max-width: 639px)` and `(min-width: 640px)` leave that width in no tier, so
 * the chrome would get neither tier's styles while `useLayoutSize` names one.
 * The range forms below cover every width exactly once, at `BREAKPOINTS`' edges.
 */
import { describe, it, expect } from 'vitest';
import { BREAKPOINTS } from './theme.js';

const sources = import.meta.glob<string>(['../**/*.vue'], { query: '?raw', import: 'default', eager: true });

const TIERS = [
  `(width < ${BREAKPOINTS.compact}px)`,
  `(${BREAKPOINTS.compact}px <= width < ${BREAKPOINTS.medium}px)`,
  `(width >= ${BREAKPOINTS.medium}px)`,
];

describe('width media queries (#1621)', () => {
  it('reads the shells and dev host', () => {
    expect(Object.keys(sources)).toEqual(expect.arrayContaining(['./components/PlayShell.vue', '../cli/dev-host/DevHost.vue']));
  });

  it('use only the tier ranges, so a fractional width lands in exactly one tier', () => {
    const strays = Object.entries(sources).flatMap(([file, source]) =>
      Array.from(source.matchAll(/@media([^{]*)\{/g))
        .flatMap(([, prelude]) => prelude.match(/\([^()]*width[^()]*\)/g) ?? [])
        .filter((feature) => !TIERS.includes(feature))
        .map((feature) => `${file}: ${feature}`));
    expect(strays).toEqual([]);
  });
});
