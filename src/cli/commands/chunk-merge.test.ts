/**
 * #294: `boardsmith chunk-merge` is the one way a chunk built on its own branch reaches the main
 * line. It merges serially, allocates ledger numbers on the combined tree, re-runs the tree-wide
 * checks there, and refuses (leaving the main line as it was) when the combined tree fails a
 * check each branch passed alone: the sotf failure, where each chunk measured only its own growth
 * in a shared partition and nobody measured the total (Shufflewick/sotf#24, #25).
 * chunk-merge-files.test.ts holds the tests for the files two chunks both touch; the two files run
 * side by side (#1319).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { chunkMerge } from './chunk-merge.js';
import { assessSignoffs, recordReopen, recordSignoff } from './chunk-signoff.js';
import { recordPassingVerify } from '../lib/verify-result.test-helper.js';
import { checkClaimQuotes } from './claim-quotes.js';
import { checkConstraints, type TestRunner } from './constraint-check.js';
import type { TypeCheckRun } from './validate.js';
import {
  git,
  write,
  read,
  budgetRunner,
  typeCheck,
  sketchEntry,
  main,
  setUp,
  buildOnBranch,
  head,
  status,
} from './chunk-merge.test-helper.js';
import { skillMarkdown } from '../slash-command/skill-markdown.test-helper.js';

/**
 * These tests merge real branches, so each one runs real git processes: at most about 80 (building
 * the repository and up to three chunk branches, then about 18 per merge). The count is fixed per
 * test, and the time is almost all process start-up, which a loaded machine stretches: the heaviest
 * test takes about 2 seconds at a load average of 140 (#310). The timeout covers that load, not
 * unbounded work. If a test here nears it, count the git calls the merge makes before raising it.
 */
vi.setConfig({ testTimeout: 30_000 });

beforeEach(setUp);

