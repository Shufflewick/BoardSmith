import { describe, it, expect } from 'vitest';
import {
  SESSION_KINDS,
  countsAsPlay,
  isSessionKind,
  resolveSessionKind,
} from './session-kind.js';

/**
 * ShufflewickPub #47 -- the vocabulary is `match | world`, and it is CLOSED.
 *
 * The platform collapsed it there in its own #39, deleting the round
 * architecture's `orderEntry` and `resolution` outright. Until this landed the
 * engine still declared those two and did not declare `world`, so
 * `boardsmith dev` could be started as a kind no session can be and could not
 * be started as the one kind a session now can be.
 *
 * `scripts/persistence-conformance.test.mjs` on the platform side holds this
 * set equal to `convex/sessionKind.ts`'s validator. This file is the engine's
 * half: it pins the set itself, so a kind added here without the platform
 * agreeing fails on both sides rather than only on theirs.
 */
describe('#47 -- the session-kind vocabulary', () => {
  it('is exactly the two kinds the platform can issue', () => {
    expect([...SESSION_KINDS]).toEqual(['match', 'world']);
  });

  it('refuses the round era\'s two kinds, which no writer can produce', () => {
    // Not merely absent from the list: `isSessionKind` is what the callers of
    // this vocabulary gate on, so a name the platform cannot issue has to be
    // refused there rather than only missing from an array nobody reads.
    expect(isSessionKind('orderEntry')).toBe(false);
    expect(isSessionKind('resolution')).toBe(false);
  });

  it('accepts every kind it declares, and nothing else', () => {
    for (const kind of SESSION_KINDS) expect(isSessionKind(kind)).toBe(true);
    expect(isSessionKind('')).toBe(false);
    expect(isSessionKind(undefined)).toBe(false);
    expect(isSessionKind(7)).toBe(false);
  });

  it('counts only a match as a play, and a world never', () => {
    // `countsAsPlay` is an ALLOWLIST, which is why adding `world` needed no
    // change to it: a resident world's evidence reaches the quality ladder as a
    // season, not as a play.
    expect(countsAsPlay('match')).toBe(true);
    expect(countsAsPlay('world')).toBe(false);
    expect(countsAsPlay(undefined)).toBe(true);
  });

  it('reads absence as a match', () => {
    expect(resolveSessionKind(undefined)).toBe('match');
    for (const kind of SESSION_KINDS) expect(resolveSessionKind(kind)).toBe(kind);
  });
});
