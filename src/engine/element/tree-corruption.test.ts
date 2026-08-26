/**
 * Detected tree corruption stops the game (#45).
 *
 * Two places prove an invariant violation and used to log it and carry on:
 *
 * - `moveToInternal`, when an element's parent does not list it among its
 *   children. Proceeding re-parents the element while leaving the stale
 *   reference in place, so it exists in two places at once.
 * - the collection traversal, when it reaches the same element twice.
 *
 * Either way the corrupted tree then gets serialized into a snapshot and a
 * checkpoint, poisoning every later restore, while the one diagnostic scrolls
 * out of the console. These are dev/test-time checks (they cost a traversal),
 * and at dev/test time they throw.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Game, Space, Piece, Player, type GameOptions } from '../index.js';

class Token extends Piece<Board, Player> {}
class Zone extends Space<Board, Player> {}

class Board extends Game<Board, Player> {
  left!: Zone;
  right!: Zone;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Token, Zone]);
    this.left = this.create(Zone, 'left');
    this.right = this.create(Zone, 'right');
    this.left.createMany(3, Token, 'token');
  }
}

let game: Board;

beforeEach(() => {
  game = new Board({ playerCount: 2, playerNames: ['A', 'B'], seed: 'corrupt' });
});

describe('moveToInternal, on a parent that does not list its child', () => {
  it('throws instead of moving the element into a second place in the tree', () => {
    const token = game.left.first(Token)!;

    // Corrupt the tree the way a bad direct splice would: the token still
    // points at `left`, but `left` no longer lists it.
    const children = (game.left as unknown as { _t: { children: unknown[] } })._t.children;
    children.splice(children.indexOf(token as unknown as never), 1);

    expect(() => token.putInto(game.right)).toThrow(/TREE CORRUPTION/);
  });

  it('names both the element and the parent that lost track of it', () => {
    const token = game.left.first(Token)!;
    const children = (game.left as unknown as { _t: { children: unknown[] } })._t.children;
    children.splice(children.indexOf(token as unknown as never), 1);

    expect(() => token.putInto(game.right)).toThrow(new RegExp(`id: ${token.id}`));
    expect(() => token.putInto(game.right)).toThrow(/left/);
  });

  it('leaves an intact tree alone', () => {
    const token = game.left.first(Token)!;
    expect(() => token.putInto(game.right)).not.toThrow();
    expect(game.right.all(Token)).toHaveLength(1);
    expect(game.left.all(Token)).toHaveLength(2);
  });
});

describe('traversal, on an element reachable twice', () => {
  it('throws rather than returning a result set that will be snapshotted', () => {
    const token = game.left.first(Token)!;
    // Parent it in a second place without unparenting it from the first.
    (game.right as unknown as { _t: { children: unknown[] } })._t.children.push(token);

    expect(() => game.all(Token)).toThrow(/TREE CORRUPTION/);
  });

  it('names both containers the element is reachable under', () => {
    const token = game.left.first(Token)!;
    (game.right as unknown as { _t: { children: unknown[] } })._t.children.push(token);

    expect(() => game.all(Token)).toThrow(/left/);
    expect(() => game.all(Token)).toThrow(/right/);
  });

  it('leaves an intact tree alone', () => {
    expect(() => game.all(Token)).not.toThrow();
    expect(game.all(Token)).toHaveLength(3);
  });
});