describe('chunkMerge: the combined tree is checked, not the branch alone', () => {
  it('merges two independent chunks one at a time, keeping the main line\'s session lock', async () => {
    await buildOnBranch('trading', 150);
    await buildOnBranch('quests', 150);

    const first = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(first.refusals).toEqual([]);
    const second = await chunkMerge(main, 'quests', { runTests: budgetRunner, typeCheck });
    expect(second.refusals).toEqual([]);
    expect(second.alongside).toEqual(['trading']);

    const sketch = await read(main, 'design/SKETCH.md');
    expect(sketch).toMatch(/^Session Lock: "trading,quests @ run-1/m);
    expect(sketch).toContain('- an idea from trading');
    expect(sketch).toContain('- an idea from quests');
    expect(status()).toBe('');
  });

  it("copies the chunk's verify results from its worktree into the main checkout, so review-gate can find them after the worktree goes (#1001)", async () => {
    const worktree = await buildOnBranch('trading', 150);
    const [result] = await fs.readdir(join(worktree, '.boardsmith/verify'));

    expect((await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck })).refusals).toEqual([]);

    expect(await read(main, `.boardsmith/verify/${result}`)).toBe(await read(worktree, `.boardsmith/verify/${result}`));
  });

  /** Records review rounds in `slug`'s run log on its branch, one per commit, each naming that commit's verify. */
  async function reviewRounds(worktree: string, slug: string, commits: string[]): Promise<void> {
    const log = await read(worktree, `design/run-log/${slug}.md`);
    const rounds = commits.map((commit, i) =>
      `### Review Round ${i + 1}\n- Step: audit\n- Reviewed: Dispatch 1\n- Level: full\n- Verify: ${commit.slice(0, 12)} passed\n` +
      '- Agents: fidelity=bs-judgement\n- Outcome: changes requested\n');
    await write(worktree, { [`design/run-log/${slug}.md`]: `${log}\n${rounds.join('\n')}` });
    git(worktree, 'add', '-A');
    git(worktree, 'commit', '-q', '-m', `chunk-${slug}/review`);
  }

  /** The commits whose verify results the chunk's worktree holds. */
  const verifiedCommits = async (worktree: string) =>
    (await fs.readdir(join(worktree, '.boardsmith/verify'))).map((name) => name.slice(0, -'.json'.length));

  it("names each review round's commit the main checkout has no verify result for, with how to record one there (#1302)", async () => {
    const worktree = await buildOnBranch('trading', 150);
    const [verified] = await verifiedCommits(worktree);
    await reviewRounds(worktree, 'trading', [verified]);
    git(main, 'worktree', 'remove', '--force', worktree);
    const mainBranch = git(main, 'branch', '--show-current').trim();

    const merge = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });

    expect(merge.refusals).toEqual([]);
    const short = verified.slice(0, 12);
    expect(merge.noVerifyResults).toContain(`this checkout has no verify result for review round 1's commit ${short}`);
    expect(merge.noVerifyResults).toContain(
      `with a clean tree run \`git checkout ${short}\`, run \`npx boardsmith verify --chunk trading\`, then \`git checkout ${mainBranch}\` again`,
    );
  });

  it('names the commit to go back to when the main checkout is on no branch (#1302)', async () => {
    const worktree = await buildOnBranch('trading', 150);
    const [verified] = await verifiedCommits(worktree);
    await reviewRounds(worktree, 'trading', [verified]);
    git(main, 'worktree', 'remove', '--force', worktree);
    git(main, 'checkout', '-q', '--detach');

    const merge = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });

    expect(merge.refusals).toEqual([]);
    expect(merge.noVerifyResults).toContain(`then \`git checkout ${head()}\` again`);
  });

  it('names only the rounds left without a result when it copied some of them (#1302)', async () => {
    const worktree = await buildOnBranch('trading', 150);
    const [verified] = await verifiedCommits(worktree);
    const unverified = git(worktree, 'rev-parse', 'HEAD').trim();
    await reviewRounds(worktree, 'trading', [verified, unverified]);

    const merge = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });

    expect(merge.refusals).toEqual([]);
    expect(merge.noVerifyResults).toContain(`review round 2's commit ${unverified.slice(0, 12)}`);
    expect(merge.noVerifyResults).not.toContain(verified.slice(0, 12));
  });

  it('says nothing when the main checkout already has a result for each round, though it copied none (#1302)', async () => {
    const worktree = await buildOnBranch('trading', 150);
    const [verified] = await verifiedCommits(worktree);
    await reviewRounds(worktree, 'trading', [verified]);
    await fs.mkdir(join(main, '.boardsmith/verify'), { recursive: true });
    await fs.copyFile(join(worktree, '.boardsmith/verify', `${verified}.json`), join(main, '.boardsmith/verify', `${verified}.json`));
    git(main, 'worktree', 'remove', '--force', worktree);

    const merge = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });

    expect(merge.refusals).toEqual([]);
    expect(merge.noVerifyResults).toBeUndefined();
  });

  it('says nothing about verify results when it copied one (#1202)', async () => {
    await buildOnBranch('trading', 150);
    expect((await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck })).noVerifyResults).toBeUndefined();
  });

  it('refuses a merge whose combined tree breaks a constraint each branch passed alone, and leaves main as it was', async () => {
    const trading = await buildOnBranch('trading', 300);
    const quests = await buildOnBranch('quests', 300);
    // Each branch alone holds the 512 byte budget: 100 + 300.
    expect((await checkConstraints(trading, { runTests: budgetRunner })).refusals).toEqual([]);
    expect((await checkConstraints(quests, { runTests: budgetRunner })).refusals).toEqual([]);

    expect((await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck })).refusals).toEqual([]);
    const before = head();
    const result = await chunkMerge(main, 'quests', { runTests: budgetRunner, typeCheck });

    expect(result.merged).toBe(false);
    expect(result.refusals.join('\n')).toMatch(/over the 512 byte budget/);
    expect(head()).toBe(before);
    expect(status()).toBe('');
  });

  it('refuses chunks built together that the sketch says may not be: overlapping citations', async () => {
    await buildOnBranch('trading', 100);
    await buildOnBranch('auctions', 100);
    expect((await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck })).refusals).toEqual([]);
    const result = await chunkMerge(main, 'auctions', { runTests: budgetRunner, typeCheck });
    expect(result.refusals.join('\n')).toMatch(/both cite rulebook\/04-trading\.md/);
    expect(status()).toBe('');
  });

  /** Trading is merged and verified on the main line; then auctions, which cites trading's page, leaves it. */
  async function tradingVerifiedBeforeAuctionsLeft(): Promise<void> {
    await buildOnBranch('trading', 100);
    expect((await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck })).refusals).toEqual([]);
    await buildOnBranch('auctions', 100);
  }

  /** Auctions' merge is refused under the pair rule, as built alongside trading, and main is left as it was. */
  async function expectAuctionsRefusedAlongsideTrading(): Promise<void> {
    const result = await chunkMerge(main, 'auctions', { runTests: budgetRunner, typeCheck });
    expect(result.merged).toBe(false);
    expect(result.refusals.join('\n')).toMatch(/both cite rulebook\/04-trading\.md/);
    expect(status()).toBe('');
  }

  it('does not count a chunk verified before the branch left as built alongside it, however its design files were edited since (#442)', async () => {
    await tradingVerifiedBeforeAuctionsLeft();
    // Bookkeeping on the main line: trading's CHUNK.md and run log are edited, as a re-sign or a
    // Verified Against rewrite does. Trading's rules are what auctions saw when it left.
    const chunk = await read(main, 'design/chunks/trading/CHUNK.md');
    const log = await read(main, 'design/run-log/trading.md');
    await write(main, {
      'design/chunks/trading/CHUNK.md': `${chunk}\n<!-- re-pointed after another chunk's merge -->\n`,
      'design/run-log/trading.md': `${log}\n- Note: re-signed\n`,
    });
    git(main, 'commit', '-q', '-am', 'bookkeeping on trading');

    const result = await chunkMerge(main, 'auctions', { runTests: budgetRunner, typeCheck });
    expect(result.refusals).toEqual([]);
    expect(result.alongside).toEqual([]);
    expect(status()).toBe('');
  });

  it('still counts a chunk verified before the branch left, then reopened and reworked on the main line, as built alongside it (#442)', async () => {
    await tradingVerifiedBeforeAuctionsLeft();
    // On the main line, trading goes back for rework, its code changes, and it is signed off again.
    await recordReopen('trading', { project: main, reason: 'prices rework', now: new Date('2026-09-02T00:00:00Z') });
    git(main, 'commit', '-q', '-am', 'chunk-trading/reopen');
    await write(main, { 'src/trading.ts': 'export const PARTITION_BYTES = 120;\n' });
    await recordPassingVerify(main, { chunk: 'trading', message: 'chunk-trading/revise-2' });
    await recordSignoff('trading', { project: main, automated: 'tests/budget.test.ts passed', now: new Date('2026-09-02T02:00:00Z') });
    git(main, 'commit', '-q', '-am', 'chunk-trading/close');
    expect((await assessSignoffs(main)).get('trading')!.problems).toEqual([]);

    await expectAuctionsRefusedAlongsideTrading();
  });

  it('counts a chunk the main line verified after the branch left as built alongside it, however it reached the main line (#442)', async () => {
    await buildOnBranch('trading', 100);
    await buildOnBranch('auctions', 100);
    // Not through chunk-merge: trading was still unverified on the main line when auctions left.
    git(main, 'merge', '-q', '--no-ff', '-m', 'trading by hand', 'chunk/trading');

    await expectAuctionsRefusedAlongsideTrading();
  });

  it("sees the branch's own commits on the combined tree, so a claim pinned to one of them holds (#435)", async () => {
    const trading = await buildOnBranch('trading', 100);
    const closed = git(trading, 'rev-parse', 'HEAD').trim();
    const pinned = [
      '1. **Trading has its own budget.**',
      '   > export const PARTITION_BYTES = 100;',
      `   Source: ../src/trading.ts@${closed.slice(0, 10)}:1`,
    ].join('\n');
    const chunk = await read(trading, 'design/chunks/trading/CHUNK.md');
    await write(trading, { 'design/chunks/trading/CHUNK.md': chunk.replace(/^1\. \*\*<!-- claim text -->\*\*\n.*\n.*\n/m, `${pinned}\n`) });
    git(trading, 'commit', '-q', '-am', 'chunk-trading/close: claim pinned to the code as the chunk left it');
    expect((await checkClaimQuotes(trading, 'trading')).refusals).toEqual([]);
    // The main line moves on, so the branch's commits are reachable only from the merge.
    await write(main, { 'README.md': 'the main line moved on\n' });
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'main line moves on');

    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.refusals).toEqual([]);
    expect(status()).toBe('');
  });
});

