import chalk from 'chalk';
import { isBoardsmithWorkspace } from '../lib/project-context.js';
import { runTool } from '../lib/run-tool.js';
import { selectChecks } from '../lib/select-checks.js';

export interface AuditOptions {
  /** Selector flags — when any is set, only the selected audits run. */
  deadCode?: boolean;
  duplication?: boolean;
}

interface Audit {
  name: string;
  run: (cwd: string) => Promise<number>;
}

/**
 * Code-quality audits. Deliberately not part of `boardsmith lint`: these are
 * slow, advisory sweeps you run after a refactor, not a per-commit gate.
 */
const AUDITS: Record<'deadCode' | 'duplication', Audit> = {
  deadCode: {
    name: 'dead code',
    // Fallow reads its own config from the workspace (.fallow/).
    run: (cwd) => runTool('fallow', [], { cwd }),
  },
  duplication: {
    name: 'duplication',
    run: (cwd) => runTool('jscpd', ['src/', '--min-lines', '10', '--min-tokens', '100'], { cwd }),
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

  const wants = selectChecks({ deadCode: options.deadCode, duplication: options.duplication });

  const audits: Audit[] = [];
  if (wants('deadCode')) audits.push(AUDITS.deadCode);
  if (wants('duplication')) audits.push(AUDITS.duplication);

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
