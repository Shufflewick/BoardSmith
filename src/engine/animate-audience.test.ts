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
import { Game, Player, animationFloorOf, type GameOptions } from './index.js';

class CombatGame extends Game<CombatGame, Player> {
  constructor(options: GameOptions) {
    super(options);
  }
}

const makeGame = () => new CombatGame({ playerCount: 3, playerNames: ['A', 'B', 'C'], seed: 'anim', elementIdKey: '00000000000000b1' });

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

  it('refuses seat 0, which is no player: spectators see only public events (#489)', () => {
    const game = makeGame();
    expect(() => game.animateTo(0, 'combat-exchange', {})).toThrow(/seat 0 is no player.*animate\(\)/i);
    expect(() => game.animateTo([1, 0], 'combat-exchange', {})).toThrow(/seat 0 is no player/i);
    expect(game.pendingAnimationEvents).toEqual([]);
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
});

/** The ids a given seat's payload carries, in order. */
function idsFor(game: CombatGame, seat: number | null): number[] {
  const json = game.toJSONForPlayer(seat) as { animationEvents?: Array<{ id: number }> };
  return (json.animationEvents ?? []).map((e) => e.id);
}

describe('each recipient numbers only the events it may see (#489)', () => {
  it("another seat's private events leave no gap in a seat's ids", () => {
    const game = makeGame();
    game.animate('first', {});
    game.animateTo(1, 'second', {});
    game.animateTo(1, 'third', {});
    game.animate('fourth', {});

    expect(idsFor(game, 1)).toEqual([1, 2, 3, 4]);
    expect(idsFor(game, 2)).toEqual([1, 2]);
    expect(idsFor(game, null)).toEqual([1, 2]);
    // Nothing that counts every seat's events reaches a seat.
    expect(JSON.stringify(game.toJSONForPlayer(2))).not.toMatch(/seatIds|animationSeqBySeat|animationEventSeq/);
  });

  it('keeps counting for each recipient across a full restore', () => {
    const game = makeGame();
    game.animateTo(1, 'private', {});
    game.animate('public', {});

    const restored = makeGame();
    restored.loadSerializedState(game.toJSON(), { messageLog: [] });
    restored.animate('next', {});
    expect(idsFor(restored, 1).at(-1)).toBe(3);
    expect(idsFor(restored, 2).at(-1)).toBe(2);
  });

  it("a restore below the live game re-numbers each recipient's events above what it was already sent", () => {
    const game = makeGame();
    game.animate('kept', {});
    const earlier = game.toJSON();
    game.animateTo(2, 'later', {});
    game.animate('later-public', {});
    const live = game.toJSON();

    const restored = makeGame();
    restored.loadSerializedState(earlier, { messageLog: [], animationFloor: animationFloorOf(live) });
    // Seat 2 had been sent ids up to 3, seat 1 up to 2: the replayed beat follows each.
    expect(idsFor(restored, 2)).toEqual([4]);
    expect(idsFor(restored, 1)).toEqual([3]);
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
