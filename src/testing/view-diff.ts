/**
 * Per-seat view diffing for testing BoardSmith games (VIS-02).
 *
 * `diffPlayerViews` tells a developer exactly which elements/fields two seats
 * see differently, so hidden information can be verified as hidden.
 *
 * Consumes `PlayerStateView.state` — the tree produced by
 * `game.toJSONForPlayer(seat)` AFTER a `GameClass.playerView` post-transform
 * (game.ts:2813-2816). Because this is the FINAL per-seat output (the same
 * bytes a real client receives), any content a `playerView` hook hides for
 * one seat is already absent from that seat's tree and surfaces here as a
 * legitimate `onlyIn` difference — there is no playerView blind spot.
 *
 * The engine deliberately anonymizes ids for zone-hidden/count-only children
 * (fresh synthetic negative ids per serialization call, game.ts:2750-2756)
 * while KEEPING the real, stable id for a standalone individually-hidden
 * element sitting in an otherwise-visible parent (game.ts:2722-2731, kept for
 * FLIP animation correlation). Raw id-only diffing would therefore misreport
 * identical anonymized zones as spurious adds and removes.
 *
 * So this module pairs two seats' children BY ELEMENT IDENTITY and falls back
 * to position only where the engine took identity away — a hidden zone's
 * fungible children, anonymous by design. Each pair is then classified on its
 * `__hidden` flags, which is what keeps the individually-hidden case (a stable
 * id that toggles hidden per seat) reported exactly once.
 *
 * ## Why position alone was not enough (#267)
 *
 * A table's two seats hold the SAME tree with different things redacted out of
 * it, so a position meant the same element on both sides. A WORLD's do not: a
 * seat's frame is pruned to the partitions its own `world.view` named, so seat
 * 1's frame holds seat 1's room and seat 2's holds seat 2's — one node each, in
 * the same place, and unrelated to one another. Positionally that read as one
 * room whose every field disagreed, with both `onlyIn` buckets empty. The
 * guarantee a world actually needs is that the other seat's room is ABSENT, and
 * absence is a thing only identity can express.
 *
 * @module
 */

import type { ElementJSON, Game } from '../engine/index.js';
import { isHiddenPlaceholder } from '../engine/element/hidden-placeholder.js';
import type { TestGame } from './test-game.js';
import { TestWorld } from './test-world.js';
import { assertViewFixtureShape } from './view-fixture.js';

/**
 * The two fields the view-pair overload actually reads: whose view it is, and
 * the payload to walk.
 *
 * Narrower than `PlayerStateView` on purpose. A caller holding a game rather
 * than a `TestGame` builds the pair itself -- `{ player, state:
 * game.toJSONForPlayer(seat) }` -- and demanding `messages`, `phase` and the
 * rest made that caller fabricate fields this function never opens
 * (ShufflewickPub #260). A real `PlayerStateView` is still accepted, which is
 * what the atomic overload passes.
 */
export interface DiffableView {
  /** The seat this view was built for; named in the diff's own description. */
  player: number;
  /** The per-seat payload to walk. */
  state: ElementJSON;
}

/**
 * Result of {@link diffPlayerViews}.
 *
 * Data fields first, `describe()` last — mirrors the `FlowDebugInfo`
 * convention (src/engine/flow/types.ts) rather than a class.
 */
export interface ViewDiffResult {
  /** Readable paths of elements visible in seat A's view but not seat B's. */
  onlyInA: string[];
  /** Readable paths of elements visible in seat B's view but not seat A's. */
  onlyInB: string[];
  /** Attribute-level differences for elements BOTH seats can see. */
  attributeDiffs: Array<{ path: string; a: unknown; b: unknown }>;
  /** Human-readable multi-line summary of the three buckets above. */
  describe(): string;
}


/** Readable label for a node: its `name` when present, else `ClassName[index]`. */
function describeNode(node: ElementJSON, index: number): string {
  return node.name ? node.name : `${node.className}[${index}]`;
}

function childPath(parentPath: string, node: ElementJSON, index: number): string {
  const label = describeNode(node, index);
  return parentPath ? `${parentPath}.${label}` : label;
}

