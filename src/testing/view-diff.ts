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
 * FLIP animation correlation). Raw id-based diffing would therefore either
 * misreport identical anonymized zones as spurious adds/removes, or fail to
 * recognize an individually-hidden element as "the same element" across
 * seats. This module never correlates by id at all — it walks both trees
 * POSITIONALLY (mirroring `debug.ts`'s `findDiffs` strategy) and classifies
 * purely on each position's `__hidden` flag, which sidesteps the
 * id-anonymization asymmetry entirely.
 *
 * @module
 */

import type { ElementJSON } from '../engine/index.js';
import type { PlayerStateView } from '../runtime/index.js';

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

/** True when a node is a redacted placeholder (hidden individually, count-only, or zone-anonymized). */
function isHiddenNode(node: ElementJSON | undefined): boolean {
  return node?.attributes?.__hidden === true;
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
 * Positionally walk one (index-aligned) pair of nodes from viewA/viewB,
 * classifying into onlyInA / onlyInB / attributeDiffs.
 *
 * Classification is purely `__hidden`-flag based — never id-based — so it
 * cannot fall into the synthetic-id trap (treating a hidden zone's
 * per-call-fresh anonymized ids as spurious structural changes) and cannot
 * miss the individually-hidden case (which keeps a stable id but toggles
 * hidden/visible depending on the viewing seat).
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
  const hiddenA = isHiddenNode(a);
  const hiddenB = isHiddenNode(b);

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

  // Recurse into children positionally (index-aligned, not id-aligned).
  const childrenA = a.children ?? [];
  const childrenB = b.children ?? [];
  const maxLen = Math.max(childrenA.length, childrenB.length);
  for (let i = 0; i < maxLen; i++) {
    walk(childrenA[i], childrenB[i], path, i, onlyInA, onlyInB, attributeDiffs);
  }
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
 * @example
 * ```typescript
 * const result = diffPlayerViews(testGame.getPlayerView(1), testGame.getPlayerView(2));
 * console.log(result.describe());
 * expect(result.onlyInA).not.toContain('opponent-hand-card'); // opponent's card never leaks
 * ```
 */
export function diffPlayerViews(viewA: PlayerStateView, viewB: PlayerStateView): ViewDiffResult {
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
