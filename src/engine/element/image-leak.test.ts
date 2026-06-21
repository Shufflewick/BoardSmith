/**
 * SEC-01/SEC-02: Image ref redaction in toJSONForPlayer — RED (currently failing)
 *
 * This file proves the information leak BEFORE the fix (Plan 91-02).
 * All assertions here express the CORRECT post-fix contract. They FAIL on the
 * current unfixed code because toJSONForPlayer copies $images verbatim via a
 * blanket key.startsWith('$') guard, sending face image refs to unauthorized viewers.
 *
 * Three leaking surfaces under test:
 *   1. contentsHidden() deck children  (game.ts:2244-2258 anonymous loop)
 *   2. contentsVisibleToOwner() hand children for non-owner  (game.ts:2265-2287 anonymous loop)
 *   3. contentsCountOnly() zone children  (game.ts:2236 / same anonymous loop as #1)
 *
 * SEC-02 additions: unknown $-key fail-safe drop + $image single-sided drop.
 *
 * Plan 02 turns this file green by adding redactHiddenElementAttrs().
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Game, Card, Deck, Hand, Space, Player, type ElementJSON } from '../index.js';

// ---------------------------------------------------------------------------
// Test fixture types
// ---------------------------------------------------------------------------

class TestGame extends Game<TestGame, Player> {}

class TestCard extends Card<TestGame> {
  rank!: string;
  suit!: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findByName(children: ElementJSON[] | undefined, name: string): ElementJSON | undefined {
  return children?.find((c) => c.name === name);
}

/**
 * Recursive regression guard (SEC-02): collect every attributes object where
 * __hidden is true from the entire player view tree.
 */
function collectAllHiddenAttrs(json: ElementJSON): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  if (json.attributes?.__hidden) {
    result.push(json.attributes);
  }
  for (const child of json.children ?? []) {
    result.push(...collectAllHiddenAttrs(child));
  }
  return result;
}

// ---------------------------------------------------------------------------
// SEC-01: $images.face redaction
// ---------------------------------------------------------------------------

