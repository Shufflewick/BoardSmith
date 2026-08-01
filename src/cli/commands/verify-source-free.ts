import { resolve } from 'node:path';
import chalk from 'chalk';
import {
  computeVerificationScope,
  SCOPE_CODE_ONLY,
  SCOPE_FULL,
  type ScopeReason,
} from './chunk-provenance.js';

/**
 * `verify-source-free.ts` — the ONE definition of which `/bs-verify-game` pipeline step maps to
 * which designer-facing defect class goes unchecked when that step cannot run (VERIFY-09).
 *
 * WHY THIS IS THE ONLY COPY
 *
 * This milestone has hit drift-by-duplication repeatedly — five annotation regexes, two
 * presentation-line rules, a scope-recording mechanism built on the wrong pipeline path
 * (179-CONTEXT.md `<measured_reality>` #2). `VERIFY_PIPELINE_STEPS` below is the single source of
 * truth for the step -> defect-class mapping. A second copy of this mapping ANYWHERE in the
 * repo — including skill prose — is exactly that failure recurring. `verify-source-free.test.ts`
 * enforces both directions: that this file covers every `## Step N:` heading in
 * `src/cli/slash-command/bs/verify-game.md`, and that no second declaration of
 * `VERIFY_PIPELINE_STEPS` exists anywhere under `src/`.
 *
 * Decision 1 (179-CONTEXT.md): source-free mode is a CONSEQUENCE of disk state, never a choice.
 * This module accepts no `--source-free` flag, no `force`, no `assume`, no `override` — the mode
 * is derived from `computeVerificationScope(projectDir)` alone, exactly as `chunk-provenance.ts`'s
 * `computeVerificationScope` itself accepts no scope-override parameter for the identical reason.
 *
 * Steps 2-6 do not run source-free because each consumes a FRESH RE-TRANSCRIPTION of the source
 * rulebook (179-CONTEXT.md `<measured_reality>` #4) — with no source there is no fresh
 * transcription, so these steps have no input, not merely no appetite. Steps 0, 1, 7, 8, and 9 run
 * unchanged: CHECK-04 (Step 7) and CHECK-06 (Step 8) are source-free by construction (Phase 172,
 * 177, 178), and Steps 0, 1, and 9 are state/lock/close bookkeeping that never reads the source.
 */

/** One `unchecked` entry: a designer-facing defect class, plus the check that would have caught
 * it. `defectClass` is prose a designer can read without knowing this pipeline's internals — never
 * a step number, never a requirement id (179-CONTEXT.md decision 6). */
export interface UncheckedDefectClass {
  defectClass: string;
  wouldHaveBeenCaughtBy: string;
}

/** A source-free check reached by `/bs-verify-game` outside the numbered step sequence, or (via
 * `VerifyPipelineStep.check`) the CLI command a numbered step itself dispatches. */
export interface SourceFreeCheck {
  command: string;
  checkId: string;
}

/** One entry in `VERIFY_PIPELINE_STEPS` — one `## Step N:` heading in `verify-game.md`. */
export interface VerifyPipelineStep {
  step: number;
  id: string;
  /** Must equal the heading text in `verify-game.md` verbatim (everything after `## Step N: `). */
  title: string;
  sourceFreeBehavior: 'runs' | 'skipped';
  /** Non-empty only when `sourceFreeBehavior` is `'skipped'`. */
  unchecked: UncheckedDefectClass[];
  /** Present only for a step that itself dispatches a named CLI check (Steps 7 and 8). */
  check?: SourceFreeCheck;
}

/**
 * One entry per `## Step N:` heading currently in `src/cli/slash-command/bs/verify-game.md` —
 * Steps 0 through 9. `verify-source-free.test.ts`'s coverage test fails the moment a step is added
 * to that file without a matching entry added here, or vice versa.
 */
