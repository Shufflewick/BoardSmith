import { describe, it, expect } from 'vitest';
import { Game, Player, Action, FlowEngine, actionStep, repeat, noop } from '../index.js';
import type { FlowDefinition } from '../index.js';

/**
 * An action step settles `skipIf` and `player` once, when it is entered, and
 * keeps them for every move after (#786).
 */
class TestGame extends Game<TestGame, Player> {}

function gameWithMove(): TestGame {
  const game = new TestGame({ playerCount: 2 });
  game.registerAction(Action.create('move').execute(() => {}));
  return game;
}

describe('action step entry (#786)', () => {
  it('skipIf turning true after a move does not end the step before minMoves', () => {
    const game = gameWithMove();
    let skip = false;
    const flow: FlowDefinition = {
      root: actionStep({ actions: ['move'], minMoves: 2, maxMoves: 3, skipIf: () => skip }),
    };
    const engine = new FlowEngine(game, flow);
    engine.start();
    skip = true;
    const state = engine.resume('move', {});
    expect(state.awaitingInput).toBe(true);
    expect(state.movesRequired).toBe(1);
  });

  it('the step stays with the player it was entered for', () => {
    const game = gameWithMove();
    let seat = 1;
    const flow: FlowDefinition = {
      root: actionStep({ actions: ['move'], maxMoves: 2, player: (ctx) => ctx.game.getPlayer(seat)! }),
    };
    const engine = new FlowEngine(game, flow);
    expect(engine.start().currentPlayer).toBe(1);
    seat = 2;
    expect(engine.resume('move', {}).currentPlayer).toBe(1);
  });

  it('calls config.player once when the step is entered', () => {
    const game = gameWithMove();
    let calls = 0;
    const flow: FlowDefinition = {
      root: actionStep({
        actions: ['move'],
        player: (ctx) => {
          calls++;
          return ctx.game.getPlayer(1)!;
        },
      }),
    };
    new FlowEngine(game, flow).start();
    expect(calls).toBe(1);
  });
});

describe('repeat count (#786)', () => {
  it.each([NaN, -1, 1.5, Infinity])('refuses repeat(%s)', (times) => {
    expect(() => repeat(times, noop())).toThrow(/repeat\(\) needs a whole number of times, 0 or more/);
  });

  it('accepts 0', () => {
    expect(() => repeat(0, noop())).not.toThrow();
  });
});
