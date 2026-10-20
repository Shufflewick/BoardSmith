import {
  chunkMdPath,
  readChunkMdIfExists,
  relChunkMdPath,
} from '../lib/project-paths.js';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { styleText } from 'node:util';
import { assertBareName } from '../lib/user-name.js';
import {
  atomicWriteFile,
  readRunLedgerState,
  stagingSlicesDir,
  type ClassificationRecord,
} from './verify-run.js';
import {
  verifyImpactStatusCommand,
  type ImpactMapEntry,
  type RepairGate,
} from './verify-impact.js';

/**
 * `verify-repair.ts` — CHECK-02's mechanical core (176-CONTEXT.md decisions 5, 8, 9, 12, 17, 19).
 *
 * The three audit lenses and the bounded repair loop already exist as skill text
 * (`build/audit.md`, `build/repair.md`) and are reused VERBATIM — never forked (decision 8).
 * This module supplies only the glue those two files need but do not themselves compute:
 *
 *   1. `selectStaleChunks`/`resolveStagedSlicePaths` — which chunks are in scope, and which
 *      FRESH STAGED slice paths (never live `rulebook/` slices, decision 9) a lens must read.
 *   2. `parseAuditRounds`/`planVerifyRunRound`/`appendAuditRoundHeading` — a verify run's
 *      own fresh 3-round budget (decision 17), appended after a chunk's build-era rounds without
 *      renumbering them, each heading naming the run it belongs to (#1302).
 *   3. `verify-repair-gate` — reads the repair gate `verify-impact-status` derives from the
 *      chunk's code as it is when the gate is asked, so after repair (Pitfall 1).
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
// Task 2 — verify-run round bookkeeping (decision 17)
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
  /** Whether nothing but blank lines stands between this heading and the next heading. */
  empty: boolean;
}

const AUDIT_ROUND_HEADING_RE = /^### Audit Round (\d+)(?:\s*\(([^)]*)\))?\s*$/gm;

/** Every `### Audit Round N` heading in `chunkMd`, in document order. Pure, no I/O. */
export function parseAuditRounds(chunkMd: string): AuditRoundHeading[] {
  const rounds: AuditRoundHeading[] = [];
  for (const match of chunkMd.matchAll(AUDIT_ROUND_HEADING_RE)) {
    const below = chunkMd.slice(match.index + match[0].length);
    const nextHeading = /^#{1,3} /m.exec(below);
    rounds.push({
      absolute: Number(match[1]),
      ...(match[2] !== undefined ? { parenthetical: match[2] } : {}),
      empty: below.slice(0, nextHeading?.index ?? below.length).trim() === '',
    });
  }
  return rounds;
}

/** The parenthetical this module writes: `verify-repair run <runId>, round R of 3`. */
const RUN_PARENTHETICAL_RE = /^verify-repair run (\S+), round (\d+) of \d+$/;

/** Decision 17: the max-3-round bound is per verify run, not per chunk lifetime. */
export const VERIFY_RUN_ROUND_BUDGET = 3;

export type VerifyRunRoundPlan =
  | {
      disposition: 'round';
      absoluteRound: number;
      runId: string;
      runRound: number;
      heading: string;
      /** The round is already in CHUNK.md with nothing under it yet, so opening it writes nothing. */
      alreadyOpen: boolean;
    }
  | {
      disposition: 'triage';
      runId: string;
      reason: string;
    };

/**
 * Plans `runId`'s next audit round for a chunk against `chunkMd`'s CURRENT round history. Pure.
 *
 * The rounds are counted per verify run, from the run id each heading carries (#1302), so a
 * resumed session counts the rounds its run already opened, and a new run gets its own budget
 * whatever an earlier one used. The absolute round number is `max(every existing round) + 1`: a
 * chunk with three build-era rounds gets absolute round 4 on its first verify round, never triage
 * on arrival (decision 17: the bound is a loop guard, not a lifetime quota).
 *
 * The run's latest round with nothing written under it yet is still open, so it is planned again
 * rather than a second one opened beside it: opening a round twice, as a retry or a resumed
 * session does, is harmless (#1302). Once the run has used `VERIFY_RUN_ROUND_BUDGET` rounds this
 * returns `triage` instead.
 */
