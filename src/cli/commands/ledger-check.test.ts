import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
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
import { tempTree } from '../../testing/temp-tree.test-helper.js';

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
    '- Chunk: core-loop',
    '- Pipeline: build-chunk',
    `- Dispatched at: ${dispatched}`,
    `- Finished at: ${finished}`,
    `- Outcome: ${outcome}`,
    '- Detail: n/a',
    '',
  ].join('\n');
}

const epoch = (iso: string) => Date.parse(iso) / 1000;
const NOW = epoch('2026-09-24T00:00:00Z');
const uncommitted = () => null;

describe('checkRunLog', () => {
  it('passes a well-formed log whose times are no later than their commits', () => {
    const text = [
      dispatch(1, '2026-09-23T10:00:00Z', 'closed', '2026-09-23T11:00:00Z'),
      dispatch(2, '2026-09-23T11:05:00Z', 'pending', 'pending'),
    ].join('\n');
    expect(checkRunLog(text, () => epoch('2026-09-23T12:00:00Z'), NOW)).toEqual([]);
  });

  it('fails a finish earlier than its dispatch (sotf Dispatch 73)', () => {
    const text = dispatch(73, '2026-09-23T10:03:30Z', 'closed', '2026-09-22T12:30:00Z');
    const findings = checkRunLog(text, uncommitted, NOW);
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
    const findings = checkRunLog(text, commitTime, NOW);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toMatch(/Finished at .* is later than the commit/);
  });

  it('fails an uncommitted timestamp that is in the future', () => {
    const text = dispatch(1, '2026-09-25T10:00:00Z', 'pending', 'pending');
    expect(checkRunLog(text, uncommitted, NOW).map((f) => f.kind)).toEqual(['run-timestamp']);
  });

  it('fails a dispatch earlier than the one logged before it', () => {
    const text = [
      dispatch(1, '2026-09-23T10:00:00Z', 'closed', '2026-09-23T11:00:00Z'),
      dispatch(2, '2026-09-22T09:00:00Z', 'pending', 'pending'),
    ].join('\n');
    const findings = checkRunLog(text, uncommitted, NOW);
    expect(findings.map((f) => f.entry)).toEqual(['Dispatch 2']);
  });

  it('fails a returned dispatch with no finish time, a pending one with a finish time, and a hand-typed shape', () => {
    const text = [
      dispatch(1, '2026-09-23T10:00:00Z', 'closed', 'pending'),
      dispatch(2, '2026-09-23T10:10:00Z', 'pending', '2026-09-23T10:20:00Z'),
      dispatch(3, 'Sept 23, 10:30', 'pending', 'pending'),
    ].join('\n');
    expect(checkRunLog(text, uncommitted, NOW).map((f) => f.entry)).toEqual([
      'Dispatch 1',
      'Dispatch 2',
      'Dispatch 3',
    ]);
  });

  it('fails a missing Finished at field', () => {
    const text = '### Dispatch 1\n- Dispatched at: 2026-09-23T10:00:00Z\n- Outcome: pending\n';
    expect(checkRunLog(text, uncommitted, NOW)[0].detail).toMatch(/Finished at/);
  });

  it('reports a dispatch number used twice', () => {
    const text = [
      dispatch(1, '2026-09-23T10:00:00Z', 'closed', '2026-09-23T11:00:00Z'),
      dispatch(1, '2026-09-23T11:05:00Z', 'pending', 'pending'),
    ].join('\n');
    expect(checkRunLog(text, uncommitted, NOW).map((f) => f.kind)).toEqual(['duplicate-number']);
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

  it('compares RUN.md times against the commit that recorded each line', async () => {
    const dir = await project({
      'RUN.md': dispatch(1, '2026-09-23T10:00:00Z', 'closed', '2026-09-23T11:00:00Z'),
    });
    // Committed at 10:30, so a finish at 11:00 was typed before it happened.
    commitAt(dir, '2026-09-23T10:30:00Z');
    const result = await ledgerCheck(dir);
    expect(result.findings.map((f) => f.entry)).toEqual(['Dispatch 1']);
    expect(result.findings[0].detail).toMatch(/Finished at/);
  });

  it('passes a committed log whose times precede their commits, and reports absent ledgers', async () => {
    const dir = await project({
      'RUN.md': dispatch(1, '2026-09-23T10:00:00Z', 'closed', '2026-09-23T11:00:00Z'),
      'RULINGS.md': ruling(1),
    });
    commitAt(dir, '2026-09-23T12:00:00Z');
    const result = await ledgerCheck(dir);
    expect(result.findings).toEqual([]);
    expect(result.checked).toEqual(['RULINGS.md', 'RUN.md']);
    expect(result.absent).toEqual(['DECISIONS.md', 'FILINGS.md']);
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

  it('refuses a project with a RUN.md outside a git repository, saying why', async () => {
    const tree = tempTree('bs-ledger-check-nogit-');
    const dir = join(tree, 'proj');
    await fs.mkdir(join(dir, 'design'), { recursive: true });
    await fs.writeFile(join(dir, 'design', 'RUN.md'), dispatch(1, '2026-09-23T10:00:00Z', 'pending', 'pending'));
    await expect(ledgerCheck(dir)).rejects.toThrow(/not a git repository/);
  });
});
