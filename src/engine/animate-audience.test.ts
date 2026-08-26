/**
 * `animateTo()` — the audience counterpart to `messageTo()` (#23).
 *
 * `animate()` puts its event in the game-wide buffer, and until the dispatch
 * that produced it drains, that buffer is serialized into `toJSON()` AND into
 * every seat's `toJSONForPlayer()`. A game that is per-seat private by
 * construction — every line through `messageTo`, whose audience the engine
 * enforces server-side — had no equivalent channel for animation: the event
 * reached every seat's payload and the spectator's, and the only defence was to
 * keep the payload deliberately uninformative.
 *
 * The audience is enforced at the same boundary the message log's is: server
 * side, in the per-seat payload, not by a UI filter.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, type GameOptions } from './index.js';

class CombatGame extends Game<CombatGame, Player> {
  constructor(options: GameOptions) {
    super(options);
  }
}

const makeGame = () => new CombatGame({ playerCount: 3, playerNames: ['A', 'B', 'C'], seed: 'anim' });

/** The animation events a given seat's payload actually carries. */
function eventsFor(game: CombatGame, seat: number | null): Array<{ type: string }> {
  const json = game.toJSONForPlayer(seat) as { animationEvents?: Array<{ type: string }> };
  return json.animationEvents ?? [];
}

describe('animateTo() delivers only to its audience', () => {
  it('reaches the seats it names', () => {
    const game = makeGame();
    game.animateTo([1, 2], 'combat-exchange', { damage: 3 });

    expect(eventsFor(game, 1).map((e) => e.type)).toEqual(['combat-exchange']);
    expect(eventsFor(game, 2).map((e) => e.type)).toEqual(['combat-exchange']);
  });

  it('withholds it from every seat it does not', () => {
    const game = makeGame();
    game.animateTo([1, 2], 'combat-exchange', { damage: 3 });
    expect(eventsFor(game, 3)).toEqual([]);
  });

  it('withholds it from the spectator', () => {
    const game = makeGame();
    game.animateTo(1, 'combat-exchange', { damage: 3 });
    expect(eventsFor(game, null)).toEqual([]);
  });

  it('accepts a Player as readily as a seat number, like messageTo', () => {
    const game = makeGame();
    game.animateTo(game.getPlayer(2)!, 'flinch', {});
    expect(eventsFor(game, 2).map((e) => e.type)).toEqual(['flinch']);
    expect(eventsFor(game, 1)).toEqual([]);
  });

  it('does not leak the payload to a non-audience seat', () => {
    const game = makeGame();
    game.animateTo(1, 'combat-exchange', { species: 'wolf', damage: 3 });
    const leaked = JSON.stringify(game.toJSONForPlayer(2));
    expect(leaked).not.toContain('wolf');
    expect(leaked).not.toContain('combat-exchange');
  });

  it('refuses an empty audience rather than emitting an event nobody sees', () => {
    const game = makeGame();
    expect(() => game.animateTo([], 'combat-exchange', {})).toThrow(/empty audience/);
  });

  it('refuses an invalid seat', () => {
    const game = makeGame();
    expect(() => game.animateTo(-1, 'combat-exchange', {})).toThrow(/invalid seat/i);
  });
});

describe('animate() is unchanged — public by default', () => {
  it('reaches every seat and the spectator', () => {
    const game = makeGame();
    game.animate('score', { points: 10 });

    for (const seat of [1, 2, 3, null] as Array<number | null>) {
      expect(eventsFor(game, seat).map((e) => e.type)).toEqual(['score']);
    }
  });

  it('shares one id sequence with animateTo, so ordering stays global', () => {
    const game = makeGame();
    game.animate('first', {});
    game.animateTo(1, 'second', {});
    game.animate('third', {});

    const ids = game.pendingAnimationEvents.map((e) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(3);
    // Seat 1 sees all three; seat 2 sees the two public ones, with their own
    // ids intact so a client watermark still advances correctly.
    expect(eventsFor(game, 1)).toHaveLength(3);
    expect(eventsFor(game, 2).map((e) => e.type)).toEqual(['first', 'third']);
  });
});

describe('the full game state still carries everything', () => {
  it('keeps a private event in toJSON(), which is the authoritative snapshot', () => {
    const game = makeGame();
    game.animateTo(1, 'combat-exchange', { damage: 3 });
    const json = game.toJSON() as { animationEvents?: Array<{ type: string }> };
    expect(json.animationEvents?.map((e) => e.type)).toEqual(['combat-exchange']);
  });

  it('round-trips the audience through a restore', () => {
    const game = makeGame();
    game.animateTo(1, 'combat-exchange', { damage: 3 });

    const restored = makeGame();
    restored.loadSerializedState(game.toJSON(), { messageLog: [] });
    expect(eventsFor(restored, 1).map((e) => e.type)).toEqual(['combat-exchange']);
    expect(eventsFor(restored, 2)).toEqual([]);
  });
});
