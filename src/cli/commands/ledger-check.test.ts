import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import {
  type LedgerCheckResult,
  type LedgerFinding,
  type LedgerFindingKind,
  checkNumberedLedger,
  checkFilingStatus,
  checkRunLog,
  ledgerCheck,
  ledgerCheckCommand,
} from './ledger-check.js';
import { checkClaimQuotes } from './claim-quotes.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { buildVerifyResult, writeVerifyResult } from '../lib/verify-result.js';

/**
 * `ledger-check` (#293): the mechanical integrity check for the design ledgers and the run log.
 * Every rule here was broken by a real run (Shufflewick/sotf#32, #37) while the prose that
 * forbade it sat in the templates, so each rule is pinned by a fixture that reproduces the
 * breakage and a fixture that shows the correct shape passing.
 */

function ruling(n: number, extra = ''): string {
  return [
    `### Ruling ${n}`,
    `- Decision: decision ${n}.${extra ? ` ${extra}` : ''}`,
    `- Citation interpreted or overridden: p.${n}`,
    `- Rationale: because.`,
    '',
  ].join('\n');
}

describe('checkNumberedLedger — duplicate numbers', () => {
  it('reports a ruling number used twice, naming both lines', () => {
    const text = ['# Rulings', '', '## Ledger', '', ruling(137), ruling(138), ruling(138)].join('\n');
    const findings = checkNumberedLedger(text, 'Ruling', 'RULINGS.md');
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('duplicate-number');
    expect(findings[0].entry).toBe('Ruling 138');
    expect(findings[0].detail).toMatch(/lines \d+ and \d+/);
  });

  it('reports a decision number used twice', () => {
    const text = ['### Decision 4', '- Decision: a', '### Decision 4', '- Decision: b'].join('\n');
    const findings = checkNumberedLedger(text, 'Decision', 'DECISIONS.md');
    expect(findings.map((f) => f.kind)).toEqual(['duplicate-number']);
  });

  it('ignores the illustrative example inside an HTML comment', () => {
    const text = ['<!--', '### Ruling 1', '- Decision: example', '-->', '', ruling(1)].join('\n');
    expect(checkNumberedLedger(text, 'Ruling', 'RULINGS.md')).toEqual([]);
  });
});

describe('checkNumberedLedger — supersession', () => {
  it('passes when the superseded entry carries the in-place pointer', () => {
    const text = [
      ruling(3, ''),
      '- Superseded by: Ruling 9',
      '',
      ruling(9, 'Supersedes Ruling 3.'),
    ].join('\n');
    expect(checkNumberedLedger(text, 'Ruling', 'RULINGS.md')).toEqual([]);
  });

  it('fails when a later entry supersedes one that was never marked in place', () => {
    const text = [
      '### Decision 270',
      '- Decision: relocateFled never writes the destination occupants.',
      '',
      '### Decision 301',
      '- Decision: relocateFled writes the destination occupants. Supersedes Decision 270.',
    ].join('\n');
    const findings = checkNumberedLedger(text, 'Decision', 'DECISIONS.md');
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('superseded-without-pointer');
    expect(findings[0].entry).toBe('Decision 270');
    expect(findings[0].detail).toContain('- Superseded by: Decision 301');
  });

  it('fails when an in-place pointer names an entry that does not exist', () => {
    const text = [ruling(3), '- Superseded by: Ruling 40', ''].join('\n');
    const findings = checkNumberedLedger(text, 'Ruling', 'RULINGS.md');
    expect(findings.map((f) => f.kind)).toEqual(['supersession-target-missing']);
  });

  it('fails when an entry supersedes one that does not exist', () => {
    const text = ruling(9, 'Supersedes Ruling 3.');
    const findings = checkNumberedLedger(text, 'Ruling', 'RULINGS.md');
    expect(findings.map((f) => f.kind)).toEqual(['supersession-target-missing']);
  });
});

function filing(n: number, reported: string, issue: string, extraLines: string[] = []): string {
  return [
    `### Filing ${n}`,
    ...extraLines,
    '- Kind: bug',
    '- Title: something',
    '- What happened: it broke.',
    '- Blocked: some-chunk — worked around',
    '- Workaround in the game: none',
    '- BoardSmith version: 1.0.0',
    `- Reported: ${reported}`,
    `- Issue: ${issue}`,
    '',
  ].join('\n');
}

describe('checkFilingStatus', () => {
  it('passes consistent entries in each state', () => {
    const text = [
      filing(1, 'recorded', 'n/a — not posted'),
      filing(2, 'posted', 'https://github.com/Shufflewick/BoardSmith/issues/283'),
      filing(3, 'posted-by-designer', 'https://github.com/Shufflewick/BoardSmith/issues/284'),
      filing(4, 'declined', 'n/a — not posted'),
    ].join('\n');
    expect(checkFilingStatus(text)).toEqual([]);
  });

  it('fails a banner that says POSTED over fields that say recorded (sotf Filings 25/26)', () => {
    const text = filing(25, 'recorded', 'n/a, not posted', [
      '**POSTED 2026-09-22: Shufflewick/BoardSmith #283**',
    ]);
    const findings = checkFilingStatus(text);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('filing-status-conflict');
    expect(findings[0].entry).toBe('Filing 25');
  });

  it('fails posted with no issue URL, and recorded with one', () => {
    const text = [
      filing(1, 'posted', 'n/a — not posted'),
      filing(2, 'recorded', 'https://github.com/Shufflewick/BoardSmith/issues/1'),
    ].join('\n');
    expect(checkFilingStatus(text).map((f) => f.entry)).toEqual(['Filing 1', 'Filing 2']);
  });

  it('fails an entry with two different Reported fields', () => {
    const text = filing(7, 'recorded', 'n/a — not posted', ['- Reported: posted']);
    const findings = checkFilingStatus(text);
    expect(findings.map((f) => f.kind)).toEqual(['filing-status-conflict']);
  });

  it('fails an entry with no Reported field, or an unknown value', () => {
    const missing = '### Filing 1\n- Kind: bug\n- Issue: n/a — not posted\n';
    const unknown = filing(2, 'maybe', 'n/a — not posted');
    expect(checkFilingStatus(missing + '\n' + unknown).map((f) => f.entry)).toEqual([
      'Filing 1',
      'Filing 2',
    ]);
  });
});