/**
 * Walk one PAIRED pair of nodes from viewA/viewB (see {@link pairChildren}),
 * classifying into onlyInA / onlyInB / attributeDiffs.
 *
 * Pairing is by identity; CLASSIFICATION is purely `__hidden`-flag based, which
 * is what keeps the individually-hidden case (a stable id whose hidden flag
 * toggles per seat) reported once, on the correct side, rather than as a
 * removal and an addition.
 */
function walk(
  nodeA: ElementJSON | undefined,
  nodeB: ElementJSON | undefined,
  parentPath: string,
  index: number,
  onlyInA: string[],
  onlyInB: string[],
  attributeDiffs: Array<{ path: string; a: unknown; b: unknown }>,
): void {
  if (!nodeA && !nodeB) return;

  // Structural absence: one side's tree has no node at this position at all
  // (e.g. a GameClass.playerView hook stripped it entirely for one seat, or
  // unequal-length child arrays). Present-in-exactly-one-tree.
  if (nodeA && !nodeB) {
    onlyInA.push(childPath(parentPath, nodeA, index));
    return;
  }
  if (!nodeA && nodeB) {
    onlyInB.push(childPath(parentPath, nodeB, index));
    return;
  }

  const a = nodeA as ElementJSON;
  const b = nodeB as ElementJSON;
  const hiddenA = isHiddenPlaceholder(a);
  const hiddenB = isHiddenPlaceholder(b);

  // Prefer the non-hidden side for the readable label (hidden placeholders
  // drop `name` for identity-bearing elements).
  const labelSource = !hiddenA ? a : !hiddenB ? b : a;
  const path = childPath(parentPath, labelSource, index);

  if (hiddenA !== hiddenB) {
    // Present on both sides structurally, but redacted on exactly one --
    // visible to exactly one seat. Never diff attribute contents here: doing
    // so would leak the hidden side's identity/value through the diff.
    if (!hiddenA) onlyInA.push(path);
    else onlyInB.push(path);
    return;
  }

  if (hiddenA && hiddenB) {
    // Hidden on BOTH sides -- whether an individually-hidden stable-id
    // element neither seat can see, or a zone-anonymized child whose
    // synthetic negative id is fresh per serialization call. Never surface
    // redacted attribute contents, and never recurse (there is no reliable
    // subtree behind a redacted placeholder).
    return;
  }

  // Both visible: diff own (non-hidden) attributes.
  const attrsA = a.attributes ?? {};
  const attrsB = b.attributes ?? {};
  const attrKeys = new Set([...Object.keys(attrsA), ...Object.keys(attrsB)]);
  for (const key of attrKeys) {
    const valueA = attrsA[key];
    const valueB = attrsB[key];
    if (JSON.stringify(valueA) !== JSON.stringify(valueB)) {
      attributeDiffs.push({ path: `${path}.attributes.${key}`, a: valueA, b: valueB });
    }
  }

  // Recurse into children, paired by identity where the engine left one.
  for (const pair of pairChildren(a.children ?? [], b.children ?? [])) {
    walk(pair.a, pair.b, path, pair.index, onlyInA, onlyInB, attributeDiffs);
  }
}

/** One child of A lined up with the child of B that is the SAME element, or
 *  with nothing when the other seat's frame does not hold it. */
interface ChildPair {
  a?: ElementJSON;
  b?: ElementJSON;
  /** Where this child sat in its own parent, for the `ClassName[index]` label. */
  index: number;
}

/** An id the engine anonymized (a hidden zone's fungible child) is negative and
 *  fresh on every serialization, so it identifies nothing. */
function isAnonymized(node: ElementJSON): boolean {
  return node.id < 0;
}

/**
 * Pair two seats' children of the same parent (#267).
 *
 * BY ID FIRST, which is what lets a diff say that a whole room one seat holds
 * is absent from the other's frame rather than reporting it as the room that
 * IS there with every field changed.
 *
 * WHAT THE LEFTOVERS DO. A child with no counterpart of the same id is paired
 * positionally with the other side's next leftover ONLY when one of the two is
 * a redacted placeholder, which is the case where identity was deliberately
 * withheld: a hand one seat sees in full and the other sees as anonymized
 * stand-ins is the same hand, and must be reported once rather than as a
 * removal and an addition of the same cards. Two leftovers that are both plain
 * visible elements are NOT the same element -- that is the world case, and
 * pairing them is precisely the defect -- so each is reported on its own side.
 */
