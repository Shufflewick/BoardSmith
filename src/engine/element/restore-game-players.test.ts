import { describe, it, expect } from 'vitest';
import { Game, Player } from '../index.js';
import type { ElementClass, GameOptions } from '../index.js';

/**
 * `Game.restoreGame` player detection.
 *
 * `restoreGame` used to derive playerCount by matching the literal class name
 * `'Player'`. A game that declares `static PlayerClass = MyPlayer` serializes its
 * players under THEIR class name, so the filter matched nothing and the game was
 * reconstructed as `new GameClass({ playerCount: 0, playerNames: [] })` — silently,
 * and implausibly, since every real game declares a custom PlayerClass.
 *
 * Everywhere else in the file identifies players structurally by `$type` (the
 * `players` getter, `currentPlayer`, `getPlayer`). These tests pin `restoreGame`
 * to the same structural predicate, and pin the loud failure when a serialized
 * game genuinely has no players.
 */
class Survivor extends Player {
  supplies = 0;
}

class SurvivorGame extends Game<SurvivorGame, Survivor> {
  static PlayerClass = Survivor;
}

class PlainGame extends Game<PlainGame, Player> {}

function registryFor(game: Game): Map<string, ElementClass> {
  return new Map(game._ctx.classRegistry);
}

describe('Game.restoreGame player detection', () => {
  it('serializes custom players under their own class name, tagged $type=player', async () => {
    const game = await new SurvivorGame({ playerCount: 3, playerNames: ['A', 'B', 'C'] }).ready();
    const json = game.toJSON();
    const playerChildren = (json.children ?? []).filter(
      (c) => (c.attributes as Record<string, unknown> | undefined)?.$type === 'player'
    );

    // The root cause, pinned: the class name is NOT 'Player'…
    expect(playerChildren.map((c) => c.className)).toEqual(['Survivor', 'Survivor', 'Survivor']);
    // …but the structural tag is there, and lives inside `attributes`.
    expect(playerChildren).toHaveLength(3);
  });

  it('hands the game constructor the real player count and names', async () => {
    // The damage is at the constructor call, not the final tree: `loadSerializedState`
    // rebuilds the element tree wholesale afterwards, so it papers over a wrong
    // playerCount for a game whose constructor happens not to use it. This test
    // reads the options the constructor was actually given.
    const seen: GameOptions[] = [];
    class RecordingGame extends Game<RecordingGame, Survivor> {
      static PlayerClass = Survivor;
      constructor(options: GameOptions) {
        super(options);
        seen.push(options);
      }
    }
    const game = await new RecordingGame({ playerCount: 3, playerNames: ['Ada', 'Bo', 'Cy'] }).ready();
    seen.length = 0;

    const restored = Game.restoreGame(game.toJSON(), RecordingGame, registryFor(game));

    expect(seen).toHaveLength(1);
    expect(seen[0].playerCount).toBe(3);
    expect(seen[0].playerNames).toEqual(['Ada', 'Bo', 'Cy']);
    expect(restored.players).toHaveLength(3);
    expect(restored.players[0]).toBeInstanceOf(Survivor);
  });

  it('restores a game whose constructor builds per-player structure from playerCount', async () => {
    // The realistic symptom: a constructor that validates or sizes off playerCount
    // saw 0 and threw, far from the bad read that caused it.
    class SeatedGame extends Game<SeatedGame, Survivor> {
      static PlayerClass = Survivor;
      seatCount = 0;
      constructor(options: GameOptions) {
        super(options);
        if (options.playerCount < 2) {
          throw new Error(`SeatedGame needs at least 2 players, got ${options.playerCount}`);
        }
        this.seatCount = options.playerCount;
      }
    }
    const game = await new SeatedGame({ playerCount: 4 }).ready();
    game.players[1].supplies = 7;

    const restored = Game.restoreGame(game.toJSON(), SeatedGame, registryFor(game));

    expect(restored.seatCount).toBe(4);
    expect(restored.players).toHaveLength(4);
    expect(restored.players[1].supplies).toBe(7);
  });

  it('still restores a game that uses the bare Player class', async () => {
    const game = await new PlainGame({ playerCount: 2, playerNames: ['P1', 'P2'] }).ready();

    const restored = Game.restoreGame(game.toJSON(), PlainGame, registryFor(game));

    expect(restored.players).toHaveLength(2);
    expect(restored.players.map((p) => p.name)).toEqual(['P1', 'P2']);
  });

  it('fails loudly rather than constructing a zero-player game', async () => {
    const game = await new SurvivorGame({ playerCount: 2 }).ready();
    const json = game.toJSON();
    json.children = (json.children ?? []).filter(
      (c) => (c.attributes as Record<string, unknown> | undefined)?.$type !== 'player'
    );

    expect(() => Game.restoreGame(json, SurvivorGame, registryFor(game))).toThrow(/no players/i);
    expect(() => Game.restoreGame(json, SurvivorGame, registryFor(game))).toThrow(/SurvivorGame/);
  });
});
