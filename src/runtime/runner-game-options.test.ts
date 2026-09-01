import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { GameRunner } from './runner.js';

/**
 * A GAME'S OWN OPTIONS TYPE MUST SURVIVE THE TRIP THROUGH `GameRunner`.
 *
 * `GameRunnerOptions.gameOptions` used to be typed as the base `GameOptions`,
 * so a game that widens it — Hex's `boardSize`, and every game with a rules
 * knob — could not be constructed through the runner without an excess-property
 * error (TS2353). The game class itself declares exactly which options it
 * accepts; the runner now reads that declaration off the `GameClass` rather
 * than substituting the base type for it.
 *
 * This file is the compile-time assertion. If `gameOptions` narrows back to
 * `GameOptions`, the `boardSize` below stops type-checking, which is the
 * failure this exists to produce. The runtime expectation underneath it proves
 * the option is not merely ACCEPTED by the type system but actually reaches the
 * constructed game.
 */
interface SizedOptions extends GameOptions {
  /** Rows on this game's board. */
  boardSize?: number;
}

class SizedGame extends Game<SizedGame, Player> {
  boardSize: number;

  constructor(options: SizedOptions) {
    super(options);
    this.boardSize = options.boardSize ?? 3;

    this.registerActions(
      Action.create('pass').execute(() => ({ success: true })),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 4,
          do: eachPlayer({ do: actionStep({ actions: ['pass'], turnScope: 'restart' }) }),
        }),
      }),
    );
  }
}

describe('GameRunner carries the game class\'s own options type', () => {
  it('accepts an option the game declares and hands it to the game', () => {
    const runner = new GameRunner({
      GameClass: SizedGame,
      gameType: 'sized',
      gameOptions: { playerCount: 1, boardSize: 19, seed: 'sized' },
    });

    expect(runner.game.boardSize).toBe(19);
  });

  it('still defaults to the base options for a game that widens nothing', () => {
    const runner = new GameRunner({
      GameClass: SizedGame,
      gameType: 'sized',
      gameOptions: { playerCount: 1, seed: 'sized' },
    });

    expect(runner.game.boardSize).toBe(3);
  });
});
