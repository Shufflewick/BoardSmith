/**
 * `boardsmith catalogue` — does this BoardSmith tree break a catalogue game? (#591)
 *
 * Run from the top of a BoardSmith checkout. It validates, and loads the test files of, each game in the catalogue
 * (`~/BoardSmithGames`, or `--catalogue <folder>`) on the game's committed `main`, or its branch
 * named as the checkout's branch (#1322), against the
 * checkout it is run in; `src/cli/lib/catalogue-check.ts` says how, without touching the games'
 * shared checkouts. `.agent-policy.json` runs it in every verify and merge.
 */
import { styleText } from 'node:util';
import { gitOutput as git } from '../lib/git-output.js';
import { DEFAULT_CATALOGUE_ROOT, DEFAULT_GAME_TIME_LIMIT_MS, checkCatalogue, type CatalogueGameResult, type CatalogueRun } from '../lib/catalogue-check.js';

/** What the report says of a game that passed. */
function passLine(result: CatalogueGameResult): string {
  const branch = result.ref === 'main' ? '' : `, on its branch ${result.ref}`;
  return `  ${result.slug}: validates against this tree${branch}${result.status === 'cached' ? ' (passed before on these inputs)' : ''}`;
}

/** What the report says of a game that failed, and how to fix it. */
function failureLines(failure: CatalogueGameResult): string[] {
  return [
    '',
    `${failure.slug} FAILED on its ${failure.ref} (${failure.commit.slice(0, 8)}) against this BoardSmith tree:`,
    (failure.output ?? '').trimEnd(),
    `Either this BoardSmith change broke ${failure.slug}, or its ${failure.ref} was already broken. Fix the change, or fix the game in ${failure.dir} and push its ${failure.ref}.`,
    ...(failure.ref === 'main'
      ? [`If this change needs a change to ${failure.slug}, commit it in ${failure.dir} on a branch with the same name as this BoardSmith branch: the check uses that branch instead of main.`]
      : []),
  ];
}

/** What the command prints for `run`, and whether it passes. */
export function catalogueReport(run: CatalogueRun): { ok: boolean; text: string } {
  const failures = run.results.filter((r) => r.status === 'failed');
  const lines = [...run.results.filter((r) => r.status !== 'failed').map(passLine), ...failures.flatMap(failureLines)];
  // Only a passing run lands, so only then is there a game branch to merge after it.
  for (const repo of failures.length === 0 ? run.paired : []) {
    lines.push(
      '',
      `${repo.slug} was checked on its branch ${repo.ref}, not its main. Merge that branch into its main in ${repo.dir} right after this BoardSmith change lands.`,
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
    if (report.ok) console.log(styleText('green', `\nEvery catalogue game validates against this tree.`));
    else process.exitCode = 1;
  } catch (error) {
    console.error(styleText('red', error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
