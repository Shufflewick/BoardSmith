import { describe, it, expect } from 'vitest';
import { Game, Player } from '../index.js';

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
});
