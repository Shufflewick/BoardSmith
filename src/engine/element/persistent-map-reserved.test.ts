import { describe, it, expect } from 'vitest';
import { Game, Player } from '../index.js';
import { actionTempState } from '../action/helpers.js';
import { ENGINE_SETTINGS_KEYS } from './persistent-map.js';

class MapsGame extends Game<MapsGame, Player> {
  open(name: string) {
    return this.persistentMap<string, number>(name);
  }
}

describe('persistentMap names the engine owns (#753)', () => {
  it.each(['winners', 'colors', 'playerCount', 'playerNames', 'colorSelectionEnabled', '_actionTemp'])(
    'refuses %s, naming it and asking for another name',
    async (name) => {
      const game = await new MapsGame({ playerCount: 2, playerNames: ['A', 'B'] }).ready();
      expect(() => game.open(name)).toThrow(new RegExp(`"${name}".*pick another name`, "i"));
    },
  );

  it('still opens a normal name', async () => {
    const game = await new MapsGame({ playerCount: 2, playerNames: ['A', 'B'] }).ready();
    const map = game.open('pendingLoot');
    map.set('a', 1);
    expect(map.get('a')).toBe(1);
  });

  it('lists every key the engine writes into settings', async () => {
    const game = await new MapsGame({ playerCount: 2, playerNames: ['A', 'B'] }).ready();
    actionTempState(game, game.players[0], 'act').set('k', 1);
    game.finish([game.players[0]]);
    for (const key of Object.keys(game.settings)) {
      expect(ENGINE_SETTINGS_KEYS, `engine key "${key}" is missing from ENGINE_SETTINGS_KEYS`).toContain(key);
    }
  });
});
