import { describe, it, expect } from 'vitest';
import { Game, Player } from '../index.js';
import { serializedRoundTrip } from './serialized-round-trip.test-helper.js';

/** Built-in object names are ordinary keys of a PersistentMap, never inherited members (#761). */
class MapGame extends Game<MapGame, Player> {
  map = this.persistentMap<string, number>('m');
}

async function newGame(): Promise<MapGame> {
  return new MapGame({ playerCount: 2, playerNames: ['P1', 'P2'] }).ready();
}

describe('PersistentMap built-in names (#761)', () => {
  it('a new map has none of the built-in object names', async () => {
    const { map } = await newGame();
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(map.has(name)).toBe(false);
      expect(map.get(name)).toBeUndefined();
    }
  });

  it('delete of a built-in name is a no-op', async () => {
    const { map } = await newGame();
    map.set('a', 1);
    expect(map.delete('constructor')).toBe(false);
    expect(map.delete('__proto__')).toBe(false);
    expect(map.size).toBe(1);
  });

  it('__proto__ is a real key that survives a save/restore round-trip', async () => {
    const game = await newGame();
    game.map.set('__proto__', 7);
    expect(game.map.get('__proto__')).toBe(7);
    expect(game.map.has('__proto__')).toBe(true);
    expect(game.map.size).toBe(1);
    expect([...game.map.keys()]).toEqual(['__proto__']);

    const restored = await serializedRoundTrip(game, MapGame);
    expect(restored.map.get('__proto__')).toBe(7);
    expect(restored.map.has('__proto__')).toBe(true);
    expect(restored.map.size).toBe(1);
    expect(restored.map.has('constructor')).toBe(false);

    expect(restored.map.delete('__proto__')).toBe(true);
    expect(restored.map.size).toBe(0);
  });

  it('decoding a crafted __proto__ settings entry keeps Object.prototype and stores an own key', async () => {
    const game = await newGame();
    const json = JSON.parse(JSON.stringify(game.toJSON()));
    json.settings.m = JSON.parse('{"__proto__": {"polluted": 1}}');
    game.loadSerializedState(json);
    const data = game.settings.m as Record<string, unknown>;
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
    expect(Object.hasOwn(data, '__proto__')).toBe(true);
    expect(data.polluted).toBeUndefined();
    expect(game.map.size).toBe(1);
  });
});
