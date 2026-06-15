import { describe, it, expect } from 'vitest';
import { Game } from './game.js';
import { Player } from '../player/player.js';
import { checkForVolatileState } from './volatile-state.js';

/**
 * F4: the dev-only volatile-state / HMR scan was extracted out of the Game
 * "god object" into a dedicated collaborator module (volatile-state.ts),
 * composed by Game rather than living as private methods on the class.
 *
 * F3: the dev-only array auto-sync Proxy was removed entirely. Declared array
 * state must remain a plain Array at runtime and be persisted through the single
 * toJSON attribute path - never mirrored into a magic `settings.__autoSync_*`
 * key, and never with a runtime shape that depends on NODE_ENV.
 */

class BareGame extends Game<BareGame, Player> {
  items: number[] = [];
}

describe('F4: volatile-state extracted into a standalone collaborator', () => {
  it('exposes the scan as an importable standalone function', () => {
    expect(typeof checkForVolatileState).toBe('function');
  });

  it('no longer carries the dev-only plumbing as methods on Game', () => {
    const game = new BareGame({ playerCount: 2, playerNames: ['A', 'B'] });
    // These were private methods on Game before the extraction.
    expect((game as unknown as Record<string, unknown>)._checkForVolatileState).toBeUndefined();
    expect((game as unknown as Record<string, unknown>)._autoSyncArrayOnTarget).toBeUndefined();
    expect((game as unknown as Record<string, unknown>)._validateArrayValue).toBeUndefined();
    expect((game.constructor as unknown as Record<string, unknown>)._safeProperties).toBeUndefined();
  });
});

describe('F3: declared array state is not silently replaced by a dev-only Proxy', () => {
  it('leaves a declared array as a plain data property (no getter/setter Proxy)', () => {
    const game = new BareGame({ playerCount: 2, playerNames: ['A', 'B'] });
    checkForVolatileState(game);

    const descriptor = Object.getOwnPropertyDescriptor(game, 'items');
    expect(descriptor).toBeDefined();
    // A plain declared array is a data property; the old auto-sync replaced it
    // with an accessor (get/set) backed by a Proxy.
    expect(descriptor?.get).toBeUndefined();
    expect(descriptor?.set).toBeUndefined();
    expect(Array.isArray(descriptor?.value)).toBe(true);
  });

  it('does not create a shadow copy in settings.__autoSync_*', () => {
    const game = new BareGame({ playerCount: 2, playerNames: ['A', 'B'] });
    checkForVolatileState(game);

    game.items.push(1, 2, 3);

    // The single source of truth is the property itself, persisted via toJSON.
    expect(game.settings['__autoSync_items']).toBeUndefined();
    expect(game.items).toEqual([1, 2, 3]);
  });

  it('persists arrays through toJSON attributes (single source of truth)', () => {
    const game = new BareGame({ playerCount: 2, playerNames: ['A', 'B'] });
    checkForVolatileState(game);
    game.items.push(7, 8, 9);

    const json = game.toJSON() as unknown as { attributes: Record<string, unknown> };
    expect(json.attributes.items).toEqual([7, 8, 9]);
    // No parallel settings shadow leaks into the snapshot.
    const settings = json.attributes.settings as Record<string, unknown> | undefined;
    expect(settings?.['__autoSync_items']).toBeUndefined();
  });
});
