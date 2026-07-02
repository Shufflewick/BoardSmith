// @vitest-environment jsdom
/**
 * VIS-03: DOM-leak test utility.
 *
 * Verifies that:
 * (1) NEGATIVE — a correctly-redacted per-seat view never leaks hidden identity.
 * (2) POSITIVE CONTROL — a deliberately-injected leak (unfiltered gameView) IS
 *     caught, naming the leaked marker/element/seat. A leak-detector with no
 *     failing case is unproven (Highest-Risk-Item #2).
 * (3) PLAYERVIEW BLIND-SPOT — an attribute a `static playerView` hook strips
 *     from an otherwise-visible card is still treated as forbidden.
 * (4) ALLOWLIST — a caller-supplied predicate suppresses a known false
 *     positive (a legitimate visible value overlapping a hidden marker)
 *     while a real leak still fails.
 *
 * Cross-layer boundary: testing -> engine (toJSON/toJSONForPlayer) -> ui (AutoUI/CardRenderer)
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Hand,
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
import { assertNoHiddenInfoLeak, type HiddenInfoGameView } from './dom-leak.js';

// ---------------------------------------------------------------------------
// Fixture: two players, each with an owner-only Hand holding one secret card.
// ---------------------------------------------------------------------------

class FixtureCard extends Card<CardLeakGame> {
  rank!: string;
  suit!: string;
}

class CardLeakGame extends Game<CardLeakGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([FixtureCard]);

    for (const player of this.all(Player)) {
      const hand = this.create(Hand, `hand-${player.seat}`);
      hand.player = player;
      // Hand defaults to owner-only content visibility (hand.ts constructor).
      const card = hand.create(FixtureCard, `${player.seat}-secret-card`, {
        rank: player.seat === 1 ? 'A' : 'K',
        suit: 'spades',
      });
      // $images is a base GameElement property (not settable via create()'s
      // typed attributes param, which excludes base-class keys) — assign directly.
      card.$images = {
        face: `assets/face-${player.seat}-secret.png`,
        back: 'assets/generic-back.png',
      };
    }

    this.registerAction(
      Action.create<CardLeakGame>('pass').execute(() => ({ success: true })),
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

function makeCardLeakGame(): TestGame<CardLeakGame> {
  return TestGame.create(CardLeakGame, { playerCount: 2, seed: 'dom-leak-01' });
}

// ---------------------------------------------------------------------------
// Tree-walk helpers for constructing deliberately-leaky test overrides.
// ---------------------------------------------------------------------------

function findNodeById(node: ElementJSON, id: number): ElementJSON | undefined {
  if (node.id === id) return node;
  if (!node.children) return undefined;
  for (const child of node.children) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return undefined;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// NEGATIVE: correctly-redacted view never leaks
// ---------------------------------------------------------------------------

describe('assertNoHiddenInfoLeak — negative case (redacted view)', () => {
  it('does NOT throw when rendering the correctly-redacted per-seat view', async () => {
    const tg = makeCardLeakGame();
    await expect(assertNoHiddenInfoLeak(tg, 1)).resolves.not.toThrow();
    await expect(assertNoHiddenInfoLeak(tg, 2)).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// POSITIVE CONTROL: deliberately-injected leak MUST be caught
// ---------------------------------------------------------------------------

describe('assertNoHiddenInfoLeak — positive control (proves the matcher is not a no-op)', () => {
  it('THROWS when rendering the fully unfiltered state (hidden identity leaks)', async () => {
    const tg = makeCardLeakGame();
    // Deliberately bypass toJSONForPlayer's redaction — the raw, unfiltered
    // state contains player 2's real card face image and name.
    const unfilteredView = tg.game.toJSON() as unknown as HiddenInfoGameView;

    await expect(
      assertNoHiddenInfoLeak(tg, 1, { gameViewOverride: unfilteredView }),
    ).rejects.toThrow(/hidden-info leak/i);
  });

  it('the thrown message names the leaked marker, owning element, and seat', async () => {
    const tg = makeCardLeakGame();
    const unfilteredView = tg.game.toJSON() as unknown as HiddenInfoGameView;

    let thrown: Error | undefined;
    try {
      await assertNoHiddenInfoLeak(tg, 1, { gameViewOverride: unfilteredView });
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain('FixtureCard');
    expect(thrown!.message).toContain('seat 1');
  });
});

// ---------------------------------------------------------------------------
// PLAYERVIEW BLIND-SPOT: an attribute stripped only by static playerView
// (element remains element-visible) is still treated as forbidden.
// ---------------------------------------------------------------------------

class AttrStripCard extends Card<PlayerViewStripGame> {
  rank!: string;
}

class PlayerViewStripGame extends Game<PlayerViewStripGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([AttrStripCard]);

    // All-visible zone: isVisibleTo is true for every seat. The static
    // playerView hook (below) strips $images.face for THIS card only,
    // even though the card element itself is not hidden.
    const display = this.create(Space, 'display');
    display.contentsVisible();
    const card = display.create(AttrStripCard, 'attr-strip-card', { rank: 'Q' });
    card.$images = { face: 'assets/face-attr-strip.png', back: 'assets/generic-back.png' };

    this.registerAction(
      Action.create<PlayerViewStripGame>('pass').execute(() => ({ success: true })),
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
    game: PlayerViewStripGame,
  ): ElementJSON => {
    const card = game.first(AttrStripCard, { name: 'attr-strip-card' });
    if (!card) return state;
    const clone = cloneJson(state);
    const node = findNodeById(clone, card.id);
    if (node?.attributes) {
      delete node.attributes.$images;
    }
    return clone;
  };
}

function makePlayerViewStripGame(): TestGame<PlayerViewStripGame> {
  return TestGame.create(PlayerViewStripGame, { playerCount: 2, seed: 'dom-leak-02' });
}

describe('assertNoHiddenInfoLeak — static playerView blind spot honored', () => {
  it('does NOT throw on the correctly-transformed (stripped) view', async () => {
    const tg = makePlayerViewStripGame();
    await expect(assertNoHiddenInfoLeak(tg, 1)).resolves.not.toThrow();
  });

  it('THROWS if the playerView-stripped face image is injected back into the render', async () => {
    const tg = makePlayerViewStripGame();
    const card = tg.game.first(AttrStripCard, { name: 'attr-strip-card' })!;

    // Simulate a bug where the stripped attribute leaked back into the
    // rendered view: re-inject $images.face into the ALREADY-transformed
    // (playerView-stripped) state.
    const leaky = cloneJson(tg.getPlayerView(1).state) as unknown as ElementJSON;
    const node = findNodeById(leaky, card.id);
    expect(node).toBeDefined();
    node!.attributes = {
      ...node!.attributes,
      $images: { face: 'assets/face-attr-strip.png', back: 'assets/generic-back.png' },
    };

    await expect(
      assertNoHiddenInfoLeak(tg, 1, {
        gameViewOverride: leaky as unknown as HiddenInfoGameView,
      }),
    ).rejects.toThrow(/hidden-info leak/i);
  });
});

// ---------------------------------------------------------------------------
// ALLOWLIST: a legitimate visible value overlapping a hidden marker is
// suppressed, while a real leak still fails.
// ---------------------------------------------------------------------------

describe('assertNoHiddenInfoLeak — allowlist suppresses a known false positive without masking real leaks', () => {
  it('a coincidental collision between a hidden rank and a visible element id false-positives WITHOUT an allowlist', async () => {
    const tg = makeCardLeakGame();

    // Force player 1's secret rank to collide with player 2's visible Hand
    // container id (data-bs-el-id / data-zone-id render that id in the DOM
    // even though the hand's CONTENTS are redacted) — a realistic
    // false-positive shape (RESEARCH Pitfall 3: short values colliding with
    // unrelated visible numbers).
    const p1Card = tg.game.first(FixtureCard, { name: '1-secret-card' })!;
    const p2Hand = tg.game.first(Hand, { name: 'hand-2' })!;
    p1Card.rank = String(p2Hand.id);

    await expect(assertNoHiddenInfoLeak(tg, 2)).rejects.toThrow(/hidden-info leak/i);
  });

  it('the allowlist predicate suppresses that exact false positive', async () => {
    const tg = makeCardLeakGame();
    const p1Card = tg.game.first(FixtureCard, { name: '1-secret-card' })!;
    const p2Hand = tg.game.first(Hand, { name: 'hand-2' })!;
    const collidingValue = String(p2Hand.id);
    p1Card.rank = collidingValue;

    await expect(
      assertNoHiddenInfoLeak(tg, 2, {
        allow: (marker, ctx) => marker === collidingValue && ctx.attribute === 'rank',
      }),
    ).resolves.not.toThrow();
  });

  it('the same allowlist predicate does NOT mask a real leak (unfiltered override still throws)', async () => {
    const tg = makeCardLeakGame();
    const p1Card = tg.game.first(FixtureCard, { name: '1-secret-card' })!;
    const p2Hand = tg.game.first(Hand, { name: 'hand-2' })!;
    const collidingValue = String(p2Hand.id);
    p1Card.rank = collidingValue;

    const unfilteredView = tg.game.toJSON() as unknown as HiddenInfoGameView;

    await expect(
      assertNoHiddenInfoLeak(tg, 2, {
        allow: (marker, ctx) => marker === collidingValue && ctx.attribute === 'rank',
        gameViewOverride: unfilteredView,
      }),
    ).rejects.toThrow(/hidden-info leak/i);
  });
});
