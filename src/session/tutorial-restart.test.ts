import { describe, it, expect } from 'vitest';
import { createHeadlessSession } from '../testing/headless-session.js';
import { Game, Player, Action, actionStep, eachPlayer, loop, sequence, execute, type GameOptions } from '../engine/index.js';
import type { TutorialDefinition } from '../engine/index.js';

/**
 * #546: `startTutorial` on a live game puts the flow back on the learner's
 * turn, through the tutorial's own restart, without running the game's opening
 * again. Driven through the live path: SnapshotSessionHost over executeOp.
 */
class TwoSeatTutorialGame extends Game<TwoSeatTutorialGame, Player> {
  openings = 0;
  turns = 0;

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({
      root: sequence(
        execute((ctx) => {
          ctx.game.openings++;
        }),
        loop({
          maxIterations: 20,
          do: eachPlayer({
            do: sequence(
              actionStep({ actions: ['pass'] }),
              execute((ctx) => {
                ctx.game.turns++;
              }),
            ),
          }),
        }),
      ),
    });
  }
}

const tutorial: TutorialDefinition = {
  learnerSeat: 1,
  steps: [{ id: 'pass', gate: { action: 'pass' }, content: [{ text: 'Pass the turn.' }] }],
};

const def = { gameClass: TwoSeatTutorialGame, gameType: 'two-seat-tutorial', minPlayers: 2, maxPlayers: 2, tutorial };
const seatTwoDef = { ...def, tutorial: { ...tutorial, learnerSeat: 2 } };

describe('startTutorial mid-game (#546)', () => {
  it("leaves the learner to move, offered actions, with the opening run once", async () => {
    const session = createHeadlessSession(def, { playerCount: 2, seed: 'tutorial-restart' });
    await session.start();
    expect((await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} })).success).toBe(true);
    expect(session.host.flowState?.currentPlayer).toBe(2);

    const result = await session.send(1, { type: 'startTutorial', player: 1 });

    expect(result.success).toBe(true);
    expect(session.host.flowState?.currentPlayer).toBe(1);
    const learner = session.playerState(1);
    expect(learner.isMyTurn).toBe(true);
    expect(learner.availableActions).toEqual(['pass']);
    expect(session.readGame().openings).toBe(1);
    expect(session.readGame().turns).toBe(1);

    // The restarted position is what the snapshot holds: the next move runs
    // from it, and execute nodes run again once the learner has acted.
    expect((await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} })).success).toBe(true);
    expect(session.readGame().turns).toBe(2);
    expect(session.host.flowState?.currentPlayer).toBe(2);
  });

  it('starts a tutorial that names seat 2 on seat 2, from a game where seat 1 is to move (#552)', async () => {
    const session = createHeadlessSession(seatTwoDef, { playerCount: 2, seed: 'tutorial-restart' });
    await session.start();
    expect(session.host.flowState?.currentPlayer).toBe(1);

    const result = await session.send(2, { type: 'startTutorial', player: 2 });

    expect(result.success).toBe(true);
    expect(session.host.flowState?.currentPlayer).toBe(2);
    const learner = session.playerState(2);
    expect(learner.isMyTurn).toBe(true);
    expect(learner.availableActions).toEqual(['pass']);
    expect(learner.tutorial?.stepId).toBe('pass');
    expect(session.readGame().openings).toBe(1);

    // Two full rounds: the round was joined at seat 2, so the next keeps its order.
    const seats: number[] = [];
    for (let i = 0; i < 4; i++) {
      const seat = session.host.flowState!.currentPlayer!;
      seats.push(seat);
      expect((await session.send(seat, { type: 'action', actionName: 'pass', player: seat, args: {} })).success).toBe(true);
    }
    expect(seats).toEqual([2, 1, 2, 1]);
  });

  it.each([1, 3])('refuses a learner seat the table does not have, asked from seat %s (#552)', async (seat) => {
    const session = createHeadlessSession(
      { ...def, tutorial: { ...tutorial, learnerSeat: 3 } },
      { playerCount: 2, seed: 'tutorial-restart' },
    );
    await session.start();
    const before = structuredClone(session.host.snapshot);

    const result = await session.send(1, { type: 'startTutorial', player: seat });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/This tutorial is for seat 3, but this table has 2 seats/);
    expect(session.host.snapshot).toEqual(before);
  });

  it("refuses a seat that is not the tutorial's learner, and leaves the game as it was (#552)", async () => {
    const session = createHeadlessSession(seatTwoDef, { playerCount: 2, seed: 'tutorial-restart' });
    await session.start();
    const before = structuredClone(session.host.snapshot);

    const result = await session.send(1, { type: 'startTutorial', player: 1 });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/This tutorial is for seat 2.*Start it from seat 2/s);
    expect(session.host.snapshot).toEqual(before);
  });

  it('refuses a learner the restarted flow does not prompt, and leaves the game as it was', async () => {
    const session = createHeadlessSession(
      { ...seatTwoDef, gameClass: SeatOneOnlyGame, gameType: 'seat-one-only' },
      { playerCount: 2, seed: 'tutorial-restart' },
    );
    await session.start();
    const before = structuredClone(session.host.snapshot);

    const result = await session.send(2, { type: 'startTutorial', player: 2 });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot start for seat 2.*seat 1 is to move/s);
    expect(session.host.snapshot).toEqual(before);
  });

  it('refuses a finished game, and its phase stays finished (#552)', async () => {
    const session = createHeadlessSession(
      { ...def, gameClass: OneMoveGame, gameType: 'one-move' },
      { playerCount: 2, seed: 'tutorial-restart' },
    );
    await session.start();
    expect((await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} })).success).toBe(true);
    expect(session.readGame().phase).toBe('finished');
    const before = structuredClone(session.host.snapshot);

    const result = await session.send(1, { type: 'startTutorial', player: 1 });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/game is over.*Start a new game/s);
    expect(session.host.snapshot).toEqual(before);
    expect(session.readGame().phase).toBe('finished');
  });
});

/** Every turn is seat 1's, so no restart can put seat 2 to move. */
class SeatOneOnlyGame extends Game<SeatOneOnlyGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({
      root: loop({ maxIterations: 20, do: actionStep({ actions: ['pass'], player: (ctx) => ctx.game.getPlayer(1)! }) }),
    });
  }
}

/** One pass by seat 1 and the game is over. */
class OneMoveGame extends Game<OneMoveGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({ root: actionStep({ actions: ['pass'] }) });
  }
}
