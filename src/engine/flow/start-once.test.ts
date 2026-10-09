import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, eachPlayer, loop, sequence, execute, type GameOptions } from '../index.js';
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
    this.setFlow(
      defineFlow({
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
      }),
    );
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

    const state = tg.game.restartFlowForTutorial();

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
    tg.game.restartFlowForTutorial();

    tg.doAction(1, 'pass', {});

    expect(tg.game.turns).toBe(2);
    expect(tg.game.getFlowState()?.currentPlayer).toBe(2);
  });

  it('refuses a game whose flow never started', () => {
    const tg = createTestGame(OpeningGame, { playerCount: 2, seed: 'tutorial', autoStart: false });
    expect(() => tg.game.restartFlowForTutorial()).toThrow(/has not started/);
  });
});