export function planVerifyRunRound(chunkMd: string, runId: string): VerifyRunRoundPlan {
  const allRounds = parseAuditRounds(chunkMd);
  const runRounds = allRounds.flatMap((round) => {
    const match = round.parenthetical !== undefined ? RUN_PARENTHETICAL_RE.exec(round.parenthetical) : null;
    return match?.[1] === runId ? [{ ...round, runRound: Number(match[2]) }] : [];
  });
  const latest = runRounds.at(-1);
  if (latest?.empty) {
    return { disposition: 'round', absoluteRound: latest.absolute, runId, runRound: latest.runRound, heading: runRoundHeading(latest.absolute, runId, latest.runRound), alreadyOpen: true };
  }
  if (runRounds.length >= VERIFY_RUN_ROUND_BUDGET) {
    return {
      disposition: 'triage',
      runId,
      reason:
        `Verify run ${runId} has already used its ${VERIFY_RUN_ROUND_BUDGET}-round ` +
        `budget (\`state-machine.md\` "Repair Loop Bound") — remaining findings are triaged with ` +
        `the user rather than dispatching a further round.`,
    };
  }
  const absoluteRound = allRounds.length > 0 ? Math.max(...allRounds.map((r) => r.absolute)) + 1 : 1;
  const runRound = runRounds.length + 1;
  return { disposition: 'round', absoluteRound, runId, runRound, heading: runRoundHeading(absoluteRound, runId, runRound), alreadyOpen: false };
}

function runRoundHeading(absoluteRound: number, runId: string, runRound: number): string {
  return `### Audit Round ${absoluteRound} (verify-repair run ${runId}, round ${runRound} of ${VERIFY_RUN_ROUND_BUDGET})`;
}

/**
 * Append-only, WITHIN the `## Findings Ledger` section — not necessarily at the document's
 * absolute end (176-06-discovered bug fix). A real `CHUNK.md` has sections AFTER `## Findings
 * Ledger` (`## Revision Rounds`, `## Build Manifest`, `## Playtest Test Script`, `## Verified
 * Checklist`, `## Verified Commit Hash` — confirmed on real fixtures, e.g. `best-seven-selection`
 * and `block`'s real `CHUNK.md`). A naive end-of-document append would land the new round heading
 * AFTER `## Verified Commit Hash`, structurally detached from the Findings Ledger it is meant to
 * extend — this was never caught by this module's own tests because every synthetic fixture ended
 * right after `## Findings Ledger`, with no trailing section to expose the defect.
 *
 * The new heading is inserted immediately before the next top-level `## ` heading that follows
 * `## Findings Ledger`, or at the end when `## Findings Ledger` is the last section. A document
 * with no `## Findings Ledger` at all is refused rather than given a detached heading (#1302).
 *
 * Append-only in the sense that matters: every byte before the insertion point and every byte
 * after it survive unchanged, and every pre-existing round heading string survives unchanged
 * (`state-machine.md` Write Order — round entries are append-only, never overwritten or
 * renumbered). Pure — no I/O.
 */
const FINDINGS_LEDGER_RE = /^## Findings Ledger\s*$/m;

export function appendAuditRoundHeading(chunkMd: string, heading: string): string {
  const findingsLedgerMatch = FINDINGS_LEDGER_RE.exec(chunkMd);
  if (!findingsLedgerMatch) throw new Error('This CHUNK.md has no "## Findings Ledger" section, so the round has nowhere to go.');
  const searchFrom = findingsLedgerMatch.index + findingsLedgerMatch[0].length;
  const nextHeadingMatch = /^## /m.exec(chunkMd.slice(searchFrom));
  if (nextHeadingMatch) {
    const insertAt = searchFrom + nextHeadingMatch.index;
    const before = chunkMd.slice(0, insertAt).trimEnd();
    const after = chunkMd.slice(insertAt);
    return `${before}\n\n${heading}\n\n${after}`;
  }
  return `${chunkMd.trimEnd()}\n\n${heading}\n`;
}

/**
 * Writes a planned verify-run round's heading into `chunkFile`, through `atomicWriteFile` —
 * the ONE atomic write path in the repo (T-176-06: a torn `CHUNK.md` on crash mid-append is
 * mitigated only by never writing any other way).
 */
export async function writeAppendedAuditRound(
  chunkFile: string,
  chunkMd: string,
  heading: string,
): Promise<string> {
  const updated = appendAuditRoundHeading(chunkMd, heading);
  await atomicWriteFile(chunkFile, updated);
  return updated;
}

