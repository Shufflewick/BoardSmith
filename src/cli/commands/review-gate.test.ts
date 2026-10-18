import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { commitAll, initRepo, recordPassingVerify, writeFiles } from '../lib/verify-result.test-helper.js';
import { LIGHT_REVIEW_LINES, SMALL_CHANGE_LINES, reviewGate, reviewGateCommand, reviewLevel } from './review-gate.js';

// Each test, and the `beforeEach` that starts its repository, runs real `git` processes. A hang
// guard, not a budget: on a busy machine vitest's 5 s test and 10 s hook defaults fail these with
// nothing wrong (#360).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * `boardsmith review-gate <slug>` (#454): no model review starts until `boardsmith verify` has
 * passed for the commit under review, and what the reviewer is told about the mechanical checks
 * comes from the result on file, not from anyone's say-so.
 */

let project: string;

beforeEach(async () => {
  const tree = tempTree('bs-review-gate-');
  project = join(tree, 'game');
  await fs.mkdir(project, { recursive: true });
  initRepo(project);
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

/** Runs the gate for chunk "deal", expects it to refuse, and returns the refusal. */
async function refusal(): Promise<string> {
  const gate = await reviewGate({ projectDir: project, slug: 'deal' });
  expect(gate.open).toBe(false);
  return gate.open ? '' : gate.refusal;
}

/** A `### Dispatch N` run log entry of work done at `role`. */
const dispatch = (n: number, role: string) =>
  `### Dispatch ${n}\n- Work: repair\n- Role: ${role}\n- Agent: bs-${role}\n- Retry of: none\n` +
  `- Dispatched at: 2026-09-23T10:00:00Z\n- Finished at: 2026-09-23T11:00:00Z\n- Outcome: done\n- Detail: n/a\n`;

/** A `### Review Round N` run log entry that reviewed `commit`. */
const round = (n: number, commit: string, outcome = 'changes requested') =>
  `### Review Round ${n}\n- Step: audit\n- Reviewed: Dispatch 1\n- Level: full\n- Verify: ${commit.slice(0, 12)} passed\n` +
  `- Agents: fidelity=bs-judgement\n- Outcome: ${outcome}\n`;

/** Writes chunk "deal"'s run log, committed with the next verify. */
const runLog = (...entries: string[]) => writeFiles(project, { 'design/run-log/deal.md': `# Run Log: deal\n\n${entries.join('\n')}` });

/** `lines` lines of code, so a change of a known size can be committed. */
const code = (lines: number, tag: string) => Array.from({ length: lines }, (_, i) => `export const v${i} = '${tag}';`).join('\n') + '\n';

describe('the gate refuses a review the verify result does not back', () => {
  it('refuses a chunk with no verify result for the current commit, and says to run boardsmith verify', async () => {
    await writeFiles(project, { 'src/rules.ts': code(3, 'a') });
    await recordPassingVerify(project, { chunk: 'deal' });
    await writeFiles(project, { 'src/rules.ts': code(3, 'b') });
    commitAll(project, 'chunk-deal/step-repair');

    const refused = await refusal();

    expect(refused).toMatch(/^No model review may start for chunk "deal"/);
    expect(refused).toContain('No `boardsmith verify` result for the current commit');
    expect(refused).toContain('npx boardsmith verify --chunk deal');
  });

  it('refuses a tree with uncommitted changes', async () => {
    await writeFiles(project, { 'src/rules.ts': code(3, 'a') });
    await recordPassingVerify(project, { chunk: 'deal' });
    await writeFiles(project, { 'src/rules.ts': code(3, 'dirty') });

    expect(await refusal()).toContain('uncommitted changes');
  });

  it('refuses a full result, which is not the chunk\'s fast checks (a --base HEAD run)', async () => {
    await writeFiles(project, { 'src/rules.ts': code(3, 'a') });
    commitAll(project, 'fixture: before the chunk');
    await writeFiles(project, { 'src/rules.ts': code(3, 'b') });
    commitAll(project, 'chunk-deal/step-build');
    await writeFiles(project, { 'src/rules.ts': code(3, 'c') });
    await recordPassingVerify(project, { message: 'chunk-deal/step-test' });

    expect(await refusal()).toContain('not made for chunk "deal"');
    expect(await refusal()).toContain('boardsmith verify --chunk deal');
  });

  it('the command prints the refusal and exits non-zero', async () => {
    await writeFiles(project, { 'src/rules.ts': code(3, 'a') });
    commitAll(project, 'chunk-deal/step-build');
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errors.push(line);
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await reviewGateCommand('deal', { project });

    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('Run `npx boardsmith verify --chunk deal`');
  });
});

describe('an open gate hands the reviewer the verify result', () => {
  it('says only the fast checks ran, names each with its outcome, and that the rest run at publish, not by the reviewer (#985)', async () => {
    await writeFiles(project, { 'src/rules.ts': code(3, 'a') });
    const head = await recordPassingVerify(project, { chunk: 'deal' });

    const gate = await reviewGate({ projectDir: project, slug: 'deal' });

    expect(gate.open).toBe(true);
    if (!gate.open) return;
    expect(gate.level).toBe('full');
    expect(gate.brief).toContain(`Fast checks: done. \`boardsmith verify --chunk deal\` passed for commit ${head.slice(0, 12)} on a clean tree`);
    expect(gate.brief).toContain('- test: test passed');
    expect(gate.brief).toContain('- typecheck: typecheck passed');
    expect(gate.brief).not.toMatch(/^- (build|validate|smoke|mutation):/m);
    expect(gate.brief).toContain(`.boardsmith/verify/${head}.json`);
    expect(gate.brief).toMatch(/Only the fast checks have run: the chunk's tests and typecheck\./);
    expect(gate.brief).toMatch(/The full suite, build, validate, the smoke test and the mutation check run at publish/);
    expect(gate.brief).toMatch(/Do not run any of them, or the fast checks again/);
  });

  it('scopes a re-review to the change since the commit the last round in the run log reviewed (#829)', async () => {
    await writeFiles(project, { 'src/rules.ts': code(3, 'a') });
    await runLog(dispatch(1, 'judgement'));
    const reviewed = await recordPassingVerify(project, { chunk: 'deal' });
    await writeFiles(project, { 'src/rules.ts': code(3, 'b') });
    await runLog(dispatch(1, 'judgement'), round(1, reviewed), dispatch(2, 'bounded'));
    const head = await recordPassingVerify(project, { chunk: 'deal', message: 'chunk-deal/step-repair' });

    const gate = await reviewGate({ projectDir: project, slug: 'deal' });

    expect(gate.open).toBe(true);
    if (gate.open) expect(gate.brief).toContain(`git diff ${reviewed.slice(0, 12)}..${head.slice(0, 12)}`);
  });

  it('a rerun for a round still pending scopes to the round before it (#829)', async () => {
    await writeFiles(project, { 'src/rules.ts': code(3, 'a') });
    const reviewed = await recordPassingVerify(project, { chunk: 'deal' });
    await writeFiles(project, { 'src/rules.ts': code(3, 'b') });
    await runLog(round(1, reviewed), dispatch(1, 'bounded'));
    const head = await recordPassingVerify(project, { chunk: 'deal', message: 'chunk-deal/step-repair' });
    await runLog(round(1, reviewed), dispatch(1, 'bounded'), round(2, head, 'pending'));
    const again = await recordPassingVerify(project, { chunk: 'deal', message: 'chunk-deal/step-audit' });

    const gate = await reviewGate({ projectDir: project, slug: 'deal' });

    expect(gate.open && gate.brief).toContain(`git diff ${reviewed.slice(0, 12)}..${again.slice(0, 12)}`);
  });

  it('refuses a run log whose round has no readable Verify line, naming the run log (#829)', async () => {
    await writeFiles(project, { 'src/rules.ts': code(3, 'a') });
    await runLog(round(1, 'abcdef123456').replace('- Verify: abcdef123456 passed', '- Verify: soon'));
    await recordPassingVerify(project, { chunk: 'deal' });

    await expect(reviewGate({ projectDir: project, slug: 'deal' })).rejects.toThrow(
      /^design\/run-log\/deal\.md: Review Round 1 has no "- Verify: <commit> passed" line/,
    );
  });

  it('refuses a run log whose last round names a commit that is not before the one under review (#829)', async () => {
    await writeFiles(project, { 'src/rules.ts': code(3, 'a') });
    await runLog(round(1, 'abcdef123456'));
    await recordPassingVerify(project, { chunk: 'deal' });

    await expect(reviewGate({ projectDir: project, slug: 'deal' })).rejects.toThrow(
      /design\/run-log\/deal\.md: Review Round 1 says it reviewed abcdef123456, which is not a commit before the one under review/,
    );
  });
});

describe('the size rule: only a small mechanical change may skip or lighten review', () => {
  it('reviews in full whatever a role other than mechanical wrote, however small', () => {
    expect(reviewLevel(['bounded'], 1)).toEqual({ level: 'full', reason: 'work by the bounded role is always reviewed in full' });
    expect(reviewLevel(['judgement'], 1).level).toBe('full');
    expect(reviewLevel(['mechanical', 'second-opinion', 'bounded'], 1).reason).toBe(
      'work by the second-opinion and bounded roles is always reviewed in full',
    );
    expect(reviewLevel([], 1)).toEqual({
      level: 'full',
      reason: 'the run log records no dispatch since the last review round, so who did the work is unknown',
    });
  });

  it('skips review of a mechanical change of at most SMALL_CHANGE_LINES, and lightens one of at most LIGHT_REVIEW_LINES', () => {
    expect(reviewLevel(['mechanical'], SMALL_CHANGE_LINES).level).toBe('none');
    expect(reviewLevel(['mechanical'], SMALL_CHANGE_LINES + 1).level).toBe('light');
    expect(reviewLevel(['mechanical'], LIGHT_REVIEW_LINES).level).toBe('light');
    expect(reviewLevel(['mechanical'], LIGHT_REVIEW_LINES + 1).level).toBe('full');
  });

  it("sizes the change since the last round as mechanical, leaving the run log's own entries out (#829, #1000)", async () => {
    await writeFiles(project, { 'src/rules.ts': code(3, 'a') });
    const before = await recordPassingVerify(project, { chunk: 'deal' });
    await writeFiles(project, { 'src/rules.ts': code(2, 'a') + "export const v2 = 'b';\n" });
    await runLog(round(1, before), dispatch(1, 'mechanical'));
    await recordPassingVerify(project, { chunk: 'deal', message: 'chunk-deal/rename' });

    const gate = await reviewGate({ projectDir: project, slug: 'deal' });
    expect(gate.open && gate.changedLines).toBe(2);
    expect(gate.open && gate.level).toBe('none');
  });

  it('reviews in full when any dispatch since the last round was not mechanical, or the run log has none (#829)', async () => {
    await writeFiles(project, { 'src/rules.ts': code(3, 'a') });
    const before = await recordPassingVerify(project, { chunk: 'deal' });
    await writeFiles(project, { 'src/rules.ts': code(3, 'b') });
    await runLog(round(1, before), dispatch(1, 'mechanical'), dispatch(2, 'second-opinion'));
    await recordPassingVerify(project, { chunk: 'deal', message: 'chunk-deal/rename' });
    const gate = await reviewGate({ projectDir: project, slug: 'deal' });
    expect(gate.open && gate.level).toBe('full');
    expect(gate.open && gate.reason).toBe('work by the second-opinion role is always reviewed in full');

    await runLog(round(1, before));
    await recordPassingVerify(project, { chunk: 'deal', message: 'chunk-deal/log' });
    const noDispatch = await reviewGate({ projectDir: project, slug: 'deal' });
    expect(noDispatch.open && noDispatch.level).toBe('full');
  });

  it('counts a changed binary file as too large to lighten', async () => {
    await writeFiles(project, { 'src/rules.ts': code(3, 'a') });
    const before = await recordPassingVerify(project, { chunk: 'deal' });
    await fs.writeFile(join(project, 'art.png'), Buffer.from([0, 1, 2, 3, 0, 255]));
    await runLog(round(1, before), dispatch(1, 'mechanical'));
    await recordPassingVerify(project, { chunk: 'deal', message: 'chunk-deal/art' });

    const gate = await reviewGate({ projectDir: project, slug: 'deal' });

    expect(gate.open && gate.level).toBe('full');
  });

  it('refuses a slug that is a path', async () => {
    await expect(reviewGate({ projectDir: project, slug: '../deal' })).rejects.toThrow(/<slug> "\.\.\/deal" is a path, not a name/);
  });

  it('the command prints the level first, then the brief, and opens with exit 0', async () => {
    await writeFiles(project, { 'src/rules.ts': code(3, 'a') });
    await recordPassingVerify(project, { chunk: 'deal' });
    const printed: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      printed.push(line);
    });

    await reviewGateCommand('deal', { project });

    expect(process.exitCode).toBeUndefined();
    expect(printed[0]).toMatch(/^Review level: full \(/);
    expect(printed.join('\n')).toContain('Fast checks: done.');
  });
});
