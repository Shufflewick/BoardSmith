/**
 * A seat's snapshot gives away nothing through action history (#1167).
 *
 * `createSeatSnapshot` is the MCTS bot's search sandbox: the tree and the
 * message log are redacted for the seat, and a history beside them would name a
 * hidden element's real place, so it carries none, by type.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import { Game, Card, Space, Player, type GameOptions } from '../index.js';
import { createSeatSnapshot, type SeatSnapshot } from './snapshot.js';

class VaultGame extends Game<VaultGame, Player> {
  vault!: Space;
  constructor(options: GameOptions) {
    super(options);
    this.vault = this.create(Space, 'vault');
    this.vault.contentsHidden();
    this.vault.create(Card, 'vault-0');
    this.vault.create(Card, 'Crown');
  }
}

describe('a seat snapshot and action history (#1167)', () => {
  it('has no room for a history, by type', () => {
    expectTypeOf<SeatSnapshot['actionHistory']>().toEqualTypeOf<[]>();
    expectTypeOf(createSeatSnapshot).parameters.toEqualTypeOf<
      [Game, string, string | undefined, { forSeat: number | null; reseed: string }]
    >();
  });

  it('carries an empty one', () => {
    const game = new VaultGame({ playerCount: 2, seed: 'bs1167' });

    expect(createSeatSnapshot(game, 'vault', undefined, { forSeat: 2, reseed: 'sandbox' }).actionHistory).toEqual([]);
  });
});
