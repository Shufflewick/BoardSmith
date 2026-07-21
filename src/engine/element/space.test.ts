/**
 * FLOW-04 regression coverage for Space.shuffleInternal()'s RNG source.
 *
 * - A game-attached Space shuffles deterministically using the seeded rng
 *   inherited from Game._ctx.random (same seed -> same order).
 * - A Space with no reachable seeded rng throws an actionable Error instead
 *   of silently falling back to Math.random.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
  Action,
  defineFlow,
  actionStep,
  type GameOptions,
} from '../index.js';
import { GameRunner } from '../../runtime/index.js';

class TestGame extends Game<TestGame, Player> {}

class Token extends Piece<TestGame> {
  label!: string;
}

/** Simulate a cold-storage round-trip (matches production storage adapters). */
function roundTripJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildDeck(game: TestGame): Space<TestGame> {
  const deck = game.create(Space, 'deck');
  for (let i = 0; i < 10; i++) {
    deck.create(Token, `token-${i}`, { label: `token-${i}` });
  }
  return deck;
}

describe('Space.shuffleInternal', () => {
  it('shuffles deterministically using the game-attached seeded rng', () => {
    const gameA = new TestGame({ playerCount: 2, seed: 'space-shuffle-seed' });
    const deckA = buildDeck(gameA);
    deckA.shuffle();
    const orderA = deckA.all(Token).map((t) => t.label);

    const gameB = new TestGame({ playerCount: 2, seed: 'space-shuffle-seed' });
    const deckB = buildDeck(gameB);
    deckB.shuffle();
    const orderB = deckB.all(Token).map((t) => t.label);

    expect(orderA).toEqual(orderB);
    // Sanity: shuffle actually reorders (not a no-op on 10 items).
    expect(orderA).not.toEqual(
      Array.from({ length: 10 }, (_, i) => `token-${i}`),
    );
  });

  it('throws an actionable error when no seeded rng is reachable', () => {
    // Constructed with an empty context: no Game, no `random`.
    const disconnected = new Space({} as never);
    expect(() => disconnected.shuffleInternal()).toThrow(
      /seeded random number generator is reachable/i,
    );
    expect(() => disconnected.shuffleInternal()).toThrow(/Game/);
  });
});

/**
 * SPACE-01 (D22)/SPACE-02 (D23) — sealed/append-only Space + Space
 * remove/re-parent. See 163-CONTEXT.md for the locked decisions.
 *
 * PROC-01: these cases run against CURRENT, UNFIXED source and are expected
 * to FAIL — Space has no `sealed` field and no re-parent/remove method yet.
 */
