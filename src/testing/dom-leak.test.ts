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
  Piece,
  HexGrid,
  HexCell,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
  type ElementJSON,
} from '../engine/index.js';
import { TestGame } from './test-game.js';
import { assertNoHiddenInfoLeak, renderAsSeat, type HiddenInfoGameView } from './dom-leak.js';

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

// ---------------------------------------------------------------------------
// CR-01: a leak through a text-bearing accessibility/metadata attribute
// (aria-label/alt/title) — NOT through data-*/img[src]/inline style — MUST
// still be caught. `CardRenderer.vue`'s `ariaLabel`/`displayLabel` computeds
// read `element.name` unconditionally (regardless of `__hidden`), so a
// redaction bug that fails to strip `name` from an individually-hidden
// element's placeholder (stable id, per game.ts's FLIP-animation branch)
// would render the real name straight into aria-label/alt/title while every
// other scanned surface (data-*, img[src], style) stays clean.
// ---------------------------------------------------------------------------

class HiddenCard extends Card<AriaLeakGame> {
  rank!: string;
}

class AriaLeakGame extends Game<AriaLeakGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([HiddenCard]);

    // All-visible zone; the card itself is individually hidden from seat 2
    // via showOnlyTo(1) -- keeps its stable id (game.ts's FLIP-animation
    // branch), which is what makes the injection below possible.
    const table = this.create(Space, 'aria-table');
    table.contentsVisible();
    const card = table.create(HiddenCard, 'aria-secret-card', { rank: 'A' });
    card.showOnlyTo(1);

    this.registerAction(
      Action.create<AriaLeakGame>('pass').execute(() => ({ success: true })),
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

function makeAriaLeakGame(): TestGame<AriaLeakGame> {
  return TestGame.create(AriaLeakGame, { playerCount: 2, seed: 'dom-leak-aria-01' });
}

describe('assertNoHiddenInfoLeak — CR-01 regression: aria-label/alt/title surfaces are scanned', () => {
  it('does NOT throw on the correctly-redacted view (name absent from the hidden placeholder)', async () => {
    const tg = makeAriaLeakGame();
    await expect(assertNoHiddenInfoLeak(tg, 2)).resolves.not.toThrow();
  });

  it('THROWS when a hidden element leaks its identity ONLY via aria-label/alt/title (not data-*/img-src/style)', async () => {
    const tg = makeAriaLeakGame();
    const card = tg.game.first(HiddenCard, { name: 'aria-secret-card' })!;

    // Simulate a redaction bug: the correctly-redacted per-seat view
    // (attributes/$images already stripped, __hidden: true) but `name` is
    // re-injected onto the hidden placeholder -- e.g. a renderer computing
    // aria-label from a source that bypasses the engine's redaction.
    const leaky = cloneJson(tg.getPlayerView(2).state) as unknown as ElementJSON;
    const node = findNodeById(leaky, card.id);
    expect(node).toBeDefined();
    expect(node!.attributes?.__hidden).toBe(true);
    node!.name = card.name;

    await expect(
      assertNoHiddenInfoLeak(tg, 2, { gameViewOverride: leaky as unknown as HiddenInfoGameView }),
    ).rejects.toThrow(/hidden-info leak/i);
  });
});

// ---------------------------------------------------------------------------
// WR-03: an actionable error, not a generic "document is not defined", when
// renderAsSeat/assertNoHiddenInfoLeak are called outside a jsdom environment.
// This file itself runs under jsdom (`// @vitest-environment jsdom`, line 1)
// so `document` is temporarily removed to simulate a caller's non-jsdom test
// file (Node's default vitest environment).
// ---------------------------------------------------------------------------

describe('renderAsSeat / assertNoHiddenInfoLeak — WR-03: actionable error outside jsdom', () => {
  it('renderAsSeat throws an actionable error (not "document is not defined") when document is undefined', async () => {
    const tg = makeCardLeakGame();
    const originalDocument = globalThis.document;
    // @ts-expect-error -- deliberately simulating a non-DOM environment
    delete globalThis.document;
    try {
      await expect(renderAsSeat(tg, 1)).rejects.toThrow(/@vitest-environment jsdom/);
    } finally {
      globalThis.document = originalDocument;
    }
  });

  it('assertNoHiddenInfoLeak throws the same actionable error when document is undefined', async () => {
    const tg = makeCardLeakGame();
    const unfilteredView = tg.game.toJSON() as unknown as HiddenInfoGameView;
    const originalDocument = globalThis.document;
    // @ts-expect-error -- deliberately simulating a non-DOM environment
    delete globalThis.document;
    try {
      await expect(
        assertNoHiddenInfoLeak(tg, 1, { gameViewOverride: unfilteredView }),
      ).rejects.toThrow(/@vitest-environment jsdom/);
    } finally {
      globalThis.document = originalDocument;
    }
  });
});

// ---------------------------------------------------------------------------
// IN-01: an allowlist predicate broad enough to suppress EVERY forbidden
// marker makes the assertion a silent no-op -- fail loud instead.
// ---------------------------------------------------------------------------

describe('assertNoHiddenInfoLeak — IN-01: over-broad allowlist that masks every marker fails loud', () => {
  it('throws an actionable error when the allow predicate filters out all forbidden markers', async () => {
    const tg = makeCardLeakGame();

    await expect(
      assertNoHiddenInfoLeak(tg, 2, {
        // Deliberately over-broad: matches everything, masking every marker.
        allow: () => true,
      }),
    ).rejects.toThrow(/allowlist masked every marker/i);
  });
});

// ---------------------------------------------------------------------------
// TOOL-04 (D20): symmetric-deck leak detection. `assertNoHiddenInfoLeak`
// derives markers carrying `elementId` (`deriveForbiddenMarkers`) but, prior
// to the fix, matches them by a bare `surface.includes(marker.value)`
// substring test that ignores `elementId` entirely — so two elements sharing
// the same `name` are indistinguishable. A hidden card and a legitimately
// visible SAME-NAMED sibling collide: the visible sibling's own rendered
// identity false-positives as a "leak" of the hidden card's identity.
// ---------------------------------------------------------------------------

class SymmetricCard extends Card<SymmetricDeckGame> {}

class SymmetricDeckGame extends Game<SymmetricDeckGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([SymmetricCard]);

    // Visible sibling: an all-visible table card named "Ace" — legitimately
    // on screen for every seat.
    const table = this.create(Space, 'table');
    table.contentsVisible();
    table.create(SymmetricCard, 'Ace');

    // Hidden sibling: seat 2's own-hand card, ALSO named "Ace" (symmetric
    // deck — identical name, different identity/element).
    const player2 = this.all(Player).find((p) => p.seat === 2)!;
    const hand2 = this.create(Hand, 'hand-2');
    hand2.player = player2;
    hand2.create(SymmetricCard, 'Ace');

    this.registerAction(
      Action.create<SymmetricDeckGame>('pass').execute(() => ({ success: true })),
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

function makeSymmetricDeckGame(): TestGame<SymmetricDeckGame> {
  return TestGame.create(SymmetricDeckGame, { playerCount: 2, seed: 'dom-leak-symmetric-01' });
}

describe('assertNoHiddenInfoLeak — TOOL-04 (D20): symmetric-deck (identical-named) siblings', () => {
  it('does NOT false-positive on the visible sibling when only its own "Ace" is on screen', async () => {
    const tg = makeSymmetricDeckGame();
    // Seat 1 sees the table's visible "Ace" (its own identity) and seat 2's
    // hand is correctly redacted (hidden "Ace" absent from the rendered
    // tree). A name-only matcher can't tell the visible "Ace" apart from the
    // hidden "Ace" marker and mis-fires; an elementId-keyed matcher must not.
    await expect(assertNoHiddenInfoLeak(tg, 1)).resolves.not.toThrow();
  });

  it('still reports a leak when the hidden "Ace" itself is actually rendered', async () => {
    const tg = makeSymmetricDeckGame();
    // Deliberately bypass toJSONForPlayer's redaction — the raw, unfiltered
    // state renders BOTH "Ace" cards, including the real hidden one under
    // its own element id.
    const unfilteredView = tg.game.toJSON() as unknown as HiddenInfoGameView;

    await expect(
      assertNoHiddenInfoLeak(tg, 1, { gameViewOverride: unfilteredView }),
    ).rejects.toThrow(/hidden-info leak/i);
  });
});

// ---------------------------------------------------------------------------
// Task 3 adversarial: try to DEFEAT the D20 elementId-keyed fix. Proves
// elementId-keying is not a blanket "same value elsewhere is fine" hole —
// a real leak owned by the HIDDEN element's own id must still throw, and a
// leak surface that can't be attributed to any specific element (no
// `data-element-id` ancestor at all) must still throw via the conservative
// fallback (T-162-04).
// ---------------------------------------------------------------------------

class AdversarialCard extends Card<AdversarialSymmetricGame> {}

class AdversarialSymmetricGame extends Game<AdversarialSymmetricGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([AdversarialCard]);

    // Two same-named "Ace" cards in the SAME all-visible zone: one stays
    // genuinely visible to every seat; the other is individually hidden
    // from seat 1 via `showOnlyTo` (which keeps a STABLE placeholder id in
    // the redacted tree, per game.ts's FLIP-animation branch) — the
    // precondition for injecting a leak under the hidden card's own id.
    const table = this.create(Space, 'adversarial-table');
    table.contentsVisible();
    table.create(AdversarialCard, 'Ace');
    const secret = table.create(AdversarialCard, 'Ace');
    secret.showOnlyTo(2);

    this.registerAction(
      Action.create<AdversarialSymmetricGame>('pass').execute(() => ({ success: true })),
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

function makeAdversarialSymmetricGame(): TestGame<AdversarialSymmetricGame> {
  return TestGame.create(AdversarialSymmetricGame, {
    playerCount: 2,
    seed: 'dom-leak-adversarial-01',
  });
}

describe('assertNoHiddenInfoLeak — Task 3 adversarial: elementId-keying cannot be defeated', () => {
  it('a real leak forced into a surface owned by the HIDDEN card\'s own element id STILL throws', async () => {
    const tg = makeAdversarialSymmetricGame();
    const cards = tg.game.all(AdversarialCard);
    const secret = cards.find((c) => !c.isVisibleTo(1))!;
    expect(secret).toBeDefined();

    // Start from the correctly-redacted seat-1 view (name absent from the
    // hidden placeholder), then re-inject the real name onto the hidden
    // card's OWN node id — exactly what a renderer bug that bypasses
    // redaction would produce.
    const leaky = cloneJson(tg.getPlayerView(1).state) as unknown as ElementJSON;
    const node = findNodeById(leaky, secret.id);
    expect(node).toBeDefined();
    expect(node!.attributes?.__hidden).toBe(true);
    node!.name = secret.name;

    await expect(
      assertNoHiddenInfoLeak(tg, 1, { gameViewOverride: leaky as unknown as HiddenInfoGameView }),
    ).rejects.toThrow(/hidden-info leak/i);
  });

  it('a leak surface that cannot be attributed to any element (no data-element-id ancestor) STILL throws via the conservative fallback', async () => {
    const tg = makeCardLeakGame();
    const p1Card = tg.game.first(FixtureCard, { name: '1-secret-card' })!;
    const p2Hand = tg.game.first(Hand, { name: 'hand-2' })!;

    // `Hand` containers render `data-bs-el-id` (anchorAttrs) but NEVER their
    // own `data-element-id` (only CardRenderer/PieceRenderer/DieRenderer/
    // SpaceRenderer do), and a Hand created directly under the game root has
    // no `data-element-id` ancestor either — so this collision surface is
    // genuinely un-attributed. Forcing player 1's hidden rank to collide
    // with player 2's visible Hand container id proves the fallback still
    // scans un-attributed surfaces against every marker rather than
    // silently dropping them (an elementId-scoped-only matcher with no
    // fallback would miss this).
    p1Card.rank = String(p2Hand.id);

    await expect(assertNoHiddenInfoLeak(tg, 2)).rejects.toThrow(/hidden-info leak/i);
  });
});

// ---------------------------------------------------------------------------
// CR-01: AGGREGATION — a hidden PIECE's identity leaks not through its OWN
// surface but through an ANCESTOR's aggregated markup (HexBoardRenderer.vue's
// hexCellAriaLabel/<title> fold occupant piece names into the CELL's
// aria-label and each piece's own <title>). The cell (and everything inside
// the hex board) carries no `data-element-id` of its own -- only the
// enclosing top-level Space does (SpaceRenderer.vue) -- so a surface deep
// inside the hex board gets attributed (via findOwningElementId's ancestor
// walk) to that ENCLOSING SPACE's id, never to the piece's own id. A matcher
// that blanket-skips "surface owner != marker.elementId" treats that as a
// same-valued sibling's own legitimate identity and drops the check --
// exactly the false negative CR-01 describes. The fix must still catch this
// because the enclosing Space's OWN legitimate identity (its own name) does
// not explain the piece's name appearing on that surface.
// ---------------------------------------------------------------------------

class AggregationPiece extends Piece<HexAggregationGame> {}

class AggregationHexCell extends HexCell<HexAggregationGame> {
  q!: number;
  r!: number;
}

class HexAggregationGame extends Game<HexAggregationGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([AggregationPiece, AggregationHexCell]);

    // Top-level, all-visible Space wrapping the hex board -- this is the ONLY
    // element in the subtree that ends up with `data-element-id` (SpaceRenderer
    // stamps it on the Space container; HexBoardRenderer's cells/pieces never
    // carry `data-element-id`, only `data-bs-el-id` via anchorAttrs).
    const boardSpace = this.create(Space, 'board-space');
    boardSpace.contentsVisible();

    const hexGrid = boardSpace.create(HexGrid, 'hex-grid');
    hexGrid.contentsVisible();

    const cell = hexGrid.create(AggregationHexCell, 'cell-0-0', { q: 0, r: 0 });
    cell.contentsVisible();

    // The occupant piece is individually hidden from seat 2 (showOnlyTo keeps
    // a stable placeholder id -- game.ts's FLIP-animation branch -- with
    // `name` dropped from the redacted node).
    const piece = cell.create(AggregationPiece, 'SecretScout');
    piece.showOnlyTo(1);

    this.registerAction(
      Action.create<HexAggregationGame>('pass').execute(() => ({ success: true })),
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

function makeHexAggregationGame(): TestGame<HexAggregationGame> {
  return TestGame.create(HexAggregationGame, { playerCount: 2, seed: 'dom-leak-hex-agg-01' });
}

describe('assertNoHiddenInfoLeak — CR-01 regression: aggregation leak (hidden piece name folded into an ancestor cell/Space surface)', () => {
  it('does NOT throw on the correctly-redacted view (piece name absent from the hidden placeholder)', async () => {
    const tg = makeHexAggregationGame();
    await expect(assertNoHiddenInfoLeak(tg, 2)).resolves.not.toThrow();
  });

  it('THROWS when the hidden piece leaks its name ONLY via the aggregating cell/Space surface (aria-label/title), not via its own owned surface', async () => {
    const tg = makeHexAggregationGame();
    const piece = tg.game.first(AggregationPiece, { name: 'SecretScout' })!;

    // Simulate a redaction bug: start from the correctly-redacted seat-2 view
    // (name absent from the hidden placeholder) and re-inject the real name
    // onto the hidden piece's OWN node id -- exactly what a renderer
    // computing hexCellAriaLabel/<title> from a source that bypasses
    // redaction would produce. The resulting leak surfaces on the CELL's
    // aria-label and the piece's own <title>, neither of which carries
    // `data-element-id` -- only the enclosing Space does.
    const leaky = cloneJson(tg.getPlayerView(2).state) as unknown as ElementJSON;
    const node = findNodeById(leaky, piece.id);
    expect(node).toBeDefined();
    expect(node!.attributes?.__hidden).toBe(true);
    node!.name = piece.name;

    await expect(
      assertNoHiddenInfoLeak(tg, 2, { gameViewOverride: leaky as unknown as HiddenInfoGameView }),
    ).rejects.toThrow(/hidden-info leak/i);
  });
});
