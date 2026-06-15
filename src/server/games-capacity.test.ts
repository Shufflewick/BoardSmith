/**
 * Regression tests for F14 (security/medium):
 *   "create/action have no rate limiting or game-count cap (DoS)".
 *
 * The in-memory store kept every created game in a Map forever with no upper
 * bound, so any client could spam `POST /games` and exhaust server memory.
 *
 * The fix bounds the store: once it holds its maximum number of concurrent
 * games it refuses to create a *new* game (throwing GameStoreCapacityError),
 * which handleCreateGame surfaces as an actionable 503. Replacing an existing
 * id (the restart delete-then-recreate path) is still allowed because it does
 * not grow the map.
 *
 * Each "must reject" assertion below FAILS against the pre-fix unbounded store.
 */

import { describe, it, expect } from 'vitest';
import { Game, defineFlow, actionStep, Action, type GameOptions } from '../engine/index.js';
import { InMemoryGameStore, SimpleGameRegistry } from './stores/in-memory-games.js';
import { GameStoreCapacityError } from './errors.js';
import { handleCreateGame } from './handlers/games.js';
import type { BroadcastAdapter, CreateGameRequest, GameDefinition } from './types.js';

class TestGame extends Game {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow(defineFlow({ root: actionStep({ actions: ['pass'] }) }));
  }
}

const definition: GameDefinition = {
  gameClass: TestGame,
  gameType: 'test-game',
  minPlayers: 2,
  maxPlayers: 2,
};

function makeStore(maxGames: number) {
  const registry = new SimpleGameRegistry([definition]);
  const broadcaster: BroadcastAdapter = { getSessions: () => [], send: () => {} };
  const store = new InMemoryGameStore(registry, () => broadcaster, { maxGames });
  return { registry, store };
}

const createOptions = { gameType: 'test-game', playerCount: 2, playerNames: ['A', 'B'] };

describe('F14: in-memory store is bounded', () => {
  it('rejects creating a new game once the store is full', async () => {
    const { store } = makeStore(2);

    await store.createGame('g1', createOptions);
    await store.createGame('g2', createOptions);

    await expect(store.createGame('g3', createOptions)).rejects.toBeInstanceOf(
      GameStoreCapacityError
    );
  });

  it('frees capacity when a game is deleted', async () => {
    const { store } = makeStore(2);

    await store.createGame('g1', createOptions);
    await store.createGame('g2', createOptions);
    await store.deleteGame('g1');

    // Now there is room again.
    await expect(store.createGame('g3', createOptions)).resolves.toBeTruthy();
  });

  it('allows replacing an existing id at capacity (restart path)', async () => {
    const { store } = makeStore(1);

    await store.createGame('g1', createOptions);
    // Restart deletes then recreates the same id; recreating the same id never
    // grows the map, so it must succeed even at capacity.
    await store.deleteGame('g1');
    await expect(store.createGame('g1', createOptions)).resolves.toBeTruthy();
  });

  it('rejects an invalid maxGames at construction', () => {
    const registry = new SimpleGameRegistry([definition]);
    const broadcaster: BroadcastAdapter = { getSessions: () => [], send: () => {} };
    expect(() => new InMemoryGameStore(registry, () => broadcaster, { maxGames: 0 })).toThrow(
      /positive integer/
    );
  });
});

describe('F14: POST /games surfaces capacity as an actionable 503', () => {
  it('returns 503 with an actionable message instead of an opaque 500', async () => {
    const { store, registry } = makeStore(1);

    const first = await handleCreateGame(store, registry, createOptions as CreateGameRequest);
    expect(first.status).toBe(201);

    const second = await handleCreateGame(store, registry, createOptions as CreateGameRequest);
    expect(second.status).toBe(503);
    const body = second.body as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain('capacity');
    // Actionable: tells the operator how to recover.
    expect(body.error).toMatch(/maxGames|Delete finished games/);
  });
});