/**
 * #987: the combined tree runs the merged chunk's fast checks, as its gates did (#985): the test
 * files it added or changed since its base, and typecheck. The whole suite runs at publish (#984).
 */
describe("chunkMerge: the merged chunk's tests and typecheck, never the whole suite (#987)", () => {
  async function mergeRecording(runTests: TestRunner = budgetRunner, check = typeCheck) {
    const runs: string[][] = [];
    const typeChecked: string[] = [];
    const result = await chunkMerge(main, 'trading', {
      runTests: (dir, files) => {
        runs.push([...files]);
        return runTests(dir, files);
      },
      typeCheck: (dir) => {
        typeChecked.push(dir);
        return check();
      },
    });
    return { result, runs, typeChecked };
  }

  beforeEach(async () => {
    await buildOnBranch('trading', 150, { 'tests/trading-rules.test.ts': '// more of trading\n' });
    // A test the main line changed after the branch left is not the merged chunk's.
    await write(main, { 'tests/core.test.ts': '// core\n' });
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'core test');
  });

  it("runs the constraint tests, then only the test files the chunk added or changed, then typecheck once", async () => {
    const { result, runs, typeChecked } = await mergeRecording();
    expect(result.refusals).toEqual([]);
    expect(runs).toEqual([['tests/budget.test.ts'], ['tests/trading-rules.test.ts', 'tests/trading.test.ts']]);
    expect(typeChecked).toEqual([main]);
  });

  it("refuses, leaving main as it was, when the chunk's tests fail on the combined tree", async () => {
    const before = head();
    const failing: TestRunner = async (dir, files) =>
      files.includes('tests/trading.test.ts') ? { ok: false, output: 'tests/trading.test.ts: expected 2 to be 3' } : budgetRunner(dir, files);
    const { result, typeChecked } = await mergeRecording(failing);
    expect(result.refusals.join('\n')).toMatch(/trading's tests fail on the combined tree[\s\S]*expected 2 to be 3/);
    expect(typeChecked).toEqual([]);
    expect([head(), status()]).toEqual([before, '']);
  });

  it('refuses, leaving main as it was, when the combined tree does not typecheck', async () => {
    const before = head();
    const typeErrors = async (): Promise<TypeCheckRun> => ({
      result: { name: 'TypeScript', passed: false, message: '1 type error' },
      programFiles: [],
      compilerReport: ["src/trading.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'."],
    });
    const { result } = await mergeRecording(budgetRunner, typeErrors);
    expect(result.refusals.join('\n')).toMatch(/does not typecheck: 1 type error[\s\S]*TS2322/);
    expect([head(), status()]).toEqual([before, '']);
  });

  it('leaves out a test file the chunk deleted, running only the ones it added or changed', async () => {
    await write(main, { 'tests/old-quests.test.ts': '// replaced by quests\n' });
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'old quests test');
    const quests = await buildOnBranch('quests', 100);
    git(quests, 'rm', '-q', 'tests/old-quests.test.ts');
    git(quests, 'commit', '-q', '-m', 'chunk-quests/close: drop the old test');
    const runs: string[][] = [];
    const recording: TestRunner = (dir, files) => {
      runs.push([...files]);
      return budgetRunner(dir, files);
    };
    expect((await chunkMerge(main, 'quests', { runTests: recording, typeCheck })).refusals).toEqual([]);
    expect(runs).toEqual([['tests/budget.test.ts'], ['tests/quests.test.ts']]);
  });

  it("refuses, leaving main as it was, when one of the chunk's tests did not run", async () => {
    const before = head();
    const skipsOne: TestRunner = async (dir, files) => {
      const run = await budgetRunner(dir, files);
      return 'refused' in run ? run : { ...run, ran: files.filter((f) => f !== 'tests/trading.test.ts') };
    };
    const { result, typeChecked } = await mergeRecording(skipsOne);
    expect(result.refusals.join('\n')).toMatch(/trading's tests did not all run on the combined tree: tests\/trading\.test\.ts did not run/);
    expect(typeChecked).toEqual([]);
    expect([head(), status()]).toEqual([before, '']);
  });

  it('refuses a chunk with no test of its own, as its gates do, and passes an exempt one on typecheck alone', async () => {
    const quests = await buildOnBranch('quests', 100);
    git(quests, 'rm', '-q', 'tests/quests.test.ts');
    git(quests, 'commit', '-q', '-m', 'chunk-quests/close: no test');
    const runs: string[][] = [];
    const recording: TestRunner = (dir, files) => {
      runs.push([...files]);
      return budgetRunner(dir, files);
    };
    const refused = await chunkMerge(main, 'quests', { runTests: recording, typeCheck });
    expect(refused.refusals.join('\n')).toMatch(/Chunk "quests" added or changed no test file since its base[\s\S]*Then run chunk-merge again\./);

    const chunkPath = 'design/chunks/quests/CHUNK.md';
    await write(quests, {
      [chunkPath]: (await read(quests, chunkPath)).replace('<!-- | src/...test.ts | 1, 3, 4 | pending / yes | -->', '| exempt | a restyle, no rules change | n/a |'),
    });
    git(quests, 'commit', '-q', '-am', 'chunk-quests/close: exempt');
    runs.length = 0;
    expect((await chunkMerge(main, 'quests', { runTests: recording, typeCheck })).refusals).toEqual([]);
    expect(runs).toEqual([['tests/budget.test.ts']]);
  });

  it('refuses a chunk whose step before spec changed game code, saying once to run chunk-merge again (#1201)', async () => {
    const before = head();
    const quests = await buildOnBranch('quests', 100);
    await write(quests, { 'src/extra.ts': 'export const extra = 2;\n' });
    git(quests, 'add', '-A');
    git(quests, 'commit', '-q', '-m', 'chunk-quests/step-investigate');
    const refusal = (await chunkMerge(main, 'quests', { runTests: budgetRunner, typeCheck })).refusals.join('\n');
    expect(refusal).toMatch(/^Chunk "quests" changed files outside design\/ in a step before spec[\s\S]* changed src\/extra\.ts\./);
    expect(refusal).toMatch(/Then run chunk-merge again\.$/);
    expect(refusal).not.toMatch(/verify --chunk/);
    expect([head(), status()]).toEqual([before, '']);
  });
});

