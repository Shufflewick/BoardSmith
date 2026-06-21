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
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
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

/**
 * Recursive guard (WR-01, iteration 2): collect every __hidden node's `id`.
 * Used to prove that anonymized zone placeholders never expose a real,
 * correlatable element id. The CR-01 fix anonymized owner-only zone ids; this
 * sweep makes a future regression (e.g. restoring `id: childJson.id`) fail
 * loudly instead of leaving the suite green.
 *
 * Returns every collected id paired with whether the node is a child of an
 * anonymized zone container (count-only / hidden / owner-only). Standalone
 * individually-hidden elements (WR-02) intentionally keep their real id, so
 * callers scope assertions to the anonymized-children surfaces.
 */
function collectHiddenIds(json: ElementJSON): number[] {
  const ids: number[] = [];
  if (json.attributes?.__hidden && typeof json.id === 'number') ids.push(json.id);
  for (const child of json.children ?? []) ids.push(...collectHiddenIds(child));
  return ids;
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
    const realCard = deck.create(TestCard, 'AS', {
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

    // CR-01 guard (WR-01): the placeholder id must be anonymized, never the
    // card's real, stable id (which would let a non-owner correlate the card
    // across moves/reveals). Anonymized zone ids are negative.
    expect(
      hiddenCard.id,
      'hidden deck placeholder id must be anonymized (negative)'
    ).toBeLessThan(0);
    expect(
      hiddenCard.id,
      'hidden deck placeholder id must not equal the real card id'
    ).not.toBe(realCard.id);

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
    const realCard = hand.create(TestCard, 'KH', {
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

    // CR-01 regression guard (WR-01): this is the exact iteration-1 CRITICAL
    // surface — an owner-only zone leaking a real, stable id to a non-owner.
    // The id must be anonymized (negative) and must not equal the real card id.
    // A future edit restoring `id: childJson.id` here would re-open CR-01;
    // this assertion makes that fail loudly.
    expect(
      hiddenCard.id,
      'owner-only placeholder id must be anonymized (negative) for a non-owner'
    ).toBeLessThan(0);
    expect(
      hiddenCard.id,
      'owner-only placeholder id must not equal the real card id (CR-01)'
    ).not.toBe(realCard.id);

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
    const realCard = countZone.create(TestCard, 'QD', {
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

    // CR-01 guard (WR-01): count-only placeholder id must be anonymized.
    expect(
      hiddenCard.id,
      'count-only placeholder id must be anonymized (negative)'
    ).toBeLessThan(0);
    expect(
      hiddenCard.id,
      'count-only placeholder id must not equal the real card id'
    ).not.toBe(realCard.id);

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

// ---------------------------------------------------------------------------
// WR-03: SAFE_LAYOUT_KEYS drift guard
//
// SAFE_LAYOUT_KEYS in game.ts is a hand-maintained allowlist of the layout
// $-keys emitted by the engine element classes. If a future element adds a new
// layout $-key but forgets to add it to the allowlist, redactHiddenElementAttrs
// would silently strip it from every hidden/owner/count-only placeholder —
// degrading face-down rendering with no error. This test makes that drift fail
// loudly by discovering the $-keys actually declared across the element classes
// and asserting each is either in the allowlist or a known value-bearing key
// (handled separately inside redactHiddenElementAttrs).
// ---------------------------------------------------------------------------

describe('WR-03: SAFE_LAYOUT_KEYS must stay in sync with engine layout $-keys', () => {
  // Value-bearing $-keys are intentionally NOT in SAFE_LAYOUT_KEYS — they are
  // redacted/narrowed by dedicated logic in redactHiddenElementAttrs.
  const VALUE_BEARING_KEYS = new Set(['$image', '$images']);

  // This test file lives in the same directory as the engine element classes.
  const elementDir = fileURLToPath(new URL('.', import.meta.url));

  function discoverDeclaredDollarKeys(): Set<string> {
    const files = readdirSync(elementDir).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts')
    );
    // Class field declarations: `  $foo!: T`, `  $foo?: T`, `  readonly $foo: T`
    const fieldRe = /^\s*(?:readonly\s+)?(\$[a-zA-Z][a-zA-Z0-9]*)\s*[!?]?\s*:/gm;
    // Constructor assignments: `this.$foo = ...`
    const assignRe = /this\.(\$[a-zA-Z][a-zA-Z0-9]*)\s*=/g;
    const keys = new Set<string>();
    for (const f of files) {
      const src = readFileSync(join(elementDir, f), 'utf-8');
      for (const m of src.matchAll(fieldRe)) keys.add(m[1]);
      for (const m of src.matchAll(assignRe)) keys.add(m[1]);
    }
    return keys;
  }

  function parseSafeLayoutKeys(): Set<string> {
    const src = readFileSync(join(elementDir, 'game.ts'), 'utf-8');
    const block = src.match(/const SAFE_LAYOUT_KEYS = new Set\(\[([\s\S]*?)\]\)/);
    expect(block, 'SAFE_LAYOUT_KEYS Set literal must exist in game.ts').not.toBeNull();
    const keys = [...block![1].matchAll(/['"](\$[a-zA-Z][a-zA-Z0-9]*)['"]/g)].map((m) => m[1]);
    return new Set(keys);
  }

  it('every layout $-key declared in the element classes is present in SAFE_LAYOUT_KEYS', () => {
    const declared = discoverDeclaredDollarKeys();
    const allowlist = parseSafeLayoutKeys();

    // Sanity: the scan must actually find keys, otherwise the guard is vacuous.
    expect(declared.size, 'expected to discover layout $-keys in element classes').toBeGreaterThan(0);

    const missing = [...declared].filter(
      (k) => !allowlist.has(k) && !VALUE_BEARING_KEYS.has(k)
    );

    expect(
      missing,
      `These layout $-keys are emitted by element classes but missing from ` +
        `SAFE_LAYOUT_KEYS (game.ts). They will be silently stripped from hidden ` +
        `placeholders. Add them to SAFE_LAYOUT_KEYS (or handle them as value-bearing): ` +
        `${missing.join(', ')}`
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// WR-01: placeholder-id anonymization guard (the CR-01 fix is unguarded)
//
// CR-01 (iteration 1) was an owner-only zone leaking a real, stable element
// id, letting a non-owner correlate a face-down card across moves/reveals.
// The fix anonymizes zone-child ids to negative, position-based values, but no
// test asserted anything about ids — every prior assertion walked `attributes`.
// These tests close that gap so a future edit restoring a real id fails loudly.
// ---------------------------------------------------------------------------

describe('WR-01: anonymized zone placeholders must never expose a real element id', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
  });

  it('cross-surface guard: every __hidden zone-child id in the full player view is anonymized (negative)', () => {
    // Fixture covers all three anonymized-zone surfaces (hidden deck,
    // owner-only hand, count-only zone). None of the CONTAINERS are __hidden —
    // only their fungible children — so every __hidden node collected here is
    // an anonymized placeholder and MUST carry a negative id.
    const deck = game.create(Deck, 'guard-deck');
    deck.contentsHidden();
    deck.create(TestCard, 'AS', {
      rank: 'A',
      suit: 'S',
      $images: { face: '/cards/AS.svg', back: '/cards/back.svg' },
    });

    const hand = game.create(Hand, 'guard-hand');
    hand.player = game.getPlayer(1)!;
    hand.contentsVisibleToOwner();
    hand.create(TestCard, 'KH', {
      rank: 'K',
      suit: 'H',
      $images: { face: '/cards/KH.svg', back: '/cards/back.svg' },
    });

    const countZone = game.create(Space, 'guard-count');
    countZone.contentsCountOnly();
    countZone.create(TestCard, 'QD', {
      rank: 'Q',
      suit: 'D',
      $images: { face: '/cards/QD.svg', back: '/cards/back.svg' },
    });

    const view = game.toJSONForPlayer(2);
    const hiddenIds = collectHiddenIds(view);

    // One placeholder per fixture surface.
    expect(
      hiddenIds.length,
      'expected one __hidden placeholder per anonymized-zone surface'
    ).toBeGreaterThanOrEqual(3);

    for (const id of hiddenIds) {
      expect(
        id,
        `every anonymized-zone placeholder id must be negative, found ${id}`
      ).toBeLessThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// WR-02: standalone individually-hidden element keeps its real, stable id
//
// This LOCKS IN the iteration-2 accept decision (see the documenting comment in
// game.ts at the standalone hidden-placeholder branch). A single element hidden
// via hideFromAll() while sitting in a VISIBLE parent intentionally retains its
// real id so the FLIP animation layer (useFlyingElements.ts) can correlate the
// hidden↔visible transition by id and animate the flip. If a future change
// anonymizes this branch, this test fails and forces a deliberate re-decision
// (which would also need to revisit the animation requirement).
// ---------------------------------------------------------------------------

describe('WR-02: standalone hidden element retains a stable id for animation', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
  });

  it('a hideFromAll() card in a visible parent keeps its real id when hidden from a non-viewer', () => {
    // Visible parent (default visibility), single individually-hidden card.
    const table = game.create(Space, 'table');
    const realCard = table.create(TestCard, 'AS', {
      rank: 'A',
      suit: 'S',
      $images: { face: '/cards/AS.svg', back: '/cards/back.svg' },
    });
    realCard.hideFromAll();

    const view = game.toJSONForPlayer(2);
    const tableJson = findByName(view.children, 'table');
    expect(tableJson, 'visible table must appear in player-2 view').toBeDefined();

    const placeholder = tableJson!.children![0];
    expect(placeholder, 'table must contain the hidden card placeholder').toBeDefined();
    expect(placeholder.attributes.__hidden).toBe(true);

    // Intentional: the standalone hidden placeholder keeps the real, stable id
    // (positive) so the FLIP animation can track it across hidden↔visible.
    expect(
      placeholder.id,
      'standalone hidden element must retain its real (positive) id for animation'
    ).toBe(realCard.id);
    expect(placeholder.id).toBeGreaterThan(0);

    // It must still be redacted: no identity-bearing image leaks through.
    expect(
      (placeholder.attributes.$images as Record<string, unknown> | undefined)?.face,
      'standalone hidden element must not leak $images.face'
    ).toBeUndefined();
  });
});
