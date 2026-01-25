import { describe, it, expect, beforeEach } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
  captureDevState,
  restoreDevState,
} from '../index.js';
import type { GameOptions, ElementClass } from '../index.js';

// ============================================
// Test Utilities
// ============================================

/**
 * Create a test game instance with given game class.
 * Waits for initialization to complete and throws if there's an error.
 */
async function createTestGame<G extends Game>(
  GameClass: new (options: GameOptions) => G
): Promise<G> {
  const game = new GameClass({ playerCount: 2, playerNames: ['P1', 'P2'] });
  // Wait for initialization to complete (auto-sync setup)
  // This will throw if there's an initialization error (e.g., element in array)
  return game.ready();
}

/**
 * Synchronous version for tests that don't need auto-sync
 */
function createTestGameSync<G extends Game>(
  GameClass: new (options: GameOptions) => G
): G {
  return new GameClass({ playerCount: 2, playerNames: ['P1', 'P2'] });
}

/**
 * Simulate HMR by capturing state and restoring to a new game instance.
 * This is the core test utility - if arrays survive this, they survive HMR.
 */
async function simulateHMR<G extends Game>(
  originalGame: G,
  GameClass: new (options: GameOptions) => G
): Promise<G> {
  // 1. Capture dev state from original
  const devState = captureDevState(originalGame);

  // 2. Build class registry from original game
  const classRegistry = new Map<string, ElementClass>();
  for (const [name, cls] of originalGame._ctx.classRegistry) {
    classRegistry.set(name, cls);
  }

  // 3. Restore state to new instance
  const restored = restoreDevState(devState, GameClass, {
    gameOptions: {
      playerCount: originalGame.players.length,
      playerNames: originalGame.players.map(p => p.name),
    },
    classRegistry,
  });

  // 4. Wait for auto-sync to set up on restored game
  await Promise.resolve();

  return restored;
}

// ============================================
// Test Element Classes
// ============================================

class Die extends Piece<TestGame> {
  sides: number = 6;
  value: number = 1;
}

class Card extends Piece<TestGame> {
  suit: string = 'hearts';
  rank: number = 1;
}

class TestBoard extends Space<TestGame> {}

// ============================================
// Test Game Classes
// ============================================

// Basic game for most tests
class TestGame extends Game<TestGame, Player> {
  setup() {
    this.registerElements([TestBoard, Die, Card]);
  }
}

// ============================================
// TESTS
// ============================================

describe('Auto-sync: Primitive Arrays', () => {
  it('number array survives HMR', async () => {
    class ScoreGame extends Game<ScoreGame, Player> {
      scores: number[] = [];
    }
    const game = await createTestGame(ScoreGame);
    game.scores.push(10, 20, 30);

    const restored = await simulateHMR(game, ScoreGame);

    expect(restored.scores).toEqual([10, 20, 30]);
  });

  it('string array survives HMR', async () => {
    class NameGame extends Game<NameGame, Player> {
      names: string[] = [];
    }
    const game = await createTestGame(NameGame);
    game.names.push('Alice', 'Bob');

    const restored = await simulateHMR(game, NameGame);
    expect(restored.names).toEqual(['Alice', 'Bob']);
  });

  it('boolean array survives HMR', async () => {
    class FlagGame extends Game<FlagGame, Player> {
      flags: boolean[] = [];
    }
    const game = await createTestGame(FlagGame);
    game.flags.push(true, false, true);

    const restored = await simulateHMR(game, FlagGame);
    expect(restored.flags).toEqual([true, false, true]);
  });

  it('mixed primitive array survives HMR', async () => {
    class MixedGame extends Game<MixedGame, Player> {
      mixed: (string | number | boolean | null)[] = [];
    }
    const game = await createTestGame(MixedGame);
    game.mixed.push('a', 1, true, null);

    const restored = await simulateHMR(game, MixedGame);
    expect(restored.mixed).toEqual(['a', 1, true, null]);
  });

  it('pre-populated array survives HMR', async () => {
    class PrePopGame extends Game<PrePopGame, Player> {
      scores: number[] = [100, 200, 300];
    }
    const game = await createTestGame(PrePopGame);

    const restored = await simulateHMR(game, PrePopGame);
    expect(restored.scores).toEqual([100, 200, 300]);
  });
});