describe('Space.sealed (SPACE-01/D22): append-only child removal guard', () => {
  it('rejects moving a Piece OUT of a sealed Space, tree left untouched (no corrupt-on-reject)', () => {
    const game = new TestGame({ playerCount: 2, seed: 'sealed-reject-1' });
    const sealedSpace = game.create(Space, 'sealed-space');
    const other = game.create(Space, 'other');
    const token = sealedSpace.create(Token, 'token', { label: 'x' });
    sealedSpace.sealed = true;

    const childrenBefore = [...sealedSpace._t.children];

    expect(() => token.putInto(other)).toThrow(/sealed-space/i);

    // Tree must be byte-identical after the throw: no corrupt-on-reject.
    expect(token.parent).toBe(sealedSpace);
    expect(sealedSpace._t.children).toEqual(childrenBefore);
    expect(other._t.children).toEqual([]);
  });

  it('allows adding a Piece INTO a sealed Space (append-only, not frozen)', () => {
    const game = new TestGame({ playerCount: 2, seed: 'sealed-add-1' });
    const sealedSpace = game.create(Space, 'sealed-add-space');
    const other = game.create(Space, 'other');
    sealedSpace.sealed = true;
    const token = other.create(Token, 'token', { label: 'y' });

    expect(() => token.putInto(sealedSpace)).not.toThrow();
    expect(token.parent).toBe(sealedSpace);
  });

  it('negative control: an ordinary (unsealed) Space allows Piece removal exactly as today', () => {
    const game = new TestGame({ playerCount: 2, seed: 'unsealed-1' });
    const openSpace = game.create(Space, 'open-space');
    const other = game.create(Space, 'other');
    const token = openSpace.create(Token, 'token', { label: 'w' });

    expect(() => token.putInto(other)).not.toThrow();
    expect(token.parent).toBe(other);
  });

  it('a sealed flag and its onExit-driven state survive a snapshot restore round-trip', () => {
    class Marker extends Piece<MarkerGame> {}
    class MarkerGame extends Game<MarkerGame, Player> {
      sealedZone!: Space<MarkerGame>;
      overflow!: Space<MarkerGame>;
      exitCount = 0;

      constructor(options: GameOptions) {
        super(options);
        this.sealedZone = this.create(Space, 'sealed-zone');
        this.overflow = this.create(Space, 'overflow');
        this.sealedZone.onExit(() => {
          this.exitCount += 1;
        });
        this.sealedZone.create(Marker, 'marker');

        this.registerAction(Action.create('noop').execute(() => ({ success: true })));
        this.setFlow(
          defineFlow({
            root: actionStep({
              actions: ['noop'],
              player: (ctx) => ctx.game.getPlayer(1)!,
              repeatUntil: () => false,
              maxMoves: 10,
            }),
          })
        );
      }
    }

    const runner = new GameRunner<MarkerGame>({
      GameClass: MarkerGame,
      gameType: 'sealed-restore-test',
      gameOptions: { playerCount: 2, seed: 'sealed-restore-seed' },
    });
    runner.start();

    // Fire the onExit side-effect legitimately (space is NOT sealed yet).
    const marker = runner.game.sealedZone.first(Marker)!;
    marker.putInto(runner.game.overflow);
    expect(runner.game.exitCount).toBe(1);

    // Now seal the (now-empty) zone and restore must NOT re-run the seal
    // check (restore rebuilds children via addChild, not moveToInternal).
    runner.game.sealedZone.sealed = true;

    const snapshot = roundTripJson(runner.getSnapshot());
    const restored = GameRunner.fromSnapshot<MarkerGame>(snapshot, MarkerGame);

    expect(restored.game.sealedZone.sealed).toBe(true);
    expect(restored.game.exitCount).toBe(1);
  });
});

describe('Space re-parent (SPACE-02/D23): a Space can be removed/re-parented', () => {
  it('re-parents a Space: its own onExit fires once on the old parent, children ride along with no child exit events', () => {
    const game = new TestGame({ playerCount: 2, seed: 'reparent-1' });
    const parentA = game.create(Space, 'parent-a');
    const parentB = game.create(Space, 'parent-b');

    let aExitCount = 0;
    let childExitCount = 0;
    parentA.onExit(() => {
      aExitCount += 1;
    });

    const childSpace = parentA.create(Space, 'child-space');
    childSpace.onExit(() => {
      childExitCount += 1;
    });
    const token = childSpace.create(Token, 'token', { label: 'z' });

    (childSpace as unknown as { reparent: (dest: Space) => void }).reparent(parentB);

    expect(childSpace.parent).toBe(parentB);
    expect(childSpace._t.children).toContain(token);
    expect(token.parent).toBe(childSpace);
    expect(aExitCount).toBe(1);
    expect(childExitCount).toBe(0);
  });

  it('a sealed Space can still be re-parented (seal fences child removal, not the Space itself)', () => {
    const game = new TestGame({ playerCount: 2, seed: 'reparent-sealed-1' });
    const parentA = game.create(Space, 'parent-a');
    const parentB = game.create(Space, 'parent-b');

    const sealedChild = parentA.create(Space, 'sealed-child');
    sealedChild.sealed = true;
    const token = sealedChild.create(Token, 'token', { label: 'q' });

    expect(() =>
      (sealedChild as unknown as { reparent: (dest: Space) => void }).reparent(parentB)
    ).not.toThrow();

    expect(sealedChild.parent).toBe(parentB);
    expect(token.parent).toBe(sealedChild);
  });
});
