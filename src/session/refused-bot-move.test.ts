import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  actionStep,
  simultaneousActionStep,
  type GameOptions,
} from '../engine/index.js';
import { executeOp, type ExecutableOp, type GameDefinitionLike, type OpResultFor } from './stateless-ops.js';
import { boundaryKeyOfHost } from './testing/boundary-stamp.js';
import { SnapshotSessionHost } from './snapshot-session-host.js';
import { GameSession } from './game-session.js';
import { BotController } from './bot-controller.js';
import { BotGame } from './testing/fixtures/bot-game-fixture.js';

// ============================================================================
// #421: a bot whose move is refused must never spin.
//
// Nothing about the game changes when a move is refused, so the same bot asked
// again at the same state makes the same move and is refused the same way. A
// driver that asks again anyway is a loop that floods the log and burns CPU
// for as long as the table sits there. It says so once, loudly, and waits for
// the state to change.
// ============================================================================

const REFUSAL = 'Seat 2 may never move.';

class Mover extends Player<StubbornSeatGame, Mover> {
  moved = false;
}

/**
 * Every seat moves once, all at the same time. Seat 2's move is always
 * refused; every other seat's is accepted. Seat 1 is the human.
 */
class StubbornSeatGame extends Game<StubbornSeatGame, Mover> {
  static override PlayerClass = Mover;

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create('move').execute((_args, ctx) => {
        const mover = ctx.player as Mover;
        if (mover.seat === 2) return { success: false, error: REFUSAL };
        mover.moved = true;
        return { success: true };
      }),
    );
    this.setFlow(defineFlow({
      root: simultaneousActionStep({ actions: ['move'], playerDone: (_ctx, player) => player.moved }),
    }));
  }
}

const stubbornDef = {
  gameClass: StubbornSeatGame,
  gameType: 'stubborn-seat',
  minPlayers: 3,
  maxPlayers: 3,
} satisfies GameDefinitionLike;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('#421: SnapshotSessionHost with a bot seat whose move is refused', () => {
  function makeHost() {
    const gameOptions = { playerCount: 3, seed: 'bs421-host' };
    const botTurns: Array<{ seats: number[]; result: OpResultFor<'botTurn'> }> = [];
    const host = new SnapshotSessionHost({
      playerCount: 3,
      executeOp: async (snapshot, pendingState, op) => {
        const result = await executeOp(stubbornDef, gameOptions, snapshot, pendingState, op);
        const asked: ExecutableOp = op;
        if (asked.type === 'botTurn') {
          botTurns.push({ seats: asked.seats.map((s) => s.seat), result: result as OpResultFor<'botTurn'> });
        }
        return result;
      },
      record: () => {}, push: () => {},
    });
    host.setBotSeats([{ seat: 2, level: 'easy' }, { seat: 3, level: 'easy' }]);
    const refusalsOfSeat2 = () =>
      botTurns.filter((t) => !t.result.success && t.result.botPlayer === 2).length;
    return { host, botTurns, refusalsOfSeat2 };
  }

  it('asks a refused seat once per game state, says so each time, and lets the rest of the table move', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { host, botTurns, refusalsOfSeat2 } = makeHost();
    await host.start();
    const refusalLogs = () =>
      errors.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(REFUSAL));

    await host.runBotTurns();
    // Seat 2 is asked first and refused. Seat 3 still moves, which changes the
    // game, so seat 2 is asked once more, at the new state, and refused again.
    expect(botTurns.filter((t) => t.result.success && t.result.botMoved && t.result.botPlayer === 3)).toHaveLength(1);
    expect(refusalsOfSeat2()).toBe(2);
    expect(refusalLogs()).toHaveLength(2);
    expect(refusalLogs()[0]).toMatch(/seat 2\b/);

    // Nothing changed: asking again must not retry the refused move.
    await host.runBotTurns();
    await host.runBotTurns();
    expect(refusalsOfSeat2()).toBe(2);

    // The human moves, so the state changed: seat 2 gets exactly one more try.
    const human = await host.handleOp(1, {
      type: 'action', actionName: 'move', player: 1, args: {}, boundaryKey: boundaryKeyOfHost(host),
    });
    expect(human.success).toBe(true);
    expect(refusalsOfSeat2()).toBe(3);
    await host.runBotTurns();
    expect(refusalsOfSeat2()).toBe(3);
    expect(refusalLogs()).toHaveLength(3);
  });
});

// ----------------------------------------------------------------------------
// GameSession drives its bots itself, off a scheduler.
// ----------------------------------------------------------------------------

/** Seat 2 is a bot and always to move; every move it makes is refused. */
class RefusedBotGame extends Game<RefusedBotGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create('move')
        .chooseFrom('n', { choices: () => [1, 2] })
        .execute(() => ({ success: false, error: REFUSAL })),
    );
    this.setFlow(defineFlow({
      root: actionStep({ actions: ['move'], player: (ctx) => ctx.game.getPlayer(2)! }),
    }));
  }
}

/** Long enough for several of GameSession's bot checks (each waits 300 ms first). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 1500));

describe('#421: GameSession bot checks', () => {
  it('a refused bot move is reported once and not retried while nothing changes', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const checks = vi.spyOn(BotController.prototype, 'checkAndPlay');
    GameSession.create({
      gameType: 'refused-bot',
      GameClass: RefusedBotGame,
      playerCount: 2,
      playerNames: ['Human', 'Bot'],
      botSeats: { players: [2], level: 'easy' },
    });

    await vi.waitFor(
      () => expect(errors.mock.calls.some((c) => String(c[0]).includes(REFUSAL))).toBe(true),
      { timeout: 30_000 },
    );
    await settle();

    expect(checks).toHaveBeenCalledTimes(1);
    const refusalLogs = errors.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(REFUSAL));
    expect(refusalLogs).toHaveLength(1);
    expect(refusalLogs[0]).toMatch(/seat 2/);
  }, 60_000);

  it('does not keep checking while a human is to move, and checks again when the human moves', async () => {
    const checks = vi.spyOn(BotController.prototype, 'checkAndPlay');
    // BotGame: seat 1, a human, is always to move; the bot in seat 2 never is.
    const session = GameSession.create({
      gameType: 'human-to-move',
      GameClass: BotGame,
      playerCount: 2,
      playerNames: ['Human', 'Bot'],
      botSeats: { players: [2], level: 'easy' },
    });

    await vi.waitFor(() => expect(checks).toHaveBeenCalled(), { timeout: 30_000 });
    await settle();
    expect(checks).toHaveBeenCalledTimes(1);

    const result = await session.performAction('move', 1, { direction: 'left' });
    expect(result.success).toBe(true);
    await vi.waitFor(() => expect(checks).toHaveBeenCalledTimes(2), { timeout: 30_000 });
    await settle();
    expect(checks).toHaveBeenCalledTimes(2);
  }, 60_000);
});
