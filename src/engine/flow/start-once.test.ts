import { describe, it, expect } from 'vitest';
import { Game, Player, Action, actionStep, eachPlayer, loop, sequence, execute, TurnOrder, type GameOptions } from '../index.js';
import { createTestGame } from '../../testing/test-game.js';

/**
 * A game starts once (#502), and a tutorial puts the flow back on the
 * learner's turn through its own named restart that runs no game code (#546).
 *
 * `setups` counts the flow's `setup`, `openings` counts the opening
 * `execute`; both are game code a restart must not run again.
 */
class OpeningGame extends Game<OpeningGame, Player> {
  setups = 0;
  openings = 0;
  turns = 0;

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({
      setup: (ctx) => {
        ctx.game.setups++;
      },
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

const ALREADY_STARTED = /This game has already started/;

describe('starting a game once (#502)', () => {
  it('refuses a second start on a game createTestGame already started', () => {
    const tg = createTestGame(OpeningGame, { playerCount: 2, seed: 'once' });
    expect(() => tg.start()).toThrow(ALREADY_STARTED);
    expect(() => tg.start()).toThrow(/remove the extra \.start\(\) call, or pass autoStart: false/);
  });

  it('runs the opening once, and a refused second start runs nothing', () => {
    const tg = createTestGame(OpeningGame, { playerCount: 2, seed: 'once' });
    expect(tg.game.setups).toBe(1);
    expect(tg.game.openings).toBe(1);

    expect(() => tg.game.startFlow()).toThrow(ALREADY_STARTED);
    expect(tg.game.setups).toBe(1);
    expect(tg.game.openings).toBe(1);
  });

  it('starts a game created with autoStart: false exactly once', () => {
    const tg = createTestGame(OpeningGame, { playerCount: 2, seed: 'once', autoStart: false });
    expect(tg.game.openings).toBe(0);
    tg.start();
    expect(tg.game.openings).toBe(1);
    expect(() => tg.start()).toThrow(ALREADY_STARTED);
  });
});

describe('restartFlowForTutorial (#546)', () => {
  it("puts the turn back on seat 1 without re-running the flow's setup or opening execute", () => {
    const tg = createTestGame(OpeningGame, { playerCount: 2, seed: 'tutorial' });
    tg.doAction(1, 'pass', {});
    expect(tg.game.getFlowState()?.currentPlayer).toBe(2);

    const state = tg.game.restartFlowForTutorial(1);

    expect(state.currentPlayer).toBe(1);
    expect(state.awaitingInput).toBe(true);
    expect(state.availableActions).toEqual(['pass']);
    expect(tg.game.setups).toBe(1);
    expect(tg.game.openings).toBe(1);
    expect(tg.game.turns).toBe(1);
  });

  it('stops passing over execute nodes at the first step that needs input', () => {
    const tg = createTestGame(OpeningGame, { playerCount: 2, seed: 'tutorial' });
    tg.doAction(1, 'pass', {});
    tg.game.restartFlowForTutorial(1);

    tg.doAction(1, 'pass', {});

    expect(tg.game.turns).toBe(2);
    expect(tg.game.getFlowState()?.currentPlayer).toBe(2);
  });

  it('refuses a game whose flow never started', () => {
    const tg = createTestGame(OpeningGame, { playerCount: 2, seed: 'tutorial', autoStart: false });
    expect(() => tg.game.restartFlowForTutorial(1)).toThrow(/has not started/);
  });

  it.each([
    { players: 2, turns: [2, 1, 2, 1] },
    { players: 3, turns: [2, 3, 1, 2, 3, 1] },
  ])('joins the round at the seat it names, so the next round keeps its order ($players players) (#552)', ({ players, turns }) => {
    const tg = createTestGame(OpeningGame, { playerCount: players, seed: 'tutorial' });

    const state = tg.game.restartFlowForTutorial(2);

    expect(state.availableActions).toEqual(['pass']);
    expect(tg.game.openings).toBe(1);
    expect(seatsToMove(tg, turns.length)).toEqual(turns);
  });

  it("joins a round that has its own starting player at the named seat's place in it (#552)", () => {
    // The round runs 2, 3, 1; joining it at seat 3 skips only seat 2.
    const tg = createTestGame(StartingPlayerGame, { playerCount: 3, seed: 'tutorial' });
    expect(tg.game.getFlowState()?.currentPlayer).toBe(2);

    tg.game.restartFlowForTutorial(3);

    expect(seatsToMove(tg, 5)).toEqual([3, 1, 2, 3, 1]);
  });

  it('gives the named seat a step that is not inside an eachPlayer (#552)', () => {
    const tg = createTestGame(BareStepGame, { playerCount: 2, seed: 'tutorial' });
    expect(tg.game.getFlowState()?.currentPlayer).toBe(1);

    expect(tg.game.restartFlowForTutorial(2).currentPlayer).toBe(2);
  });
});

/** The seat to move before each of the next `count` passes, each seat passing in turn. */
function seatsToMove(tg: ReturnType<typeof createTestGame<OpeningGame | StartingPlayerGame>>, count: number): number[] {
  const seats: number[] = [];
  for (let i = 0; i < count; i++) {
    const seat = tg.game.getFlowState()!.currentPlayer!;
    seats.push(seat);
    tg.doAction(seat, 'pass', {});
  }
  return seats;
}

/** A round that always starts at seat 2, whatever turn the game is on. */
class StartingPlayerGame extends Game<StartingPlayerGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({
      root: loop({
        maxIterations: 20,
        do: eachPlayer({ ...TurnOrder.DEFAULT, startingPlayer: (ctx) => ctx.game.getPlayer(2)!, do: actionStep({ actions: ['pass'] }) }),
      }),
    });
  }
}

/** An action step reached without an eachPlayer: it prompts the flow's current seat. */
class BareStepGame extends Game<BareStepGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({ root: loop({ maxIterations: 20, do: actionStep({ actions: ['pass'] }) }) });
  }
}
