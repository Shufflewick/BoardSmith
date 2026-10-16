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
 * out of the console. The traversal check costs a walk, so it runs and throws
 * only at dev/test time. The `moveToInternal` check is free and throws in every
 * mode (#762).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Game, Space, Piece, Player, type GameOptions } from '../index.js';

// isDevMode() is fixed at module load, so the production-mode cases override it here.
const devModeState = vi.hoisted(() => ({ override: null as boolean | null }));
vi.mock('../../utils/dev.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/dev.js')>();
  return {
    ...actual,
    isDevMode: () => (devModeState.override !== null ? devModeState.override : actual.isDevMode()),
  };
});

afterEach(() => {
  devModeState.override = null;
});

class Token extends Piece<Board, Player> {}
class Zone extends Space<Board, Player> {}

class Board extends Game<Board, Player> {
  left!: Zone;
  right!: Zone;
  far!: Zone;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Token, Zone]);
    this.left = this.create(Zone, 'left');
    this.right = this.create(Zone, 'right');
    this.far = this.create(Zone, 'far');
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

    expect(() => token.putInto(game.right)).toThrow(/does not list it/);
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

describe.each([
  ['development', true],
  ['production', false],
])('an onExit handler that moves the leaving element, in %s mode (#762)', (_mode, dev) => {
  beforeEach(() => {
    devModeState.override = dev;
  });

  it('is refused with an error that says what to do instead', () => {
    const token = game.left.first(Token)!;
    game.left.onExit((el: Token) => el.putInto((el.game as Board).far), Token);

    expect(() => token.putInto(game.right)).toThrow(/onExit handler.*onEnter/s);
  });

  it('leaves the element where it was, listed once, in a tree that still traverses', () => {
    const token = game.left.all(Token)[1];
    const before = game.left.all(Token).map((t) => t.id);
    game.left.onExit((el: Token) => el.putInto((el.game as Board).far), Token);
    const entered: Token[] = [];
    game.right.onEnter((el: Token) => entered.push(el), Token);

    expect(() => token.putInto(game.right)).toThrow();

    expect(entered).toEqual([]);

    expect(token.parent).toBe(game.left);
    expect(game.left.all(Token).map((t) => t.id)).toEqual(before);
    expect(game.right.all(Token)).toHaveLength(0);
    expect(game.far.all(Token)).toHaveLength(0);
    expect(game.all(Token)).toHaveLength(3);
  });

  it('refuses a move from a parent that does not list the element', () => {
    const token = game.left.first(Token)!;
    const children = (game.left as unknown as { _t: { children: unknown[] } })._t.children;
    children.splice(children.indexOf(token as unknown as never), 1);

    expect(() => token.putInto(game.right)).toThrow(/does not list it/);
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