function pairChildren(
  childrenA: readonly ElementJSON[],
  childrenB: readonly ElementJSON[],
): ChildPair[] {
  const takenB = new Set<number>();
  const byIdB = new Map<number, number>();
  childrenB.forEach((child, index) => {
    if (!isAnonymized(child) && !byIdB.has(child.id)) byIdB.set(child.id, index);
  });

  const pairs: ChildPair[] = [];
  const leftoverA: ChildPair[] = [];
  childrenA.forEach((child, index) => {
    const at = isAnonymized(child) ? undefined : byIdB.get(child.id);
    if (at === undefined) {
      leftoverA.push({ a: child, index });
      return;
    }
    takenB.add(at);
    pairs.push({ a: child, b: childrenB[at], index });
  });

  const leftoverB: ChildPair[] = [];
  childrenB.forEach((child, index) => {
    if (!takenB.has(index)) leftoverB.push({ b: child, index });
  });

  let i = 0;
  let j = 0;
  while (i < leftoverA.length || j < leftoverB.length) {
    const left = leftoverA[i];
    const right = leftoverB[j];
    if (left && right && (isHiddenPlaceholder(left.a) || isHiddenPlaceholder(right.b))) {
      pairs.push({ a: left.a, b: right.b, index: left.index });
      i += 1;
      j += 1;
    } else if (left) {
      pairs.push(left);
      i += 1;
    } else {
      pairs.push(right!);
      j += 1;
    }
  }

  return pairs;
}

/**
 * Diff two seats' final per-seat game views, reporting which elements only
 * one seat can see and which shared elements disagree on attribute values.
 *
 * Operates on `PlayerStateView.state` (`game.toJSONForPlayer(seat)`, AFTER
 * any `GameClass.playerView` post-transform) — the exact bytes each seat's
 * client receives. Use this to verify hidden information stays hidden: two
 * views of the same game should show no unexpected `onlyIn`/`attributeDiffs`
 * entries for content that is supposed to be shared, and identical-count
 * hidden zones should never appear as spurious noise.
 *
 * WARNING (WR-02): a diff is only meaningful for two views of the SAME
 * game-state instant. If `viewA`/`viewB` are captured at different points (e.g.
 * one before and one after a card draw, with other mutating code running in
 * between), ordinary state progression is reported as differences between the
 * seats — an element drawn in between is genuinely in one frame and not the
 * other, and nothing here can tell that apart from a seat that cannot see it.
 * Prefer the `(subject, seatA, seatB)` overloads below, which capture both
 * views back-to-back with no gap for intervening mutation.
 *
 * @example
 * ```typescript
 * // Preferred — atomic capture, immune to the WR-02 footgun:
 * const result = diffPlayerViews(testGame, 1, 2);
 * console.log(result.describe());
 * expect(result.onlyInA).not.toContain('opponent-hand-card'); // opponent's card never leaks
 * ```
 */
export function diffPlayerViews(viewA: DiffableView, viewB: DiffableView): ViewDiffResult;
/**
 * A WORLD'S TWO SEATS (#267), captured the way a world host sends them.
 *
 * Asynchronous because a world's frame is a read of its store: `viewsFor`
 * settles the bundle's own `world.view` declaration and hydrates what it names
 * before it can answer. Both frames are still captured back-to-back inside this
 * call, so the atomic-capture guarantee the table overload gives holds here too.
 *
 * @example
 * ```typescript
 * const result = await diffPlayerViews(world, 1, 2);
 * expect(result.onlyInB).toContain('World[0].vault-2'); // seat 2's room is absent from seat 1's frame
 * ```
 */
export function diffPlayerViews(
  world: TestWorld,
  seatA: number,
  seatB: number,
): Promise<ViewDiffResult>;
/**
 * Atomic overload (WR-02): captures both seats' views back-to-back from
 * `testGame` in the SAME call, eliminating the caller footgun of diffing
 * views taken at different points in game state.
 *
 * @example
 * ```typescript
 * const result = diffPlayerViews(testGame, 1, 2);
 * console.log(result.describe());
 * ```
 */