// -------------------------------------------------------------------------------------------
// #838 — the post-repair helpers as commands `verify/repair-dispatch.md` calls
// -------------------------------------------------------------------------------------------

/** Why a stale chunk cannot take an audit round, said the same way by verify-repair and verify-repair-round. */
function noFindingsLedger(slug: string): string {
  return (
    `${relChunkMdPath(slug)} has no "## Findings Ledger" section, so its rounds have nowhere to go. ` +
    'Add the section build/audit.md describes, then run verify-repair-round again.'
  );
}

/** The run's impact-map entry for a chunk it marked stale, or a refusal naming what is wrong. */
async function staleEntryOf(projectDir: string, runId: string | undefined, chunk: string): Promise<{ runId: string; entry: ImpactMapEntry }> {
  const impactStatus = await verifyImpactStatusCommand({ project: projectDir, runId, quiet: true });
  const entry = impactStatus.entries.find((e) => e.slug === chunk);
  const seeStatus = 'run `boardsmith verify-impact-status` to see which chunks it covers.';
  if (entry === undefined) throw new Error(`Chunk "${chunk}" is not in run ${impactStatus.runId}'s impact map — ${seeStatus}`);
  if (!entry.stale) throw new Error(`Chunk "${chunk}" is not stale in run ${impactStatus.runId}, so it has nothing to repair — ${seeStatus}`);
  // A run whose map has entries always has an id.
  return { runId: impactStatus.runId!, entry };
}

/**
 * `boardsmith verify-repair-round` — opens a stale chunk's next audit round for a verify run by
 * writing its `### Audit Round` heading into the Findings Ledger, or reports `triage` and writes
 * nothing once the run's budget is spent. A round already open with nothing under it is reported
 * again and not written twice (#1302).
 */
export async function verifyRepairRoundCommand(options: {
  project?: string;
  runId?: string;
  chunk: string;
  json?: boolean;
}): Promise<VerifyRunRoundPlan> {
  assertBareName('--chunk', options.chunk, "Pass the stale chunk's slug, the name of its directory under design/chunks/.");
  const projectDir = resolve(options.project ?? process.cwd());
  const { runId } = await staleEntryOf(projectDir, options.runId, options.chunk);

  const chunkMd = await readChunkMdIfExists(projectDir, options.chunk);
  if (chunkMd === undefined) {
    throw new Error(`Chunk "${options.chunk}" has no ${relChunkMdPath(options.chunk)} — check the --chunk slug.`);
  }

  if (!FINDINGS_LEDGER_RE.test(chunkMd)) throw new Error(noFindingsLedger(options.chunk));

  const plan = planVerifyRunRound(chunkMd, runId);
  if (plan.disposition === 'round' && !plan.alreadyOpen) {
    await writeAppendedAuditRound(chunkMdPath(projectDir, options.chunk), chunkMd, plan.heading);
  }

  if (options.json) {
    console.log(JSON.stringify(plan, null, 2));
  } else if (plan.disposition === 'round') {
    console.log(styleText('green', `✓ ${options.chunk}: ${plan.alreadyOpen ? 'still open' : 'opened'} ${plan.heading}`));
  } else {
    console.log(styleText('yellow', `⚠ ${options.chunk}: ${plan.reason}`));
  }
  return plan;
}

/**
 * `boardsmith verify-repair-gate` — one stale chunk's repair gate, once its rounds are closed.
 * Read-only. The gate comes from `verify-impact-status`, which reads the chunk's code as it is
 * now, so it answers for the code after repair (Pitfall 1).
 */
export async function verifyRepairGateCommand(options: {
  project?: string;
  runId?: string;
  chunk: string;
  json?: boolean;
}): Promise<RepairGate> {
  const projectDir = resolve(options.project ?? process.cwd());
  const { gate } = (await staleEntryOf(projectDir, options.runId, options.chunk)).entry;

  if (options.json) {
    console.log(JSON.stringify(gate, null, 2));
  } else {
    // Only a gate that settles the chunk clears its marker; the others need a person.
    console.log(gate.clearMarker ? styleText('green', `✓ ${options.chunk}: ${gate.disposition}`) : styleText('yellow', `⚠ ${options.chunk}: ${gate.disposition}`));
    console.log(`  ${gate.reason}`);
  }
  return gate;
}

// -------------------------------------------------------------------------------------------
// Task 4 (176-03) — verifyRepairStatusCommand: the CLI-facing read-only entry point
// -------------------------------------------------------------------------------------------

