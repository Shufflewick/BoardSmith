/**
 * VIS-02: `diffPlayerViews` — per-seat view diffing.
 *
 * Verifies that:
 * (1) An owner-only hand card visible to exactly one seat is reported as
 *     onlyInA/onlyInB (never double-counted as removed+added, per the
 *     stable-id individually-hidden branch).
 * (2) An identical-count fully-hidden zone (fresh synthetic ids per call)
 *     produces NO spurious onlyInA/onlyInB entries and NO attributeDiffs.
 * (3) A standalone individually-hidden element (stable positive id) sitting
 *     in an otherwise-visible parent is reported exactly once, on the
 *     correct side, never duplicated on both.
 * (4) A `static playerView` hook that injects a per-seat-different attribute
 *     on a shared, both-visible node surfaces as a real attributeDiff (no
 *     playerView blind spot).
 * (5) `describe()` renders a readable multi-line summary of the three
 *     buckets.
 *
 * Cross-layer boundary: testing -> engine (Game.toJSONForPlayer / playerView) -> runtime (PlayerStateView)
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
import { diffPlayerViews } from './view-diff.js';

class DiffCard extends Card<DiffGame> {
  rank!: string;
}

/**
 * Fixture exercising both hidden-element id shapes in one game:
 * - hand-1 / hand-2: owner-only zones (contentsVisibleToOwner) -- each
 *   seat's own hand is visible only to them, the other sees an anonymized
 *   (fresh synthetic negative id) placeholder.
 * - table: all-visible zone containing `shared-card`, individually hidden
 *   from seat 2 via `showOnlyTo(1)` -- keeps its stable, real (positive) id
 *   on both sides (WR-02), toggling only its `__hidden` flag per seat.
 * - deck: fully hidden zone (contentsHidden) with two cards -- both seats
 *   see identical-count anonymized placeholders with fresh synthetic ids.
 *
 * `static playerView` further annotates the (both-visible) `table` node with
 * a per-seat-different `viewerNote` attribute, so the diff's attributeDiffs
 * path is exercised on a node BOTH seats can see, and proven to honor the
 * post-transform (no playerView blind spot).
 */
class DiffGame extends Game<DiffGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([DiffCard]);

    for (const player of this.all(Player)) {
      const hand = this.create(Space, `hand-${player.seat}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      hand.create(DiffCard, `hand-card-${player.seat}`, {
        rank: player.seat === 1 ? 'A' : 'K',
      });
    }

    const table = this.create(Space, 'table');
    table.contentsVisible();
    const sharedCard = table.create(DiffCard, 'shared-card', { rank: 'Q' });
    sharedCard.showOnlyTo(1);

    const deck = this.create(Space, 'deck');
    deck.contentsHidden();
    deck.create(DiffCard, 'deck-card-1', { rank: '2' });
    deck.create(DiffCard, 'deck-card-2', { rank: '3' });

    this.registerAction(Action.create<DiffGame>('pass').execute(() => ({ success: true })));

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
    playerSeat: number | null,
    _game: DiffGame,
  ): ElementJSON => {
    const annotate = (node: ElementJSON): ElementJSON => {
      if (node.name === 'table') {
        return { ...node, attributes: { ...node.attributes, viewerNote: `seat-${playerSeat}` } };
      }
      if (!node.children) return node;
      return { ...node, children: node.children.map(annotate) };
    };
    return annotate(state);
  };
}

function makeDiffGame(): TestGame<DiffGame> {
  return TestGame.create(DiffGame, { playerCount: 2, seed: 'view-diff-01' });
}

describe('diffPlayerViews', () => {
  it('lists owner-only hand cards visible to exactly one seat as onlyInA/onlyInB', () => {
    const tg = makeDiffGame();
    const result = diffPlayerViews(tg.getPlayerView(1), tg.getPlayerView(2));

    expect(result.onlyInA.some((p) => p.includes('hand-card-1'))).toBe(true);
    expect(result.onlyInB.some((p) => p.includes('hand-card-2'))).toBe(true);
    // Never double-counted on the wrong side.
    expect(result.onlyInB.some((p) => p.includes('hand-card-1'))).toBe(false);
    expect(result.onlyInA.some((p) => p.includes('hand-card-2'))).toBe(false);
  });

  it('reports NO spurious onlyIn/attributeDiff noise for an identical-count fully-hidden zone', () => {
    const tg = makeDiffGame();
    const result = diffPlayerViews(tg.getPlayerView(1), tg.getPlayerView(2));

    expect(result.onlyInA.some((p) => p.includes('deck'))).toBe(false);
    expect(result.onlyInB.some((p) => p.includes('deck'))).toBe(false);
    expect(result.attributeDiffs.some((d) => d.path.includes('deck'))).toBe(false);
  });

  it('correlates a standalone individually-hidden element by its stable id (reported exactly once)', () => {
    const tg = makeDiffGame();
    const result = diffPlayerViews(tg.getPlayerView(1), tg.getPlayerView(2));

    const inA = result.onlyInA.filter((p) => p.includes('shared-card'));
    const inB = result.onlyInB.filter((p) => p.includes('shared-card'));
    expect(inA.length).toBe(1);
    expect(inB.length).toBe(0);
    // Never surfaced as an attributeDiff either -- that would leak identity/value.
    expect(result.attributeDiffs.some((d) => d.path.includes('shared-card'))).toBe(false);
  });

  it('surfaces a playerView-hook attribute difference on a shared node BOTH seats can see', () => {
    const tg = makeDiffGame();
    const result = diffPlayerViews(tg.getPlayerView(1), tg.getPlayerView(2));

    const tableDiff = result.attributeDiffs.find(
      (d) => d.path.includes('table') && d.path.endsWith('viewerNote'),
    );
    expect(tableDiff).toBeDefined();
    expect(tableDiff!.a).toBe('seat-1');
    expect(tableDiff!.b).toBe('seat-2');
  });

  it('describe() returns a readable multi-line summary of all three buckets', () => {
    const tg = makeDiffGame();
    const result = diffPlayerViews(tg.getPlayerView(1), tg.getPlayerView(2));
    const text = result.describe();

    expect(text).toContain('Only visible to seat 1');
    expect(text).toContain('Only visible to seat 2');
    expect(text).toContain('Attribute differences');
    expect(text.split('\n').length).toBeGreaterThan(1);
  });

  // -------------------------------------------------------------------------
  // WR-02: the atomic (testGame, seatA, seatB) overload produces the same
  // result as the two-view form when the underlying game state is unchanged,
  // and is the pit-of-success way to avoid the non-simultaneous-snapshot
  // footgun (comparing views captured at different points in game state).
  // -------------------------------------------------------------------------
  it('the atomic (testGame, seatA, seatB) overload matches the two-view form', () => {
    const tg = makeDiffGame();
    const atomicResult = diffPlayerViews(tg, 1, 2);
    const manualResult = diffPlayerViews(tg.getPlayerView(1), tg.getPlayerView(2));

    expect(atomicResult.onlyInA).toEqual(manualResult.onlyInA);
    expect(atomicResult.onlyInB).toEqual(manualResult.onlyInB);
    expect(atomicResult.attributeDiffs).toEqual(manualResult.attributeDiffs);
  });
});
