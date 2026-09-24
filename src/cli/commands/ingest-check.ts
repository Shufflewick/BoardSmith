import { resolve } from 'node:path';
import chalk from 'chalk';
import { ingestGapsCommand, ingestRelabelCommand } from './ingest-archive.js';
import { checkSliceSources, describeSliceSourceProblems } from './rulebook-sources.js';
import {
  describeUnanchoredExamples,
  reanchorExampleLedger,
  type ReanchorResult,
} from './verify-example-replay.js';

/**
 * `boardsmith ingest-check` — repair ingest synthesis, and FAIL if repair was needed.
 *
 * The gap this closes: `boardsmith init` installs a pre-commit hook that runs synthesis, and the
 * bs- build protocol commits at every chunk step — but `/bs-ingest-rules` itself never commits.
 * The 2026-07-28 human gate found the hook had therefore never run at the end of a real ingest:
 * `## Open Rules Gaps` held 2 of 5 gaps, and not one `Derived (p.N):` line had been separated
 * from presentation. `/bs-build-chunk` reads `rulebook/INDEX.md` during investigate, before it
 * commits anything, so chunk 1 gets planned against that broken index.
 *
 * It repairs first and fails second, on purpose. A check that only reports leaves the caller to
 * remember a follow-up command, and this pipeline's entire history is of follow-up commands not
 * being run. A check that repairs silently is worse: the session carries on holding the stale
 * `INDEX.md` it already read into its context. So the repair lands on disk AND the non-zero exit
 * forces a re-read — the one mechanism this phase proved survives contact with a live session.
 * Re-running immediately afterwards exits 0, so it can never wedge a project.
 *
 * It also keeps the worked-example ledger tied to the slices (#350): a recorded example whose
 * line moved (a `Source:` line inserted above it, a paragraph added) is re-anchored to the one
 * line that now holds its text, which is a repair like the others.
 *
 * Two things it checks without repairing, because only a person or the transcription knows the
 * answer: that every slice names the document it was transcribed from (#311,
 * `rulebook-sources.ts`), which fails with the `boardsmith ingest-slice-source` command that
 * records it; and that every recorded worked example's text is still in its slice exactly once,
 * which fails naming the slice whose examples must be recorded again.
 */
export async function ingestCheckCommand(
  options: { project?: string; json?: boolean } = {},
): Promise<void> {
  const projectDir = resolve(options.project ?? process.cwd());
  const relabel = await ingestRelabelCommand({ project: projectDir, quiet: true });
  const gaps = await ingestGapsCommand({ project: projectDir, skipRelabel: true, quiet: true });
  const examples = await reanchorExampleLedger(projectDir);
  // Which document a slice came from is a fact only the transcription knows, so a slice that does
  // not say is reported, never repaired by guessing (#311).
  const sources = await checkSliceSources(projectDir);
  const sourcesMissing = sources.unattributed.length > 0 || sources.unrecorded.length > 0;
  const check: IngestCheck = {
    relabel,
    gaps,
    examples,
    sourceProblems: sourcesMissing ? describeSliceSourceProblems(sources) : [],
  };

  if (options.json) {
    const result = {
      repaired: wasRepaired(check),
      relabelled: relabel.relabelled,
      gapsWritten: gaps.gapsWritten,
      reanchoredExamples: examples.moved,
      unanchoredExamples: examples.lost,
      unattributedSlices: sources.unattributed,
      unrecordedSliceSources: sources.unrecorded,
    };
    console.log(JSON.stringify(result, null, 2));
  } else {
    reportIngestCheck(check);
  }

  // Set the exit code rather than throwing: `program.parse()` does not await action handlers, so a
  // rejection surfaces as an unhandled-rejection stack trace. The caller here is a git hook or a
  // build session, both of which need the non-zero status and neither of which should be shown
  // this repo's internal paths.
  if (wasRepaired(check) || leftUnrepaired(check)) process.exitCode = 1;
}

/** What one `ingest-check` run found and did. */
interface IngestCheck {
  relabel: Awaited<ReturnType<typeof ingestRelabelCommand>>;
  gaps: Awaited<ReturnType<typeof ingestGapsCommand>>;
  examples: ReanchorResult;
  /** `describeSliceSourceProblems`' lines, or none when every slice names a recorded document. */
  sourceProblems: string[];
}

function wasRepaired(check: IngestCheck): boolean {
  return check.relabel.relabelled > 0 || check.gaps.changed || check.examples.moved.length > 0;
}

function leftUnrepaired(check: IngestCheck): boolean {
  return check.sourceProblems.length > 0 || check.examples.lost.length > 0;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** `ingest-check`'s human-readable report: what it repaired, and what it could not. */
function reportIngestCheck(check: IngestCheck): void {
  if (!wasRepaired(check) && !leftUnrepaired(check)) {
    const n = check.gaps.gapsWritten;
    console.log(
      chalk.green(
        `✓ Ingest synthesis up to date — ${n} open rules ${plural(n, 'gap', 'gaps')}, no Derived/Visual misfiling`,
      ),
    );
    return;
  }
  if (wasRepaired(check)) reportRepairs(check);
  if (check.sourceProblems.length > 0) {
    console.error(chalk.red('rulebook/ slices do not all say which document they came from. NOT repaired:'));
    for (const line of check.sourceProblems) console.error(line);
  }
  if (check.examples.lost.length > 0) {
    console.error(chalk.red('Recorded worked examples no longer point at their text. NOT repaired:'));
    for (const line of describeUnanchoredExamples(check.examples.lost)) console.error(line);
  }
}

function reportRepairs({ relabel, gaps, examples }: IngestCheck): void {
  console.error(chalk.yellow('rulebook/ was out of sync with its slices. It has been REPAIRED:'));
  if (relabel.relabelled) {
    console.error(
      `  • relabelled ${relabel.relabelled} presentation ${plural(relabel.relabelled, 'line', 'lines')} Derived → Visual`,
    );
    for (const c of relabel.changes) {
      console.error(`      ${chalk.gray(`${c.file}:${c.line}`)} matched "${c.matched}"`);
    }
  }
  if (gaps.changed) {
    console.error(
      `  • rewrote ## Open Rules Gaps from the slices — ${gaps.gapsWritten} ${plural(gaps.gapsWritten, 'entry', 'entries')}`,
    );
  }
  if (examples.moved.length > 0) {
    const n = examples.moved.length;
    console.error(
      `  • moved ${n} recorded worked ${plural(n, 'example', 'examples')} to the line ${plural(n, 'its', 'their')} text is now on:`,
    );
    for (const m of examples.moved) console.error(`      ${m.from} → ${m.to}`);
  }
  console.error('');
  console.error(chalk.yellow('Re-read rulebook/INDEX.md before continuing — the copy you have is stale.'));
  console.error(chalk.dim('Then re-run `boardsmith ingest-check`; it will pass once nothing below is left.'));
}
