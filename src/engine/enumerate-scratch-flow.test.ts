/**
 * Enumerating a repeating pick puts the scratch copy's flow back with its tree
 * on every replay (#682).
 *
 * The scratch copy rebuilds its element tree before each replay, which makes
 * new element objects. A flow left as it was still holds the elements of an
 * earlier tree, and keeps whatever an `onEach` did to it on an earlier replay.
 * Here the simultaneous step's `players` filter reads an element from a flow
 * variable, and `onEach` calls `game.refreshAwaitingActions()`, so both reach
 * the moves found.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Action,
  sequence,
  setVar,
  simultaneousActionStep,
  enumerateLegalMoves,
  type GameOptions,
} from './index.js';

class Token extends Piece<ScratchFlowGame, Player> {
  count = 0;
}

function seatTwoAwaited(game: Game): boolean {
  return game.getFlowState()?.awaitingPlayers?.some((p) => p.playerIndex === 2) ?? false;
}

class ScratchFlowGame extends Game<ScratchFlowGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Token]);
    this.create(Token, 'token');

    this.registerActions(
      Action.create<ScratchFlowGame>('bump')
        .prompt('Bump')
        .chooseFrom('picks', {
          // A pick is named for whether seat 2 was awaited when it was made.
          choices: (ctx) => [seatTwoAwaited(ctx.game) ? 'after' : 'before'],
          repeat: {
            until: (ctx) => ctx.game.first(Token)!.count >= 2,
            onEach: (ctx) => {
              ctx.game.first(Token)!.count++;
              ctx.game.refreshAwaitingActions();
            },
          },
        })
        .execute(() => {}),
    );

    this.setFlow({
      root: sequence(
        setVar<ScratchFlowGame>('token', (ctx) => ctx.game.first(Token)),
        simultaneousActionStep({
          name: 'round',
          // Seat 2 joins once the token held by the flow has been bumped.
          players: (ctx) =>
            ctx.game.players.filter((p) => p.seat === 1 || ctx.get<Token>('token')!.count > 0),
          actions: ['bump'],
        }),
      ),
    });
  }
}

function started(): ScratchFlowGame {
  const game = new ScratchFlowGame({ playerCount: 2, playerNames: ['A', 'B'], seed: 'scratch' });
  game.startFlow();
  return game;
}

describe('enumerating a repeating pick whose onEach reaches the flow (#682)', () => {
  it('finds the move the game accepts', () => {
    const moves = enumerateLegalMoves(started(), 1);

    expect(moves).toEqual([{ action: 'bump', args: { picks: ['before', 'after'] } }]);

    const game = started();
    expect(game.continueFlow('bump', moves[0].args, 1).actionError).toBeUndefined();
    expect(game.first(Token)!.count).toBe(2);
  });
});
