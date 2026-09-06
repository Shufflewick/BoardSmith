import chalk from 'chalk';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { requireBoardsmithWorkspace } from '../lib/project-context.js';
import { runTool, runToolCapturingStdout } from '../lib/run-tool.js';
import { selectChecks } from '../lib/select-checks.js';
import {
  compareHealthBaselines,
  describeBaselineDrift,
  type HealthBaseline,
} from '../lib/health-baseline.js';

export interface AuditOptions {
  /** Selector flags — when any is set, only the selected audits run. */
  changes?: boolean;
  duplication?: boolean;
  healthBaseline?: boolean;
  /** Git ref the changed-files audit diffs against, overriding fallow's own base detection. */
  since?: string;
  /** Report the whole repository's accepted debt instead of running the gate. */
  backlog?: boolean;
}

/** The committed baseline `fallow audit` subtracts its findings against. */
const HEALTH_BASELINE_FILE = '.fallow-health-baseline.json';

/**
 * Save a fresh health baseline to `path`. Injected in tests so the check's own
 * logic is provable without running fallow.
 */
type SaveHealthBaseline = (path: string, cwd: string) => Promise<number>;

const saveHealthBaselineWithFallow: SaveHealthBaseline = (path, cwd) =>
  runTool('fallow', ['health', '--save-baseline', path], { cwd });

/**
 * Is the committed health baseline still an accurate record of this tree
 * (#159)?
 *
 * The baseline is generated and nothing keeps it in sync. When it drifts, the
 * next change touching a drifted file is blocked on debt it did not introduce
 * — a failure that reads as the gate catching something rather than as a stale
 * file. Running the comparison here makes the drift itself the finding.
 *
 * Returns the exit code and the report rather than printing, so the check is
 * testable without capturing stdout.
 */
