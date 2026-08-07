/**
 * #18 — RNG scumming in private sessions.
 *
 * Undo restores `randomState` along with the state, so redoing the SAME action
 * after an undo cannot re-roll. What scums is REORDERING: undo, interpose an
 * action that also draws, then take the drawing action again — it lands on a
 * different generator position. A player alone in a private session with
 * unlimited undo can repeat that until the roll suits them, and nobody sees it.
 *
 * Two independent closures, both proved here against the REAL stateless
 * executor (`executeOp`) with the snapshot JSON round-tripped between every op,
 * because JSON over a stateless boundary is the only thing production ever
 * sees:
 *
 *  1. `GameDefinition.undo.fenceRandomRewind` — for a session that MUST draw
 *     (the ≤16-player persistent world buildable on today's async machinery is
 *     one long-lived shared session, and the session IS the world).
 *  2. `hostOptions.randomness: 'forbidden'` — for an order-entry session, which
 *     is pure intent capture and has no business drawing at all. This also
 *     closes a channel undo policy cannot touch: abandoning a private session
 *     and creating a new one, since a fresh `start` mints a new seed.
 *
 * The unfenced CONTROL below deliberately performs the exploit and asserts the
 * roll changes. It is the tripwire: if the exploit ever stops being possible
 * for an unrelated reason, that test fails and the fenced tests stop being
 * evidence of anything.
 */

import { describe, it, expect } from 'vitest';

import { executeOp, type GameDefinitionLike, type Op } from '../stateless-ops.js';
import type { GameStateSnapshot } from '../../runtime/index.js';
import {
  fencedScumDefinition,
  unfencedScumDefinition,
  fencedPrunedScumDefinition,
  fencedSimulScumDefinition,
  fencedUncheckpointedScumDefinition,
  constructorDrawDefinition,
} from './fixtures/random-scumming-fixture.js';

type HostOptions = Parameters<typeof executeOp>[5];

/**
 * A stateless session: every op rebuilds its runner from a snapshot that has
 * been through `JSON.parse(JSON.stringify(...))`, exactly as the executor and
 * the games worker do. An in-memory runner carried between ops would prove
 * nothing about the deployed path.
 */
function statelessSession(
  def: GameDefinitionLike,
  gameOptions: { playerCount: number; seed?: string },
  hostOptions?: HostOptions,
) {
  let snapshot: unknown = null;
  return {
    get snapshot() {
      return snapshot;
    },
    async send(op: Op) {
      const res = await executeOp(def, gameOptions, snapshot, null, op, hostOptions);
      if (res.success) snapshot = JSON.parse(JSON.stringify(res.snapshot));
      return res;
    },
  };
}

function attributesOf(snapshot: unknown): Record<string, unknown> {
  return ((snapshot as GameStateSnapshot).state as { attributes?: Record<string, unknown> })
    .attributes ?? {};
}

const soloOptions = { playerCount: 1, seed: 'scum-seed' };

