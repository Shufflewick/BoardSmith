/**
 * `boardsmith catalogue` — does this BoardSmith tree break a catalogue game? (#591)
 *
 * Run from the top of a BoardSmith checkout. It validates each game in the catalogue
 * (`~/BoardSmithGames`, or `--catalogue <folder>`) on the game's committed `main` against the
 * checkout it is run in; `src/cli/lib/catalogue-check.ts` says how, without touching the games'
 * shared checkouts. `.agent-policy.json` runs it in every verify and thread merge.
 */
import chalk from 'chalk';
import { gitOutput as git } from '../lib/git-output.js';
import { DEFAULT_CATALOGUE_ROOT, DEFAULT_GAME_TIME_LIMIT_MS, checkCatalogue, type CatalogueRun } from '../lib/catalogue-check.js';

/** What the command prints for `run`, and whether it passes. */
export function catalogueReport(run: CatalogueRun): { ok: boolean; text: string } {
  const lines: string[] = [];
  for (const result of run.results.filter((r) => r.status !== 'failed')) {
    lines.push(`  ${result.slug}: validates against this tree${result.status === 'cached' ? ' (passed before on these inputs)' : ''}`);
  }
  const failures = run.results.filter((r) => r.status === 'failed');
  for (const failure of failures) {
    lines.push(
      '',
      `${failure.slug} FAILED boardsmith validate on its main (${failure.commit.slice(0, 8)}) against this BoardSmith tree:`,
      (failure.output ?? '').trimEnd(),
      `Either this BoardSmith change broke ${failure.slug}, or its main was already broken. Fix the change, or fix the game in ${failure.dir} and push its main.`,
    );
  }
  if (run.notChecked.length > 0) {
    lines.push('', 'Not checked:', ...run.notChecked.map((n) => `  ${n.slug}: ${n.reason}`));
  }
  return { ok: failures.length === 0, text: lines.join('\n') };
}

/** `--skip` entries, each `<game>=<reason>`, by game. A skip with no reason is refused. */
export function parseSkips(entries: string[]): Record<string, string> {
  const skips: Record<string, string> = {};
  for (const entry of entries) {
    const at = entry.indexOf('=');
    const slug = at === -1 ? entry : entry.slice(0, at);
    const reason = at === -1 ? '' : entry.slice(at + 1).trim();
    if (reason === '') throw new Error(`--skip ${slug} has no reason. Write it as --skip "${slug}=<why, with the issue that tracks it>".`);
    skips[slug] = reason;
  }
  return skips;
}

/** `--time-limit` in minutes, as milliseconds. */
function parseTimeLimit(minutes: string | undefined): number {
  if (minutes === undefined) return DEFAULT_GAME_TIME_LIMIT_MS;
  const value = Number(minutes);
  if (!(value > 0)) throw new Error(`--time-limit ${minutes} is not a number of minutes above zero.`);
  return value * 60_000;
}

export async function catalogueCommand(options: { catalogue?: string; skip?: string[]; timeLimit?: string }): Promise<void> {
  try {
    const tree = (await git(process.cwd(), ['rev-parse', '--show-toplevel'])).trim();
    const run = await checkCatalogue({
      tree,
      catalogueRoot: options.catalogue ?? DEFAULT_CATALOGUE_ROOT,
      skip: parseSkips(options.skip ?? []),
      timeLimitMs: parseTimeLimit(options.timeLimit),
    });
    const report = catalogueReport(run);
    console.log(report.text);
    if (report.ok) console.log(chalk.green(`\nEvery catalogue game validates against this tree.`));
    else process.exitCode = 1;
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
