import { type ClassificationRecord } from './verify-run.js';
import type { ImpactMapEntry } from './verify-impact.js';

/**
 * `verify-repair.ts` — CHECK-02's mechanical core (176-CONTEXT.md decisions 5, 8, 9, 12, 17, 19).
 *
 * The three audit lenses and the bounded repair loop already exist as skill text
 * (`build/audit.md`, `build/repair.md`) and are reused VERBATIM — never forked (decision 8).
 * This module supplies only the glue those two files need but do not themselves compute:
 *
 *   1. `selectStaleChunks`/`resolveStagedSlicePaths` — which chunks are in scope, and which
 *      FRESH STAGED slice paths (never live `rulebook/` slices, decision 9) a lens must read.
 *   2. (Task 2) verify-episode round bookkeeping — a fresh 3-round budget per verify pass,
 *      appended after a chunk's build-era rounds without renumbering them.
 *   3. (Task 3) `recomputeRepairGatePostRepair` — re-derives `computeRepairGate` from POST-repair
 *      code state; the pre-repair snapshot is structurally unpassable to it.
 *
 * Every write in this module routes through `verify-run.ts`'s `atomicWriteFile` — the ONE atomic
 * ledger/artifact write path in the repo (173-REVIEW.md CR-01's defect class). No second parser,
 * no second pairing algorithm, no second write path.
 */

// -------------------------------------------------------------------------------------------
// Task 1 — stale-chunk selection + staged-slice resolution
// -------------------------------------------------------------------------------------------

/** Decision 5: only `stale === true` entries are dispatched into CHECK-02's lens loop. */
export function selectStaleChunks(entries: ImpactMapEntry[]): ImpactMapEntry[] {
  return entries.filter((entry) => entry.stale === true);
}

/**
 * The discriminated result of resolving one stale chunk's cited live slices to their fresh
 * staged counterparts. Mirrors `verify-ruling-recheck.ts`'s `resolveFreshTranscription` and
 * PROV-02's report-honestly precedent (decision 10): a caller can never mistake a partial
 * resolution for a complete, successful one.
 */
export type StagedSliceResolution =
  | { scopeLimited: false; paths: string[] }
  | { scopeLimited: true; reason: string; unresolvedPairId: string };

/**
 * Maps `entry.pairIds` to the `stagedSlices[]` recorded for each `pairId` in the run's OWN
 * `RUN.md` classification records (`ClassificationRecord.stagedSlices`, keyed by `pairId`) —
 * never a filename heuristic and never a second `pairSlices()` re-derivation (decision 9's
 * "Don't Hand-Roll" gate).
 *
 * Real m:n fan-out holds here by construction: one `pairId` can carry many `stagedSlices[]`
 * (`seven`'s real fixture: 3 live rule slices resolve to 6 staged files under one `pairId`).
 *
 * A `pairId` with no matching classification record yields the scope-limited arm naming that
 * unresolved `pairId` — never an empty-but-successful path list, and never a silent live-slice
 * substitution (decision 9's "staged only, never live" guarantee, enforced structurally below by
 * `stagingSlicesDir`'s own dot-prefixed-tree containment).
 *
 * Pure — no I/O. `stagedSlicesDir` is the caller-supplied staging-tree path prefix, computed via
 * `verify-run.ts`'s `stagingSlicesDir(projectDir, runId)` — the ONE path-computation authority for
 * a run's staging tree (173-CONTEXT.md decision 5). This function never re-derives that path.
 */
export function resolveStagedSlicePaths(
  entry: { slug: string; pairIds: string[] },
  classifications: ClassificationRecord[],
  stagedSlicesDir: string,
): StagedSliceResolution {
  const byPairId = new Map(classifications.map((c) => [c.pairId, c]));

  const seen = new Set<string>();
  const paths: string[] = [];

  for (const pairId of entry.pairIds) {
    const record = byPairId.get(pairId);
    if (record === undefined) {
      return {
        scopeLimited: true,
        unresolvedPairId: pairId,
        reason:
          `Chunk "${entry.slug}" cites pairId "${pairId}", but no classification record for it ` +
          `exists in this run's RUN.md ledger — the staged transcription for this pair is ` +
          `unavailable, so the lens loop cannot proceed for this chunk. Reporting scope-limited ` +
          `rather than substituting the live rulebook/ slice.`,
      };
    }
    for (const stagedSlice of record.stagedSlices) {
      const abs = joinStagedPath(stagedSlicesDir, stagedSlice);
      if (!seen.has(abs)) {
        seen.add(abs);
        paths.push(abs);
      }
    }
  }

  return { scopeLimited: false, paths };
}

/** Local, dependency-free join (avoids a second import just for path joining semantics). */
function joinStagedPath(dir: string, relPath: string): string {
  const dirNormalized = dir.endsWith('/') ? dir.slice(0, -1) : dir;
  return `${dirNormalized}/${relPath}`;
}
