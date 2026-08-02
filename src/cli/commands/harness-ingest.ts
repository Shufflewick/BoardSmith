import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import { getProjectContext } from '../lib/project-context.js';

/** Harness driver script, relative to the BoardSmith repo root. */
const HARNESS_SCRIPT = join('scripts', 'ingest-harness', 'run.mjs');

/**
 * Drive the live-agent `/bs-ingest-rules` produced-artifact harness.
 *
 * Operator-invoked and non-deterministic by design — it drives a real headless
 * `claude` session — so it is deliberately outside `boardsmith test`. All flags
 * are forwarded verbatim to the harness; run with `--help` for its options.
 */
export async function harnessIngestCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();

  if (getProjectContext(cwd) !== 'monorepo') {
    console.error(chalk.red('Error: boardsmith harness-ingest runs in the BoardSmith library repo'));
    console.error(chalk.dim('It drives the repo\'s own bs- skill sources; there is nothing to harness in a game project.'));
    process.exit(1);
  }

  const script = join(cwd, HARNESS_SCRIPT);
  if (!existsSync(script)) {
    console.error(chalk.red(`Error: harness script not found at ${HARNESS_SCRIPT}`));
    console.error(chalk.dim('Run this from the BoardSmith repo root.'));
    process.exit(1);
  }

  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, stdio: 'inherit' });
    child.on('error', (error) => reject(error));
    child.on('close', (exitCode, signal) => resolve(signal ? 1 : exitCode ?? 1));
  });

  if (code !== 0) process.exit(code);
}
