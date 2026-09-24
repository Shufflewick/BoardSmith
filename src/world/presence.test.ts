/**
 * #338: THE DEPARTURE GRACE IS ONE DEFINITION, AND EVERY HOST RUNS IT.
 *
 * `boardsmith dev` used to default an undeclared grace to 0 where the platform
 * defaults it to a minute, so a page reload was a departure and an arrival
 * locally and nothing at all in production. The default and the bounds live
 * here so a laptop and the platform read the same numbers.
 */
import { describe, expect, it } from 'vitest';

import {
  WORLD_PRESENCE_DEFAULT_GRACE_MS,
  WORLD_PRESENCE_MAX_GRACE_MS,
  WORLD_PRESENCE_MIN_GRACE_MS,
  presenceDepartGraceMs,
} from './presence.js';
import { WorldRefusal } from './refusals.js';

describe('#338: the departure grace', () => {
  it('is the platform numbers: a minute by default, one second to one day', () => {
    expect(WORLD_PRESENCE_DEFAULT_GRACE_MS).toBe(60_000);
    expect(WORLD_PRESENCE_MIN_GRACE_MS).toBe(1_000);
    expect(WORLD_PRESENCE_MAX_GRACE_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('defaults an undeclared grace to a minute', () => {
    expect(presenceDepartGraceMs(undefined)).toBe(60_000);
  });

  it('accepts the bounds themselves and anything between', () => {
    expect(presenceDepartGraceMs(1_000)).toBe(1_000);
    expect(presenceDepartGraceMs(90_000)).toBe(90_000);
    expect(presenceDepartGraceMs(24 * 60 * 60 * 1000)).toBe(24 * 60 * 60 * 1000);
  });

  it.each([0, 500, 999, 24 * 60 * 60 * 1000 + 1, Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'refuses %s rather than clamping it, naming the bounds and the default',
    (declared) => {
      let caught: unknown;
      try {
        presenceDepartGraceMs(declared);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(WorldRefusal);
      expect((caught as WorldRefusal).code).toBe('bundle-not-a-world');
      expect((caught as WorldRefusal).message).toMatch(
        /world\.presence\.departGraceMs.*1000 through 86400000 milliseconds.*default \(60000ms\)/s,
      );
    },
  );
});
