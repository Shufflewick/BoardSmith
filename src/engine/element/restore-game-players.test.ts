import { describe, it, expect } from 'vitest';
import { Game, Player } from '../index.js';
import type { GameOptions } from '../index.js';
import { serializedRoundTrip } from './serialized-round-trip.test-helper.js';

/**
 * Restoring a game's players.
 *
 * A game that declares `static PlayerClass = MyPlayer` serializes its players
 * under THEIR class name, not `'Player'`, so anything that finds players in a
 * serialized tree must do it structurally by `$type`. These tests pin that,
 * and that a restore keeps the players' class, count and attributes.
 */
class Survivor extends Player {
  supplies = 0;
}

class SurvivorGame extends Game<SurvivorGame, Survivor> {
  static PlayerClass = Survivor;
}

class PlainGame extends Game<PlainGame, Player> {}

describe('restoring a game keeps its players', () => {
  it('serializes custom players under their own class name, tagged $type=player', async () => {
    const game = await new SurvivorGame({ playerCount: 3, playerNames: ['A', 'B', 'C'] }).ready();
    const json = game.toJSON();
    const playerChildren = (json.children ?? []).filter(
      (c) => (c.attributes as Record<string, unknown> | undefined)?.$type === 'player'
    );

    // The class name is NOT 'Player'…
    expect(playerChildren.map((c) => c.className)).toEqual(['Survivor', 'Survivor', 'Survivor']);
    // …but the structural tag is there, and lives inside `attributes`.
    expect(playerChildren).toHaveLength(3);
  });

  it('restores a game whose constructor builds per-player structure from playerCount', async () => {
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

    const restored = await serializedRoundTrip(game, SeatedGame);

    expect(restored.seatCount).toBe(4);
    expect(restored.players).toHaveLength(4);
    expect(restored.players[0]).toBeInstanceOf(Survivor);
    expect(restored.players[1].supplies).toBe(7);
  });

  it('still restores a game that uses the bare Player class', async () => {
    const game = await new PlainGame({ playerCount: 2, playerNames: ['P1', 'P2'] }).ready();

    const restored = await serializedRoundTrip(game, PlainGame);

    expect(restored.players).toHaveLength(2);
    expect(restored.players.map((p) => p.name)).toEqual(['P1', 'P2']);
  });
});