export function diffPlayerViews<G extends Game>(
  testGame: TestGame<G>,
  seatA: number,
  seatB: number,
): ViewDiffResult;
export function diffPlayerViews<G extends Game>(
  viewAOrSubject: DiffableView | TestGame<G> | TestWorld,
  viewBOrSeatA: DiffableView | number,
  seatB?: number,
): ViewDiffResult | Promise<ViewDiffResult> {
  let viewA: DiffableView;
  let viewB: DiffableView;

  if (viewAOrSubject instanceof TestWorld) {
    return diffWorldViews(viewAOrSubject, viewBOrSeatA as number, seatB as number);
  }

  if (typeof viewBOrSeatA === 'number') {
    // Atomic overload: fetch both views back-to-back, right here, with no
    // gap for caller code to mutate game state between captures.
    const testGame = viewAOrSubject as TestGame<G>;
    viewA = assertFrameArrived(testGame.getPlayerView(viewBOrSeatA), viewBOrSeatA);
    viewB = assertFrameArrived(testGame.getPlayerView(seatB as number), seatB as number);
  } else {
    viewA = viewAOrSubject as DiffableView;
    viewB = viewBOrSeatA;
    // A view-pair caller may have hand-built either side. A player attribute
    // written as `{ seat }` renders identically to the real
    // `{ __playerRef, seat, color, name }`, so the drift is invisible unless
    // something refuses it here (#160).
    assertViewFixtureShape(viewA.state, `seat ${viewA.player} view`);
    assertViewFixtureShape(viewB.state, `seat ${viewB.player} view`);
  }

  return diffOf(viewA, viewB);
}

/**
 * A world's two seats, captured back-to-back.
 *
 * Nothing here knows how a world's frame is built: it asks the harness, which
 * asks the host core (#262). A second implementation of the projection would be
 * a diff of something no player is sent.
 */
async function diffWorldViews(
  world: TestWorld,
  seatA: number,
  seatB: number,
): Promise<ViewDiffResult> {
  const a = await world.getPlayerView(seatA);
  const b = await world.getPlayerView(seatB);
  return diffOf({ player: seatA, state: a.state }, { player: seatB, state: b.state });
}

/**
 * ONE FRAME, OR A SENTENCE SAYING WHY THERE IS NONE (#267).
 *
 * A subject whose frames are a read of a store answers a PROMISE, and diffing
 * one of those walks two `undefined` trees: an empty diff, reported as though
 * it were a clean one, from an assertion that could never have failed.
 */
function assertFrameArrived(view: unknown, seat: number): DiffableView {
  const state = (view as DiffableView | undefined)?.state;
  if (state === null || typeof state !== 'object') {
    throw new Error(
      `diffPlayerViews: seat ${seat}'s frame has not arrived yet -- what was handed back is ` +
        `${view instanceof Promise ? 'a promise' : `a ${typeof state} where the element tree should be`}. ` +
        'A world answers its frames asynchronously, so diff a world with ' +
        '`await diffPlayerViews(world, a, b)`; a table answers at once, so a table subject that ' +
        'lands here is not the TestGame this function takes.',
    );
  }
  return view as DiffableView;
}

/** The three buckets and their summary, for a pair of frames already captured. */
function diffOf(viewA: DiffableView, viewB: DiffableView): ViewDiffResult {
  const onlyInA: string[] = [];
  const onlyInB: string[] = [];
  const attributeDiffs: Array<{ path: string; a: unknown; b: unknown }> = [];

  walk(viewA.state, viewB.state, '', 0, onlyInA, onlyInB, attributeDiffs);

  return {
    onlyInA,
    onlyInB,
    attributeDiffs,
    describe(): string {
      const lines: string[] = [`View diff: seat ${viewA.player} vs seat ${viewB.player}`];

      lines.push(
        onlyInA.length > 0
          ? `Only visible to seat ${viewA.player}:\n${onlyInA.map((p) => `  - ${p}`).join('\n')}`
          : `Only visible to seat ${viewA.player}: (none)`,
      );
      lines.push(
        onlyInB.length > 0
          ? `Only visible to seat ${viewB.player}:\n${onlyInB.map((p) => `  - ${p}`).join('\n')}`
          : `Only visible to seat ${viewB.player}: (none)`,
      );
      lines.push(
        attributeDiffs.length > 0
          ? `Attribute differences:\n${attributeDiffs
              .map((d) => `  - ${d.path}: ${JSON.stringify(d.a)} vs ${JSON.stringify(d.b)}`)
              .join('\n')}`
          : 'Attribute differences: (none)',
      );

      return lines.join('\n');
    },
  };
}
