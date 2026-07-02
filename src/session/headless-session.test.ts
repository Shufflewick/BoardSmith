import { describe, it, expect } from 'vitest';
import { createHeadlessSession } from './headless-session.js';
import { eachPlayerFixtureDefinition } from './testing/fixtures/each-player-fixture.js';
import { Game, Player, Action, defineFlow, actionStep, loop, type GameOptions } from '../engine/index.js';
import type { GameDefinitionLike } from './stateless-ops.js';

/**
 * Public-path tests for `createHeadlessSession` (boardsmith/session).
 *
 * Proves the three contract guarantees a headless simulation driver depends on:
 * seeded determinism, AI seats acting on their own, and a normal action op
 * round-trip. All assertions run against the PUBLIC `./headless-session.js`
 * import — never the removed `testing/headless-harness.js` path.
 */

// Inline fixture: a single-player action that draws from the game's seeded
// RNG and records the result on game state. Exercises game.random() (not just
// a no-randomness 'pass' action) so the determinism test is meaningful.
class RollGame extends Game<RollGame, Player> {
  lastRoll = 0;

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create('roll').execute(() => {
        this.lastRoll = Math.floor(this.random() * 6) + 1;
        return { success: true };
      }),
    );
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 10,
          do: actionStep({ actions: ['roll'], player: (ctx) => ctx.game.getPlayer(1)! }),
        }),
      }),
    );
  }
}

const rollGameDef: GameDefinitionLike = {
  gameClass: RollGame as new (...args: unknown[]) => unknown,
  gameType: 'roll',
  minPlayers: 1,
  maxPlayers: 1,
};

describe('createHeadlessSession (public path)', () => {
  it('is deterministic: the same seed + same op sequence yields identical broadcasts', async () => {
    const opts = { playerCount: 1, seed: 'headless-demo-seed' };
    const sessionA = createHeadlessSession(rollGameDef, opts);
    const sessionB = createHeadlessSession(rollGameDef, opts);

    await sessionA.start();
    await sessionB.start();

    // Extracts the seeded RNG draw recorded on game state for each roll.
    // (Full broadcasts/results also carry Date.now() action-history timestamps,
    // which are legitimately wall-clock-based and not part of the seeded-RNG
    // determinism contract this test proves.)
    function lastRoll(res: { playerViews: Array<{ state: { view: { attributes: { lastRoll: number } } } }> }) {
      return res.playerViews[0].state.view.attributes.lastRoll;
    }

    const rollsA: number[] = [];
    const rollsB: number[] = [];
    for (let i = 0; i < 3; i++) {
      const resultA = await sessionA.send(1, { type: 'action', actionName: 'roll', player: 1, args: {} });
      const resultB = await sessionB.send(1, { type: 'action', actionName: 'roll', player: 1, args: {} });
      expect(resultA.success).toBe(true);
      expect(resultB.success).toBe(true);
      rollsA.push(lastRoll(resultA as never));
      rollsB.push(lastRoll(resultB as never));
    }

    // Same seed drives the exact same sequence of RNG draws.
    expect(rollsA).toEqual(rollsB);
    // A non-trivial sequence (not all identical values) proves this isn't a
    // vacuous pass from a constant/broken RNG.
    expect(new Set(rollsA).size).toBeGreaterThan(1);
  });

  it('drives AI seats without an explicit send() for that seat', async () => {
    const opts = { playerCount: 2, seed: 'ai-seat-seed' };
    const session = createHeadlessSession(eachPlayerFixtureDefinition, opts, [{ seat: 2, level: 'easy' }]);
    await session.start();

    const broadcastsBefore = session.broadcasts.length;

    // Only seat 1 is driven explicitly. The host's AI pump
    // (SnapshotSessionHost.runAITurns) fires automatically after this action
    // because seat 2 is due next and is registered as an AI seat.
    const result = await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} });
    expect(result.success).toBe(true);

    // Two broadcasts occurred: seat 1's action, then seat 2's automatic AI move.
    expect(session.broadcasts.length).toBeGreaterThan(broadcastsBefore + 1);

    // The 2-player eachPlayer loop rotates 1 -> 2(AI) -> 1, so the final
    // broadcast shows play back on seat 1 without any session.send(2, ...) call.
    const lastBroadcast = session.broadcasts[session.broadcasts.length - 1] as Array<{
      flowState?: { currentPlayer?: number };
    }>;
    expect(lastBroadcast[0]?.flowState?.currentPlayer).toBe(1);
  });

  it('round-trips a valid action op: send() resolves with success:true', async () => {
    const opts = { playerCount: 1, seed: 'roundtrip-seed' };
    const session = createHeadlessSession(rollGameDef, opts);
    await session.start();

    const result = await session.send(1, { type: 'action', actionName: 'roll', player: 1, args: {} });
    expect(result.success).toBe(true);
  });
});
