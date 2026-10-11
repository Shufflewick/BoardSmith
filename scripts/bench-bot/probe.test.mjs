/**
 * The game the bot benchmark builds is the same game every time it is built
 * (#630), down to its element ids. The engine otherwise mints a random element
 * id key per game (#447), and a bot hook that orders moves by id (hex's does)
 * then searches differently in every run.
 */
import { describe, it, expect } from 'vitest';
import { Game, Space, Action, eachPlayer, actionStep } from '../../src/engine/index.ts';
import { startGame } from './probe.mjs';

class TinyGame extends Game {
  constructor(options) {
    super(options);
    this.create(Space, 'board');
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({ root: eachPlayer({ do: actionStep({ actions: ['pass'] }) }) });
  }
}

const definition = { gameClass: TinyGame, gameType: 'tiny' };

describe('startGame', () => {
  it('builds a game whose element ids are the same every time', () => {
    const ids = () => startGame(definition, { playerCount: 2, options: {} }).game.all(Space).map((space) => space.id);
    expect(ids()).toEqual(ids());
  });
});
