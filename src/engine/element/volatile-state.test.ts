import { describe, it, expect } from 'vitest';
import { Game } from './game.js';
import { Player } from '../player/player.js';
import { Piece } from './piece.js';
import {
  checkForVolatileState,
  validateArrayValue,
} from './volatile-state.js';

/**
 * Regression test for F4: the dev-only volatile-state / HMR auto-sync machinery
 * was extracted out of the Game "god object" into a dedicated collaborator
 * module (volatile-state.ts), composed by Game rather than living as private
 * methods on the class.
 *
 * Against the pre-fix code this file fails to even import (the module did not
 * exist and the logic was private to Game). With the fix it imports and the
 * standalone functions carry the behavior.
 */

class TestPiece extends Piece {}

class BareGame extends Game<BareGame, Player> {
  items: number[] = [];
}

describe('F4: volatile-state extracted into a standalone collaborator', () => {
  it('exposes the machinery as importable standalone functions', () => {
    expect(typeof checkForVolatileState).toBe('function');
    expect(typeof validateArrayValue).toBe('function');
  });

  it('no longer carries the dev-only plumbing as methods on Game', () => {
    const game = new BareGame({ playerCount: 2, playerNames: ['A', 'B'] });
    // These were private methods on Game before the extraction.
    expect((game as unknown as Record<string, unknown>)._checkForVolatileState).toBeUndefined();
    expect((game as unknown as Record<string, unknown>)._autoSyncArrayOnTarget).toBeUndefined();
    expect((game as unknown as Record<string, unknown>)._validateArrayValue).toBeUndefined();
    expect((game.constructor as unknown as Record<string, unknown>)._safeProperties).toBeUndefined();
  });

  it('checkForVolatileState wires up array auto-sync when called directly', () => {
    const game = new BareGame({ playerCount: 2, playerNames: ['A', 'B'] });
    checkForVolatileState(game);

    game.items.push(1, 2, 3);

    // The collaborator mirrors the array into game.settings so it survives HMR.
    expect(game.settings['__autoSync_items']).toEqual([1, 2, 3]);
  });

  it('validateArrayValue rejects non-serializable values with actionable errors', () => {
    expect(() => validateArrayValue(() => {}, 'game.items')).toThrow(/non-serializable|function/i);
    expect(() => validateArrayValue(undefined, 'game.items')).toThrow(/non-serializable|undefined/i);
    expect(() => validateArrayValue(Symbol('x'), 'game.items')).toThrow(/non-serializable|symbol/i);

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => validateArrayValue(circular, 'game.items')).toThrow(/circular|non-serializable/i);
  });

  it('validateArrayValue rejects GameElements with element-children guidance', () => {
    const game = new BareGame({ playerCount: 2, playerNames: ['A', 'B'] });
    const piece = game.create(TestPiece, 'p');
    expect(() => validateArrayValue(piece, 'game.items')).toThrow(/Element arrays cannot be auto-synced|element children/i);
  });

  it('accepts JSON-serializable primitives and plain objects', () => {
    expect(() => validateArrayValue(42, 'game.items')).not.toThrow();
    expect(() => validateArrayValue('x', 'game.items')).not.toThrow();
    expect(() => validateArrayValue(null, 'game.items')).not.toThrow();
    expect(() => validateArrayValue({ a: 1 }, 'game.items')).not.toThrow();
  });
});