describe('SEC-01: toJSONForPlayer must redact $images.face on hidden elements (RED)', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
  });

  // -------------------------------------------------------------------------
  // Surface 1: contentsHidden() deck children
  // -------------------------------------------------------------------------

  it('hidden deck child: $images.face must be absent; $images.back must survive', () => {
    const deck = game.create(Deck, 'draw-pile');
    // Deck defaults to contentsHidden(), but make it explicit for clarity.
    deck.contentsHidden();
    deck.create(TestCard, 'AS', {
      rank: 'A',
      suit: 'S',
      $images: { face: '/cards/AS.svg', back: '/cards/back.svg' },
    });

    const view = game.toJSONForPlayer(2);
    const deckJson = findByName(view.children, 'draw-pile');
    expect(deckJson, 'draw-pile container must appear in player-2 view').toBeDefined();

    const hiddenCard = deckJson!.children![0];
    expect(hiddenCard, 'hidden deck must have at least one child placeholder').toBeDefined();

    // Must be marked hidden so the UI knows not to render card details.
    expect(hiddenCard.attributes.__hidden).toBe(true);

    // RED: face is currently leaked via key.startsWith('$') — this assertion FAILS.
    expect(
      (hiddenCard.attributes.$images as Record<string, unknown> | undefined)?.face,
      '$images.face must be undefined on a hidden deck card'
    ).toBeUndefined();

    // Back MUST survive so the renderer can draw a face-down card graphic.
    // (A fix that drops ALL of $images would break back-of-card rendering — Pitfall 2.)
    expect(
      (hiddenCard.attributes.$images as Record<string, unknown> | undefined)?.back,
      '$images.back must be preserved for hidden card rendering'
    ).toBe('/cards/back.svg');

    // $type must survive for AutoUI renderer dispatch.
    expect(hiddenCard.attributes.$type).toBe('card');
  });

  // -------------------------------------------------------------------------
  // Surface 2: contentsVisibleToOwner() hand — non-owner viewer (Pitfall 4)
  // -------------------------------------------------------------------------

  it('owner-only hand child: non-owner must NOT receive $images.face', () => {
    const hand = game.create(Hand, 'hand-p1');
    hand.player = game.getPlayer(1)!;
    // Hand defaults to contentsVisibleToOwner(); call explicitly for clarity.
    hand.contentsVisibleToOwner();
    hand.create(TestCard, 'KH', {
      rank: 'K',
      suit: 'H',
      $images: { face: '/cards/KH.svg', back: '/cards/back.svg' },
    });

    // Player 2 cannot see player 1's hand.
    const view = game.toJSONForPlayer(2);
    const handJson = findByName(view.children, 'hand-p1');
    expect(handJson, 'hand-p1 must appear in player-2 view').toBeDefined();

    const hiddenCard = handJson!.children![0];
    expect(hiddenCard, 'hand must have at least one child placeholder').toBeDefined();

    expect(hiddenCard.attributes.__hidden).toBe(true);

    // RED: face is currently leaked — this assertion FAILS.
    expect(
      (hiddenCard.attributes.$images as Record<string, unknown> | undefined)?.face,
      '$images.face must be undefined when non-owner views an owner-only hand card'
    ).toBeUndefined();

    // Back must survive.
    expect(
      (hiddenCard.attributes.$images as Record<string, unknown> | undefined)?.back,
      '$images.back must be preserved for hidden hand card rendering'
    ).toBe('/cards/back.svg');
  });

  it('owner-only hand: owner DOES see $images.face (contract sanity check)', () => {
    const hand = game.create(Hand, 'hand-p1');
    hand.player = game.getPlayer(1)!;
    hand.contentsVisibleToOwner();
    hand.create(TestCard, 'KH', {
      rank: 'K',
      suit: 'H',
      $images: { face: '/cards/KH.svg', back: '/cards/back.svg' },
    });

    // Player 1 IS the owner — must see both sides.
    const ownerView = game.toJSONForPlayer(1);
    const handJson = findByName(ownerView.children, 'hand-p1')!;
    const visibleCard = handJson.children![0];

    // Owner card must NOT be marked hidden.
    expect(visibleCard.attributes.__hidden).toBeUndefined();

    // Owner must see face.
    expect(
      (visibleCard.attributes.$images as Record<string, unknown> | undefined)?.face
    ).toBe('/cards/KH.svg');
  });

  // -------------------------------------------------------------------------
  // Surface 3: contentsCountOnly() zone children (Pitfall 1)
  // -------------------------------------------------------------------------

  it('count-only zone child: $images.face must be absent; $images.back must survive', () => {
    // A Space with count-only visibility: viewers see the count but not which elements.
    const countZone = game.create(Space, 'count-pile');
    countZone.contentsCountOnly();
    countZone.create(TestCard, 'QD', {
      rank: 'Q',
      suit: 'D',
      $images: { face: '/cards/QD.svg', back: '/cards/back.svg' },
    });

    const view = game.toJSONForPlayer(2);
    const zoneJson = findByName(view.children, 'count-pile');
    expect(zoneJson, 'count-pile must appear in player-2 view').toBeDefined();

    // count-only zones expose children as anonymous placeholders.
    const hiddenCard = zoneJson!.children![0];
    expect(hiddenCard, 'count-only zone must have at least one child placeholder').toBeDefined();

    expect(hiddenCard.attributes.__hidden).toBe(true);

    // RED: face is currently leaked in the count-only anonymous loop — FAILS.
    expect(
      (hiddenCard.attributes.$images as Record<string, unknown> | undefined)?.face,
      '$images.face must be undefined on a count-only zone child'
    ).toBeUndefined();

    // Back must survive.
    expect(
      (hiddenCard.attributes.$images as Record<string, unknown> | undefined)?.back,
      '$images.back must be preserved for count-only zone child rendering'
    ).toBe('/cards/back.svg');
  });
});

// ---------------------------------------------------------------------------
// SEC-02: $-key allowlist + fail-safe drop + $image single-sided drop
// ---------------------------------------------------------------------------