function dispatch(n: number, dispatched: string, outcome: string, finished: string): string {
  return [
    `### Dispatch ${n}`,
    '- Work: build-chunk',
    '- Role: judgement',
    '- Agent: bs-judgement',
    `- Dispatched at: ${dispatched}`,
    `- Finished at: ${finished}`,
    `- Outcome: ${outcome}`,
    '- Detail: n/a',
    '',
  ].join('\n');
}

const LOG = 'run-log/core-loop.md';
const epoch = (iso: string) => Date.parse(iso) / 1000;
const NOW = epoch('2026-09-24T00:00:00Z');
const uncommitted = () => null;
const noVerifyFiles = () => undefined;

describe('checkRunLog', () => {
  it('passes a well-formed log whose times are no later than their commits', () => {
    const text = [
      dispatch(1, '2026-09-23T10:00:00Z', 'closed', '2026-09-23T11:00:00Z'),
      dispatch(2, '2026-09-23T11:05:00Z', 'pending', 'pending'),
    ].join('\n');
    expect(checkRunLog(text, LOG, () => epoch('2026-09-23T12:00:00Z'), NOW, noVerifyFiles)).toEqual([]);
  });

  it('fails a finish earlier than its dispatch (sotf Dispatch 73)', () => {
    const text = dispatch(73, '2026-09-23T10:03:30Z', 'closed', '2026-09-22T12:30:00Z');
    const findings = checkRunLog(text, LOG, uncommitted, NOW, noVerifyFiles);
    expect(findings).toHaveLength(1);
    expect(findings[0].entry).toBe('Dispatch 73');
    expect(findings[0].detail).toMatch(/earlier than its Dispatched at/);
  });

  it('fails a timestamp later than the commit that recorded it', () => {
    const text = dispatch(1, '2026-09-23T10:00:00Z', 'closed', '2026-09-23T11:00:00Z');
    const lines = text.split('\n');
    const finishedLine = lines.findIndex((l) => l.startsWith('- Finished at:')) + 1;
    const commitTime = (line: number) =>
      line === finishedLine ? epoch('2026-09-23T10:30:00Z') : epoch('2026-09-23T12:00:00Z');
    const findings = checkRunLog(text, LOG, commitTime, NOW, noVerifyFiles);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toMatch(/Finished at .* is later than the commit/);
  });

  it('fails an uncommitted timestamp that is in the future', () => {
    const text = dispatch(1, '2026-09-25T10:00:00Z', 'pending', 'pending');
    expect(checkRunLog(text, LOG, uncommitted, NOW, noVerifyFiles).map((f) => f.kind)).toEqual(['run-timestamp']);
  });

  it('fails a dispatch earlier than the one logged before it', () => {
    const text = [
      dispatch(1, '2026-09-23T10:00:00Z', 'closed', '2026-09-23T11:00:00Z'),
      dispatch(2, '2026-09-22T09:00:00Z', 'pending', 'pending'),
    ].join('\n');
    const findings = checkRunLog(text, LOG, uncommitted, NOW, noVerifyFiles);
    expect(findings.map((f) => f.entry)).toEqual(['Dispatch 2']);
  });

  it('fails a returned dispatch with no finish time, a pending one with a finish time, and a hand-typed shape', () => {
    const text = [
      dispatch(1, '2026-09-23T10:00:00Z', 'closed', 'pending'),
      dispatch(2, '2026-09-23T10:10:00Z', 'pending', '2026-09-23T10:20:00Z'),
      dispatch(3, 'Sept 23, 10:30', 'pending', 'pending'),
    ].join('\n');
    expect(checkRunLog(text, LOG, uncommitted, NOW, noVerifyFiles).map((f) => f.entry)).toEqual([
      'Dispatch 1',
      'Dispatch 2',
      'Dispatch 3',
    ]);
  });

  it('fails a missing Finished at field', () => {
    const text = '### Dispatch 1\n- Dispatched at: 2026-09-23T10:00:00Z\n- Outcome: pending\n';
    expect(checkRunLog(text, LOG, uncommitted, NOW, noVerifyFiles)[0].detail).toMatch(/Finished at/);
  });

  it('holds each dispatch to a role and an agent type, and each review round to a passing verify (#454)', () => {
    const text = [
      '### Dispatch 1',
      '- Work: build',
      '- Dispatched at: 2026-09-23T10:00:00Z',
      '- Finished at: pending',
      '- Outcome: pending',
      '',
      '### Review Round 1',
      '- Step: audit',
      '- Level: full',
      '- Verify: 0123456789ab failed',
      '- Agents: bs-review',
      '- Outcome: pending',
      '',
    ].join('\n');
    expect(checkRunLog(text, LOG, uncommitted, NOW, noVerifyFiles).map((f) => `${f.ledger}:${f.entry}:${f.kind}`)).toEqual([
      `${LOG}:Dispatch 1:run-role`,
      `${LOG}:Dispatch 1:run-role`,
      `${LOG}:Review Round 1:review-round`,
      `${LOG}:Review Round 1:review-round`,
    ]);
  });

  it('reports a dispatch number used twice', () => {
    const text = [
      dispatch(1, '2026-09-23T10:00:00Z', 'closed', '2026-09-23T11:00:00Z'),
      dispatch(1, '2026-09-23T11:05:00Z', 'pending', 'pending'),
    ].join('\n');
    expect(checkRunLog(text, LOG, uncommitted, NOW, noVerifyFiles).map((f) => f.kind)).toEqual(['duplicate-number']);
  });
});

