/**
 * State-size measurement for CI.
 *
 * A game's saved state is not its board. It is the board PLUS one full copy of
 * the element tree per action taken (the per-action undo checkpoints), so:
 *
 *     saved size  ~=  tree size  x  total actions in the game
 *
 * Every byte on the game tree is multiplied by the game's action count. A tree
 * that looks small — 9 KB — is 2.7 MB of saved state after 300 actions, and
 * hosts cap how large a saved game may be. Nothing about playing the game
 * reveals this: the tree never grows, so a game that plays fine for 40 rounds
 * can hit the ceiling at round 41.
 *
 * These helpers make that measurable, so a game can assert its own budget in
 * CI instead of discovering it in production:
 *
 * ```ts
 * import { measureSnapshotSize, projectSnapshotSize } from 'boardsmith/testing';
 *
 * it('fits the platform state budget for a full game', () => {
 *   const game = createTestGame(MyGame, { playerCount: 8 });
 *   // ...play a representative position...
 *   const size = measureSnapshotSize(game.runner.getSnapshot());
 *   expect(projectSnapshotSize(size, EXPECTED_ACTIONS_PER_GAME)).toBeLessThan(1_800_000);
 * });
 * ```
 *
 * The two costs that dominate in practice, and that neither shows up until
 * measured:
 *   - The message log. It is stored ONCE per snapshot (`messageLogBytes`), so it
 *     is no longer multiplied by the checkpoint count — but it is the one term
 *     that never stops growing, so on a long narration-heavy game it can still
 *     dominate everything else put together.
 *   - Named-key objects cost roughly 6x positional arrays
 *     (`{beastLore: 3, ...}` = 137 bytes vs `[3, ...]` = 23).
 *
 * See `docs/state-size.md`, and `GameDefinition.checkpoints` for bounding the
 * multiplier instead of shrinking the tree.
 */

import { checkpointCount, type GameStateSnapshot } from '../engine/index.js';

/** Byte length of a value's JSON encoding (UTF-8 bytes, not UTF-16 units). */
function jsonByteLength(value: unknown): number {
  if (value === undefined) return 0;
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export interface SnapshotSizeMeasurement {
  /** Total serialized size of the snapshot, in bytes. */
  totalBytes: number;
  /** `snapshot.state` — the element tree. The thing that gets multiplied. */
  treeBytes: number;
  /** All retained per-action checkpoints, in total. */
  checkpointBytes: number;
  /** How many checkpoints are retained right now. */
  checkpointCount: number;
  /** `snapshot.actionHistory` — grows with the game, but per action, not per tree. */
  actionHistoryBytes: number;
  /**
   * `snapshot.messageLog` — the message log, stored once per snapshot.
   *
   * Broken out because it is the term most likely to dominate a narration-heavy
   * game while looking like nothing in the tree measurement: it is NOT part of
   * `treeBytes`, so a game whose tree measures 4 KB can still be megabytes.
   * Attribute it explicitly rather than inferring it from the remainder.
   */
  messageLogBytes: number;
  /**
   * How many actions the measured game had actually taken
   * (`snapshot.actionHistory.length`).
   *
   * The denominator for every per-action rate in `projectSnapshotSize`. Using
   * `checkpointCount` instead is wrong under a `checkpoints: { max }` policy,
   * where the retained count is capped far below the action count — it inflated
   * the per-action rates by exactly the ratio between them.
   */
  observedActionCount: number;
  /**
   * Average cost of ONE retained checkpoint, in bytes: the per-action
   * multiplier. `0` when nothing is retained (checkpointing disabled).
   */
  bytesPerCheckpoint: number;
}

/** Measure where a snapshot's bytes actually are. */
export function measureSnapshotSize(snapshot: GameStateSnapshot): SnapshotSizeMeasurement {
  const count = checkpointCount(snapshot.actionCheckpoints);
  const checkpointBytes = jsonByteLength(snapshot.actionCheckpoints);
  return {
    totalBytes: jsonByteLength(snapshot),
    treeBytes: jsonByteLength(snapshot.state),
    checkpointBytes,
    checkpointCount: count,
    actionHistoryBytes: jsonByteLength(snapshot.actionHistory),
    messageLogBytes: jsonByteLength(snapshot.messageLog),
    observedActionCount: snapshot.actionHistory.length,
    bytesPerCheckpoint: count === 0 ? 0 : Math.round(checkpointBytes / count),
  };
}

/**
 * Project what this game's snapshot will weigh after `actionCount` total
 * actions, from a measurement taken at any point in the game.
 *
 * This is the number to assert against a host's limit — a measurement taken
 * five actions in says almost nothing on its own, which is exactly why
 * measuring during development has historically missed the problem.
 *
 * Assumes the tree stays roughly the size it is now (true for most games:
 * pieces move rather than multiply). Under a `checkpoints: { max }` policy the
 * retained count is capped, so the CHECKPOINT term is capped with it — that is
 * the whole point of setting one.
 *
 * The result is NOT flat in `actionCount` even then. Two terms still grow
 * linearly: the action history, and the message log. Capping checkpoints
 * removed the log's multiplier, not the log's growth — a game that narrates
 * every action accumulates that text forever, and on a long enough game it
 * becomes the dominant term on its own. That is a real remaining limit, not a
 * modelling artifact, so this projection reports it rather than flattening it.
 */
export function projectSnapshotSize(
  measurement: SnapshotSizeMeasurement,
  actionCount: number,
  options?: { maxCheckpoints?: number },
): number {
  const perCheckpoint = measurement.bytesPerCheckpoint || measurement.treeBytes;
  const retained = Math.min(actionCount + 1, options?.maxCheckpoints ?? Number.POSITIVE_INFINITY);
  const fixed =
    measurement.totalBytes -
    measurement.checkpointBytes -
    measurement.actionHistoryBytes -
    measurement.messageLogBytes;

  // Per-action rates divide by the actions actually TAKEN, not by the retained
  // checkpoint count — under a `max` policy those differ by orders of magnitude
  // and dividing by the wrong one silently inflates the projection.
  const observed = Math.max(1, measurement.observedActionCount);
  const historyPerAction = measurement.actionHistoryBytes / observed;
  const logPerAction = measurement.messageLogBytes / observed;

  return Math.round(
    fixed + retained * perCheckpoint + actionCount * (historyPerAction + logPerAction),
  );
}
