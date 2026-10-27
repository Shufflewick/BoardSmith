/**
 * `boardsmith mutate --base <ref>` (#1496): shows the tests of a change can fail, at merge time.
 *
 * It breaks a sample of 3 of the code lines under `src/` changed since the merge base of HEAD with
 * `<ref>` (committed, staged, unstaged and untracked), one small change at a time, picked with the
 * HEAD commit as seed so a re-run tries the same ones, and runs the unit tests that import the
 * changed files against each (`runDiffMutationCheck`). A mutant no test notices, and one in a file no
 * test loads, fails the run, naming its file and line. Sims never run here (#1494).
 */
import { readFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { styleText } from 'node:util';
import { gitOutput as git } from '../lib/git-output.js';
import { requireGameProject } from '../lib/game-project.js';
import { mutationBudget } from '../lib/mutation-budget.js';
import { gameTestRunProblem } from '../lib/test-run-scope.js';
import { runDiffMutationCheck } from './test-step-mutation.js';
import { changedSince, resolveBase } from './verify.js';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface MutateVerdict {
  passed: boolean;
  summary: string;
  next?: string;
  findings: Array<{ file: string; line: number; detail: string }>;
}

type DiffMutationRun = Awaited<ReturnType<typeof runDiffMutationCheck>>;

/** What a finished run says: a red run before any mutant, survivors or mutants no test loads, or every mutant caught. */
function verdict(since: string, run: DiffMutationRun): MutateVerdict {
  const { summary, survivors, unreached, notGreen } = run;
  if (notGreen) {
    return {
      passed: false,
      summary: `The test files that import the changed files did not pass, run on their own, before any mutant was tried: ${notGreen.join('; ')}.`,
      next:
        'Run `boardsmith test` to see why. If they pass with the rest of the suite, a test there needs something another test ' +
        'file leaves behind: make each test file set up what it needs itself. Then run `boardsmith mutate` again.',
      findings: [],
    };
  }
  if (summary.mutants === 0) return { passed: true, summary: `No line changed since ${since} holds code a mutant can change.`, findings: [] };
  const of = `of ${plural(summary.mutants, 'mutant')} of the lines changed since ${since}`;
  const said: string[] = [];
  const next: string[] = [];
  if (survivors.length > 0) {
    said.push(`${survivors.length} ${of} survived: every test that loads its file still passed with the code changed`);
    next.push('For each survivor, add or tighten a test so it fails when that line is changed that way, then run `boardsmith mutate` again.');
  }
  if (unreached.length > 0) {
    said.push(`${unreached.length} ${of} were in a file no test imports, so no test could notice the change`);
    next.push('For each file no test imports, add a test that imports it and checks what the changed lines do, then run `boardsmith mutate` again.');
  }
  if (said.length > 0) {
    return {
      passed: false,
      summary: `${said.join('; ')}.`,
      next: next.join(' '),
      findings: [
        ...survivors.map((s) => ({ file: s.file, line: s.line, detail: `${s.description}: no test failed` })),
        ...unreached.map((u) => ({ file: u.file, line: u.line, detail: `${u.description}: no test imports ${u.file}` })),
      ],
    };
  }
  return {
    passed: true,
    summary: `${plural(summary.mutants, 'mutant')} of the lines changed since ${since}: ${summary.killed} killed by tests, ${summary.timedOut} timed out; none survived.`,
    findings: [],
  };
}

/** Runs the sample against the change since the merge base of HEAD with `base`. */
async function runMutate(options: { projectDir: string; base: string; log?: (line: string) => void }): Promise<MutateVerdict> {
  const { projectDir } = options;
  const configPath = requireGameProject(projectDir);
  const problem = await gameTestRunProblem(projectDir);
  if (problem) throw new Error(problem);
  const base = await resolveBase(projectDir, options.base);
  const since = `${base.ref} (${base.commit.slice(0, 12)})`;
  const head = (await git(projectDir, ['rev-parse', 'HEAD'])).trim();
  const changed = await changedSince(projectDir, base.commit);
  if (base.commit === head && changed.files.length === 0) {
    throw new Error(
      `The merge base with ${base.ref} is the current commit (${head.slice(0, 12)}), so no change is measured and a pass would cover nothing. ` +
        'Pass --base <the branch or commit this work started from>, e.g. --base main from a work branch.',
    );
  }
  if (changed.code.size === 0) return { passed: true, summary: `No code under src/ changed since ${since}, so there was nothing to mutate.`, findings: [] };
  const run = await runDiffMutationCheck({
    projectDir,
    added: changed.code,
    seed: head,
    log: options.log ?? ((line) => console.error(styleText('dim', line))),
    budget: mutationBudget(JSON.parse(readFileSync(configPath, 'utf-8'))),
  });
  return verdict(since, run);
}

export async function mutateCommand(options: { base: string; project?: string }): Promise<void> {
  const projectDir = pathResolve(options.project ?? process.cwd());
  const result = await runMutate({ projectDir, base: options.base });
  console.log(`${result.passed ? styleText('green', 'pass') : styleText('red', 'FAIL')}  ${result.summary}`);
  for (const f of result.findings) console.log(`        ${f.file}:${f.line} ${f.detail}`);
  if (result.next) console.log(`\n${result.next}`);
  if (!result.passed) process.exitCode = 1;
}
