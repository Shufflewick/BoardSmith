/**
 * VIS-01: Per-seat element-visibility utilities.
 *
 * Verifies that:
 * (1) `isElementVisible`/`getVisibleElements` (standalone + TestGame methods)
 *     correctly classify owner-visible, owner-hidden, count-only, all-visible,
 *     and spectator (seat 0) elements.
 * (2) Fast-path parity: with no `static playerView`, `isElementVisible` result
 *     equals `element.isVisibleTo(seat)` exactly.
 * (3) Post-transform correctness: with a `static playerView` that strips an
 *     element from the final tree, `isElementVisible` reflects the strip
 *     (false) even though `element.isVisibleTo(seat)` is true.
 *
 * Cross-layer boundary: testing -> engine (Game.toJSONForPlayer / isVisibleTo)
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Space,
  Card,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
  type ElementJSON,
} from '../engine/index.js';
import { TestGame } from './test-game.js';
import { isElementVisible, getVisibleElements } from './visibility.js';

// ---------------------------------------------------------------------------
// Fixture 1: no static playerView — four visibility modes per player
// ---------------------------------------------------------------------------

class FixtureCard extends Card<NoPlayerViewGame> {
  rank!: string;
}

/**
 * Each player gets four per-player zones exercising all visibility modes:
 * - hand: owner-only (contentsVisibleToOwner)
 * - vault: hidden from everyone (contentsHidden)
 * - stash: count-only (contentsCountOnly)
 * - display: all-visible (contentsVisible, the default)
 */