describe('SEC-02: unknown $-keys and $image must be fail-safe dropped on hidden elements (RED)', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
  });

  it('safe layout keys survive; unknown $-key and $image are dropped on hidden elements', () => {
    const deck = game.create(Deck, 'mixed-deck');
    deck.contentsHidden();

    // Create a card carrying:
    //   • $type (safe — set by Card constructor)
    //   • $direction (safe layout descriptor from the allowlist)
    //   • $image (identity-bearing single-sided — must be DROPPED, Pitfall 3)
    //   • $secretValue (unknown future $-key — must be DROPPED, fail-safe)
    deck.create(TestCard, 'SECRET', {
      rank: 'A',
      suit: 'S',
      $image: '/cards/AS.svg',
      $direction: 'horizontal',
      $secretValue: 'leak-me',
    } as any);

    const view = game.toJSONForPlayer(2);
    const deckJson = findByName(view.children, 'mixed-deck')!;
    const hiddenCard = deckJson.children![0];

    expect(hiddenCard.attributes.__hidden).toBe(true);

    // Safe layout keys: must survive on hidden elements.
    expect(
      hiddenCard.attributes.$type,
      '$type (safe layout key) must survive on hidden elements'
    ).toBe('card');
    expect(
      hiddenCard.attributes.$direction,
      '$direction (safe layout key) must survive on hidden elements'
    ).toBe('horizontal');

    // $image: identity-bearing single-sided image — must be DROPPED (Pitfall 3).
    // RED: currently present via the blanket key.startsWith('$') copy — FAILS.
    expect(
      hiddenCard.attributes.$image,
      '$image must be absent on hidden elements (single-sided images reveal identity)'
    ).toBeUndefined();

    // Unknown $-key: fail-safe drop — must NOT leak to unauthorized viewers.
    // RED: currently present — FAILS.
    expect(
      (hiddenCard.attributes as any).$secretValue,
      '$secretValue (unknown $-key) must be absent on hidden elements (fail-safe)'
    ).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Regression guard: sweep the WHOLE player-2 view
  // -------------------------------------------------------------------------

  it('regression guard: no $images.face or $image on ANY __hidden element in the full player view', () => {
    // Build a fixture covering all three hidden surfaces so the guard sweeps all of them.
    const deck = game.create(Deck, 'guard-deck');
    deck.contentsHidden();
    deck.create(TestCard, 'AS', {
      rank: 'A',
      suit: 'S',
      $images: { face: '/cards/AS.svg', back: '/cards/back.svg' },
      $image: '/cards/AS-single.svg',
    } as any);

    const hand = game.create(Hand, 'guard-hand');
    hand.player = game.getPlayer(1)!;
    hand.contentsVisibleToOwner();
    hand.create(TestCard, 'KH', {
      rank: 'K',
      suit: 'H',
      $images: { face: '/cards/KH.svg', back: '/cards/back.svg' },
      $image: '/cards/KH-single.svg',
    } as any);

    const countZone = game.create(Space, 'guard-count');
    countZone.contentsCountOnly();
    countZone.create(TestCard, 'QD', {
      rank: 'Q',
      suit: 'D',
      $images: { face: '/cards/QD.svg', back: '/cards/back.svg' },
    });

    // Walk every __hidden attributes object in the full player-2 view.
    const view = game.toJSONForPlayer(2);
    const allHiddenAttrs = collectAllHiddenAttrs(view);

    // There must be at least one hidden element per fixture surface.
    expect(allHiddenAttrs.length).toBeGreaterThanOrEqual(3);

    for (const attrs of allHiddenAttrs) {
      const images = attrs.$images as Record<string, unknown> | undefined;

      // RED: $images.face is currently present on all surfaces — FAILS.
      expect(
        images?.face,
        `$images.face must be absent on every __hidden element (found on: ${JSON.stringify(attrs)})`
      ).toBeUndefined();

      // RED: $image is currently present — FAILS.
      expect(
        attrs.$image,
        `$image must be absent on every __hidden element (found on: ${JSON.stringify(attrs)})`
      ).toBeUndefined();
    }
  });
});
