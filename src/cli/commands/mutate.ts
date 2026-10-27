/**
 * `boardsmith mutate --base <ref>` (#1496): shows the tests of a change can fail, at merge time.
 *
 * It breaks a sample of 3 of the code lines under `src/` changed since the merge base of HEAD with
 * `<ref>` (committed, staged, unstaged and untracked), one small change at a time, picked by what
 * the mutants change, so the same change tries the same ones whichever commit holds it (#1500), and
 * runs the unit tests that import the changed files against each (`runDiffMutationCheck`). A mutant no test notices, and one in a file no
 * test loads, fails the run, naming its file and line, and so does a sample whose mutants only timed
 * out, since none was shown caught (#1499). Sims never run here (#1494).
 */
import { resolve as pathResolve } from 'node:path';
import { styleText } from 'node:util';
import { gitOutput as git } from '../lib/git-output.js';
import { readProjectConfig } from '../lib/agent-roles.js';
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

/** What a finished run says: a red run before any mutant, survivors, mutants no test loads, only timeouts, or every mutant caught. */
function verdict(since: string, run: DiffMutationRun): MutateVerdict {
  const { summary, survivors, unreached, timedOut, notGreen } = run;
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
    next.push(
      'Only the test files that import a changed file, directly or through other files, run here. ' +
        'A file a test reaches only through a setup file counts as imported by none, since Vitest does not follow setup files to the tests. ' +
        'For each file no test imports, add a test that imports it and checks what the changed lines do, then run `boardsmith mutate` again.',
    );
  }
  // A timeout alone shows nothing: a busy machine and a never-ending loop look the same.
  const onlyTimedOut = said.length === 0 && summary.killed === 0 && timedOut.length > 0;
  if (onlyTimedOut) {
    said.push(`${timedOut.length} ${of} made their tests run past the time limit, and none was killed, so no test was shown to notice a change`);
    next.push(
      'A run times out when the machine is busy, or when the change makes a loop never end. Run `boardsmith mutate` again when the machine is less busy.',
    );
  }
  if (said.length > 0) {
    return {
      passed: false,
      summary: `${said.join('; ')}.`,
      next: next.join(' '),
      findings: [
        ...survivors.map((s) => ({ file: s.file, line: s.line, detail: `${s.description}: no test failed` })),
        ...unreached.map((u) => ({ file: u.file, line: u.line, detail: `${u.description}: no test imports ${u.file}` })),
        ...timedOut.map((t) => ({ file: t.file, line: t.line, detail: `${t.description}: its tests ran past the time limit` })),
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
  const budget = mutationBudget(await readProjectConfig(projectDir, { command: 'boardsmith mutate', purpose: 'find its "mutation" budget' }));
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
    log: options.log ?? ((line) => console.error(styleText('dim', line))),
    budget,
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
