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
    '- Pipeline: build-chunk',
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

describe('checkRunLog', () => {
  it('passes a well-formed log whose times are no later than their commits', () => {
    const text = [
      dispatch(1, '2026-09-23T10:00:00Z', 'closed', '2026-09-23T11:00:00Z'),
      dispatch(2, '2026-09-23T11:05:00Z', 'pending', 'pending'),
    ].join('\n');
    expect(checkRunLog(text, LOG, () => epoch('2026-09-23T12:00:00Z'), NOW)).toEqual([]);
  });

  it('fails a finish earlier than its dispatch (sotf Dispatch 73)', () => {
    const text = dispatch(73, '2026-09-23T10:03:30Z', 'closed', '2026-09-22T12:30:00Z');
    const findings = checkRunLog(text, LOG, uncommitted, NOW);
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
    const findings = checkRunLog(text, LOG, commitTime, NOW);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toMatch(/Finished at .* is later than the commit/);
  });

  it('fails an uncommitted timestamp that is in the future', () => {
    const text = dispatch(1, '2026-09-25T10:00:00Z', 'pending', 'pending');
    expect(checkRunLog(text, LOG, uncommitted, NOW).map((f) => f.kind)).toEqual(['run-timestamp']);
  });

  it('fails a dispatch earlier than the one logged before it', () => {
    const text = [
      dispatch(1, '2026-09-23T10:00:00Z', 'closed', '2026-09-23T11:00:00Z'),
      dispatch(2, '2026-09-22T09:00:00Z', 'pending', 'pending'),
    ].join('\n');
    const findings = checkRunLog(text, LOG, uncommitted, NOW);
    expect(findings.map((f) => f.entry)).toEqual(['Dispatch 2']);
  });

  it('fails a returned dispatch with no finish time, a pending one with a finish time, and a hand-typed shape', () => {
    const text = [
      dispatch(1, '2026-09-23T10:00:00Z', 'closed', 'pending'),
      dispatch(2, '2026-09-23T10:10:00Z', 'pending', '2026-09-23T10:20:00Z'),
      dispatch(3, 'Sept 23, 10:30', 'pending', 'pending'),
    ].join('\n');
    expect(checkRunLog(text, LOG, uncommitted, NOW).map((f) => f.entry)).toEqual([
      'Dispatch 1',
      'Dispatch 2',
      'Dispatch 3',
    ]);
  });

  it('fails a missing Finished at field', () => {
    const text = '### Dispatch 1\n- Dispatched at: 2026-09-23T10:00:00Z\n- Outcome: pending\n';
    expect(checkRunLog(text, LOG, uncommitted, NOW)[0].detail).toMatch(/Finished at/);
  });

  it('reports a dispatch number used twice', () => {
    const text = [
      dispatch(1, '2026-09-23T10:00:00Z', 'closed', '2026-09-23T11:00:00Z'),
      dispatch(1, '2026-09-23T11:05:00Z', 'pending', 'pending'),
    ].join('\n');
    expect(checkRunLog(text, LOG, uncommitted, NOW).map((f) => f.kind)).toEqual(['duplicate-number']);
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

  it('does not hold a chunk that is not verified yet to its citations', async () => {
    const dir = await tree({
      'design/chunks/world-shell/CHUNK.md': chunk('built', '- tests/not-written-yet.test.ts'),
    });
    commitAt(dir, '2026-09-23T12:00:00Z');
    expect(evidence((await ledgerCheck(dir)).findings)).toEqual([]);
  });
});