describe('#18 undo random fence (GameDefinition.undo.fenceRandomRewind)', () => {
  it('CONTROL — without the fence, undo + reorder re-rolls the draw', async () => {
    const s = statelessSession(unfencedScumDefinition, soloOptions);
    expect((await s.send({ type: 'start' })).success).toBe(true);

    expect((await s.send({ type: 'action', actionName: 'gamble', player: 1, args: {} })).success)
      .toBe(true);
    const firstRoll = attributesOf(s.snapshot).lastRoll as number;
    expect(firstRoll).toBeGreaterThan(0);

    // Undo is allowed: no fence declared.
    expect((await s.send({ type: 'undo', player: 1 })).success).toBe(true);
    expect(attributesOf(s.snapshot).lastRoll).toBe(0);

    // Reorder: interpose an action that also draws, then gamble again.
    expect((await s.send({ type: 'action', actionName: 'scout', player: 1, args: {} })).success)
      .toBe(true);
    expect((await s.send({ type: 'action', actionName: 'gamble', player: 1, args: {} })).success)
      .toBe(true);

    // THIS is the exploit: the "same" gamble, a different result, repeatable.
    expect(attributesOf(s.snapshot).lastRoll).not.toBe(firstRoll);
  });

  it('refuses an undo whose span consumed a draw, and preserves the roll', async () => {
    const s = statelessSession(fencedScumDefinition, soloOptions);
    expect((await s.send({ type: 'start' })).success).toBe(true);

    expect((await s.send({ type: 'action', actionName: 'gamble', player: 1, args: {} })).success)
      .toBe(true);
    const roll = attributesOf(s.snapshot).lastRoll as number;

    const undo = await s.send({ type: 'undo', player: 1 });
    expect(undo.success).toBe(false);
    expect(undo.error).toMatch(/random draw was\s+consumed/);

    // Refusal is not a partial rewind: the roll and the snapshot stand.
    expect(attributesOf(s.snapshot).lastRoll).toBe(roll);
  });

  it('still allows undo across actions that drew nothing', async () => {
    const s = statelessSession(fencedScumDefinition, soloOptions);
    expect((await s.send({ type: 'start' })).success).toBe(true);

    expect((await s.send({ type: 'action', actionName: 'move', player: 1, args: {} })).success)
      .toBe(true);
    expect((await s.send({ type: 'action', actionName: 'note', player: 1, args: {} })).success)
      .toBe(true);
    expect(attributesOf(s.snapshot).moves).toBe(1);

    const undo = await s.send({ type: 'undo', player: 1 });
    expect(undo.success).toBe(true);
    expect(attributesOf(s.snapshot).moves).toBe(0);
    expect(attributesOf(s.snapshot).noted).toBe(false);
  });

  it('fences a draw taken AFTER a non-drawing action in the same turn', async () => {
    // The fence must key off the draw, not off the action that immediately
    // precedes the undo target.
    const s = statelessSession(fencedScumDefinition, soloOptions);
    expect((await s.send({ type: 'start' })).success).toBe(true);

    await s.send({ type: 'action', actionName: 'move', player: 1, args: {} });
    await s.send({ type: 'action', actionName: 'gamble', player: 1, args: {} });

    const undo = await s.send({ type: 'undo', player: 1 });
    expect(undo.success).toBe(false);
  });

  it('refuses, naming the retention policy, when the target checkpoint was pruned', async () => {
    const s = statelessSession(fencedPrunedScumDefinition, soloOptions);
    expect((await s.send({ type: 'start' })).success).toBe(true);

    await s.send({ type: 'action', actionName: 'move', player: 1, args: {} });
    await s.send({ type: 'action', actionName: 'note', player: 1, args: {} });

    // Neither action drew, so the fence could have waved this through — but
    // with `checkpoints: { max: 1 }` there is no retained entry at the turn
    // start recording what the generator position WAS. Guessing "probably
    // nothing drew" is exactly the silent hole the fence exists to close.
    const undo = await s.send({ type: 'undo', player: 1 });
    expect(undo.success).toBe(false);
    expect(undo.error).toMatch(/checkpoints: \{ max \}/);
  });

  it('names `enabled: false`, not the retention limit, when nothing is checkpointed', async () => {
    // The two absences have different fixes, and the fence must not assert the
    // wrong one: this author never set `checkpoints: { max }`, so telling them
    // to raise it names a knob that does not exist in their game.
    const s = statelessSession(fencedUncheckpointedScumDefinition, soloOptions);
    expect((await s.send({ type: 'start' })).success).toBe(true);
    await s.send({ type: 'action', actionName: 'move', player: 1, args: {} });

    const undo = await s.send({ type: 'undo', player: 1 });
    expect(undo.success).toBe(false);
    // From the FENCE (it runs before any restore is attempted), carrying the
    // absence cause `describeCheckpointAbsence` derived rather than a guess.
    expect(undo.error).toMatch(/fences undo/);
    expect(undo.error).toMatch(/enabled: false/);
    expect(undo.error).not.toMatch(/Raise or remove/);
  });

  it('fences a seat that drew inside its own run of a simultaneous step', async () => {
    const s = statelessSession(fencedSimulScumDefinition, { playerCount: 2, seed: 'simul' });
    expect((await s.send({ type: 'start' })).success).toBe(true);

    expect((await s.send({ type: 'action', actionName: 'note', player: 2, args: {} })).success)
      .toBe(true);
    expect((await s.send({ type: 'action', actionName: 'gamble', player: 2, args: {} })).success)
      .toBe(true);

    const undo = await s.send({ type: 'undo', player: 2 });
    expect(undo.success).toBe(false);
    expect(undo.error).toMatch(/random draw/);
  });

  it("does NOT fence a seat for another seat's earlier draw", async () => {
    // Worth pinning because it is the one place the fence could have been
    // needlessly conservative. A simultaneous seat's undo boundary is its own
    // TRAILING run of actions (`simultaneousUndoBoundary`), so a co-decider's
    // draw sits BEFORE that boundary and the generator has not moved across
    // the span actually being rewound. Refusing here would take undo away from
    // an innocent seat every time anyone else rolled.
    const s = statelessSession(fencedSimulScumDefinition, { playerCount: 2, seed: 'simul' });
    expect((await s.send({ type: 'start' })).success).toBe(true);

    expect((await s.send({ type: 'action', actionName: 'gamble', player: 1, args: {} })).success)
      .toBe(true);
    const roll = attributesOf(s.snapshot).lastRoll as number;
    expect((await s.send({ type: 'action', actionName: 'note', player: 2, args: {} })).success)
      .toBe(true);

    const undo = await s.send({ type: 'undo', player: 2 });
    expect(undo.success).toBe(true);
    // Seat 1's roll is untouched by seat 2's undo — nothing re-rolled.
    expect(attributesOf(s.snapshot).lastRoll).toBe(roll);
  });
});

