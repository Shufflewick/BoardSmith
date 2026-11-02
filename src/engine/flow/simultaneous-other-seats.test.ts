/**
 * When one seat's action settles in a simultaneous step, every other seat's
 * offer is worked out again (#1551). Before, only the acting seat's list was,
 * so a seat kept an action another seat's move had made unavailable and was
 * refused it, and a seat another seat's move gave an action was never offered it.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  simultaneousActionStep,
  enumerateLegalMoves,
  type GameOptions,
} from '../index.js';

/** One token is shared: taking it ends `take` for every seat; `give` puts one back for seat 2 only. */
class TokenGame extends Game<TokenGame, Player> {
  tokens = 1;
  seat2Tokens = 0;
  passOpen = true;

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<TokenGame>('take')
        .condition({ 'a token is left': () => this.tokens > 0 })
        .execute(() => { this.tokens--; }),
      Action.create<TokenGame>('pass')
        .condition({ 'passing is open': () => this.passOpen })
        .execute(() => {}),
      Action.create<TokenGame>('give')
        .condition({ 'seat 1 only': (ctx) => ctx.player.seat === 1 })
        .execute(() => { this.seat2Tokens++; }),
      Action.create<TokenGame>('spend')
        .condition({ 'seat 2 has a token': (ctx) => ctx.player.seat === 2 && this.seat2Tokens > 0 })
        .execute(() => { this.seat2Tokens--; }),
    );
    this.setFlow({ root: simultaneousActionStep({ name: 'round', actions: ['take', 'pass', 'give', 'spend'] }) });
  }
}

function started(): TokenGame {
  const game = new TokenGame({ playerCount: 2, seed: 'r' });
  game.startFlow();
  return game;
}

function offered(game: Game, seat: number): string[] | undefined {
  return game.getFlowState()?.awaitingPlayers?.find((p) => p.playerIndex === seat)?.availableActions;
}

describe('a simultaneous step re-derives every seat after any seat acts (#1551)', () => {
  it('stops offering a seat an action another seat made unavailable', () => {
    const game = started();
    expect(offered(game, 1)).toContain('take');

    expect(game.continueFlow('take', {}, 2).actionError).toBeUndefined();

    expect(offered(game, 1)).not.toContain('take');
    expect(offered(game, 1)!.sort()).toEqual(enumerateLegalMoves(game, 1).map((m) => m.action).sort());
  });

  it('admits a seat another seat gave its only action', () => {
    const game = started();
    game.tokens = 0;
    game.passOpen = false;
    game.refreshAwaitingActions();
    expect(offered(game, 2)).toBeUndefined();

    expect(game.continueFlow('give', {}, 1).actionError).toBeUndefined();

    expect(offered(game, 2)).toEqual(['spend']);
    expect(game.continueFlow('spend', {}, 2).actionError).toBeUndefined();
  });

});
