/**
 * #716: a seat's `actionTempState` values must not reach any other seat's view.
 *
 * They live in `game.settings`, which rides on the game root and so passed the
 * per-seat redaction unchanged: seat 2 and the spectator received seat 1's
 * temporary picks. These tests assert absence from the payload each audience
 * actually receives, through both projection paths.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Space, actionTempState, type ElementJSON } from '../index.js';

class TempGame extends Game<TempGame, Player> {
  board!: Space<TempGame>;
  setupBoard(): void {
    this.board = this.create(Space<TempGame>, 'board');
  }
}

function newGame(): TempGame {
  const game = new TempGame({ playerCount: 3, seed: 'action-temp-audience', elementIdKey: '00000000000000a2' });
  game.setupBoard();
  return game;
}

type TempStore = Record<string, Record<string, Record<string, unknown>>>;
const tempValues = (settings: Record<string, unknown>): unknown[] =>
  Object.values((settings._actionTemp ?? {}) as TempStore)
    .flatMap((actions) => Object.values(actions))
    .flatMap((keys) => Object.values(keys));

describe('actionTempState: who receives it', () => {
  it('gives a seat its own values and nobody else, through toJSONForPlayer', () => {
    const game = newGame();
    actionTempState(game, game.getPlayer(1)!, 'peek').set('cardId', 'AS-of-spades');

    expect(tempValues(game.toJSONForPlayer(1).settings)).toEqual(['AS-of-spades']);
    expect(tempValues(game.toJSONForPlayer(2).settings)).toEqual([]);
    expect(tempValues(game.toJSONForPlayer(null).settings)).toEqual([]);
  });

  it('gives a seat its own values and nobody else, through toJSONForPlayers', () => {
    const game = newGame();
    actionTempState(game, game.getPlayer(1)!, 'peek').set('cardId', 'AS-of-spades');
    actionTempState(game, game.getPlayer(2)!, 'peek').set('cardId', 'KH');

    const [one, two, spectator] = game.toJSONForPlayers([1, 2, null]);
    expect(tempValues(one.settings)).toEqual(['AS-of-spades']);
    expect(tempValues(two.settings)).toEqual(['KH']);
    expect(tempValues(spectator.settings)).toEqual([]);
  });

  it('tells seats apart when the action name ends in a seat number', () => {
    const game = newGame();
    actionTempState(game, game.getPlayer(1)!, 'peek_2').set('cardId', 'AS-of-spades');

    expect(tempValues(game.toJSONForPlayer(1).settings)).toEqual(['AS-of-spades']);
    expect(tempValues(game.toJSONForPlayer(2).settings)).toEqual([]);
  });

  it('leaves other settings in every view', () => {
    const game = newGame();
    game.settings.round = 3;
    actionTempState(game, game.getPlayer(1)!, 'peek').set('cardId', 'AS-of-spades');

    expect(game.toJSONForPlayer(2).settings.round).toBe(3);
    expect(game.toJSONForPlayer(null).settings.round).toBe(3);
  });

  it('drops another seat\'s value that a playerView hook puts back', () => {
    class Hooked extends TempGame {
      static override playerView = (state: ElementJSON): ElementJSON => ({
        ...state,
        settings: { ...(state as ElementJSON & { settings: Record<string, unknown> }).settings, _actionTemp: { 1: { peek: { cardId: 'AS-of-spades' } } } },
      } as ElementJSON);
    }
    const game = new Hooked({ playerCount: 3, seed: 'action-temp-audience', elementIdKey: '00000000000000a2' });
    game.setupBoard();

    expect(tempValues(game.toJSONForPlayer(2).settings)).toEqual([]);
    expect(tempValues(game.toJSONForPlayer(null).settings)).toEqual([]);
  });
});

describe('actionTempState: whose values clear() and get() reach (#725)', () => {
  const twelveSeats = (): TempGame => {
    const game = new TempGame({ playerCount: 12, seed: 'action-temp-names', elementIdKey: '00000000000000a3' });
    game.setupBoard();
    return game;
  };

  it('leaves seat 10 alone when seat 1 clears', () => {
    const game = twelveSeats();
    actionTempState(game, game.getPlayer(10)!, 'explore').set('sectorId', 42);
    actionTempState(game, game.getPlayer(1)!, 'explore').clear();

    expect(actionTempState(game, game.getPlayer(10)!, 'explore').get('sectorId')).toBe(42);
  });

  it('leaves action a_b alone when action a clears', () => {
    const game = newGame();
    const player = game.getPlayer(1)!;
    actionTempState(game, player, 'a_b').set('x', 'kept');
    actionTempState(game, player, 'a').clear();

    expect(actionTempState(game, player, 'a_b').get('x')).toBe('kept');
  });

  it('keeps action a key b_x apart from action a_b key x', () => {
    const game = newGame();
    const player = game.getPlayer(1)!;
    actionTempState(game, player, 'a').set('b_x', 'from-a');
    actionTempState(game, player, 'a_b').set('x', 'from-a_b');

    expect(actionTempState(game, player, 'a').get('b_x')).toBe('from-a');
    expect(actionTempState(game, player, 'a_b').get('x')).toBe('from-a_b');
  });
});