export const VERIFY_PIPELINE_STEPS: readonly VerifyPipelineStep[] = Object.freeze([
  {
    step: 0,
    id: 'state-detection-and-lock',
    title: 'State Detection and Lock (VERIFY-01)',
    sourceFreeBehavior: 'runs',
    unchecked: [],
  },
  {
    step: 1,
    id: 'source-resolution',
    title: 'Source Resolution (VERIFY-01)',
    sourceFreeBehavior: 'runs',
    unchecked: [],
  },
  {
    step: 2,
    id: 'staging-run-and-re-transcription',
    title: 'Staging Run and Re-Transcription (VERIFY-02, VERIFY-07, VERIFY-08)',
    sourceFreeBehavior: 'skipped',
    unchecked: [
      {
        defectClass:
          'rulebook-fidelity drift between the live rules text and the source rulebook',
        wouldHaveBeenCaughtBy: 'the staging-dispatch re-transcription pass',
      },
    ],
  },
  {
    step: 3,
    id: 'classification',
    title: 'Classification (VERIFY-03, VERIFY-07)',
    sourceFreeBehavior: 'skipped',
    unchecked: [
      {
        defectClass: 'wording-change-versus-rules-change discrimination in the live text',
        wouldHaveBeenCaughtBy: 'the classification-dispatch pairwise comparison',
      },
    ],
  },
  {
    step: 4,
    id: 'adjudication-gate-and-impact-map',
    title: 'Adjudication Gate and Impact Map (VERIFY-04, VERIFY-05, VERIFY-06)',
    sourceFreeBehavior: 'skipped',
    unchecked: [
      {
        defectClass: 'unadjudicated contradictions and cross-chunk rules-staleness',
        wouldHaveBeenCaughtBy: 'the adjudication gate and its impact map',
      },
    ],
  },
  {
    step: 5,
    id: 'ruling-re-check',
    title: 'Ruling Re-Check (CHECK-01)',
    sourceFreeBehavior: 'skipped',
    unchecked: [
      {
        defectClass: 'a recorded ruling that no longer matches the current source',
        wouldHaveBeenCaughtBy: 'the ruling-recheck dispatch against fresh staged text',
      },
    ],
  },
  {
    step: 6,
    id: 'repair-dispatch',
    title: 'Repair Dispatch (CHECK-02)',
    sourceFreeBehavior: 'skipped',
    unchecked: [
      {
        defectClass: 'a stale chunk left unrepaired through the build-pipeline audit lenses',
        wouldHaveBeenCaughtBy: 'the repair-dispatch audit-and-repair loop',
      },
    ],
  },
  {
    step: 7,
    id: 'derived-line-re-check',
    title: 'Derived-Line Re-Check (CHECK-04)',
    sourceFreeBehavior: 'runs',
    unchecked: [],
    check: { command: 'verify-derive-check', checkId: 'CHECK-04' },
  },
  {
    step: 8,
    id: 'worked-example-replay',
    title: 'Worked-Example Replay (CHECK-06)',
    sourceFreeBehavior: 'runs',
    unchecked: [],
    check: { command: 'verify-example-replay', checkId: 'CHECK-06' },
  },
  {
    step: 9,
    id: 'close',
    title: 'Close (VERIFY-02)',
    sourceFreeBehavior: 'runs',
    unchecked: [],
  },
] as const);

/**
 * The two checks source-free mode reaches that `verify-game.md`'s numbered steps do not
 * themselves invoke — `trace-check` (CHECK-03) and `drift-check` (CHECK-05), both source-free by
 * construction since Phase 172. Combined with Steps 7 and 8's own `check` fields, these are the
 * full set of four checks a source-free pass still runs — decision 11(d): a mode that reports
 * honestly about running nothing is a banner, not a verification pass.
 */
export const SOURCE_FREE_ADDITIONAL_CHECKS: readonly SourceFreeCheck[] = Object.freeze([
  { command: 'trace-check', checkId: 'CHECK-03' },
  { command: 'drift-check', checkId: 'CHECK-05' },
] as const);

/** One `uncheckedDefectClasses` entry, with the owning step's `id` attached so a reader can trace
 * a defect class back to the step that would have caught it. */
export interface SourceFreeUncheckedEntry extends UncheckedDefectClass {
  stepId: string;
}

/**
 * `computeSourceFreeReport`'s pure, disk-state-only result. `scope` and `reason` are a verbatim
 * pass-through of `computeVerificationScope(projectDir)` — this module never re-derives either
 * itself and never accepts them from a caller (179-CONTEXT.md decision 1).
 */
export interface SourceFreeReport {
  sourceFree: boolean;
  scope: typeof SCOPE_FULL | typeof SCOPE_CODE_ONLY;
  reason?: ScopeReason;
  stepsRun: VerifyPipelineStep[];
  stepsSkipped: VerifyPipelineStep[];
  uncheckedDefectClasses: SourceFreeUncheckedEntry[];
  checksRun: SourceFreeCheck[];
}

/**
 * Computes a project's source-free report from disk state alone. Takes exactly ONE parameter —
 * the project directory — mirroring `computeVerificationScope`'s own one-parameter contract. Do
 * NOT add a `scope`, `assume`, `force`, or `sourceFree` override parameter, now or ever: the mode
 * is a consequence of the project's actual state, never a caller's claim (decision 1).
 *
 * Pure of process concerns: no console output, no exit codes, no writes. The CLI wrapper (plan
 * 02) owns presentation; this function owns computation only.
 */
