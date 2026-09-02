import chalk from 'chalk';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isBoardsmithWorkspace } from '../lib/project-context.js';
import { runTool } from '../lib/run-tool.js';
import { selectChecks } from '../lib/select-checks.js';
import {
  compareHealthBaselines,
  describeBaselineDrift,
  type HealthBaseline,
} from '../lib/health-baseline.js';

export interface AuditOptions {
  /** Selector flags — when any is set, only the selected audits run. */
  deadCode?: boolean;
  duplication?: boolean;
  healthBaseline?: boolean;
}

/** The committed baseline `fallow audit` subtracts its findings against. */
const HEALTH_BASELINE_FILE = '.fallow-health-baseline.json';

/**
 * Save a fresh health baseline to `path`. Injected in tests so the check's own
 * logic is provable without running fallow.
 */
export type SaveHealthBaseline = (path: string, cwd: string) => Promise<number>;

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

interface Audit {
  name: string;
  run: (cwd: string) => Promise<number>;
}

/**
 * Code-quality audits. Deliberately not part of `boardsmith lint`: these are
 * slow, advisory sweeps you run after a refactor, not a per-commit gate.
 */
const AUDITS: Record<'deadCode' | 'duplication' | 'healthBaseline', Audit> = {
  deadCode: {
    name: 'dead code',
    // Fallow reads its own config from the workspace (.fallow/).
    run: (cwd) => runTool('fallow', [], { cwd }),
  },
  duplication: {
    name: 'duplication',
    run: (cwd) => runTool('jscpd', ['src/', '--min-lines', '10', '--min-tokens', '100'], { cwd }),
  },
  healthBaseline: {
    name: 'health baseline',
    run: async (cwd) => {
      const { code, report } = await runHealthBaselineCheck(cwd);
      console.log(code === 0 ? chalk.dim(report) : chalk.yellow(report));
      return code;
    },
  },
};

/**
 * Run BoardSmith's code-quality audits.
 *
 * With no flags both audits run; pass `--dead-code` or `--duplication` to run
 * just one. Exits non-zero if any audit reports failure, so it can gate a
 * refactor.
 */
export async function auditCommand(options: AuditOptions): Promise<void> {
  const cwd = process.cwd();

  if (!isBoardsmithWorkspace(cwd)) {
    console.error(chalk.red('Error: not a BoardSmith workspace'));
    console.error(chalk.dim('Run this from a game project (has boardsmith.json) or the BoardSmith repo.'));
    process.exit(1);
  }

  const wants = selectChecks({
    deadCode: options.deadCode,
    duplication: options.duplication,
    healthBaseline: options.healthBaseline,
  });

  const audits: Audit[] = [];
  if (wants('deadCode')) audits.push(AUDITS.deadCode);
  if (wants('duplication')) audits.push(AUDITS.duplication);
  if (wants('healthBaseline')) audits.push(AUDITS.healthBaseline);

  const failed: string[] = [];
  for (const audit of audits) {
    console.log(chalk.cyan(`\nAuditing ${audit.name}...\n`));
    const code = await audit.run(cwd);
    if (code !== 0) failed.push(audit.name);
  }

  if (failed.length > 0) {
    console.error(chalk.red(`\nAudit reported findings: ${failed.join(', ')}\n`));
    process.exit(1);
  }

  console.log(chalk.green(`\nAudit clean (${audits.map((a) => a.name).join(', ')})\n`));
}
