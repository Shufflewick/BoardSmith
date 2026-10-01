import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { commitAll, initRepo, recordPassingVerify, writeFiles } from '../lib/verify-result.test-helper.js';
import { LIGHT_REVIEW_LINES, SMALL_CHANGE_LINES, reviewGate, reviewGateCommand, reviewLevel } from './review-gate.js';

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

  it('refuses a result that did not measure the chunk\'s whole change (a --base HEAD run)', async () => {
    await writeFiles(project, { 'src/rules.ts': code(3, 'a') });
    commitAll(project, 'fixture: before the chunk');
    await writeFiles(project, { 'src/rules.ts': code(3, 'b') });
    commitAll(project, 'chunk-deal/step-build');
    await writeFiles(project, { 'src/rules.ts': code(3, 'c') });
    await recordPassingVerify(project, { message: 'chunk-deal/step-test' });

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
  it('states the mechanical checks are done, names every check with its outcome, and says not to re-run them', async () => {
    await writeFiles(project, { 'src/rules.ts': code(3, 'a') });
    const head = await recordPassingVerify(project, { chunk: 'deal' });

    const gate = await reviewGate({ projectDir: project, slug: 'deal' });

    expect(gate.open).toBe(true);
    if (!gate.open) return;
    expect(gate.level).toBe('full');
    expect(gate.brief).toContain(`Mechanical checks: done. \`boardsmith verify --chunk deal\` passed for commit ${head.slice(0, 12)} on a clean tree`);
    for (const check of ['test', 'typecheck', 'build', 'validate', 'smoke', 'mutation']) {
      expect(gate.brief).toContain(`- ${check}: ${check} passed`);
    }
    expect(gate.brief).toContain(`.boardsmith/verify/${head}.json`);
    expect(gate.brief).toMatch(/Do not run the suite, typecheck, build, validate, the smoke test or a mutation check again/);
  });

  it('scopes a re-review to the change since the commit the last round reviewed', async () => {
    await writeFiles(project, { 'src/rules.ts': code(3, 'a') });
    const reviewed = await recordPassingVerify(project, { chunk: 'deal' });
    await writeFiles(project, { 'src/rules.ts': code(3, 'b') });
    const head = await recordPassingVerify(project, { chunk: 'deal', message: 'chunk-deal/step-repair' });

    const gate = await reviewGate({ projectDir: project, slug: 'deal', since: reviewed });

    expect(gate.open).toBe(true);
    if (gate.open) expect(gate.brief).toContain(`git diff ${reviewed.slice(0, 12)}..${head.slice(0, 12)}`);
  });

  it('refuses a --since that is not a commit before the one under review', async () => {
    await writeFiles(project, { 'src/rules.ts': code(3, 'a') });
    await recordPassingVerify(project, { chunk: 'deal' });

    await expect(reviewGate({ projectDir: project, slug: 'deal', since: 'no-such-ref' })).rejects.toThrow(
      /--since no-such-ref is not a commit before the one under review/,
    );
  });
});

describe('the size rule: only a small mechanical change may skip or lighten review', () => {
  it('reviews in full whatever a role other than mechanical wrote, however small', () => {
    expect(reviewLevel('bounded', 1).level).toBe('full');
    expect(reviewLevel('judgement', 1).level).toBe('full');
  });

  it('skips review of a mechanical change of at most SMALL_CHANGE_LINES, and lightens one of at most LIGHT_REVIEW_LINES', () => {
    expect(reviewLevel('mechanical', SMALL_CHANGE_LINES).level).toBe('none');
    expect(reviewLevel('mechanical', SMALL_CHANGE_LINES + 1).level).toBe('light');
    expect(reviewLevel('mechanical', LIGHT_REVIEW_LINES).level).toBe('light');
    expect(reviewLevel('mechanical', LIGHT_REVIEW_LINES + 1).level).toBe('full');
  });

  it('measures a mechanical change from --since, which it requires', async () => {
    await writeFiles(project, { 'src/rules.ts': code(3, 'a') });
    const before = await recordPassingVerify(project, { chunk: 'deal' });
    await writeFiles(project, { 'src/rules.ts': code(3, 'b') });
    await recordPassingVerify(project, { chunk: 'deal', message: 'chunk-deal/rename' });

    await expect(reviewGate({ projectDir: project, slug: 'deal', workRole: 'mechanical' })).rejects.toThrow(
      /A mechanical change is sized from the commit before it began: pass --since <that commit>/,
    );
    const gate = await reviewGate({ projectDir: project, slug: 'deal', workRole: 'mechanical', since: before });
    expect(gate.open && gate.level).toBe('none');
    expect(gate.open && gate.changedLines).toBe(6);
  });

  it('counts a changed binary file as too large to lighten', async () => {
    await writeFiles(project, { 'src/rules.ts': code(3, 'a') });
    const before = await recordPassingVerify(project, { chunk: 'deal' });
    await fs.writeFile(join(project, 'art.png'), Buffer.from([0, 1, 2, 3, 0, 255]));
    await recordPassingVerify(project, { chunk: 'deal', message: 'chunk-deal/art' });

    const gate = await reviewGate({ projectDir: project, slug: 'deal', workRole: 'mechanical', since: before });

    expect(gate.open && gate.level).toBe('full');
  });

  it('refuses a slug that is a path', async () => {
    await expect(reviewGate({ projectDir: project, slug: '../deal' })).rejects.toThrow(/<slug> "\.\.\/deal" is a path, not a name/);
  });

  it('refuses review as the role that did the work', async () => {
    await writeFiles(project, { 'src/rules.ts': code(3, 'a') });
    await recordPassingVerify(project, { chunk: 'deal' });

    await expect(reviewGate({ projectDir: project, slug: 'deal', workRole: 'review' })).rejects.toThrow(
      /--work-role names the role that did the work under review: mechanical, bounded or judgement/,
    );
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
    expect(printed.join('\n')).toContain('Mechanical checks: done.');
  });
});