describe("chunkMerge: parallel-check's refusals for chunks built together (#820)", () => {
  /** Adds `entries` to the sketch on the main line, before any branch leaves it. */
  async function addToSketch(...entries: string[]): Promise<void> {
    const sketch = await read(main, 'design/SKETCH.md');
    await write(main, { 'design/SKETCH.md': sketch.replace('## Ideas Backlog', `${entries.join('\n')}## Ideas Backlog`) });
    git(main, 'commit', '-q', '-am', 'sketch entries');
  }

  /** Merges trading, then `slug` built beside it; returns the refusals of the second merge. */
  async function refusalsBesideTrading(slug: string): Promise<string> {
    await buildOnBranch('trading', 100);
    await buildOnBranch(slug, 100);
    expect((await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck })).refusals).toEqual([]);
    const before = head();
    const result = await chunkMerge(main, slug, { runTests: budgetRunner, typeCheck });
    expect(result.merged).toBe(false);
    expect(head()).toBe(before);
    expect(status()).toBe('');
    return result.refusals.join('\n');
  }

  it('refuses a chunk with no rulebook citations', async () => {
    await addToSketch(sketchEntry('bare', 'none'));
    expect(await refusalsBesideTrading('bare')).toMatch(/bare has no rulebook citations/);
  });

  it('refuses a citation that names no rulebook slice', async () => {
    await addToSketch(sketchEntry('ghost', 'rulebook/09-missing.md'));
    expect(await refusalsBesideTrading('ghost')).toMatch(/ghost cites rulebook\/09-missing\.md, which names no single file/);
  });

  it('refuses the final-acceptance chunk built beside another', async () => {
    await addToSketch(sketchEntry('finale', 'rulebook/07-quests.md', 'final-acceptance'));
    expect(await refusalsBesideTrading('finale')).toMatch(/finale is the final-acceptance chunk.*always built on its own/);
  });

  it('refuses a chunk built alongside that has no sketch entry', async () => {
    await buildOnBranch('trading', 100);
    await buildOnBranch('quests', 100);
    expect((await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck })).refusals).toEqual([]);
    // The main line drops trading's sketch entry after merging it, so quests' merge cannot read it.
    const sketch = await read(main, 'design/SKETCH.md');
    await write(main, { 'design/SKETCH.md': sketch.replace(/### trading\n[\s\S]*?\n\n/, '') });
    git(main, 'commit', '-q', '-am', 'drop trading from the sketch');
    const before = head();
    const result = await chunkMerge(main, 'quests', { runTests: budgetRunner, typeCheck });
    expect(result.refusals.join('\n')).toMatch(/There is no chunk "trading" in SKETCH\.md/);
    expect(head()).toBe(before);
  });
});