// ---------------------------------------------------------------------------------------------
// The command, against a real git repository.
// ---------------------------------------------------------------------------------------------

const GIT = '-c user.email=t@t -c user.name=t';

/** `ledger:kind` for each finding, in report order. */
function located(findings: LedgerFinding[]): Array<`${string}:${LedgerFindingKind}`> {
  return findings.map((f) => `${f.ledger}:${f.kind}` as const);
}

async function project(files: Record<string, string>): Promise<string> {
  const tree = tempTree('bs-ledger-check-');
  const dir = join(tree, 'proj');
  await fs.mkdir(join(dir, 'design'), { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  for (const [name, text] of Object.entries(files)) {
    await fs.mkdir(dirname(join(dir, 'design', name)), { recursive: true });
    await fs.writeFile(join(dir, 'design', name), text);
  }
  return dir;
}

function commitAt(dir: string, iso: string): void {
  execSync('git add -A', { cwd: dir, stdio: 'ignore' });
  execSync(`git ${GIT} commit -m c`, {
    cwd: dir,
    stdio: 'ignore',
    env: { ...process.env, GIT_COMMITTER_DATE: iso, GIT_AUTHOR_DATE: iso },
  });
}

/** A committed project holding `files`, checked; `found` is each finding as `ledger:entry:kind`. */
async function committedProject(files: Record<string, string>): Promise<{ result: LedgerCheckResult; found: string[] }> {
  const dir = await project(files);
  commitAt(dir, '2026-09-23T12:00:00Z');
  const result = await ledgerCheck(dir);
  return { result, found: result.findings.map((f) => `${f.ledger}:${f.entry}:${f.kind}`) };
}

describe('ledgerCheck — the whole project', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('compares each chunk run log\'s times against the commit that recorded each line', async () => {
    const dir = await project({
      'run-log/core-loop.md': dispatch(1, '2026-09-23T10:00:00Z', 'closed', '2026-09-23T11:00:00Z'),
    });
    // Committed at 10:30, so a finish at 11:00 was typed before it happened.
    commitAt(dir, '2026-09-23T10:30:00Z');
    const result = await ledgerCheck(dir);
    expect(located(result.findings)).toEqual(['run-log/core-loop.md:run-timestamp']);
    expect(result.findings[0].detail).toMatch(/Finished at/);
  });

  it('checks every chunk run log on its own, so two chunks built at once never share a field (#294)', async () => {
    const dir = await project({
      'run-log/trading.md': dispatch(1, '2026-09-23T10:00:00Z', 'closed', '2026-09-23T11:00:00Z'),
      'run-log/auctions.md': dispatch(1, '2026-09-23T09:00:00Z', 'closed', '2026-09-23T08:00:00Z'),
    });
    commitAt(dir, '2026-09-23T12:00:00Z');
    const result = await ledgerCheck(dir);
    expect(result.checked).toEqual(['run-log/auctions.md', 'run-log/trading.md']);
    expect(located(result.findings)).toEqual(['run-log/auctions.md:run-timestamp']);
  });

  it('fails a dispatch entry written into RUN.md, where two writers would share one log (#294)', async () => {
    const dir = await project({
      'RUN.md': ['# Run', 'Run Status: active', '## Run Log', dispatch(1, '2026-09-23T10:00:00Z', 'pending', 'pending')].join('\n'),
    });
    commitAt(dir, '2026-09-23T12:00:00Z');
    const result = await ledgerCheck(dir);
    expect(located(result.findings)).toEqual(['RUN.md:run-log-misplaced']);
    expect(result.findings[0].detail).toContain('design/run-log/<slug>.md');
  });

  it('fails a cross-chunk merge the audit has not ruled on (#294)', async () => {
    const { result, found } = await committedProject({
      'CROSS-CHUNK.md': '# Cross-Chunk References\n\n### Merge 1\n- Chunk: auctions\n- Verdict: pending\n',
    });
    expect(result.checked).toContain('CROSS-CHUNK.md');
    expect(found).toEqual(['CROSS-CHUNK.md:Merge 1:cross-chunk-unreviewed']);
  });

  it('fails a question number used twice, and a provisional id used twice (#294)', async () => {
    const { found } = await committedProject({
      'QUESTIONS.md': '### Question 3\n- Question: a\n### Question 3\n- Question: b\n',
      'RULINGS.md': '### Ruling @trading.1\n- Decision: a\n### Ruling @trading.1\n- Decision: b\n',
    });
    expect(found).toContain('RULINGS.md:Ruling @trading.1:duplicate-number');
    expect(found).toContain('QUESTIONS.md:Question 3:duplicate-number');
  });

  it('fails a provisional id in the main checkout, where only chunk-merge may land one (#294)', async () => {
    const { result, found } = await committedProject({
      'RULINGS.md': ruling(1) + '### Ruling @trading.1\n- Decision: merged by hand.\n',
      'CONSTRAINTS.md': '# Constraints\n\n## Growing Structures\n\n### G@trading.1\n- State: x\n',
    });
    expect(found).toEqual([
      'RULINGS.md:Ruling @trading.1:provisional-on-main-line',
      'CONSTRAINTS.md:G@trading.1:provisional-on-main-line',
    ]);
    expect(result.findings[0].detail).toContain('boardsmith chunk-merge');
  });

  it('accepts provisional ids in a chunk\'s own worktree, where a parallel branch writes them', async () => {
    const dir = await project({ 'RULINGS.md': ruling(1) });
    commitAt(dir, '2026-09-23T12:00:00Z');
    const worktree = join(dirname(dir), 'wt-trading');
    execSync(`git worktree add -q -b chunk/trading ${worktree}`, { cwd: dir, stdio: 'ignore' });
    await fs.appendFile(join(worktree, 'design', 'RULINGS.md'), '### Ruling @trading.1\n- Decision: x.\n');
    commitAt(worktree, '2026-09-23T12:30:00Z');
    expect((await ledgerCheck(worktree)).findings).toEqual([]);
  });

  it('passes a committed log whose times precede their commits, and reports absent ledgers', async () => {
    const dir = await project({
      'run-log/core-loop.md': dispatch(1, '2026-09-23T10:00:00Z', 'closed', '2026-09-23T11:00:00Z'),
      'RULINGS.md': ruling(1),
    });
    commitAt(dir, '2026-09-23T12:00:00Z');
    const result = await ledgerCheck(dir);
    expect(result.findings).toEqual([]);
    expect(result.checked).toEqual(['RULINGS.md', 'run-log/core-loop.md']);
    expect(result.absent).toEqual(['DECISIONS.md', 'FILINGS.md', 'QUESTIONS.md', 'RUN.md', 'CROSS-CHUNK.md']);
  });

  it('checks every ledger in one run, so a merged tree is checked as a whole', async () => {
    const dir = await project({
      'RULINGS.md': ruling(138) + ruling(138),
      'DECISIONS.md': '### Decision 2\n- Decision: x. Supersedes Decision 1.\n',
      'FILINGS.md': filing(1, 'posted', 'n/a — not posted'),
    });
    commitAt(dir, '2026-09-23T12:00:00Z');
    const result: LedgerCheckResult = await ledgerCheck(dir);
    expect(located(result.findings)).toEqual([
      'RULINGS.md:duplicate-number',
      'DECISIONS.md:supersession-target-missing',
      'FILINGS.md:filing-status-conflict',
    ]);
  });

  it('the command exits non-zero on a finding and zero on a clean project', async () => {
    const bad = await project({ 'RULINGS.md': ruling(1) + ruling(1) });
    await ledgerCheckCommand({ project: bad, json: true });
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    const good = await project({ 'RULINGS.md': ruling(1) });
    await ledgerCheckCommand({ project: good, json: true });
    expect(process.exitCode).toBeUndefined();
  });

  it('confirms a review round\'s passing verify against the result on this machine, when there is one (#454)', async () => {
    const commit = '0123456789abcdef0123456789abcdef01234567';
    const roleFields = ['- Work: build', '- Role: bounded', '- Agent: bs-bounded'];
    const log = [
      dispatch(1, '2026-09-23T10:00:00Z', 'done', '2026-09-23T11:00:00Z').replace(/- Work: build-chunk\n- Role: judgement\n- Agent: bs-judgement/, roleFields.join('\n')),
      '### Review Round 1',
      '- Step: audit',
      '- Reviewed: Dispatch 1',
      '- Level: full',
      `- Verify: ${commit.slice(0, 12)} passed`,
      '- Agents: bs-review',
      '- Outcome: clean',
      '',
    ].join('\n');
    const result = (passed: boolean) =>
      buildVerifyResult({
        commit,
        cleanTree: true,
        base: { ref: 'main', commit: 'f'.repeat(40) },
        chunk: 'core-loop',
        checks: [{ name: 'test', passed, summary: passed ? 'all passed' : '1 failed' }],
      });

    const unverified = await project({ 'run-log/core-loop.md': log });
    commitAt(unverified, '2026-09-23T12:00:00Z');
    expect((await ledgerCheck(unverified)).findings).toEqual([]);

    await writeVerifyResult(unverified, result(false));
    const [finding, ...others] = (await ledgerCheck(unverified)).findings;
    expect(others).toEqual([]);
    expect(`${finding.ledger}:${finding.entry}:${finding.kind}`).toBe('run-log/core-loop.md:Review Round 1:review-round');
    expect(finding.detail).toContain(`the verify result on file for that commit (.boardsmith/verify/${commit}.json) failed`);

    await writeVerifyResult(unverified, result(true));
    expect((await ledgerCheck(unverified)).findings).toEqual([]);
  });

  it('refuses a chunk named like a skill that keeps its own run log, since the two would share one file (#454)', async () => {
    const dir = await project({ 'chunks/verify-game/CHUNK.md': 'Status: proposed\n', 'chunks/trading/CHUNK.md': 'Status: proposed\n' });
    commitAt(dir, '2026-09-23T12:00:00Z');
    const findings = (await ledgerCheck(dir)).findings;
    expect(findings.map((f) => `${f.ledger}:${f.entry}:${f.kind}`)).toEqual(['run-log/verify-game.md:chunk verify-game:run-log-shared']);
    expect(findings[0].detail).toMatch(/\/bs-verify-game keeps its own dispatches in design\/run-log\/verify-game\.md.*Rename the chunk/);
  });

  it('refuses a project with a run log outside a git repository, saying why', async () => {
    const tree = tempTree('bs-ledger-check-nogit-');
    const dir = join(tree, 'proj');
    await fs.mkdir(join(dir, 'design', 'run-log'), { recursive: true });
    await fs.writeFile(join(dir, 'design', 'run-log', 'core-loop.md'), dispatch(1, '2026-09-23T10:00:00Z', 'pending', 'pending'));
    await expect(ledgerCheck(dir)).rejects.toThrow(/not a git repository/);
  });
});

/**
 * #292: a ledger entry or a verified CHUNK.md (its sign-off included) that cites a script or a
 * capture is only evidence if that file is in git. sotf's food-invariant harness lived in the
 * gitignored scratch folder while Decision 257 said it was committed.
 */
describe('ledgerCheck — cited evidence must be in git (#292)', () => {
  async function tree(files: Record<string, string>): Promise<string> {
    const dir = await project({});
    await fs.writeFile(join(dir, '.gitignore'), '.boardsmith/\n');
    for (const [rel, text] of Object.entries(files)) {
      await fs.mkdir(join(dir, rel, '..'), { recursive: true });
      await fs.writeFile(join(dir, rel), text);
    }
    return dir;
  }

  function chunk(status: string, body: string): string {
    return [`# Chunk: world-shell`, '', `Status: ${status}`, '', '## Sign-off', body, ''].join('\n');
  }

  const evidence = (f: LedgerFinding[]) => f.filter((x) => x.kind === 'evidence-not-committed');

  it('fails a decision that cites a harness in the gitignored scratch folder', async () => {
    const dir = await tree({
      'design/DECISIONS.md': '### Decision 257\n- Decision: food holds; see `.boardsmith/scratch/food-invariant.mjs`.\n',
      '.boardsmith/scratch/food-invariant.mjs': '// harness\n',
    });
    commitAt(dir, '2026-09-23T12:00:00Z');
    const found = evidence((await ledgerCheck(dir)).findings);
    expect(found).toHaveLength(1);
    expect(found[0].ledger).toBe('DECISIONS.md');
    expect(found[0].entry).toBe('line 2');
    expect(found[0].detail).toContain('.boardsmith/scratch/food-invariant.mjs');
    expect(found[0].detail).toMatch(/gitignored/);
    expect(found[0].detail).toContain('design/chunks/<slug>/evidence/');
  });

  it('passes a verified chunk whose sign-off cites committed evidence, design-relative or project-relative', async () => {
    const dir = await tree({
      'design/chunks/world-shell/CHUNK.md': chunk(
        'verified',
        'automated: chunks/world-shell/evidence/food.mjs and design/chunks/world-shell/evidence/after.png',
      ),
      'design/chunks/world-shell/evidence/food.mjs': '// kept\n',
      'design/chunks/world-shell/evidence/after.png': 'png',
    });
    commitAt(dir, '2026-09-23T12:00:00Z');
    const result = await ledgerCheck(dir);
    expect(evidence(result.findings)).toEqual([]);
    expect(result.checked).toContain('chunks/world-shell/CHUNK.md');
  });

  it('fails a verified chunk that cites a missing file, an untracked file, or a path outside the project', async () => {
    const dir = await tree({
      'design/chunks/world-shell/CHUNK.md': chunk(
        'verified (user-waived)',
        ['- tests/gone.test.ts', '- chunks/world-shell/evidence/new.mjs', '- /tmp/driver.mjs'].join('\n'),
      ),
    });
    commitAt(dir, '2026-09-23T12:00:00Z');
    await fs.mkdir(join(dir, 'design/chunks/world-shell/evidence'), { recursive: true });
    await fs.writeFile(join(dir, 'design/chunks/world-shell/evidence/new.mjs'), '// not added\n');
    const found = evidence((await ledgerCheck(dir)).findings);
    expect(found.map((f) => f.ledger)).toEqual(Array(3).fill('chunks/world-shell/CHUNK.md'));
    expect(found[0].detail).toMatch(/does not exist/);
    expect(found[1].detail).toMatch(/git add/);
    expect(found[2].detail).toMatch(/outside the project/);
  });

  it('passes a decision citing a file that was committed when the decision was, and deleted later (#398)', async () => {
    const dir = await tree({ 'src/rules/flow.ts': '// the old session flow\n' });
    commitAt(dir, '2026-09-20T12:00:00Z');
    await fs.writeFile(join(dir, 'design/DECISIONS.md'), '### Decision 12\n- Decision: turn order lives in `src/rules/flow.ts`.\n');
    commitAt(dir, '2026-09-21T12:00:00Z');
    await fs.rm(join(dir, 'src/rules/flow.ts'));
    commitAt(dir, '2026-09-22T12:00:00Z');
    expect(evidence((await ledgerCheck(dir)).findings)).toEqual([]);
  });

  it('still fails a citation of a file that was not in git when the citing line was committed (#398)', async () => {
    const dir = await tree({ 'src/rules/flow.ts': '// the old session flow\n' });
    commitAt(dir, '2026-09-20T12:00:00Z');
    await fs.rm(join(dir, 'src/rules/flow.ts'));
    commitAt(dir, '2026-09-21T12:00:00Z');
    await fs.writeFile(
      join(dir, 'design/DECISIONS.md'),
      ['### Decision 12', '- Decision: see `src/rules/flow.ts`.', '### Decision 13', '- Decision: see `tests/never.test.ts`.', ''].join('\n'),
    );
    commitAt(dir, '2026-09-22T12:00:00Z');
    await fs.appendFile(join(dir, 'design/DECISIONS.md'), '### Decision 14\n- Decision: see `src/rules/flow.ts` again.\n');
    const found = evidence((await ledgerCheck(dir)).findings);
    expect(found.map((f) => f.entry)).toEqual(['line 2', 'line 4', 'line 6']);
    for (const f of found) expect(f.detail).toMatch(/does not exist/);
  });

  it('reports a ~/ path in another checkout as outside the project, not as a missing project file (#398)', async () => {
    const dir = await tree({
      'design/DECISIONS.md': '### Decision 3\n- Decision: zoom as `~/BoardSmith/src/ui/composables/useAutoZoom.ts` does.\n',
    });
    commitAt(dir, '2026-09-23T12:00:00Z');
    vi.stubEnv('HOME', dirname(dir));
    try {
      const found = evidence((await ledgerCheck(dir)).findings);
      expect(found).toHaveLength(1);
      expect(found[0].detail).toMatch(/outside the project/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('does not treat a module specifier quoted in a decision as a cited file (#398)', async () => {
    const dir = await tree({
      'design/DECISIONS.md': "### Decision 4\n- Decision: the host loads it with `import { beat } from './heartbeat.js'`.\n",
    });
    commitAt(dir, '2026-09-23T12:00:00Z');
    expect(evidence((await ledgerCheck(dir)).findings)).toEqual([]);
  });

  it('reads a claim\'s Source path exactly as claim-quote-check does, so a claim that passes one passes the other (#409)', async () => {
    const claims = [
      '1. **Trading starts at zero.**',
      '   > export const TRADING = 0;',
      '   Source: ../src/world.ts:1',
      '2. **Hunting starts at one.**',
      '   > export const HUNTING = 1;',
      '   Source: src/hunting.ts:1',
      '3. **Ties go to combatant 2.**',
      '   > Ties favour combatant 2.',
      '   Source: rulebook/08-combat.md:1',
    ].join('\n');
    const dir = await tree({
      'design/chunks/world-shell/CHUNK.md': [
        '# Chunk: world-shell', '', 'Status: verified', '', '## Interpretation', '', claims, '', '## Sign-off', 'ok', '',
      ].join('\n'),
      'src/world.ts': 'export const TRADING = 0;\n',
      'src/hunting.ts': 'export const HUNTING = 1;\n',
      'design/rulebook/08-combat.md': 'Ties favour combatant 2.\n',
    });
    commitAt(dir, '2026-09-23T12:00:00Z');
    expect((await checkClaimQuotes(dir, 'world-shell')).refusals).toEqual([]);
    expect(evidence((await ledgerCheck(dir)).findings)).toEqual([]);
  });

  it('refuses a claim\'s Source path that leaves the project in both checks (#409)', async () => {
    const dir = await tree({
      'design/chunks/world-shell/CHUNK.md': [
        '# Chunk: world-shell', '', 'Status: verified', '', '## Interpretation', '',
        '1. **Trading starts at zero.**', '   > export const TRADING = 0;', '   Source: ../../other/src/world.ts:1', '',
      ].join('\n'),
    });
    commitAt(dir, '2026-09-23T12:00:00Z');
    expect((await checkClaimQuotes(dir, 'world-shell')).refusals[0]).toMatch(/outside this project/);
    const found = evidence((await ledgerCheck(dir)).findings);
    expect(found).toHaveLength(1);
    expect(found[0].detail).toMatch(/outside the project/);
  });

  const citedLines = (f: LedgerFinding[]) => f.filter((x) => x.kind === 'cited-lines-missing');
  const decision = (citation: string) => `### Decision 7\n- Decision: measured with \`${citation}\`.\n`;
  const fiveLines = ['one', 'two', 'three', 'four', 'five', ''].join('\n');
  async function expectNoCitationFindings(dir: string): Promise<void> {
    const { findings } = await ledgerCheck(dir);
    expect(evidence(findings)).toEqual([]);
    expect(citedLines(findings)).toEqual([]);
  }

  it('fails a decision that cites a gitignored scratch harness by line range, as it does one cited by line (#414)', async () => {
    const dir = await tree({
      'design/DECISIONS.md': [decision('.boardsmith/scratch/probe.mjs:1-5'), decision('.boardsmith/scratch/probe.mjs:1')].join(''),
      '.boardsmith/scratch/probe.mjs': fiveLines,
    });
    commitAt(dir, '2026-09-23T12:00:00Z');
    const found = evidence((await ledgerCheck(dir)).findings);
    expect(found.map((f) => f.entry)).toEqual(['line 2', 'line 4']);
    for (const f of found) expect(f.detail).toMatch(/gitignored/);
  });

  it('passes a committed file cited by lines it has, up to its last line (#414)', async () => {
    const dir = await tree({
      'design/DECISIONS.md': [decision('src/rules/game.ts:2-5'), decision('../src/rules/game.ts:3')].join(''),
      'src/rules/game.ts': fiveLines,
    });
    commitAt(dir, '2026-09-23T12:00:00Z');
    await expectNoCitationFindings(dir);
  });

  it('fails a citation of lines past the end of the file, and a range that is not a range (#414)', async () => {
    const dir = await tree({
      'design/DECISIONS.md': [decision('src/rules/game.ts:4-9'), decision('src/rules/game.ts:5-2'), decision('src/rules/game.ts:0')].join(''),
      'src/rules/game.ts': fiveLines,
    });
    commitAt(dir, '2026-09-23T12:00:00Z');
    const [pastEnd, ...notRanges] = citedLines((await ledgerCheck(dir)).findings);
    expect([pastEnd, ...notRanges].map((f) => `${f.ledger} ${f.entry}`)).toEqual(
      ['line 2', 'line 4', 'line 6'].map((entry) => `DECISIONS.md ${entry}`),
    );
    expect(pastEnd.detail).toContain('src/rules/game.ts:4-9');
    expect(pastEnd.detail).toMatch(/line 9, but src\/rules\/game\.ts had 5 lines/);
    for (const f of notRanges) expect(f.detail).toMatch(/:N or :N-M with N <= M/);
  });

  it('reads the cited lines in the file as it was at the commit that recorded the citation (#414)', async () => {
    const dir = await tree({ 'src/rules/game.ts': fiveLines, 'src/rules/gone.ts': fiveLines });
    commitAt(dir, '2026-09-20T12:00:00Z');
    await fs.writeFile(join(dir, 'design/DECISIONS.md'), [decision('src/rules/game.ts:4-5'), decision('src/rules/gone.ts:5')].join(''));
    commitAt(dir, '2026-09-21T12:00:00Z');
    await fs.writeFile(join(dir, 'src/rules/game.ts'), 'one\n');
    await fs.rm(join(dir, 'src/rules/gone.ts'));
    commitAt(dir, '2026-09-22T12:00:00Z');
    await expectNoCitationFindings(dir);
  });

  it('reads a citation not committed yet, or one committed before its file was, against the file as it is now (#414)', async () => {
    const dir = await tree({ 'design/DECISIONS.md': decision('src/rules/late.ts:6') });
    commitAt(dir, '2026-09-20T12:00:00Z');
    await fs.mkdir(join(dir, 'src/rules'), { recursive: true });
    await fs.writeFile(join(dir, 'src/rules/late.ts'), fiveLines);
    await fs.writeFile(join(dir, 'src/rules/game.ts'), fiveLines);
    commitAt(dir, '2026-09-21T12:00:00Z');
    await fs.appendFile(join(dir, 'design/DECISIONS.md'), decision('src/rules/game.ts:7'));
    const found = citedLines((await ledgerCheck(dir)).findings);
    expect(found.map((f) => f.entry)).toEqual(['line 2', 'line 4']);
    expect(found[0].detail).toMatch(/line 6, but src\/rules\/late\.ts has 5 lines/);
    expect(found[1].detail).toMatch(/line 7, but src\/rules\/game\.ts has 5 lines/);
  });

  /**
   * #432: a claim about how BoardSmith behaves quotes BoardSmith's own source, and claim-quote-check
   * reads it from the installed package (`../node_modules/boardsmith/...`). That file is in no
   * commit of the game (node_modules is gitignored, and a game's copy is a symlink to the library's
   * checkout), so it is held to the installed package having it, and the lines cited, instead.
   */
  async function withInstalledBoardSmith(files: Record<string, string>, library: Record<string, string>): Promise<string> {
    const dir = await tree({ '.gitignore': '.boardsmith/\nnode_modules/\n', ...files });
    const checkout = join(dir, '..', 'BoardSmith');
    for (const [rel, text] of Object.entries(library)) {
      await fs.mkdir(dirname(join(checkout, rel)), { recursive: true });
      await fs.writeFile(join(checkout, rel), text);
    }
    await fs.mkdir(join(dir, 'node_modules'), { recursive: true });
    await fs.symlink(checkout, join(dir, 'node_modules', 'boardsmith'));
    commitAt(dir, '2026-09-23T12:00:00Z');
    return dir;
  }

  function verifiedClaims(...claims: string[]): string {
    return ['# Chunk: game-end', '', 'Status: verified', '', '## Interpretation', '', ...claims, '', '## Sign-off', 'ok', ''].join('\n');
  }

  const engineTs = ['// flow engine', 'if (this.complete) {', '  return this.finish();', '}', ''].join('\n');

  it('passes a claim quoting BoardSmith source from the installed package, in both checks (#432)', async () => {
    const dir = await withInstalledBoardSmith(
      {
        'design/chunks/game-end/CHUNK.md': verifiedClaims(
          '1. **The engine finishes a complete game.**',
          '   > if (this.complete) { return this.finish();',
          '   Source: ../node_modules/boardsmith/src/engine/flow/engine.ts:2-3',
          '2. **The same, cited from the project root.**',
          '   > return this.finish();',
          '   Source: node_modules/boardsmith/src/engine/flow/engine.ts:3',
        ),
      },
      { 'src/engine/flow/engine.ts': engineTs },
    );
    expect((await checkClaimQuotes(dir, 'game-end')).refusals).toEqual([]);
    await expectNoCitationFindings(dir);
  });

  it('fails a citation of a BoardSmith file or lines the installed package does not have (#432)', async () => {
    const dir = await withInstalledBoardSmith(
      {
        'design/DECISIONS.md': [
          decision('../node_modules/boardsmith/src/engine/flow/gone.ts'),
          decision('../node_modules/boardsmith/src/engine/flow/engine.ts:3-9'),
        ].join(''),
      },
      { 'src/engine/flow/engine.ts': engineTs },
    );
    const { findings } = await ledgerCheck(dir);
    const [missing] = evidence(findings);
    expect(evidence(findings)).toHaveLength(1);
    expect(missing.entry).toBe('line 2');
    expect(missing.detail).toMatch(/installed BoardSmith \(node_modules\/boardsmith\) has no src\/engine\/flow\/gone\.ts/);
    expect(missing.detail).not.toMatch(/git add/);
    const [pastEnd] = citedLines(findings);
    expect(citedLines(findings)).toHaveLength(1);
    expect(pastEnd.entry).toBe('line 4');
    expect(pastEnd.detail).toMatch(/line 9, but the installed BoardSmith's src\/engine\/flow\/engine\.ts has 4 lines/);
  });

  /**
   * #426: a verified chunk's claim may cite code as it was in a commit of the chunk's history
   * (`path@<commit>:N-M`), so ledger-check holds that citation to the file having been in git
   * there, with those lines, and not to the file as it is now.
   */
  async function builtChunkCiting(source: (base: string) => string[]): Promise<string> {
    const dir = await tree({ 'src/rules/damage.ts': fiveLines });
    commitAt(dir, '2026-09-20T12:00:00Z');
    const base = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    const claims = source(base.slice(0, 7)).flatMap((s, i) => [`${i + 1}. **Claim.**`, '   > one', `   Source: ${s}`]);
    await fs.mkdir(join(dir, 'design/chunks/game-end'), { recursive: true });
    await fs.writeFile(join(dir, 'design/chunks/game-end/CHUNK.md'), verifiedClaims(...claims));
    execSync('git add -A', { cwd: dir, stdio: 'ignore' });
    execSync(`git ${GIT} commit -q -m "chunk-game-end/step-investigate: claims"`, { cwd: dir, stdio: 'ignore' });
    await fs.rm(join(dir, 'src/rules/damage.ts'));
    execSync('git add -A', { cwd: dir, stdio: 'ignore' });
    execSync(`git ${GIT} commit -q -m "chunk-game-end/step-build: replaced"`, { cwd: dir, stdio: 'ignore' });
    return dir;
  }

  it('passes a claim citing a file the chunk removed, pinned to a commit of the chunk (#426)', async () => {
    await expectNoCitationFindings(await builtChunkCiting((base) => [`../src/rules/damage.ts@${base}:1-5`]));
  });

  it('fails a pinned citation of lines or a file the commit did not have, or a commit outside the chunk (#426)', async () => {
    const dir = await builtChunkCiting((base) => [
      `../src/rules/damage.ts@${base}:4-9`,
      `../src/rules/other.ts@${base}:1`,
      '../src/rules/damage.ts@abcdef0:1',
    ]);
    const { findings } = await ledgerCheck(dir);
    const [pastEnd] = citedLines(findings);
    expect(citedLines(findings)).toHaveLength(1);
    expect(pastEnd.detail).toMatch(/line 9, but src\/rules\/damage\.ts had 5 lines at [0-9a-f]{10} \(base of chunk-game-end\)/);
    const [missing, outsideChunk] = evidence(findings);
    expect(evidence(findings)).toHaveLength(2);
    expect(missing.detail).toMatch(/src\/rules\/other\.ts was not in git at [0-9a-f]{10} \(base of chunk-game-end\)/);
    expect(outsideChunk.detail).toMatch(/abcdef0 is not a commit of chunk "game-end"/);
  });

  it('fails a pinned citation outside a chunk\'s CHUNK.md, which has no chunk history (#426)', async () => {
    const dir = await tree({ 'design/DECISIONS.md': decision('src/rules/game.ts@abcdef0:2'), 'src/rules/game.ts': fiveLines });
    commitAt(dir, '2026-09-23T12:00:00Z');
    const [pinned, ...others] = (await ledgerCheck(dir)).findings;
    expect(others).toEqual([]);
    expect(pinned).toMatchObject({ ledger: 'DECISIONS.md', entry: 'line 2', kind: 'evidence-not-committed' });
    expect(pinned.detail).toMatch(/pins a commit, and only a chunk's CHUNK\.md may.*as it is now/);
  });

  it('does not hold a chunk that is not verified yet to its citations', async () => {
    const dir = await tree({
      'design/chunks/world-shell/CHUNK.md': chunk('built', '- tests/not-written-yet.test.ts'),
    });
    commitAt(dir, '2026-09-23T12:00:00Z');
    expect(evidence((await ledgerCheck(dir)).findings)).toEqual([]);
  });
});

describe('provisional entries after numbered ones (#436)', () => {
  it('does not read a provisional filing\'s fields as the numbered filing above it', () => {
    const text = [
      filing(25, 'posted', 'https://github.com/Shufflewick/BoardSmith/issues/283'),
      filing(1, 'recorded', 'n/a — not posted').replace('### Filing 1', '### Filing @demo.1'),
    ].join('\n');
    expect(checkFilingStatus(text)).toEqual([]);
  });

  it('names a provisional filing by its own id when it is inconsistent', () => {
    const text = [
      filing(25, 'recorded', 'n/a — not posted'),
      filing(1, 'posted', 'n/a — not posted').replace('### Filing 1', '### Filing @demo.1'),
    ].join('\n');
    expect(checkFilingStatus(text).map((f) => f.entry)).toEqual(['Filing @demo.1']);
  });

  it('reads a provisional decision\'s supersession as its own, pointing both ways', () => {
    const text = [
      '### Decision 25',
      '- Decision: old.',
      '- Superseded by: Decision @board-zoom-pan.9',
      '',
      '### Decision 109',
      '- Decision: unrelated.',
      '',
      '### Decision @board-zoom-pan.9',
      '- Decision: new. Supersedes Decision 25.',
    ].join('\n');
    expect(checkNumberedLedger(text, 'Decision', 'DECISIONS.md')).toEqual([]);
  });

  it('still reports a provisional entry that supersedes an entry without its pointer', () => {
    const text = ['### Decision 25', '- Decision: old.', '', '### Decision @demo.1', '- Decision: Supersedes Decision 25.'].join('\n');
    const findings = checkNumberedLedger(text, 'Decision', 'DECISIONS.md');
    expect(findings.map((f) => [f.entry, f.kind])).toEqual([['Decision 25', 'superseded-without-pointer']]);
    expect(findings[0].detail).toContain('- Superseded by: Decision @demo.1');
  });
});