export async function computeSourceFreeReport(projectDir: string): Promise<SourceFreeReport> {
  const verificationScope = await computeVerificationScope(projectDir);
  const sourceFree = verificationScope.scope === SCOPE_CODE_ONLY;

  // A full-scope pass runs every step (nothing is unreachable — source is present and verified),
  // so `stepsRun`/`stepsSkipped` only diverge from "everything runs" once `sourceFree` is true.
  // Either way the two arrays partition `VERIFY_PIPELINE_STEPS`: their union is every step, their
  // intersection is empty.
  const stepsSkippedAll = VERIFY_PIPELINE_STEPS.filter(
    (s) => s.sourceFreeBehavior === 'skipped',
  ).slice();

  const stepsRun = sourceFree
    ? VERIFY_PIPELINE_STEPS.filter((s) => s.sourceFreeBehavior === 'runs').slice()
    : VERIFY_PIPELINE_STEPS.slice();
  const stepsSkipped = sourceFree ? stepsSkippedAll : [];
  const uncheckedDefectClasses: SourceFreeUncheckedEntry[] = sourceFree
    ? stepsSkippedAll.flatMap((step) =>
        step.unchecked.map((entry) => ({ ...entry, stepId: step.id })),
      )
    : [];

  const checksRun: SourceFreeCheck[] = [
    ...SOURCE_FREE_ADDITIONAL_CHECKS,
    ...VERIFY_PIPELINE_STEPS.filter((s) => s.check).map((s) => s.check as SourceFreeCheck),
  ];

  return {
    sourceFree,
    scope: verificationScope.scope,
    reason: verificationScope.reason,
    stepsRun,
    stepsSkipped,
    uncheckedDefectClasses,
    checksRun,
  };
}

// -------------------------------------------------------------------------------------------
// verifySourceFreeCheckCommand — the read/report CLI surface (179-02)
// -------------------------------------------------------------------------------------------

export interface VerifySourceFreeCheckOptions {
  project?: string;
  json?: boolean;
}

/**
 * `boardsmith verify-source-free-check` — the one read-only CLI surface the skill formats. It
 * RENDERS `computeSourceFreeReport`'s result; it computes nothing itself and accepts no override
 * of any field that function returns.
 *
 * NO `--source-free`, `--force`, `--assume-full`, `--force-scope`, or equivalent flag exists here,
 * now or ever (179-CONTEXT.md decision 1 / T-179-06): source-free mode is a CONSEQUENCE of the
 * project's actual disk state, never a caller's claim. A flag here would let a caller declare
 * reduced scope on a project that HAS source — verification-skipping that still looks verified.
 *
 * ADVISORY, EXIT 0 UNCONDITIONALLY on both a source-free AND a full-scope project — a reduced
 * pass is a SUCCESSFUL pass, never a failure. Non-zero is reserved for genuine tool failure (an
 * unreadable `--project` directory), which `computeVerificationScope`'s own read path throws for;
 * this function never assigns `process.exitCode` itself.
 *
 * `--project` is resolved with `resolve()` before any filesystem access (via
 * `computeSourceFreeReport` -> `computeVerificationScope`), matching every sibling read command
 * (`verify-derive-check`, `verify-example-replay`) so a relative path is normalised once at the
 * boundary.
 */
export async function verifySourceFreeCheckCommand(
  options: VerifySourceFreeCheckOptions = {},
): Promise<SourceFreeReport> {
  const projectDir = resolve(options.project ?? process.cwd());
  const report = await computeSourceFreeReport(projectDir);

  // `--json` emits the result and nothing else on stdout.
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  if (report.sourceFree) {
    console.log(
      chalk.yellow(
        `⚠ Source-free mode — scope: ${report.scope}${
          report.reason ? ` (${report.reason})` : ''
        }`,
      ),
    );
    console.log(
      `  ${report.stepsRun.length} of ${VERIFY_PIPELINE_STEPS.length} pipeline step(s) run; ` +
        `${report.stepsSkipped.length} skipped for lack of input.`,
    );
    console.log(`  ${report.checksRun.length} source-free check(s) still run:`);
    for (const check of report.checksRun) {
      console.log(`    - ${check.command} (${check.checkId})`);
    }
    console.log(`  ${report.uncheckedDefectClasses.length} defect class(es) go unchecked:`);
    for (const entry of report.uncheckedDefectClasses) {
      console.log(`    - ${entry.defectClass} — would have been caught by ${entry.wouldHaveBeenCaughtBy}`);
    }
  } else {
    console.log(chalk.green(`✓ Full scope — every pipeline step runs; nothing is skipped.`));
    console.log(`  ${report.checksRun.length} source-free check(s) among the steps that ran:`);
    for (const check of report.checksRun) {
      console.log(`    - ${check.command} (${check.checkId})`);
    }
  }

  return report;
}