describe('Auto-sync: All Mutation Methods', () => {
  class MutationGame extends Game<MutationGame, Player> {
    items: number[] = [];
  }

  let game: MutationGame;

  beforeEach(async () => {
    game = await createTestGame(MutationGame);
    game.items = [1, 2, 3, 4, 5];
  });

  it('push() persists', async () => {
    game.items.push(6, 7);
    const restored = await simulateHMR(game, MutationGame);
    expect(restored.items).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('pop() persists', async () => {
    const popped = game.items.pop();
    expect(popped).toBe(5);
    const restored = await simulateHMR(game, MutationGame);
    expect(restored.items).toEqual([1, 2, 3, 4]);
  });

  it('shift() persists', async () => {
    const shifted = game.items.shift();
    expect(shifted).toBe(1);
    const restored = await simulateHMR(game, MutationGame);
    expect(restored.items).toEqual([2, 3, 4, 5]);
  });

  it('unshift() persists', async () => {
    game.items.unshift(-1, 0);
    const restored = await simulateHMR(game, MutationGame);
    expect(restored.items).toEqual([-1, 0, 1, 2, 3, 4, 5]);
  });

  it('splice() remove persists', async () => {
    game.items.splice(1, 2); // Remove 2 items starting at index 1
    const restored = await simulateHMR(game, MutationGame);
    expect(restored.items).toEqual([1, 4, 5]);
  });

  it('splice() insert persists', async () => {
    game.items.splice(2, 0, 99, 98); // Insert at index 2
    const restored = await simulateHMR(game, MutationGame);
    expect(restored.items).toEqual([1, 2, 99, 98, 3, 4, 5]);
  });

  it('splice() replace persists', async () => {
    game.items.splice(1, 2, 99); // Replace 2 items with 1
    const restored = await simulateHMR(game, MutationGame);
    expect(restored.items).toEqual([1, 99, 4, 5]);
  });

  it('sort() persists', async () => {
    game.items = [5, 2, 8, 1, 9];
    game.items.sort((a, b) => a - b);
    const restored = await simulateHMR(game, MutationGame);
    expect(restored.items).toEqual([1, 2, 5, 8, 9]);
  });

  it('reverse() persists', async () => {
    game.items.reverse();
    const restored = await simulateHMR(game, MutationGame);
    expect(restored.items).toEqual([5, 4, 3, 2, 1]);
  });

  it('fill() persists', async () => {
    game.items.fill(0, 1, 4);
    const restored = await simulateHMR(game, MutationGame);
    expect(restored.items).toEqual([1, 0, 0, 0, 5]);
  });

  it('copyWithin() persists', async () => {
    game.items.copyWithin(0, 3); // Copy [4,5] to start
    const restored = await simulateHMR(game, MutationGame);
    expect(restored.items).toEqual([4, 5, 3, 4, 5]);
  });
});

describe('Auto-sync: Index Assignment', () => {
  it('direct index assignment persists', async () => {
    class IndexGame extends Game<IndexGame, Player> {
      items: number[] = [1, 2, 3];
    }
    const game = await createTestGame(IndexGame);
    game.items[1] = 99;

    const restored = await simulateHMR(game, IndexGame);
    expect(restored.items).toEqual([1, 99, 3]);
  });

  it('sparse array assignment persists', async () => {
    class SparseGame extends Game<SparseGame, Player> {
      items: number[] = [];
    }
    const game = await createTestGame(SparseGame);
    game.items[5] = 100; // Creates sparse array

    const restored = await simulateHMR(game, SparseGame);
    expect(restored.items[5]).toBe(100);
    expect(restored.items.length).toBe(6);
  });

  it('length truncation persists', async () => {
    class TruncGame extends Game<TruncGame, Player> {
      items: number[] = [1, 2, 3, 4, 5];
    }
    const game = await createTestGame(TruncGame);
    game.items.length = 2;

    const restored = await simulateHMR(game, TruncGame);
    expect(restored.items).toEqual([1, 2]);
  });

  it('length extension persists', async () => {
    class ExtendGame extends Game<ExtendGame, Player> {
      items: number[] = [1, 2];
    }
    const game = await createTestGame(ExtendGame);
    game.items.length = 5;

    const restored = await simulateHMR(game, ExtendGame);
    expect(restored.items.length).toBe(5);
  });
});

describe('Auto-sync: Object Arrays', () => {
  it('array of plain objects survives HMR', async () => {
    class PlayerDataGame extends Game<PlayerDataGame, Player> {
      playerData: { name: string; score: number }[] = [];
    }
    const game = await createTestGame(PlayerDataGame);
    game.playerData.push({ name: 'Alice', score: 100 });
    game.playerData.push({ name: 'Bob', score: 200 });

    const restored = await simulateHMR(game, PlayerDataGame);
    expect(restored.playerData).toEqual([
      { name: 'Alice', score: 100 },
      { name: 'Bob', score: 200 }
    ]);
  });

  it('nested objects survive HMR', async () => {
    class NestedGame extends Game<NestedGame, Player> {
      data: { outer: { inner: number } }[] = [];
    }
    const game = await createTestGame(NestedGame);
    game.data.push({ outer: { inner: 42 } });

    const restored = await simulateHMR(game, NestedGame);
    expect(restored.data[0].outer.inner).toBe(42);
  });

  it('objects with arrays survive HMR', async () => {
    class RoundsGame extends Game<RoundsGame, Player> {
      rounds: { scores: number[] }[] = [];
    }
    const game = await createTestGame(RoundsGame);
    game.rounds.push({ scores: [10, 20, 30] });

    const restored = await simulateHMR(game, RoundsGame);
    expect(restored.rounds[0].scores).toEqual([10, 20, 30]);
  });

  it('mutating nested object persists', async () => {
    class MutateNestedGame extends Game<MutateNestedGame, Player> {
      playerData: { name: string; score: number }[] = [];
    }
    const game = await createTestGame(MutateNestedGame);
    game.playerData.push({ name: 'Alice', score: 100 });
    game.playerData[0].score = 150; // Mutate nested object

    const restored = await simulateHMR(game, MutateNestedGame);
    expect(restored.playerData[0].score).toBe(150);
  });
});

describe('Auto-sync: Element Array Rejection', () => {
  it('Die[] throws clear error', async () => {
    class DiceGame extends Game<DiceGame, Player> {
      dice: Die[] = [];

      constructor(options: GameOptions) {
        super(options);
        this.registerElements([Die]);
        const die = this.create(Die, 'd6');
        this.dice.push(die); // Should trigger error when auto-sync runs
      }
    }

    // The error is thrown during queueMicrotask (when auto-sync validates)
    await expect(createTestGame(DiceGame)).rejects.toThrow(
      /Element arrays cannot be auto-synced|Use element children instead/
    );
  });

  it('Card[] throws clear error', async () => {
    class HandGame extends Game<HandGame, Player> {
      hand: Card[] = [];

      constructor(options: GameOptions) {
        super(options);
        this.registerElements([Card]);
        const card = this.create(Card, 'ace');
        this.hand.push(card);
      }
    }

    await expect(createTestGame(HandGame)).rejects.toThrow(
      /Element arrays cannot be auto-synced|Use element children instead/
    );
  });

  it('mixed array with element throws', async () => {
    class MixedElementGame extends Game<MixedElementGame, Player> {
      mixed: (number | Die)[] = [];

      constructor(options: GameOptions) {
        super(options);
        this.registerElements([Die]);
        this.mixed.push(1);
        this.mixed.push(this.create(Die, 'd6')); // Should error
      }
    }

    await expect(createTestGame(MixedElementGame)).rejects.toThrow(/Element/);
  });

  it('error message includes fix guidance', async () => {
    class GuidanceGame extends Game<GuidanceGame, Player> {
      dice: Die[] = [];

      constructor(options: GameOptions) {
        super(options);
        this.registerElements([Die]);
        this.dice.push(this.create(Die, 'd6'));
      }
    }

    await expect(createTestGame(GuidanceGame)).rejects.toThrow(/element children|Space/i);
  });
});

describe('Auto-sync: Non-Serializable Rejection', () => {
  it('array with functions throws', async () => {
    class FnGame extends Game<FnGame, Player> {
      callbacks: (() => void)[] = [];
    }
    const game = await createTestGame(FnGame);

    expect(() => {
      game.callbacks.push(() => console.log('test'));
    }).toThrow(/non-serializable|function/i);
  });

  it('array with undefined throws', async () => {
    class UndefGame extends Game<UndefGame, Player> {
      items: (number | undefined)[] = [];
    }
    const game = await createTestGame(UndefGame);

    expect(() => {
      game.items.push(undefined);
    }).toThrow(/non-serializable|undefined/i);
  });

  it('array with Symbol throws', async () => {
    class SymGame extends Game<SymGame, Player> {
      items: symbol[] = [];
    }
    const game = await createTestGame(SymGame);

    expect(() => {
      game.items.push(Symbol('test'));
    }).toThrow(/non-serializable|symbol/i);
  });

  it('array with circular reference throws', async () => {
    class CircularGame extends Game<CircularGame, Player> {
      items: object[] = [];
    }
    const game = await createTestGame(CircularGame);
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;

    expect(() => {
      game.items.push(circular);
    }).toThrow(/circular|non-serializable/i);
  });
});

describe('Auto-sync: Multiple Arrays', () => {
  it('multiple arrays are independent', async () => {
    class MultiGame extends Game<MultiGame, Player> {
      scores: number[] = [];
      names: string[] = [];
      flags: boolean[] = [];
    }
    const game = await createTestGame(MultiGame);
    game.scores.push(100);
    game.names.push('Alice');
    game.flags.push(true);

    const restored = await simulateHMR(game, MultiGame);
    expect(restored.scores).toEqual([100]);
    expect(restored.names).toEqual(['Alice']);
    expect(restored.flags).toEqual([true]);
  });

  it('array reassignment works', async () => {
    class ReassignGame extends Game<ReassignGame, Player> {
      items: number[] = [];
    }
    const game = await createTestGame(ReassignGame);
    game.items = [1, 2, 3]; // Full reassignment

    const restored = await simulateHMR(game, ReassignGame);
    expect(restored.items).toEqual([1, 2, 3]);
  });

  it('array reassignment with new array persists', async () => {
    class ReassignMutateGame extends Game<ReassignMutateGame, Player> {
      items: number[] = [1, 2, 3];
    }
    const game = await createTestGame(ReassignMutateGame);
    game.items = [4, 5, 6];
    game.items.push(7);

    const restored = await simulateHMR(game, ReassignMutateGame);
    expect(restored.items).toEqual([4, 5, 6, 7]);
  });
});

describe('Auto-sync: Edge Cases', () => {
  it('empty array survives HMR', async () => {
    class EmptyGame extends Game<EmptyGame, Player> {
      items: number[] = [];
    }
    const game = await createTestGame(EmptyGame);
    // Don't add anything

    const restored = await simulateHMR(game, EmptyGame);
    expect(restored.items).toEqual([]);
  });

  it('array with null values survives', async () => {
    class NullGame extends Game<NullGame, Player> {
      items: (number | null)[] = [];
    }
    const game = await createTestGame(NullGame);
    game.items.push(1, null, 3);

    const restored = await simulateHMR(game, NullGame);
    expect(restored.items).toEqual([1, null, 3]);
  });

  it('large array survives', async () => {
    class LargeGame extends Game<LargeGame, Player> {
      items: number[] = [];
    }
    const game = await createTestGame(LargeGame);
    for (let i = 0; i < 10000; i++) {
      game.items.push(i);
    }

    const restored = await simulateHMR(game, LargeGame);
    expect(restored.items.length).toBe(10000);
    expect(restored.items[9999]).toBe(9999);
  });

  it('rapid mutations all persist', async () => {
    class RapidGame extends Game<RapidGame, Player> {
      items: number[] = [];
    }
    const game = await createTestGame(RapidGame);
    for (let i = 0; i < 100; i++) {
      game.items.push(i);
      game.items.pop();
      game.items.push(i * 2);
    }

    const restored = await simulateHMR(game, RapidGame);
    // Should have 100 items, each i*2
    expect(restored.items.length).toBe(100);
  });

  it('array on Player class survives', async () => {
    class AchievementPlayer extends Player<PlayerGame> {
      achievements: string[] = [];
    }
    class PlayerGame extends Game<PlayerGame, AchievementPlayer> {
      static PlayerClass = AchievementPlayer;
    }
    const game = await createTestGame(PlayerGame);
    const player = game.players[0] as AchievementPlayer;
    player.achievements.push('First Win');

    const restored = await simulateHMR(game, PlayerGame);
    const restoredPlayer = restored.players[0] as AchievementPlayer;
    expect(restoredPlayer.achievements).toEqual(['First Win']);
  });
});

describe('Auto-sync: Iteration Methods', () => {
  class IterGame extends Game<IterGame, Player> {
    items: number[] = [1, 2, 3, 4, 5];
  }

  let game: IterGame;

  beforeEach(async () => {
    game = await createTestGame(IterGame);
  });

  it('forEach works', () => {
    const results: number[] = [];
    game.items.forEach(x => results.push(x * 2));
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('map works', () => {
    const doubled = game.items.map(x => x * 2);
    expect(doubled).toEqual([2, 4, 6, 8, 10]);
  });

  it('filter works', () => {
    const evens = game.items.filter(x => x % 2 === 0);
    expect(evens).toEqual([2, 4]);
  });

  it('reduce works', () => {
    const sum = game.items.reduce((a, b) => a + b, 0);
    expect(sum).toBe(15);
  });

  it('find works', () => {
    const found = game.items.find(x => x > 3);
    expect(found).toBe(4);
  });

  it('some/every work', () => {
    expect(game.items.some(x => x > 4)).toBe(true);
    expect(game.items.every(x => x > 0)).toBe(true);
  });

  it('for...of works', () => {
    const results: number[] = [];
    for (const item of game.items) {
      results.push(item);
    }
    expect(results).toEqual([1, 2, 3, 4, 5]);
  });

  it('spread operator works', () => {
    const copy = [...game.items];
    expect(copy).toEqual([1, 2, 3, 4, 5]);
  });

  it('Array.from works', () => {
    const copy = Array.from(game.items);
    expect(copy).toEqual([1, 2, 3, 4, 5]);
  });
});