describe('chunkMerge: ledger numbers are allocated at merge, never on a branch', () => {
  it('turns each branch\'s provisional rulings into distinct real numbers and rewrites their citations', async () => {
    await buildOnBranch('trading', 100, {
      'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: the core loop.\n\n### Ruling @trading.1\n- Decision: prices are public.\n',
      'src/trading-rules.ts': '// Ruling @trading.1: prices are public.\nexport const PUBLIC_PRICES = true;\n',
    });
    await buildOnBranch('quests', 100, {
      'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: the core loop.\n\n### Ruling @quests.1\n- Decision: quests expire.\n',
      'src/quest-rules.ts': '// Ruling @quests.1: quests expire.\nexport const QUESTS_EXPIRE = true;\n',
    });

    const first = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(first.allocated).toEqual({ 'Ruling @trading.1': 'Ruling 2' });
    const second = await chunkMerge(main, 'quests', { runTests: budgetRunner, typeCheck });
    expect(second.refusals).toEqual([]);
    expect(second.allocated).toEqual({ 'Ruling @quests.1': 'Ruling 3' });

    const rulings = await read(main, 'design/RULINGS.md');
    expect(rulings.match(/^### Ruling \d+$/gm)).toEqual(['### Ruling 1', '### Ruling 2', '### Ruling 3']);
    expect(await read(main, 'src/quest-rules.ts')).toContain('// Ruling 3: quests expire.');
    expect(rulings).not.toContain('@');
  });

  it('merges a filing whose reproduction quotes example ids, written into the shipped FILINGS template (#437)', async () => {
    const template = skillMarkdown('bs/templates/FILINGS.template.md');
    const filing = [
      '### Filing @trading.1',
      '- Kind: bug',
      '- What happened: a FILINGS.md with `### Filing 1`, then `### Filing @x.1` holding',
      '  `- Reported: recorded`; ledger-check reads the second as part of the first.',
      '- Reported: recorded',
      '- Issue: n/a — not posted',
      '',
    ].join('\n');
    await buildOnBranch('trading', 100, { 'design/FILINGS.md': `${template.trimEnd()}\n\n${filing}` });

    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.refusals).toEqual([]);
    expect(result.allocated).toEqual({ 'Filing @trading.1': 'Filing 1' });
    const filings = await read(main, 'design/FILINGS.md');
    expect(filings).toContain('### Filing 1\n');
    expect(filings).toContain('then `### Filing @x.1` holding');
  });

  it('rewrites a provisional id cited in list form, "Rulings 1 and @trading.1" (#439)', async () => {
    await buildOnBranch('trading', 100, {
      'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: the core loop.\n\n### Ruling @trading.1\n- Decision: prices are public.\n',
      'design/notes.md': 'Prices follow Rulings 1 and @trading.1.\n',
    });
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.refusals).toEqual([]);
    expect(result.allocated).toEqual({ 'Ruling @trading.1': 'Ruling 2' });
    expect(await read(main, 'design/notes.md')).toBe('Prices follow Rulings 1 and 2.\n');
  });

  it('rewrites shorthand ids after a provisional id, "Rulings @trading.1 to .3" and "@trading.1, .2" (#446)', async () => {
    const rulings = ['1', '2', '3'].map((n) => `### Ruling @trading.${n}\n- Decision: ${n}.\n`).join('\n');
    await buildOnBranch('trading', 100, {
      'design/RULINGS.md': `# Rulings\n\n### Ruling 1\n- Decision: the core loop.\n\n${rulings}`,
      'src/trading-rules.ts': '// Rulings @trading.1 to .3 apply here.\n// Rulings 1 and @trading.1, .2\nexport const X = 1;\n',
    });
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.refusals).toEqual([]);
    expect(await read(main, 'src/trading-rules.ts')).toBe(
      '// Rulings 2 to 4 apply here.\n// Rulings 1 and 2, 3\nexport const X = 1;\n',
    );
  });

  it('refuses a range whose ids would not stay one unbroken run, naming the file, and leaves main as it was (#446)', async () => {
    // Headed out of order, so @trading.1 to .3 would become 2 to 3 and drop @trading.2 (4).
    const rulings = ['1', '3', '2'].map((n) => `### Ruling @trading.${n}\n- Decision: ${n}.\n`).join('\n');
    await buildOnBranch('trading', 100, {
      'design/RULINGS.md': `# Rulings\n\n### Ruling 1\n- Decision: the core loop.\n\n${rulings}`,
      'design/notes.md': 'Prices follow Rulings @trading.1 to .3.\n',
    });
    const before = head();
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.merged).toBe(false);
    expect(result.refusals).toEqual([
      'design/notes.md cites the range "Rulings @trading.1 to .3", but those ids became Rulings 2, 4 and 3, ' +
        'which are not one unbroken run of numbers. Write each id out as a list on the branch (for example ' +
        '"Rulings @trading.1, @trading.2 and @trading.3"), and merge again.',
    ]);
    expect(head()).toBe(before);
    expect(status()).toBe('');
  });

  it('refuses shorthand it cannot map, "@trading.1-3", naming the file (#446)', async () => {
    await buildOnBranch('trading', 100, {
      'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: the core loop.\n\n### Ruling @trading.1\n- Decision: prices are public.\n',
      'design/notes.md': 'Prices follow Rulings @trading.1-3.\n',
    });
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.merged).toBe(false);
    expect(result.refusals).toEqual([expect.stringMatching(/^design\/notes\.md writes "@trading\.1-3", which reads as a range of ids/)]);
    expect(status()).toBe('');
  });

  it('refuses a dash then a plain number on the next line, in a CRLF file, and leaves main as it was (#1394)', async () => {
    await buildOnBranch('trading', 100, {
      'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: the core loop.\n\n### Ruling @trading.1\n- Decision: prices are public.\n',
      'design/notes.md': 'Prices follow Rulings @trading.1 -\r\n3.\r\n',
    });
    const before = head();
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.merged).toBe(false);
    expect(result.refusals).toEqual([
      expect.stringMatching(/^design\/notes\.md writes "@trading\.1 - 3", which reads as a range of ids, .*`Rulings @trading\.1 and @trading\.3`/),
    ]);
    expect(head()).toBe(before);
    expect(status()).toBe('');
  });

  it('says how to reword prose that only reads as a range, and how to write a shortened id in full (#446)', async () => {
    await buildOnBranch('trading', 100, {
      'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: the core loop.\n\n### Ruling @trading.1\n- Decision: prices are public.\n',
      'design/notes.md': 'Ruling @trading.1 - 2 players only.\n\nSee Decision .2 too.\n',
    });
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.merged).toBe(false);
    expect(result.refusals).toEqual([
      'design/notes.md writes "@trading.1 - 2", which reads as a range of ids, so the merge cannot tell whether 2 is ' +
        '@trading.2 or real number 2. If it is a range, write each id in full on the branch (for example ' +
        '`Rulings @trading.1 and @trading.2`); if 2 is not an id, put something other than a dash between them ' +
        '(for example "@trading.1: 2"). Then merge again.',
      expect.stringMatching(/^design\/notes\.md writes "Decision \.2", a shortened id straight after a kind word\./),
    ]);
    expect(status()).toBe('');
  });

  it('says a kind word must be followed by an id in full, even when a provisional id comes before it (#1386)', async () => {
    await buildOnBranch('trading', 100, {
      'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: the core loop.\n\n### Ruling @trading.1\n- Decision: prices are public.\n',
      'design/notes.md': 'Prices follow Rulings @trading.1 and Decision .2.\n',
    });
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.merged).toBe(false);
    expect(result.refusals).toEqual([
      'design/notes.md writes "Decision .2", a shortened id straight after a kind word. A kind word must be followed ' +
        'by an id in full: a shortened id is read only after a provisional id in a list (as in "@<slug>.1, .2"), so ' +
        'the merge cannot give this one a real number. Write the id in full on the branch (for example ' +
        '`Decision @<slug>.2`), and merge again.',
    ]);
    expect(status()).toBe('');
  });

  it('refuses a shortened id on the line after its kind word for the kind written, not the id before it (#1389)', async () => {
    await buildOnBranch('trading', 100, {
      'design/RULINGS.md':
        '# Rulings\n\n### Ruling 1\n- Decision: the core loop.\n\n### Ruling @trading.1\n- Decision: prices are public.\n\n' +
        '### Ruling @trading.2\n- Decision: prices move.\n',
      'design/notes.md': 'Prices follow Rulings @trading.1 and Decision\n.2.\n',
    });
    const before = head();
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.merged).toBe(false);
    expect(result.refusals).toEqual([
      expect.stringMatching(/^design\/notes\.md writes "Decision \.2", a shortened id straight after a kind word\..*`Decision @<slug>\.2`/),
    ]);
    expect(head()).toBe(before);
    expect(status()).toBe('');
  });

  it('refuses a shortened id on the line after its kind word in a CRLF file with no provisional id before it (#1389)', async () => {
    await buildOnBranch('trading', 100, {
      'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: the core loop.\n\n### Ruling @trading.1\n- Decision: prices are public.\n',
      'design/notes.md': 'Prices follow Ruling @trading.1.\r\n\r\nSee Decision\r\n.2 too.\r\n',
    });
    const before = head();
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.merged).toBe(false);
    expect(result.refusals).toEqual([expect.stringMatching(/^design\/notes\.md writes "Decision \.2", a shortened id straight after a kind word\./)]);
    expect(head()).toBe(before);
    expect(status()).toBe('');
  });

  it('does not refuse a "Decision .2" already on main, in a ledger the branch left alone or added to (#1395)', async () => {
    await write(main, { 'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: the core loop. See Decision .2.\n' });
    git(main, 'commit', '-q', '-am', 'shorthand on main');
    await buildOnBranch('trading', 100);
    await buildOnBranch('quests', 100, {
      'design/RULINGS.md':
        '# Rulings\n\n### Ruling 1\n- Decision: the core loop. See Decision .2.\n\n### Ruling @quests.1\n- Decision: quests expire.\n',
    });
    expect((await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck })).refusals).toEqual([]);
    expect((await chunkMerge(main, 'quests', { runTests: budgetRunner, typeCheck })).refusals).toEqual([]);
  });

  it('refuses a second "Decision .2" the branch wrote beside the one already on main (#1395)', async () => {
    await write(main, { 'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: the core loop. See Decision .2.\n' });
    git(main, 'commit', '-q', '-am', 'shorthand on main');
    await buildOnBranch('trading', 100, {
      'design/RULINGS.md':
        '# Rulings\n\n### Ruling 1\n- Decision: the core loop. See Decision .2.\n\n### Ruling @trading.1\n- Decision: as Decision .2.\n',
    });
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.refusals).toEqual([expect.stringMatching(/^design\/RULINGS\.md writes "Decision \.2", a shortened id straight after a kind word\./)]);
  });

  it('refuses a "Decision .2" the branch moved to a line it wrote, though main had one elsewhere in the file (#1399)', async () => {
    await write(main, { 'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: the core loop. See Decision .2.\n' });
    git(main, 'commit', '-q', '-am', 'shorthand on main');
    await buildOnBranch('trading', 100, {
      'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: the core loop.\n\n### Ruling @trading.1\n- Decision: as Decision .2.\n',
    });
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.refusals).toEqual([expect.stringMatching(/^design\/RULINGS\.md writes "Decision \.2", a shortened id straight after a kind word\./)]);
  });

  it('refuses in a file the branch renamed only the "Decision .3" it wrote, not the "Decision .2" main had (#1399)', async () => {
    const notes = '# Notes\n\nThe market opens at dawn.\nPrices rise with demand.\nSee Decision .2.\nTraders leave at dusk.\n';
    await write(main, { 'design/a.md': notes });
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'shorthand on main');
    const trading = await buildOnBranch('trading', 100);
    git(trading, 'mv', 'design/a.md', 'design/b.md');
    await write(trading, { 'design/b.md': `${notes}Also Decision .3.\n` });
    git(trading, 'commit', '-q', '-am', 'chunk-trading/close: rename the notes');
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.refusals).toEqual([expect.stringMatching(/^design\/b\.md writes "Decision \.3", a shortened id straight after a kind word\./)]);
  });

  it('refuses a "Decision .2" the branch made only by deleting the blank line between its words (#1399 review F1)', async () => {
    await write(main, { 'design/a.md': '# Notes\n\nSee Decision\n\n.2 of the deck.\n' });
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'no shorthand on main');
    await buildOnBranch('trading', 100, { 'design/a.md': '# Notes\n\nSee Decision\n.2 of the deck.\n' });
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.refusals).toEqual([expect.stringMatching(/^design\/a\.md writes "Decision \.2", a shortened id straight after a kind word\./)]);
  });

  it('refuses a shortened id straight after a constraint letter, and leaves main as it was (#1390)', async () => {
    const constraints = await fs.readFile(join(main, 'design/CONSTRAINTS.md'), 'utf-8');
    await buildOnBranch('trading', 100, {
      'design/CONSTRAINTS.md':
        `${constraints}\n### G@trading.1\n- State: Market.prices\n- Grows with: turns\n- Chunk: trading\n- Ruling: Ruling 1\n` +
        '\n### G@trading.2\n- State: Market.offers\n- Grows with: turns\n- Chunk: trading\n- Ruling: Ruling 1\n',
      'design/notes.md': 'Prices follow G@trading.1 and G.2.\n',
    });
    const before = head();
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.merged).toBe(false);
    expect(result.refusals).toEqual([
      'design/notes.md writes "G.2" after G@trading.1, but a shortened id is never read after a constraint letter, so ' +
        'the merge cannot read it as G@trading.2 and would leave it naming nothing. Write the id in full on the branch ' +
        '(for example "G@trading.2"), and merge again.',
    ]);
    expect(head()).toBe(before);
    expect(status()).toBe('');
  });

  it('refuses a shortened id a parenthetical separates from its provisional id, and leaves main as it was (#1363)', async () => {
    await buildOnBranch('trading', 100, {
      'design/QUESTIONS.md': '# Questions\n\n### Question @trading.9\n- a\n\n### Question @trading.10\n- b\n',
      'design/notes.md': 'Questions @trading.9 (owner-only data, issue #92) and .10 (round-3 triage).\n',
    });
    const before = head();
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.merged).toBe(false);
    expect(result.refusals).toEqual([
      'design/notes.md writes ".10" after Question @trading.9, but not in a list with it, so the merge cannot read it ' +
        'as Question @trading.10 and would leave it naming nothing. Write the id in full on the branch (for example ' +
        '"Question @trading.10"), and merge again.',
    ]);
    expect(head()).toBe(before);
    expect(status()).toBe('');
  });

  it('refuses a provisional id written with no kind before it, naming the file and the form to write (#439)', async () => {
    await buildOnBranch('trading', 100, {
      'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: the core loop.\n\n### Ruling @trading.1\n- Decision: prices are public.\n',
      'design/notes.md': 'Prices follow @trading.1.\n',
    });
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.merged).toBe(false);
    expect(result.refusals.join('\n')).toContain(
      'design/notes.md cites @trading.1 without saying what kind of entry it is. Write the kind in front of it ' +
        '(for example `Ruling @trading.1`, or in a list, `Rulings 8 and @trading.1`) on the branch',
    );
  });

  it('refuses a backticked id nobody declared inside an HTML block, saying backticks there are not a code span (#1410)', async () => {
    await buildOnBranch('trading', 100, {
      'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: the core loop.\n\n### Ruling @trading.1\n- Decision: prices are public.\n',
      'design/notes.md': '<details>\n`Ruling @trading.2` is the form\n</details>\n',
    });
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.merged).toBe(false);
    expect(result.refusals).toEqual([
      'design/notes.md cites Ruling @trading.2, but no ledger entry is headed Ruling @trading.2. Correct the citation on the ' +
        'branch, or, if it is an example rather than a citation, put it in a code span. Inside an HTML block such as ' +
        '<details>, backticks and <code> are plain text: there, put the example in an HTML comment, or on a line of its ' +
        'own after a blank line, where Markdown is read again (not inside <pre>, <script>, <style> or <textarea>, which ' +
        'end only at their closing tag).',
    ]);
  });

  it('refuses a branch that took a real number itself, which is how two branches collide', async () => {
    await buildOnBranch('trading', 100, {
      'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: the core loop.\n\n### Ruling 2\n- Decision: prices are public.\n',
    });
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.merged).toBe(false);
    expect(result.refusals.join('\n')).toMatch(/Ruling 2.*Ruling @trading\.1/);
  });

  it('refuses a branch that writes RUN.md or another chunk\'s run log', async () => {
    await buildOnBranch('trading', 100, { 'design/RUN.md': '# Run\n\nRun Status: active\n' });
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.refusals.join('\n')).toMatch(/design\/RUN\.md/);
  });
});