export async function runHealthBaselineCheck(
  cwd: string,
  saveBaseline: SaveHealthBaseline = saveHealthBaselineWithFallow,
): Promise<{ code: number; report: string }> {
  const committedPath = join(cwd, HEALTH_BASELINE_FILE);
  if (!existsSync(committedPath)) {
    return {
      code: 0,
      report: `Skipped: this project keeps no ${HEALTH_BASELINE_FILE}, so there is nothing to drift.`,
    };
  }

  const scratch = mkdtempSync(join(tmpdir(), 'boardsmith-health-'));
  const freshPath = join(scratch, 'fresh-baseline.json');
  try {
    // `fallow health` exits non-zero whenever the tree has findings above a
    // threshold -- which this repo's backlog guarantees -- while still writing
    // the baseline. The FILE is the signal here, not the exit code.
    const code = await saveBaseline(freshPath, cwd);
    if (!existsSync(freshPath)) {
      return {
        code: 1,
        report:
          `\`fallow health --save-baseline\` wrote no baseline to compare against `
          + `(exit ${code}), so drift in ${HEALTH_BASELINE_FILE} cannot be ruled out.`,
      };
    }

    const committed = JSON.parse(readFileSync(committedPath, 'utf-8')) as HealthBaseline;
    const fresh = JSON.parse(readFileSync(freshPath, 'utf-8')) as HealthBaseline;
    const drift = compareHealthBaselines(committed, fresh);

    if (drift.length === 0) {
      return { code: 0, report: `${HEALTH_BASELINE_FILE} still describes this tree.` };
    }
    return { code: 1, report: describeBaselineDrift(drift) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * What one audit concluded. `nothing-to-check` is its own answer because a
 * clean report over zero files is not a pass, and printing it as one is how a
 * gate stops meaning anything (#176).
 */
type AuditOutcome = 'pass' | 'fail' | 'nothing-to-check';

/** The two ways `boardsmith audit` invokes `fallow audit`. Injected in tests. */
interface FallowAuditRunner {
  /** `fallow audit <args>`, stdout captured for the caller to parse. */
  capture: (args: string[]) => Promise<{ code: number; stdout: string }>;
  /** `fallow audit <args>`, output streamed to the developer's terminal. */
  stream: (args: string[]) => Promise<number>;
}

const fallowAuditRunner = (cwd: string): FallowAuditRunner => ({
  capture: (args) => runToolCapturingStdout('fallow', ['audit', ...args], { cwd }),
  stream: (args) => runTool('fallow', ['audit', ...args], { cwd }),
});

/** The fields of `fallow audit --format json` this command reasons about. */
interface FallowAuditReport {
  verdict: string;
  changed_files_count: number;
  base_ref: string;
}

function isFallowAuditReport(value: unknown): value is FallowAuditReport {
  const report = value as Partial<FallowAuditReport> | null;
  return (
    typeof report === 'object'
    && report !== null
    && typeof report.verdict === 'string'
    && typeof report.changed_files_count === 'number'
    && typeof report.base_ref === 'string'
  );
}

const files = (n: number) => `${n} changed file${n === 1 ? '' : 's'}`;

/**
 * Audit what this branch changed (#176).
 *
 * `fallow audit` is the baseline-aware command: it reads the three baselines
 * named in `.fallowrc.json` and reports only the files changed against the base
 * branch, so it answers "did my change introduce anything?". A bare `fallow`
 * reads no baseline and sweeps the whole repository, so it reported the
 * accepted backlog and exited 1 on every tree — a gate that cannot pass is a
 * gate people learn to skip.
 *
 * The verdict comes from fallow's JSON report rather than its human output: the
 * human report is for the developer to read, and a rewording of it must not be
 * able to change what the gate concludes.
 */
export async function runChangedFilesAudit(
  runner: FallowAuditRunner,
  since?: string,
): Promise<{ outcome: AuditOutcome; report: string }> {
  const scope = since ? ['--changed-since', since] : [];
  const { code, stdout } = await runner.capture([...scope, '--format', 'json', '--quiet']);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = undefined;
  }
  if (!isFallowAuditReport(parsed)) {
    return {
      outcome: 'fail',
      report:
        `\`fallow audit\` exited ${code} without a readable JSON verdict, so nothing was audited.\n`
        + 'Run `npx fallow audit` here to see what it reported.',
    };
  }

  if (parsed.changed_files_count === 0) {
    return {
      outcome: 'nothing-to-check',
      report:
        `No files changed against ${parsed.base_ref}, so this audit checked nothing.\n`
        + 'Audit a wider range with `boardsmith audit --since <ref>`, or report the whole '
        + 'repository with `boardsmith audit --backlog`.',
    };
  }

  const scoped = `${files(parsed.changed_files_count)} vs ${parsed.base_ref}`;
  if (parsed.verdict === 'pass') {
    return {
      outcome: 'pass',
      report: `No new findings in ${scoped} (the repo's baselines applied).`,
    };
  }

  // The developer needs the findings themselves, not a count of them.
  await runner.stream(scope);

  // fallow grades a run `pass`, `warn` or `fail`, and only `fail` is a verdict
  // it exits non-zero on. Promoting a `warn` to a blocked commit here would
  // invent a stricter rule than the tool it delegates to — and the things that
  // warn (two structurally similar tests, say) are exactly the noise that
  // teaches people to stop reading the gate.
  return {
    outcome: parsed.verdict === 'fail' ? 'fail' : 'pass',
    report: `fallow audit verdict: ${parsed.verdict} — ${scoped}.`,
  };
}

interface Audit {
  name: string;
  run: (cwd: string) => Promise<AuditOutcome>;
}

const outcomeOf = (code: number): AuditOutcome => (code === 0 ? 'pass' : 'fail');

/**
 * Code-quality audits. Deliberately not part of `boardsmith lint`: these are
 * slow, advisory sweeps you run after a refactor, not a per-commit gate.
 */
function buildAudits(options: AuditOptions): Record<'changes' | 'duplication' | 'healthBaseline', Audit> {
  return {
    changes: {
      name: 'changed files',
      run: async (cwd) => {
        const { outcome, report } = await runChangedFilesAudit(fallowAuditRunner(cwd), options.since);
        console.log(outcome === 'pass' ? chalk.dim(report) : chalk.yellow(report));
        return outcome;
      },
    },
    duplication: {
      name: 'duplication',
      run: async (cwd) =>
        outcomeOf(await runTool('jscpd', ['src/', '--min-lines', '10', '--min-tokens', '100'], { cwd })),
    },
    healthBaseline: {
      name: 'health baseline',
      run: async (cwd) => {
        const { code, report } = await runHealthBaselineCheck(cwd);
        console.log(code === 0 ? chalk.dim(report) : chalk.yellow(report));
        return outcomeOf(code);
      },
    },
  };
}

/**
 * Report the whole repository's dead code — every finding, baselines and
 * changed-file scope both set aside.
 *
 * This is a report, not a gate, and it exits 0 whatever it finds. Its exit code
 * would otherwise be 1 on every tree that carries any accepted debt, which is
 * precisely the meaningless verdict #176 was about. The gate is
 * `boardsmith audit`.
 */
async function reportBacklog(cwd: string): Promise<void> {
  console.log(chalk.cyan('\nWhole-repository dead-code backlog...\n'));
  await runTool('fallow', [], { cwd });
  console.log(
    chalk.yellow(
      '\nThis is a report of the whole repository, baselines set aside — not a verdict on '
      + 'your change.\nThe gate is `boardsmith audit`; see docs/fallow-gate.md.\n',
    ),
  );
}

/**
 * Run BoardSmith's code-quality audits.
 *
 * With no flags every audit runs; pass `--changes`, `--duplication` or
 * `--health-baseline` to run just one. Exits non-zero if any audit reports
 * findings, so it can gate a refactor.
 */
export async function auditCommand(options: AuditOptions): Promise<void> {
  const cwd = process.cwd();

  requireBoardsmithWorkspace(cwd);

  if (options.backlog) {
    if (options.changes || options.duplication || options.healthBaseline || options.since) {
      console.error(chalk.red('Error: --backlog is a whole-repository report, not one of the gate\'s checks.'));
      console.error(chalk.dim('Run `boardsmith audit --backlog` on its own.'));
      process.exit(1);
    }
    await reportBacklog(cwd);
    return;
  }

  const wants = selectChecks({
    changes: options.changes,
    duplication: options.duplication,
    healthBaseline: options.healthBaseline,
  });

  const all = buildAudits(options);
  const audits: Audit[] = [];
  if (wants('changes')) audits.push(all.changes);
  if (wants('duplication')) audits.push(all.duplication);
  if (wants('healthBaseline')) audits.push(all.healthBaseline);

  const failed: string[] = [];
  const checked: string[] = [];
  for (const audit of audits) {
    console.log(chalk.cyan(`\nAuditing ${audit.name}...\n`));
    const outcome = await audit.run(cwd);
    if (outcome === 'fail') failed.push(audit.name);
    if (outcome !== 'nothing-to-check') checked.push(audit.name);
  }

  if (failed.length > 0) {
    console.error(chalk.red(`\nAudit reported findings: ${failed.join(', ')}\n`));
    process.exit(1);
  }

  // Never report a green tick for a run that looked at nothing.
  if (checked.length === 0) {
    console.log(chalk.yellow('\nAudit checked nothing — no verdict to give.\n'));
    return;
  }

  console.log(chalk.green(`\nAudit clean (${checked.join(', ')})\n`));
}
