import chalk from 'chalk';
import { relative, resolve } from 'node:path';
import { driftCheckCommand } from './drift-check.js';
import {
  computeVerificationScope,
  recordVerifiedAgainst,
  SCOPE_CODE_ONLY,
  SCOPE_FULL,
  type ScopeReason,
} from './chunk-provenance.js';
import { ledgerFilePath, parseLedgerBody, readLedgerOrThrow } from './verify-run.js';

/**
 * `verify-close-record.ts` — the durable write a verify pass's Close performs (179-CONTEXT.md
 * measured_reality #2 CORRECTED, decision "WIRE IT"). Before this module, the ONLY function that
 * ever wrote a chunk's `## Verified Against` block was `chunkCheckCommand` (`chunk-provenance.ts`),
 * and every one of its call sites lived in the BUILD pipeline — `/bs-verify-game` never dispatched
 * it. PROV-02 ("a verification that could not re-read source records its scope as
 * code-conformance-only") was closed (Phase 171) on the build path only; the mechanism was
 * unreachable from the pipeline its own text describes. This module is the fix: it reuses the
 * SAME fenced writer (`recordVerifiedAgainst`), never a second write path.
 *
 * SCOPED TO TOUCHED CHUNKS ONLY. `computeTouchedChunks` derives the evaluated set from a check's
 * OWN RESULT (`driftCheckCommand`'s `chunks[].chunk`) — never from a directory listing of
 * `chunks/` taken in this module. A directory-listing sweep would make a Close a blanket rewrite
 * of chunks the pass never evaluated; the honest scope of a Close write is what the pass actually
 * looked at.
 *
 * NEVER A GATE. `verifyCloseRecordCommand` exits 0 on every outcome except a tool failure that
 * prevented the command from running at all — including when `errors[]` is non-empty. A Close
 * reports; it does not gate. This is deliberately UNLIKE `chunk-check`, which repairs-then-fails —
 * exactly why the writer is extracted rather than the command reused (179-03-PLAN.md
 * `<the_extraction_is_the_risk>`).
 *
 * NO SCOPE-DECLARING OPTION OF ANY KIND is registered for this command — scope comes only from
 * `computeVerificationScope(projectDir)` and disk state, per 171-CONTEXT.md decision 1. A caller
 * cannot claim `full` on a project that lacks source, here or anywhere else in this codebase.
 */

export interface TouchedChunksOptions {
  runId?: string;
}

/**
 * Derives the sorted, de-duplicated set of chunk slugs a verify pass evaluated: every chunk
 * `driftCheckCommand` classified (`chunks[].chunk` — a chunk with no readable `CHUNK.md` is never
 * classified, so it never appears here), UNIONED — only when `runId` is supplied — with the
 * affected slugs recorded in that run's ledger `impact` records.
 *
 * MUST NOT enumerate the `chunks/` directory itself — see this module's header comment.
 */
export async function computeTouchedChunks(
  projectDir: string,
  options: TouchedChunksOptions = {},
): Promise<string[]> {
  const drift = await driftCheckCommand({ project: projectDir, quiet: true });
  const slugs = new Set<string>(drift.chunks.map((c) => c.chunk));

  if (options.runId) {
    const ledgerFile = ledgerFilePath(projectDir, options.runId);
    const relLedgerPath = relative(projectDir, ledgerFile);
    const ledgerText = await readLedgerOrThrow(ledgerFile, options.runId, projectDir);
    const { lines } = parseLedgerBody(ledgerText, relLedgerPath);
    for (const line of lines) {
      if (line.type === 'impact') {
        slugs.add(line.record.slug);
      }
    }
  }

  return [...slugs].sort();
}

export interface VerifyCloseRecordResult {
  scope: typeof SCOPE_FULL | typeof SCOPE_CODE_ONLY;
  reason?: ScopeReason;
  runId?: string;
  recorded: Array<{ slug: string; changed: boolean }>;
  errors: Array<{ slug: string; message: string }>;
}

export interface VerifyCloseRecordOptions {
  project?: string;
  run?: string;
  json?: boolean;
}

/**
 * `boardsmith verify-close-record` — a verify pass's Close writes durable `## Verified Against`
 * provenance for exactly the chunks it evaluated, through `recordVerifiedAgainst` — the ONE fenced
 * writer this command shares with `chunk-check`.
 *
 * Per-chunk failures (a missing `CHUNK.md`, a hand-authored section with its fences removed) are
 * caught individually, land in `errors[]` with the writer's own message, are printed loudly to
 * stderr, and do NOT abort the remaining chunks — a Close that could not record a chunk must say
 * which chunk and why, never swallow it silently. This command never assigns a non-zero exit
 * status: exit is always 0 absent a genuine tool failure (an unreadable `--project`, a missing run
 * ledger when `--run` names one that does not exist) that prevented the command from running at
 * all.
 */
export async function verifyCloseRecordCommand(
  options: VerifyCloseRecordOptions = {},
): Promise<VerifyCloseRecordResult> {
  const projectDir = resolve(options.project ?? process.cwd());

  const scope = await computeVerificationScope(projectDir);
  const touched = await computeTouchedChunks(projectDir, { runId: options.run });

  const recorded: Array<{ slug: string; changed: boolean }> = [];
  const errors: Array<{ slug: string; message: string }> = [];

  for (const slug of touched) {
    try {
      const result = await recordVerifiedAgainst(slug, { project: projectDir });
      recorded.push({ slug: result.slug, changed: result.changed });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ slug, message });
    }
  }

  const result: VerifyCloseRecordResult = {
    scope: scope.scope,
    reason: scope.reason,
    ...(options.run ? { runId: options.run } : {}),
    recorded,
    errors,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  console.log(
    `${result.scope}${result.reason ? ` (${result.reason})` : ''}` +
      (result.runId ? ` — run ${result.runId}` : ''),
  );
  const changedCount = recorded.filter((r) => r.changed).length;
  const currentCount = recorded.length - changedCount;
  console.log(`${changedCount} written, ${currentCount} already current`);

  if (errors.length > 0) {
    console.error(chalk.red(`${errors.length} chunk(s) could not be recorded:`));
    for (const e of errors) {
      console.error(chalk.red(`  ${e.slug}: ${e.message}`));
    }
  }

  return result;
}
