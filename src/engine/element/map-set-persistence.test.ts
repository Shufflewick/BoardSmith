import { describe, it, expect } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
  captureDevState,
  restoreDevState,
} from '../index.js';
import type { GameOptions, ElementClass } from '../index.js';

/**
 * Map / Set persistence across a snapshot round-trip.
 *
 * Map and Set are not plain objects: Object.entries() returns [] for them, so the
 * attribute serializer used to flatten them to {} — losing every entry AND their
 * methods (.set/.has/.add). Restored state would carry a truthy {} that defeated
 * `if (!x) x = new Map()` guards, then throw "x.set is not a function" (the MERC
 * combat `retreatDecisions` lockup). These tests prove Map/Set now round-trip as
 * real Map/Set, including element references stored inside them.
 */
async function createTestGame<G extends Game>(GameClass: new (o: GameOptions) => G): Promise<G> {
  return new GameClass({ playerCount: 2, playerNames: ['P1', 'P2'] }).ready();
}

async function simulateHMR<G extends Game>(original: G, GameClass: new (o: GameOptions) => G): Promise<G> {
  const devState = captureDevState(original);
  const classRegistry = new Map<string, ElementClass>();
  for (const [name, cls] of original._ctx.classRegistry) classRegistry.set(name, cls);
  const restored = restoreDevState(devState, GameClass, {
    gameOptions: { playerCount: original.players.length, playerNames: original.players.map(p => p.name) },
    classRegistry,
  });
  await Promise.resolve();
  return restored;
}

class Token extends Piece<TestGame> {}
class TestGame extends Game<TestGame, Player> {}

describe('Map/Set persistence', () => {
  it('a Map<string, object> survives as a real Map (entries + working .set)', async () => {
    class MapGame extends Game<MapGame, Player> {
      decisions: Map<string, { action: string }> = new Map();
    }
    const game = await createTestGame(MapGame);
    game.decisions.set('1', { action: 'continue' });
    game.decisions.set('2', { action: 'retreat' });

    const restored = await simulateHMR(game, MapGame);

    expect(restored.decisions).toBeInstanceOf(Map);
    expect(restored.decisions.get('1')).toEqual({ action: 'continue' });
    expect(restored.decisions.has('2')).toBe(true);
    // The exact regression: .set must still be callable after restore.
    expect(() => restored.decisions.set('3', { action: 'continue' })).not.toThrow();
    expect(restored.decisions.size).toBe(3);
  });

  it('a Set<string> survives as a real Set', async () => {
    class SetGame extends Game<SetGame, Player> {
      processed: Set<string> = new Set();
    }
    const game = await createTestGame(SetGame);
    game.processed.add('a');
    game.processed.add('b');

    const restored = await simulateHMR(game, SetGame);

    expect(restored.processed).toBeInstanceOf(Set);
    expect(restored.processed.has('a')).toBe(true);
    expect([...restored.processed].sort()).toEqual(['a', 'b']);
    expect(() => restored.processed.add('c')).not.toThrow();
  });

  it('a Map nested inside an object attribute survives (activeCombat shape)', async () => {
    class CombatGame extends Game<CombatGame, Player> {
      activeCombat: { round: number; decisions: Map<string, string> } | null = null;
    }
    const game = await createTestGame(CombatGame);
    game.activeCombat = { round: 1, decisions: new Map([['1', 'continue']]) };

    const restored = await simulateHMR(game, CombatGame);

    expect(restored.activeCombat?.decisions).toBeInstanceOf(Map);
    expect(restored.activeCombat?.decisions.get('1')).toBe('continue');
  });

  it('element references stored as Map values resolve to the live elements', async () => {
    class RefGame extends Game<RefGame, Player> {
      bag!: Space<RefGame>;
      byId: Map<string, Token> = new Map();
      constructor(options: GameOptions) {
        super(options);
        this.registerElements([Space, Token]);
        this.bag = this.create(Space, 'bag') as Space<RefGame>;
        const t = this.bag.create(Token, 'tok');
        this.byId.set('tok', t);
      }
    }
    const game = await createTestGame(RefGame);
    const restored = await simulateHMR(game, RefGame);

    expect(restored.byId).toBeInstanceOf(Map);
    const tok = restored.byId.get('tok');
    expect(tok).toBeInstanceOf(Token);
    // Same live element as the one in the tree, not a copy.
    expect(tok).toBe(restored.bag.all(Token)[0]);
  });
});