export interface RepairStatusRow {
  slug: string;
  scopeLimited: boolean;
  /** Populated only when `scopeLimited` is false — this chunk's fresh staged slice paths. */
  slicePaths?: string[];
  /** Populated only when `scopeLimited` is true — names the unresolved input. */
  scopeLimitedReason?: string;
  /** This chunk's next round for this verify run (a round to dispatch, or triage). */
  roundPlan: VerifyRunRoundPlan;
}

export interface VerifyRepairStatusResult {
  runId?: string;
  /** Every entry from Phase 175's impact map with `stale === true` (decision 5). */
  rows: RepairStatusRow[];
  warnings: string[];
}

/**
 * `boardsmith verify-repair` — CHECK-02's read-only status report: for every chunk Phase 175's
 * impact map marks `stale === true`, resolves its fresh staged slice paths
 * (`resolveStagedSlicePaths`, decision 9 — scope-limited, never a live fallback, decision 10) and
 * plans its next audit round for this run (`planVerifyRunRound`, decision 17). This command computes and reports only — it never
 * dispatches a lens, never writes a `### Audit Round` heading, and never re-derives a repair
 * gate; `verify-repair-round` and `verify-repair-gate` do those last two, called by
 * `verify/repair-dispatch.md`'s orchestration, an agent reading each row this command reports (the same "CLI computes, subagent judges" split CHECK-01 already
 * holds). Findings exit 0 — only a tool failure (unknown run, no chunks/ tree) is non-zero.
 */
export async function verifyRepairStatusCommand(
  options: { project?: string; runId?: string; json?: boolean } = {},
): Promise<VerifyRepairStatusResult> {
  const projectDir = resolve(options.project ?? process.cwd());

  const impactStatus = await verifyImpactStatusCommand({
    project: projectDir,
    runId: options.runId,
    json: false,
    // quiet: true (176-06-discovered bug fix) — without this, verifyImpactStatusCommand's own
    // internal composed calls print a full human report to stdout regardless of THIS command's
    // own --json flag, silently contaminating verify-repair --json's machine-readable output
    // (found live: JSON.parse(stdout) failed on real concatenated human-report text ahead of
    // the real JSON object).
    quiet: true,
  });
  const runId = impactStatus.runId;
  const staleEntries = selectStaleChunks(impactStatus.entries);

  const warnings = [...impactStatus.warnings];
  const rows: RepairStatusRow[] = [];

  if (staleEntries.length > 0 && runId !== undefined) {
    const { classifications } = await readRunLedgerState(projectDir, runId);
    const stagedDir = stagingSlicesDir(projectDir, runId);

    for (const entry of staleEntries) {
      const resolution = resolveStagedSlicePaths(entry, classifications, stagedDir);

      let chunkMd = '';
      try {
        chunkMd = await fs.readFile(chunkMdPath(projectDir, entry.slug), 'utf-8');
      } catch {
        warnings.push(
          `[repair-status] chunk "${entry.slug}" is marked stale but has no readable ` +
            `chunks/${entry.slug}/CHUNK.md — its round plan could not be computed.`,
        );
        continue;
      }

      if (!FINDINGS_LEDGER_RE.test(chunkMd)) {
        warnings.push(`[repair-status] ${noFindingsLedger(entry.slug)}`);
        continue;
      }
      const roundPlan = planVerifyRunRound(chunkMd, runId);

      rows.push({
        slug: entry.slug,
        scopeLimited: resolution.scopeLimited,
        ...(resolution.scopeLimited
          ? { scopeLimitedReason: resolution.reason }
          : { slicePaths: resolution.paths }),
        roundPlan,
      });
    }
  }

  const result: VerifyRepairStatusResult = { runId, rows, warnings };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  console.log(styleText('green', `✓ Repair status — ${rows.length} stale chunk(s)`));
  for (const row of rows) {
    if (row.scopeLimited) {
      console.log(styleText('yellow', `  ${row.slug}: scope-limited — ${row.scopeLimitedReason}`));
    } else if (row.roundPlan.disposition === 'triage') {
      console.log(`  ${row.slug}: round budget exhausted — ${row.roundPlan.reason}`);
    } else {
      console.log(`  ${row.slug}: next round ${row.roundPlan.heading}`);
    }
  }
  for (const warning of warnings) {
    console.log(styleText('yellow', `⚠ ${warning}`));
  }
  return result;
}
