/**
 * #356: `gameInstanceId` -- the broadcast "this is a different game" signal.
 *
 * `restoreEpoch` tells a client that the runner of THIS game was replaced (undo,
 * rewind). It cannot tell it that the game itself was replaced: every new game
 * starts at epoch 0, so "New game" at a step whose action set does not change
 * looked like an ordinary re-broadcast, and the client kept offering the old
 * deal's cards.
 *
 * These tests prove the identity of a game is stated, and stated in one place:
 *   1. A newly created runner has one, and no two new games share it.
 *   2. It is durable: a snapshot carries it, a stateless op keeps it, and an
 *      undo keeps it (an undo is the same game; `restoreEpoch` says it moved).
 *   3. Every start of a game is a new one, including a start from a saved seed
 *      position, which would otherwise hand every restart the seed's identity.
 *   4. Every seat's broadcast state carries it, spectators included.
 */

import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, type GameOptions } from '../engine/index.js';
import type { GameStateSnapshot } from '../engine/utils/snapshot.js';
import { GameRunner } from '../runtime/index.js';
import { GameSession } from './game-session.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import { boundaryKeyOf } from './testing/boundary-stamp.js';
import { succeeded } from './op-result.test-helper.js';

/** One seat calls a number, forever. The smallest game an undo can act on. */
class CallGame extends Game<CallGame, Player> {
  called: number[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create('call')
        .chooseFrom('n', { choices: () => [1, 2, 3] })
        .execute((args, ctx) => {
          (ctx.game as CallGame).called.push(args.n);
          return { success: true };
        }),
    );
    this.setFlow(
      defineFlow({
        root: actionStep({
          actions: ['call'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
          maxMoves: 10,
        }),
      }),
    );
  }
}

const definition: GameDefinitionLike = { gameClass: CallGame, gameType: 'call', minPlayers: 2, maxPlayers: 2 };
// A FIXED seed on purpose: two games dealt from the same seed are still two games.
const gameOptions = { playerCount: 2, seed: 'game-instance-356' };

function newRunner(): GameRunner<CallGame> {
  const runner = new GameRunner({ GameClass: CallGame, gameType: 'call', gameOptions });
  runner.start();
  return runner;
}

function newSession() {
  return GameSession.create<CallGame>({
    gameType: 'call', GameClass: CallGame, playerCount: 2, playerNames: ['Ada', 'Bo'], seed: 'game-instance-356',
  });
}

async function start(seedSnapshot?: GameStateSnapshot): Promise<GameStateSnapshot> {
  const result = succeeded(await executeOp(definition, gameOptions, null, null, { type: 'start' }, { seedSnapshot }));
  expect(result.success).toBe(true);
  return result.snapshot as GameStateSnapshot;
}

describe('#356: a game has an identity of its own', () => {
  it('a new runner has one, and two new games from the same seed do not share it', () => {
    const first = newRunner();
    const second = newRunner();
    expect(first.gameInstanceId).toMatch(/\S/);
    expect(second.gameInstanceId).not.toBe(first.gameInstanceId);
  });

  it('survives the snapshot boundary, and a plain rehydration is the same game', () => {
    const runner = newRunner();
    const snapshot = JSON.parse(JSON.stringify(runner.getSnapshot())) as GameStateSnapshot;
    expect(snapshot.gameInstanceId).toBe(runner.gameInstanceId);
    expect(GameRunner.fromSnapshot(snapshot, CallGame).gameInstanceId).toBe(runner.gameInstanceId);
  });

  it('is kept by an undo, which moves restoreEpoch instead', async () => {
    const session = newSession();
    const before = session.buildPlayerState(1).gameInstanceId;
    expect((await session.performAction('call', 1, { n: 2 })).success).toBe(true);
    expect((await session.undoToTurnStart(1)).success).toBe(true);

    const after = session.buildPlayerState(1);
    expect(after.restoreEpoch).toBe(1);
    expect(after.gameInstanceId).toBe(before);
  });

  it('is kept by every stateless op on the same game', async () => {
    const started = await start();
    const acted = succeeded(await executeOp(definition, gameOptions, started, null, {
      type: 'action', actionName: 'call', player: 1, args: { n: 3 },
      boundaryKey: boundaryKeyOf(started),
    }));
    expect(acted.success).toBe(true);
    expect((acted.snapshot as GameStateSnapshot).gameInstanceId).toBe(started.gameInstanceId);
  });

  it('is new on every start, including every start from the same saved seed position', async () => {
    const first = await start();
    const second = await start();
    expect(second.gameInstanceId).not.toBe(first.gameInstanceId);

    // `boardsmith dev --seed <file>`: each New game restores the same saved
    // position, and each is still a new game. A client holding a pick from the
    // previous one must be told.
    const seeded1 = await start(first);
    const seeded2 = await start(first);
    expect(seeded1.gameInstanceId).not.toBe(first.gameInstanceId);
    expect(seeded2.gameInstanceId).not.toBe(seeded1.gameInstanceId);
  });

  it('is published to every seat, spectators included', () => {
    const session = newSession();
    const published = [0, 1, 2].map((seat) => session.buildPlayerState(seat).gameInstanceId);
    expect(published[0]).toMatch(/\S/);
    expect(new Set(published).size).toBe(1);
  });
});
