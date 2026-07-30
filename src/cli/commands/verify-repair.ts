import { atomicWriteFile, type ClassificationRecord } from './verify-run.js';
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

// -------------------------------------------------------------------------------------------
// Task 2 — verify-episode round bookkeeping (decision 17)
// -------------------------------------------------------------------------------------------

/** Every existing `### Audit Round N` heading, matching all three real precedent shapes:
 *   `### Audit Round 3 (final round — ...)`
 *   `### Audit Round 3 (FINAL — ...)`
 *   `### Audit Round 3 (the last permitted — ...)`
 * plus a bare `### Audit Round N` with no parenthetical at all. */
export interface AuditRoundHeading {
  absolute: number;
  /** The full trailing parenthetical text (without the surrounding parens), if present. */
  parenthetical?: string;
}

const AUDIT_ROUND_HEADING_RE = /^### Audit Round (\d+)(?:\s*\(([^)]*)\))?\s*$/gm;

/** Every `### Audit Round N` heading in `chunkMd`, in document order. Pure, no I/O. */
export function parseAuditRounds(chunkMd: string): AuditRoundHeading[] {
  const rounds: AuditRoundHeading[] = [];
  for (const match of chunkMd.matchAll(AUDIT_ROUND_HEADING_RE)) {
    rounds.push({
      absolute: Number(match[1]),
      ...(match[2] !== undefined ? { parenthetical: match[2] } : {}),
    });
  }
  return rounds;
}

/** The verify-episode parenthetical shape this module writes: `verify-repair episode E, round R of 3`. */
const EPISODE_PARENTHETICAL_RE = /^verify-repair episode (\d+), round (\d+) of 3$/;

interface EpisodeRoundEntry {
  episode: number;
  episodeRound: number;
}

function parseEpisodeRounds(chunkMd: string): EpisodeRoundEntry[] {
  const entries: EpisodeRoundEntry[] = [];
  for (const round of parseAuditRounds(chunkMd)) {
    const match = round.parenthetical !== undefined ? EPISODE_PARENTHETICAL_RE.exec(round.parenthetical) : null;
    if (match) {
      entries.push({ episode: Number(match[1]), episodeRound: Number(match[2]) });
    }
  }
  return entries;
}

/** Decision 17: the max-3-round bound is per-verify-episode, not per-chunk-lifetime. */
export const VERIFY_EPISODE_ROUND_BUDGET = 3;

export type VerifyEpisodeRoundPlan =
  | {
      disposition: 'round';
      absoluteRound: number;
      episode: number;
      episodeRound: number;
      heading: string;
    }
  | {
      disposition: 'triage';
      episode: number;
      reason: string;
    };

/**
 * Plans the next verify-episode audit round for `episode` against `chunkMd`'s CURRENT round
 * history. Pure — no I/O.
 *
 * The absolute round number is `max(every existing ### Audit Round N) + 1` — a chunk with three
 * build-era rounds (`best-seven-selection`, `table-and-draw`, `block`, `jab` — the four real
 * chunks research measured already at round 3) gets absolute round 4 on its FIRST verify
 * dispatch, never routed to triage on arrival (decision 17's whole point: the bound is a loop
 * guard against one session spinning forever, not a lifetime quota).
 *
 * The episode-relative round number is `(count of this episode's own prior rounds) + 1`. Once
 * that would exceed `VERIFY_EPISODE_ROUND_BUDGET`, this returns the `triage` disposition instead
 * of a heading — the episode's own budget is exhausted, regardless of the absolute round number.
 */
export function planVerifyEpisodeRound(chunkMd: string, episode: number): VerifyEpisodeRoundPlan {
  const allRounds = parseAuditRounds(chunkMd);
  const nextAbsolute = allRounds.length > 0 ? Math.max(...allRounds.map((r) => r.absolute)) + 1 : 1;

  const episodeRoundsSoFar = parseEpisodeRounds(chunkMd).filter((r) => r.episode === episode).length;
  const nextEpisodeRound = episodeRoundsSoFar + 1;

  if (nextEpisodeRound > VERIFY_EPISODE_ROUND_BUDGET) {
    return {
      disposition: 'triage',
      episode,
      reason:
        `Verify episode ${episode} has already used its ${VERIFY_EPISODE_ROUND_BUDGET}-round ` +
        `budget (\`state-machine.md\` "Repair Loop Bound") — remaining findings are triaged with ` +
        `the user rather than dispatching a further round.`,
    };
  }

  const heading =
    `### Audit Round ${nextAbsolute} (verify-repair episode ${episode}, round ${nextEpisodeRound} ` +
    `of ${VERIFY_EPISODE_ROUND_BUDGET})`;

  return {
    disposition: 'round',
    absoluteRound: nextAbsolute,
    episode,
    episodeRound: nextEpisodeRound,
    heading,
  };
}

/**
 * Derives which verify episode a resumed dispatch continues, from the count of existing
 * episode-labelled headings already present (so a resumed pass continues its own episode rather
 * than opening a new one, mirroring `build/audit.md`'s cold-resume rule for a partial round).
 *
 * No episode-labelled heading at all → episode 1 (a fresh verify pass). Otherwise: if the
 * highest-numbered episode present has not yet used its full round budget, that same episode
 * number is returned (resume it); if it has, the next episode number is returned (a genuinely new
 * verify pass opens its own fresh budget, per decision 17).
 */
export function resolveVerifyEpisodeNumber(chunkMd: string): number {
  const episodeRounds = parseEpisodeRounds(chunkMd);
  if (episodeRounds.length === 0) return 1;

  const maxEpisode = Math.max(...episodeRounds.map((r) => r.episode));
  const roundsInMaxEpisode = episodeRounds.filter((r) => r.episode === maxEpisode).length;
  return roundsInMaxEpisode < VERIFY_EPISODE_ROUND_BUDGET ? maxEpisode : maxEpisode + 1;
}

/**
 * Append-only: the produced document's prefix up to the insertion point is byte-identical to the
 * input (`output.startsWith(input.trimEnd())`), and every pre-existing round heading string
 * survives unchanged (`state-machine.md` Write Order — round entries are append-only, never
 * overwritten or renumbered). Pure — no I/O.
 */
export function appendAuditRoundHeading(chunkMd: string, heading: string): string {
  const trimmed = chunkMd.trimEnd();
  return `${trimmed}\n\n${heading}\n`;
}

/**
 * Writes a planned verify-episode round's heading into `chunkMdPath`, through `atomicWriteFile` —
 * the ONE atomic write path in the repo (T-176-06: a torn `CHUNK.md` on crash mid-append is
 * mitigated only by never writing any other way).
 */
export async function writeAppendedAuditRound(
  chunkMdPath: string,
  chunkMd: string,
  heading: string,
): Promise<string> {
  const updated = appendAuditRoundHeading(chunkMd, heading);
  await atomicWriteFile(chunkMdPath, updated);
  return updated;
}