class NoPlayerViewGame extends Game<NoPlayerViewGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([FixtureCard]);

    for (const player of this.all(Player)) {
      const hand = this.create(Space, `hand-${player.seat}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      hand.create(FixtureCard, `hand-card-${player.seat}`, { rank: 'H' });

      const vault = this.create(Space, `vault-${player.seat}`);
      vault.player = player;
      vault.contentsHidden();
      vault.create(FixtureCard, `vault-card-${player.seat}`, { rank: 'V' });

      const stash = this.create(Space, `stash-${player.seat}`);
      stash.player = player;
      stash.contentsCountOnly();
      stash.create(FixtureCard, `stash-card-${player.seat}`, { rank: 'S' });

      const display = this.create(Space, `display-${player.seat}`);
      display.player = player;
      display.contentsVisible();
      display.create(FixtureCard, `display-card-${player.seat}`, { rank: 'D' });
    }

    this.registerAction(
      Action.create<NoPlayerViewGame>('pass').execute(() => ({ success: true })),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          while: () => false,
          maxIterations: 10,
          do: eachPlayer({ do: actionStep({ actions: ['pass'] }) }),
        }),
      }),
    );
  }
}

function makeNoPlayerViewGame(): TestGame<NoPlayerViewGame> {
  return TestGame.create(NoPlayerViewGame, { playerCount: 2, seed: 'vis-01-no-playerview' });
}

describe('isElementVisible / getVisibleElements — no static playerView (fast path)', () => {
  it('owner sees their own hand card (owner-only zone)', () => {
    const tg = makeNoPlayerViewGame();
    const card = tg.game.first(FixtureCard, { name: 'hand-card-1' })!;
    expect(isElementVisible(card, 1)).toBe(true);
    expect(tg.isElementVisible(card, 1)).toBe(true);
  });

  it('non-owner does NOT see the other player\'s hand card (owner-only zone)', () => {
    const tg = makeNoPlayerViewGame();
    const card = tg.game.first(FixtureCard, { name: 'hand-card-1' })!;
    expect(isElementVisible(card, 2)).toBe(false);
    expect(tg.isElementVisible(card, 2)).toBe(false);
  });

  it('nobody sees a vault card (hidden zone), including the owner', () => {
    const tg = makeNoPlayerViewGame();
    const card = tg.game.first(FixtureCard, { name: 'vault-card-1' })!;
    expect(isElementVisible(card, 1)).toBe(false);
    expect(isElementVisible(card, 2)).toBe(false);
  });

  it('a count-only card is not visible to a non-owner (identity hidden)', () => {
    const tg = makeNoPlayerViewGame();
    const card = tg.game.first(FixtureCard, { name: 'stash-card-1' })!;
    expect(isElementVisible(card, 2)).toBe(false);
  });

  it('an all-visible display card is visible to everyone, including spectators (seat 0)', () => {
    const tg = makeNoPlayerViewGame();
    const card = tg.game.first(FixtureCard, { name: 'display-card-1' })!;
    expect(isElementVisible(card, 1)).toBe(true);
    expect(isElementVisible(card, 2)).toBe(true);
    expect(isElementVisible(card, 0)).toBe(true);
  });

  it('a hidden vault card is not visible to a spectator (seat 0)', () => {
    const tg = makeNoPlayerViewGame();
    const card = tg.game.first(FixtureCard, { name: 'vault-card-1' })!;
    expect(isElementVisible(card, 0)).toBe(false);
  });

  it('getVisibleElements(seat) returns exactly the elements visible to that seat', () => {
    const tg = makeNoPlayerViewGame();
    const visibleToP1 = getVisibleElements(tg.game, 1);
    const names = visibleToP1.filter((e) => e instanceof FixtureCard).map((e) => e.name);

    expect(names).toContain('hand-card-1');
    expect(names).not.toContain('hand-card-2');
    expect(names).not.toContain('vault-card-1');
    expect(names).not.toContain('vault-card-2');
    expect(names).not.toContain('stash-card-2');
    expect(names).toContain('display-card-1');
    expect(names).toContain('display-card-2');
  });

  it('TestGame.getVisibleElements delegates identically to the standalone function', () => {
    const tg = makeNoPlayerViewGame();
    const viaMethod = tg.getVisibleElements(2).map((e) => e.id).sort();
    const viaFn = getVisibleElements(tg.game, 2).map((e) => e.id).sort();
    expect(viaMethod).toEqual(viaFn);
  });

  it('fast-path parity: isElementVisible(el, seat) === el.isVisibleTo(seat) for every element/seat pair', () => {
    const tg = makeNoPlayerViewGame();
    const allCards = tg.game.all(FixtureCard);
    const seats = [0, 1, 2];

    for (const card of allCards) {
      for (const seat of seats) {
        expect(isElementVisible(card, seat)).toBe(card.isVisibleTo(seat));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture 2: static playerView that strips an otherwise-visible element
// ---------------------------------------------------------------------------

class StrippedCard extends Card<WithPlayerViewGame> {
  rank!: string;
}

/** Recursively remove a node (and its subtree) matching `id` from an ElementJSON tree. */
function stripNodeById(node: ElementJSON, id: number): ElementJSON {
  if (!node.children) return node;
  return {
    ...node,
    children: node.children
      .filter((child) => child.id !== id)
      .map((child) => stripNodeById(child, id)),
  };
}

/**
 * A game whose `static playerView` strips ONE specific card (identified by a
 * stable "stripped-card" name) out of the final serialized tree for every
 * seat, even though the card itself lives in an all-visible zone and
 * `isVisibleTo` returns true for it.
 */
class WithPlayerViewGame extends Game<WithPlayerViewGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([StrippedCard]);

    const display = this.create(Space, 'display');
    display.contentsVisible();
    display.create(StrippedCard, 'stripped-card', { rank: 'X' });
    display.create(StrippedCard, 'kept-card', { rank: 'Y' });

    this.registerAction(
      Action.create<WithPlayerViewGame>('pass').execute(() => ({ success: true })),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          while: () => false,
          maxIterations: 10,
          do: eachPlayer({ do: actionStep({ actions: ['pass'] }) }),
        }),
      }),
    );
  }

  static override playerView = (
    state: ElementJSON,
    _playerSeat: number | null,
    game: WithPlayerViewGame,
  ): ElementJSON => {
    const strippedCard = game.first(StrippedCard, { name: 'stripped-card' });
    if (!strippedCard) return state;
    return stripNodeById(state, strippedCard.id);
  };
}

function makeWithPlayerViewGame(): TestGame<WithPlayerViewGame> {
  return TestGame.create(WithPlayerViewGame, { playerCount: 2, seed: 'vis-01-playerview' });
}

describe('isElementVisible / getVisibleElements — static playerView post-transform honored', () => {
  it('isVisibleTo(seat) is true for the stripped card (pre-transform rule sees it as visible)', () => {
    const tg = makeWithPlayerViewGame();
    const card = tg.game.first(StrippedCard, { name: 'stripped-card' })!;
    expect(card.isVisibleTo(1)).toBe(true);
  });

  it('isElementVisible returns FALSE for the stripped card — the playerView hook removed it from the final tree', () => {
    const tg = makeWithPlayerViewGame();
    const card = tg.game.first(StrippedCard, { name: 'stripped-card' })!;
    expect(isElementVisible(card, 1)).toBe(false);
    expect(tg.isElementVisible(card, 1)).toBe(false);
  });

  it('isElementVisible returns TRUE for the non-stripped card in the same all-visible zone', () => {
    const tg = makeWithPlayerViewGame();
    const kept = tg.game.first(StrippedCard, { name: 'kept-card' })!;
    expect(isElementVisible(kept, 1)).toBe(true);
  });

  it('getVisibleElements excludes the stripped card but includes the kept card', () => {
    const tg = makeWithPlayerViewGame();
    const visible = getVisibleElements(tg.game, 1);
    const names = visible.filter((e) => e instanceof StrippedCard).map((e) => e.name);
    expect(names).not.toContain('stripped-card');
    expect(names).toContain('kept-card');
  });
});
