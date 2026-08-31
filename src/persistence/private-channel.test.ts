/**
 * The PRIVATE channel's strip refuses a divergent per-player secret.
 *
 * The channel is single-valued: whatever `takePrivateCommit` lifts becomes the
 * whole of the op's private commit. A game whose `playerView` filtering
 * projects the attribute differently per seat has written something no single
 * commit can carry, and committing any one projection silently discards every
 * other seat's. The production host (ShufflewickPub's executor runner) refuses
 * that op outright; this dev host must refuse IDENTICALLY, because the
 * environment an author develops against must never hide a bug production
 * will surface. ShufflewickPub's `scripts/persistence-conformance.test.mjs`
 * runs the same cases through both implementations and holds them equal.
 */
import { describe, it, expect } from 'vitest';
import { takePrivateCommit } from './private-channel.js';

const viewWith = (attributes: Record<string, unknown>) => ({
  state: { view: { attributes } },
});

describe('takePrivateCommit refuses a divergent private commit', () => {
  it('throws when two views carry DIFFERENT defined values, naming both views', () => {
    const divergent = {
      spectatorView: viewWith({ persistPrivate: { seen: 'spectator' } }),
      playerViews: [viewWith({ persistPrivate: { seen: 'p1' } })],
    };

    expect(() => takePrivateCommit(divergent)).toThrow(/persistPrivate/);
    expect(() => takePrivateCommit(divergent)).toThrow(/the spectator view/);
    expect(() => takePrivateCommit(divergent)).toThrow(/player 1's view/);
    // The fix the message points at: uniform value, per-player secrecy in
    // sealed entries.
    expect(() => takePrivateCommit(divergent)).toThrow(/player:<userId>\//);
  });

  it('throws when two PLAYER views disagree with no spectator view at all', () => {
    const divergent = {
      playerViews: [
        viewWith({ persistPrivate: { gold: 1 } }),
        viewWith({ persistPrivate: { gold: 2 } }),
      ],
    };
    expect(() => takePrivateCommit(divergent)).toThrow(/player 1's view/);
    expect(() => takePrivateCommit(divergent)).toThrow(/player 2's view/);
  });

  it('does NOT refuse the same value serialized with different key order', () => {
    const reordered = {
      spectatorView: viewWith({ persistPrivate: { a: 1, b: [1, 2] } }),
      playerViews: [viewWith({ persistPrivate: { b: [1, 2], a: 1 } })],
    };
    const stripped = takePrivateCommit(reordered);
    expect(stripped.persistPrivate).toEqual({ a: 1, b: [1, 2] });
  });

  it('still commits when a view HID the attribute entirely but the rest agree', () => {
    const hiddenFromOne = {
      spectatorView: viewWith({ score: 3 }),
      playerViews: [
        viewWith({ persistPrivate: { sealed: 'scenario' } }),
        viewWith({ persistPrivate: { sealed: 'scenario' } }),
      ],
    };
    const stripped = takePrivateCommit(hiddenFromOne);
    expect(stripped.persistPrivate).toEqual({ sealed: 'scenario' });
    expect(JSON.stringify(stripped.playerViews)).not.toContain('sealed');
  });

  it('returns the result unchanged when the attribute is absent everywhere', () => {
    const result = { spectatorView: viewWith({ score: 1 }) };
    expect(takePrivateCommit(result)).toBe(result);
  });
});