describe("#18 order-entry sessions (hostOptions.randomness: 'forbidden')", () => {
  const forbidden = { randomness: 'forbidden' } as const;

  it('refuses a drawing action, names the fix, and preserves the prior state', async () => {
    const s = statelessSession(unfencedScumDefinition, soloOptions, forbidden);
    expect((await s.send({ type: 'start' })).success).toBe(true);

    expect((await s.send({ type: 'action', actionName: 'move', player: 1, args: {} })).success)
      .toBe(true);
    const before = JSON.stringify(s.snapshot);

    const drew = await s.send({ type: 'action', actionName: 'gamble', player: 1, args: {} });
    expect(drew.success).toBe(false);
    expect(drew.error).toMatch(/order-entry/);
    expect(drew.error).toMatch(/resolution session/);
    // Refuse-and-preserve: no snapshot is emitted, so the host keeps the old one.
    expect(drew.snapshot).toBeNull();
    expect(JSON.stringify(s.snapshot)).toBe(before);

    // And the session is still usable afterwards.
    expect((await s.send({ type: 'action', actionName: 'note', player: 1, args: {} })).success)
      .toBe(true);
  });

  it('the SAME op succeeds when the host does not forbid randomness', async () => {
    const s = statelessSession(unfencedScumDefinition, soloOptions);
    expect((await s.send({ type: 'start' })).success).toBe(true);
    const drew = await s.send({ type: 'action', actionName: 'gamble', player: 1, args: {} });
    expect(drew.success).toBe(true);
  });

  it('keeps undo legal — with no draws possible, undo is outcome-neutral', async () => {
    const s = statelessSession(unfencedScumDefinition, soloOptions, forbidden);
    expect((await s.send({ type: 'start' })).success).toBe(true);
    await s.send({ type: 'action', actionName: 'move', player: 1, args: {} });
    await s.send({ type: 'action', actionName: 'note', player: 1, args: {} });

    const undo = await s.send({ type: 'undo', player: 1 });
    expect(undo.success).toBe(true);
    expect(attributesOf(s.snapshot).moves).toBe(0);
  });

  it('reordering the same orders reproduces identical state — the determinism witness', async () => {
    // The claim the whole design rests on: without draws, action ORDER cannot
    // change any outcome, so undo and reorder are free and no fence is needed.
    const play = async (order: string[]) => {
      const s = statelessSession(unfencedScumDefinition, soloOptions, forbidden);
      await s.send({ type: 'start' });
      for (const actionName of order) {
        const res = await s.send({ type: 'action', actionName, player: 1, args: {} });
        expect(res.success).toBe(true);
      }
      return JSON.stringify(attributesOf(s.snapshot));
    };

    expect(await play(['move', 'note'])).toBe(await play(['note', 'move']));
  });

  it('refuses an AI turn up front — bot playouts consume randomness', async () => {
    const s = statelessSession(unfencedScumDefinition, soloOptions, forbidden);
    expect((await s.send({ type: 'start' })).success).toBe(true);

    const ai = await s.send({ type: 'aiTurn', seats: [{ seat: 1, level: 'easy' }] } as Op);
    expect(ai.success).toBe(false);
    expect(ai.error).toMatch(/order-entry session/);
    expect(ai.error).toMatch(/randomness/);
  });

  it('refuses a draw made in the GAME CONSTRUCTOR, before start() returns', async () => {
    // The gap a post-construction switch leaves open: a subclass constructor
    // body runs after `Game`'s, so forbidding randomness on the instance after
    // `new GameClass(...)` returned misses every setup draw. Real games draw
    // exactly there (dealer pick, map seed). Without this, an order-entry
    // `start` would succeed and its setup would be silently re-rollable by
    // abandoning the session and creating a new one.
    const s = statelessSession(constructorDrawDefinition, soloOptions, forbidden);

    const started = await s.send({ type: 'start' });
    expect(started.success).toBe(false);
    expect(started.error).toMatch(/order-entry/);
    expect(started.error).toMatch(/resolution session/);
    expect(s.snapshot).toBeNull();
  });

  it('CONTROL — that same constructor draw re-rolls per session when allowed', async () => {
    // The channel the refusal above closes, demonstrated: three sessions, three
    // seeds, three different setups. If this ever stops holding, the test above
    // stops being evidence that anything was closed.
    const rolls = await Promise.all(
      ['seed-a', 'seed-b', 'seed-c'].map(async (seed) => {
        const s = statelessSession(constructorDrawDefinition, { playerCount: 1, seed });
        expect((await s.send({ type: 'start' })).success).toBe(true);
        return attributesOf(s.snapshot).setupRoll as number;
      }),
    );

    expect(new Set(rolls).size).toBe(3);
  });

  it('a game bundle cannot smuggle its own randomness policy past the host', async () => {
    // `randomness` is written unconditionally from hostOptions in executeOp, so
    // a value on the definition is inert. The host is the only authority.
    const smuggled = { ...unfencedScumDefinition, randomness: 'allowed' } as GameDefinitionLike;
    const s = statelessSession(smuggled, soloOptions, forbidden);
    expect((await s.send({ type: 'start' })).success).toBe(true);

    const drew = await s.send({ type: 'action', actionName: 'gamble', player: 1, args: {} });
    expect(drew.success).toBe(false);
  });
});
