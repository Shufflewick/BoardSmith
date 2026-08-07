import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, execute, type GameOptions } from '../engine/index.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import { SnapshotSessionHost, type SnapshotSessionAdapters } from './snapshot-session-host.js';

// ---------------------------------------------------------------------------
// A flow that runs to completion INSIDE start(): the whole result is decided in
// setup, so there is never a player action. This is the shape a persistent-world
// resolver takes (and any restore that lands one step from the end).
//
// Before the startFlow() fix, `Game.settings.winners` was only populated by
// continueFlow / continueFlowAfterPendingAction, so a start-time completion
// broadcast `winners: []` -- which SnapshotSessionHost turns into
// `isDraw: true`. A decisive game reported a draw.
// ---------------------------------------------------------------------------

class InstantWinGame extends Game<InstantWinGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    // Registered so the game has a legal action surface; the flow never reaches it.
    this.registerAction(Action.create('noop').execute(() => ({ success: true })));
    this.setFlow(
      defineFlow({
        root: execute(() => {
          // Nothing to do -- the flow's only node completes immediately.
        }),
        getWinners: (ctx) => [ctx.game.getPlayer(2)!],
      }),
    );
  }
}

const instantWinGameDef: GameDefinitionLike = {
  gameClass: InstantWinGame as new (...args: unknown[]) => unknown,
  gameType: 'instant-win',
  minPlayers: 1,
  maxPlayers: 4,
};

const instantWinOptions = { playerCount: 2, seed: 'instant-win-seed' };

describe('a flow completing inside start() publishes its winners', () => {
  it('the start op result carries the flow-declared winners, not an empty draw', async () => {
    const res = await executeOp(instantWinGameDef, instantWinOptions, null, {}, { type: 'start' });

    expect(res.success).toBe(true);
    expect(res.isComplete).toBe(true);
    expect(res.winners).toEqual([2]);
  });

  it('the host broadcasts isDraw:false with the winner seat', async () => {
    const broadcastLog: unknown[][] = [];
    const adapters: SnapshotSessionAdapters = {
      playerCount: 2,
      executeOp: (snap, pend, op) =>
        executeOp(instantWinGameDef, instantWinOptions, snap, pend, op),
      broadcast: (views, meta) => broadcastLog.push([views, meta]),
    };

    const host = new SnapshotSessionHost(adapters);
    await host.start();

    expect(broadcastLog.length).toBeGreaterThan(0);
    const meta = broadcastLog[broadcastLog.length - 1][1];
    expect(meta).toMatchObject({ isComplete: true, winners: [2], isDraw: false });
  });
});
