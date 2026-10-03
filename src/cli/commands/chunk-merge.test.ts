import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { takeOsLock } from '../lib/os-lock.js';
import { chunkMerge, resolveDesignConflicts } from './chunk-merge.js';
import { assessSignoffs, recordReopen, recordSignoff } from './chunk-signoff.js';
import { recordPassingVerify } from '../lib/verify-result.test-helper.js';
import { recordVerifiedAgainst } from './chunk-provenance.js';
import { checkClaimQuotes } from './claim-quotes.js';
import { checkConstraints, type TestRunner } from './constraint-check.js';

/**
 * #294: `boardsmith chunk-merge` is the one way a chunk built on its own branch reaches the main
 * line. It merges serially, allocates ledger numbers on the combined tree, re-runs the tree-wide
 * checks there, and refuses (leaving the main line as it was) when the combined tree fails a
 * check each branch passed alone: the sotf failure, where each chunk measured only its own growth
 * in a shared partition and nobody measured the total (Shufflewick/sotf#24, #25).
 */

/**
 * These tests merge real branches, so each one runs real git processes: at most about 80 (building
 * the repository and up to three chunk branches, then about 18 per merge). The count is fixed per
 * test, and the time is almost all process start-up, which a loaded machine stretches: the heaviest
 * test takes about 2 seconds at a load average of 140 (#310). The timeout covers that load, not
 * unbounded work. If a test here nears it, count the git calls the merge makes before raising it.
 */
vi.setConfig({ testTimeout: 30_000 });

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf-8' });

async function write(dir: string, files: Record<string, string>): Promise<void> {
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(dirname(join(dir, rel)), { recursive: true });
    await fs.writeFile(join(dir, rel), text);
  }
}

const read = (dir: string, rel: string) => fs.readFile(join(dir, rel), 'utf-8');

/**
 * The measurement test the constraint names, run as code: the world partition is the sum of every
 * `PARTITION_BYTES` a chunk adds under src/, and the budget is 512.
 */
const budgetRunner: TestRunner = async (projectDir, files) => {
  const src = join(projectDir, 'src');
  let total = 0;
  for (const name of await fs.readdir(src)) {
    const m = /PARTITION_BYTES = (\d+)/.exec(await read(src, name));
    if (m) total += Number(m[1]);
  }
  return total <= 512
    ? { ok: true, output: `partition ${total} bytes`, ran: [...files] }
    : { ok: false, output: `world partition is ${total} bytes, over the 512 byte budget` };
};

function sketchEntry(slug: string, citations: string, milestone = 'none'): string {
  return [
    `### ${slug}`,
    `- What it builds: ${slug}`,
    `- Citations: ${citations}`,
    `- Depends on: core-loop`,
    `- ui: none`,
    `- Milestone: ${milestone}`,
    `- Status (derived from chunks/${slug}/CHUNK.md): approved`,
    '',
  ].join('\n');
}

const CLAUDE_MD = '# Game\n\n## Hard constraints\n\n- The world partition stays under 512 bytes.\n';
const CONSTRAINTS_MD = [
  '# Constraints',
  '',
  '## Hard Constraints',
  '',
  '### C1',
  '- Quote: The world partition stays under 512 bytes.',
  '- Source: CLAUDE.md',
  '- Kind: measured',
  '- Test: tests/budget.test.ts',
  '',
  '## Growing Structures',
  '',
].join('\n');

async function chunkMd(slug: string): Promise<string> {
  const template = await fs.readFile(
    new URL('../slash-command/bs/templates/CHUNK.template.md', import.meta.url),
    'utf-8',
  );
  return template
    .replace(/^Status: proposed$/m, 'Status: built')
    .replace('<!-- | src/... | written / pending | -->', `| src/${slug}.ts | written |`)
    .replace(/(## Constraints Review\n(?:<!--[\s\S]*?-->\n)?)/, '$1- C1: held. tests/budget.test.ts\n');
}

let main: string;

async function setUp(): Promise<void> {
  const tree = tempTree('bs-chunk-merge-');
  main = join(tree, 'game');
  await write(main, {
    'CLAUDE.md': CLAUDE_MD,
    'tests/budget.test.ts': '// measures the world partition\n',
    'src/core.ts': 'export const PARTITION_BYTES = 100;\n',
    'design/CONSTRAINTS.md': CONSTRAINTS_MD,
    'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: the core loop.\n',
    'design/rulebook/04-trading.md': '# Trading\n',
    'design/rulebook/05-market.md': '# Market\n',
    'design/rulebook/07-quests.md': '# Quests\n',
    'design/SKETCH.md': [
      '# Sketch',
      '',
      'Session Lock: "trading,quests @ run-1 — locked at 2026-09-01T00:00:00Z"',
      '',
      '## Ordered Chunk List',
      '',
      '### core-loop',
      '- Depends on: none',
      '- Milestone: core-loop',
      '- Status: proposed (sketch-level — no CHUNK.md yet)',
      '',
      sketchEntry('trading', 'rulebook/04-trading.md'),
      sketchEntry('quests', 'rulebook/07-quests.md'),
      sketchEntry('auctions', 'rulebook/04-trading.md, rulebook/05-market.md'),
      '## Ideas Backlog',
      '',
      '- none yet',
      '',
    ].join('\n'),
  });
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'base');
}

/**
 * Builds `slug` on its own branch in its own worktree, the way a parallel dispatch does: its code,
 * its CHUNK.md, a signed-off verified status, its own run log, and whatever else `extra` adds.
 * Returns the worktree.
 */
async function buildOnBranch(slug: string, bytes: number, extra: Record<string, string> = {}): Promise<string> {
  const worktree = join(dirname(main), `wt-${slug}`);
  git(main, 'worktree', 'add', '-q', '-b', `chunk/${slug}`, worktree);
  await write(worktree, {
    [`src/${slug}.ts`]: `export const PARTITION_BYTES = ${bytes};\n`,
    [`design/chunks/${slug}/CHUNK.md`]: await chunkMd(slug),
    [`design/run-log/${slug}.md`]: [
      `# Run Log: ${slug}`,
      '',
      '### Dispatch 1',
      '- Work: build-chunk',
      '- Role: judgement',
      '- Agent: bs-judgement',
      '- Dispatched at: 2026-09-01T00:00:00Z',
      '- Finished at: 2026-09-01T01:00:00Z',
      '- Outcome: closed',
      '- Detail: n/a',
      '',
    ].join('\n'),
    ...extra,
  });
  // A sign-off needs the chunk's work committed and verified (#452).
  await recordPassingVerify(worktree, { chunk: slug, message: `chunk-${slug}/build` });
  await recordSignoff(slug, { project: worktree, automated: 'tests/budget.test.ts passed', now: new Date('2026-09-01T02:00:00Z') });
  // Close releases the lock on the branch; the run on the main line still holds it.
  const sketch = await read(worktree, 'design/SKETCH.md');
  await write(worktree, {
    'design/SKETCH.md': sketch
      .replace(/^Session Lock:.*$/m, 'Session Lock: none')
      .replace('- none yet', `- none yet\n- an idea from ${slug}`),
  });
  git(worktree, 'add', '-A');
  git(worktree, 'commit', '-q', '-m', `chunk-${slug}/close`);
  return worktree;
}

const head = () => git(main, 'rev-parse', 'HEAD').trim();
const status = () => git(main, 'status', '--porcelain', '--untracked-files=no');

beforeEach(async () => {
  await setUp();
});

describe('chunkMerge: the combined tree is checked, not the branch alone', () => {
  it('merges two independent chunks one at a time, keeping the main line\'s session lock', async () => {
    await buildOnBranch('trading', 150);
    await buildOnBranch('quests', 150);

    const first = await chunkMerge(main, 'trading', { runTests: budgetRunner });
    expect(first.refusals).toEqual([]);
    const second = await chunkMerge(main, 'quests', { runTests: budgetRunner });
    expect(second.refusals).toEqual([]);
    expect(second.alongside).toEqual(['trading']);

    const sketch = await read(main, 'design/SKETCH.md');
    expect(sketch).toMatch(/^Session Lock: "trading,quests @ run-1/m);
    expect(sketch).toContain('- an idea from trading');
    expect(sketch).toContain('- an idea from quests');
    expect(status()).toBe('');
  });

  it('refuses a merge whose combined tree breaks a constraint each branch passed alone, and leaves main as it was', async () => {
    const trading = await buildOnBranch('trading', 300);
    const quests = await buildOnBranch('quests', 300);
    // Each branch alone holds the 512 byte budget: 100 + 300.
    expect((await checkConstraints(trading, { runTests: budgetRunner })).refusals).toEqual([]);
    expect((await checkConstraints(quests, { runTests: budgetRunner })).refusals).toEqual([]);

    expect((await chunkMerge(main, 'trading', { runTests: budgetRunner })).refusals).toEqual([]);
    const before = head();
    const result = await chunkMerge(main, 'quests', { runTests: budgetRunner });

    expect(result.merged).toBe(false);
    expect(result.refusals.join('\n')).toMatch(/over the 512 byte budget/);
    expect(head()).toBe(before);
    expect(status()).toBe('');
  });

  it('refuses chunks built together that the sketch says may not be: overlapping citations', async () => {
    await buildOnBranch('trading', 100);
    await buildOnBranch('auctions', 100);
    expect((await chunkMerge(main, 'trading', { runTests: budgetRunner })).refusals).toEqual([]);
    const result = await chunkMerge(main, 'auctions', { runTests: budgetRunner });
    expect(result.refusals.join('\n')).toMatch(/both cite rulebook\/04-trading\.md/);
    expect(status()).toBe('');
  });

  /** Trading is merged and verified on the main line; then auctions, which cites trading's page, leaves it. */
  async function tradingVerifiedBeforeAuctionsLeft(): Promise<void> {
    await buildOnBranch('trading', 100);
    expect((await chunkMerge(main, 'trading', { runTests: budgetRunner })).refusals).toEqual([]);
    await buildOnBranch('auctions', 100);
  }

  /** Auctions' merge is refused under the pair rule, as built alongside trading, and main is left as it was. */
  async function expectAuctionsRefusedAlongsideTrading(): Promise<void> {
    const result = await chunkMerge(main, 'auctions', { runTests: budgetRunner });
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

    const result = await chunkMerge(main, 'auctions', { runTests: budgetRunner });
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

    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner });
    expect(result.refusals).toEqual([]);
    expect(status()).toBe('');
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

    const first = await chunkMerge(main, 'trading', { runTests: budgetRunner });
    expect(first.allocated).toEqual({ 'Ruling @trading.1': 'Ruling 2' });
    const second = await chunkMerge(main, 'quests', { runTests: budgetRunner });
    expect(second.refusals).toEqual([]);
    expect(second.allocated).toEqual({ 'Ruling @quests.1': 'Ruling 3' });

    const rulings = await read(main, 'design/RULINGS.md');
    expect(rulings.match(/^### Ruling \d+$/gm)).toEqual(['### Ruling 1', '### Ruling 2', '### Ruling 3']);
    expect(await read(main, 'src/quest-rules.ts')).toContain('// Ruling 3: quests expire.');
    expect(rulings).not.toContain('@');
  });

  it('merges a filing whose reproduction quotes example ids, written into the shipped FILINGS template (#437)', async () => {
    const template = await fs.readFile(
      new URL('../slash-command/bs/templates/FILINGS.template.md', import.meta.url),
      'utf-8',
    );
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

    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner });
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
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner });
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
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner });
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
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner });
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
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner });
    expect(result.merged).toBe(false);
    expect(result.refusals).toEqual([expect.stringMatching(/^design\/notes\.md writes "@trading\.1-3", which reads as a range of ids/)]);
    expect(status()).toBe('');
  });

  it('says how to reword prose that only reads as a range, and how to write a shortened id in full (#446)', async () => {
    await buildOnBranch('trading', 100, {
      'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: the core loop.\n\n### Ruling @trading.1\n- Decision: prices are public.\n',
      'design/notes.md': 'Ruling @trading.1 - 2 players only.\n\nSee Decision .2 too.\n',
    });
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner });
    expect(result.merged).toBe(false);
    expect(result.refusals).toEqual([
      'design/notes.md writes "@trading.1 - 2", which reads as a range of ids, so the merge cannot tell whether 2 is ' +
        '@trading.2 or real number 2. If it is a range, write each id in full on the branch (for example ' +
        '`Rulings @trading.1 and @trading.2`); if 2 is not an id, put something other than a dash between them ' +
        '(for example "@trading.1: 2"). Then merge again.',
      'design/notes.md writes "Decision .2", a shortened id with no provisional id before it to take its slug from, ' +
        'so the merge cannot give it a real number. Write the id in full on the branch (for example ' +
        '`Decision @<slug>.2`), and merge again.',
    ]);
    expect(status()).toBe('');
  });

  it('refuses a provisional id written with no kind before it, naming the file and the form to write (#439)', async () => {
    await buildOnBranch('trading', 100, {
      'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: the core loop.\n\n### Ruling @trading.1\n- Decision: prices are public.\n',
      'design/notes.md': 'Prices follow @trading.1.\n',
    });
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner });
    expect(result.merged).toBe(false);
    expect(result.refusals.join('\n')).toContain(
      'design/notes.md cites @trading.1 without saying what kind of entry it is. Write the kind in front of it ' +
        '(for example `Ruling @trading.1`, or in a list, `Rulings 8 and @trading.1`) on the branch',
    );
  });

  it('refuses a branch that took a real number itself, which is how two branches collide', async () => {
    await buildOnBranch('trading', 100, {
      'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: the core loop.\n\n### Ruling 2\n- Decision: prices are public.\n',
    });
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner });
    expect(result.merged).toBe(false);
    expect(result.refusals.join('\n')).toMatch(/Ruling 2.*Ruling @trading\.1/);
  });

  it('refuses a branch that writes RUN.md or another chunk\'s run log', async () => {
    await buildOnBranch('trading', 100, { 'design/RUN.md': '# Run\n\nRun Status: active\n' });
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner });
    expect(result.refusals.join('\n')).toMatch(/design\/RUN\.md/);
  });
});

describe('chunkMerge: references between chunks built together go to the audit', () => {
  it('records what the two chunks both touch as pending review, and the next merge waits for the ruling', async () => {
    const venues = (first: string, last = '') =>
      `export const VENUES = [${first}];\n// one\n// two\n// three\nexport const LAST = 1;\n${last}`;
    await write(main, { 'src/venues.ts': venues("'market'") });
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'venues');
    // Trading changes the venue list; quests, on its own branch, starts using one of them.
    await buildOnBranch('trading', 100, { 'src/venues.ts': venues("'market', 'harbor'") });
    await buildOnBranch('quests', 100, {
      'src/venues.ts': venues("'market'", "export const QUEST_VENUE = 'market';\n"),
    });
    await buildOnBranch('auctions', 100);

    expect((await chunkMerge(main, 'trading', { runTests: budgetRunner })).refusals).toEqual([]);
    const second = await chunkMerge(main, 'quests', { runTests: budgetRunner });
    expect(second.refusals).toEqual([]);
    expect(second.crossChunk).toBe('pending');

    const ledger = await read(main, 'design/CROSS-CHUNK.md');
    expect(ledger).toMatch(/^### Merge 1$/m);
    expect(ledger).toContain('- Chunk: quests');
    expect(ledger).toContain('- Built alongside: trading');
    expect(ledger).toContain('`market`');
    expect(ledger).toMatch(/^- Verdict: pending$/m);

    const third = await chunkMerge(main, 'auctions', { runTests: budgetRunner });
    expect(third.merged).toBe(false);
    expect(third.refusals.join('\n')).toMatch(/CROSS-CHUNK\.md, Merge 1/);
  });
});

describe('chunkMerge: preconditions', () => {
  it('refuses while another chunk-merge holds the lock, naming it, and merges once it is released (#441)', async () => {
    await buildOnBranch('trading', 100);
    const common = git(main, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim();
    const other = await takeOsLock(join(common, 'boardsmith-chunk-merge.flock'), 'chunk-merge of quests (branch chunk/quests)');
    if (typeof other === 'string') throw new Error(other);

    const refused = await chunkMerge(main, 'trading', { runTests: budgetRunner });
    // A merge in flight leaves the main checkout dirty; a second run is told about the merge, not
    // asked to clean up the files that merge is working on.
    const sketch = await read(main, 'design/SKETCH.md');
    await fs.writeFile(join(main, 'design/SKETCH.md'), `${sketch}\nmid-merge\n`);
    const whileDirty = await chunkMerge(main, 'trading', { runTests: budgetRunner });
    await fs.writeFile(join(main, 'design/SKETCH.md'), sketch);
    await other.release();
    expect(refused.merged).toBe(false);
    expect(refused.refusals.join('\n')).toContain(
      `Another chunk-merge holds the merge lock: chunk-merge of quests (branch chunk/quests), pid ${process.pid}`,
    );
    expect(whileDirty.refusals).toEqual(refused.refusals);
    expect(git(main, 'status', '--porcelain')).toBe('');

    expect((await chunkMerge(main, 'trading', { runTests: budgetRunner })).refusals).toEqual([]);
    expect(existsSync(join(common, 'boardsmith-chunk-merge.flock.holder'))).toBe(false);
  });

  it('names a merge a killed chunk-merge left half done, and how to undo it (#441)', async () => {
    await buildOnBranch('trading', 100);
    git(main, 'merge', '--no-ff', '--no-commit', 'chunk/trading');
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner });
    expect(result.refusals).toEqual([
      'The main checkout holds a merge that was started and never finished, most likely by a chunk-merge ' +
        'that was stopped partway. Undo it with `git merge --abort` in the main checkout, then run chunk-merge again.',
    ]);
  });

  it('refuses a dirty main checkout, a missing branch, and a chunk that is not verified', async () => {
    expect((await chunkMerge(main, 'trading', { runTests: budgetRunner })).refusals.join('\n')).toMatch(/no branch chunk\/trading/);

    await buildOnBranch('trading', 100);
    await fs.appendFile(join(main, 'src/core.ts'), '// edit\n');
    expect((await chunkMerge(main, 'trading', { runTests: budgetRunner })).refusals.join('\n')).toMatch(/uncommitted changes/);
    git(main, 'checkout', '--', 'src/core.ts');

    const worktree = join(dirname(main), 'wt-quests');
    git(main, 'worktree', 'add', '-q', '-b', 'chunk/quests', worktree);
    await write(worktree, { 'src/quests.ts': 'export const PARTITION_BYTES = 1;\n', 'design/chunks/quests/CHUNK.md': await chunkMd('quests') });
    git(worktree, 'add', '-A');
    git(worktree, 'commit', '-q', '-m', 'wip');
    expect((await chunkMerge(main, 'quests', { runTests: budgetRunner })).refusals.join('\n')).toMatch(/quests is "built", not verified/);
    expect(status()).toBe('');
  });

  it('refuses, before any test runs, a project whose vitest config would collect the chunk worktrees (#298)', async () => {
    await buildOnBranch('trading', 100);
    const before = head();
    const { refusals } = await chunkMerge(main, 'trading');
    expect(refusals).toEqual([expect.stringMatching(/has no vitest config[\s\S]*boardsmith doctor --fix/)]);
    expect([head(), status()]).toEqual([before, '']);
  });
});

describe('chunkMerge: a source file two chunks built together both edited (#403)', () => {
  /** One rules module both chunks add to, each in its own part. */
  const world = (trading: number, quests: number) =>
    `// world\n// a\n// b\n// c\nexport const TRADING = ${trading};\n// one\n// two\n// three\nexport const QUESTS = ${quests};\n`;

  /**
   * Each chunk's own test, run as code: quests' test assumes trading's constant is still 0, so it
   * passes on quests' branch and fails once trading's edit is in the combined file.
   */
  const ownTestsRunner: TestRunner = async (projectDir, files) => {
    for (const file of files) {
      const source = await read(projectDir, file);
      if (source.includes('assumes TRADING = 0') && (await read(projectDir, 'src/world.ts')).includes('TRADING = 1')) {
        return { ok: false, output: `${file}: expected TRADING to be 0` };
      }
    }
    return budgetRunner(projectDir, files);
  };

  /** A chunk whose Build Manifest names src/world.ts, with a quoted claim and its own test. */
  async function sharedChunkMd(slug: string, claim: string): Promise<string> {
    return (await chunkMd(slug))
      .replace(`| src/${slug}.ts | written |`, `| src/${slug}.ts | written |\n| src/world.ts | written |`)
      .replace(/^1\. \*\*<!-- claim text -->\*\*\n.*\n.*\n/m, `${claim}\n`)
      .replace('<!-- | src/...test.ts | 1, 3, 4 | pending / yes | -->', `| tests/${slug}.test.ts | 1 | yes |`);
  }

  const TRADING_CLAIM = [
    '1. **Every trade is public.**',
    '   > Every trade is public.',
    '   Source: rulebook/04-trading.md §"Trading"',
  ].join('\n');
  const QUESTS_CLAIM = [
    '1. **A quest has one giver.**',
    '   > A quest has one giver.',
    '   Source: rulebook/07-quests.md §"Quests"',
  ].join('\n');

  async function buildShared(
    slug: 'trading' | 'quests',
    options: { claim?: string; test?: string; worldFile?: string; chunkCheck?: boolean; extra?: Record<string, string> } = {},
  ): Promise<void> {
    const claim = options.claim ?? (slug === 'trading' ? TRADING_CLAIM : QUESTS_CLAIM);
    const worktree = await buildOnBranch(slug, 100, {
      [`design/chunks/${slug}/CHUNK.md`]: await sharedChunkMd(slug, claim),
      [`tests/${slug}.test.ts`]: options.test ?? `// ${slug}'s own test\n`,
      'src/world.ts': options.worldFile ?? (slug === 'trading' ? world(1, 0) : world(0, 1)),
      ...options.extra,
    });
    if (options.chunkCheck === false) return;
    await recordVerifiedAgainst(slug, { project: worktree });
    git(worktree, 'add', '-A');
    git(worktree, 'commit', '-q', '-m', `chunk-${slug}/close: chunk-check`);
  }

  beforeEach(async () => {
    await write(main, {
      'src/world.ts': world(0, 0),
      'design/rulebook/04-trading.md': '# Trading\n\nEvery trade is public.\n',
      'design/rulebook/07-quests.md': '# Quests\n\nA quest has one giver.\n',
    });
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'world');
  });

  it("vouches for the combined file with both chunks' own checks, and records it naming both chunks and the merge", async () => {
    await buildShared('trading');
    await buildShared('quests');
    expect((await chunkMerge(main, 'trading', { runTests: ownTestsRunner })).refusals).toEqual([]);
    const mainBefore = head();
    const branchTip = git(main, 'rev-parse', 'chunk/quests').trim();

    const result = await chunkMerge(main, 'quests', { runTests: ownTestsRunner });
    expect(result.refusals).toEqual([]);
    expect(await read(main, 'src/world.ts')).toBe(world(1, 1));

    const ledger = await read(main, 'design/MERGE-SIGNOFFS.md');
    expect(ledger).toContain('### src/world.ts');
    expect(ledger).toContain('- Chunks: quests, trading');
    expect(ledger).toContain(`- Merge: chunk/quests ${branchTip} into ${mainBefore}`);
    expect(ledger).toMatch(/^- Content: [0-9a-f]{64}$/m);
    expect(ledger).toMatch(/^- Checks: tests, chunk-check, claim-quote-check$/m);
    // The merge commit carries the record, and its parents are the two commits it names.
    expect(git(main, 'rev-parse', 'HEAD^1', 'HEAD^2').trim().split('\n')).toEqual([mainBefore, branchTip]);

    const signoffs = await assessSignoffs(main);
    expect(signoffs.get('trading')).toEqual({
      problems: [],
      sharedEdits: [{ path: 'src/world.ts', coveredBy: 'quests, trading', how: 'merged' }],
    });
    expect(signoffs.get('quests')).toEqual({
      problems: [],
      sharedEdits: [{ path: 'src/world.ts', coveredBy: 'quests, trading', how: 'merged' }],
    });
    expect(status()).toBe('');
  });

  /**
   * Merges `first`, then `second`, and expects the second merge to be refused with `refusal`,
   * leaving the main line, its working tree and design/MERGE-SIGNOFFS.md as they were.
   */
  async function expectSecondMergeRefused(first: string, second: string, refusal: RegExp): Promise<void> {
    expect((await chunkMerge(main, first, { runTests: ownTestsRunner })).refusals).toEqual([]);
    await expectMergeRefused(second, ownTestsRunner, refusal);
  }

  /** Expects merging `slug` to be refused with `refusal`, leaving the main line and its records as they were. */
  async function expectMergeRefused(slug: string, runTests: TestRunner, refusal: RegExp): Promise<void> {
    const before = head();
    const result = await chunkMerge(main, slug, { runTests });
    expect(result.merged).toBe(false);
    expect(result.refusals.join('\n')).toMatch(refusal);
    expect([head(), status()]).toEqual([before, '']);
    await expect(fs.access(join(main, 'design/MERGE-SIGNOFFS.md'))).rejects.toThrow();
  }

  it("refuses when a chunk's own tests fail on the combined file, naming the check and the chunk", async () => {
    await buildShared('trading');
    await buildShared('quests', { test: '// quests: assumes TRADING = 0\n' });
    await expectSecondMergeRefused(
      'trading',
      'quests',
      /quests's own tests \(tests\/quests\.test\.ts\) fail on the combined tree[\s\S]*src\/world\.ts[\s\S]*expected TRADING to be 0/,
    );
  });

  it("refuses when a chunk's claim-quote-check fails on the combined tree", async () => {
    // Trading quotes Ruling 1; quests, built alongside, rewords it.
    const rulingClaim = ['1. **The core loop comes first.**', '   > the core loop.', '   Source: RULINGS.md §"Ruling 1"'].join('\n');
    await buildShared('trading', { claim: rulingClaim });
    const quests = join(dirname(main), 'wt-quests');
    await buildShared('quests');
    await write(quests, { 'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: the game loop.\n' });
    git(quests, 'commit', '-q', '-am', 'chunk-quests/revise: Ruling 1 reworded');
    await expectSecondMergeRefused('quests', 'trading', /claim-quote-check fails for trading on the combined tree[\s\S]*Claim 1/);
  });

  it('vouches for a closed chunk after the skills were reinstalled on the main line (#438)', async () => {
    const skill = '.claude/skills/bs-build-chunk/SKILL.md';
    await write(main, { [skill]: 'skill text v1\n' });
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'skills v1');
    await buildShared('trading');
    await buildShared('quests');
    await write(main, { [skill]: 'skill text v2\n' });
    git(main, 'commit', '-q', '-am', 'skills reinstalled');

    expect((await chunkMerge(main, 'trading', { runTests: ownTestsRunner })).refusals).toEqual([]);
    expect((await chunkMerge(main, 'quests', { runTests: ownTestsRunner })).refusals).toEqual([]);
  });

  it("refuses when a chunk's chunk-check fails on the combined tree", async () => {
    await buildShared('trading');
    await buildShared('quests', { chunkCheck: false });
    await expectSecondMergeRefused('trading', 'quests', /chunk-check fails for quests on the combined tree[\s\S]*Verified Against/);
  });

  it("refuses, and leaves no record behind, when a chunk's sign-off fails once the merge has vouched", async () => {
    await buildShared('trading');
    await buildShared('quests');
    expect((await chunkMerge(main, 'trading', { runTests: ownTestsRunner })).refusals).toEqual([]);
    // An edit to trading's own file on the main line that no chunk accounts for voids its sign-off.
    await write(main, { 'src/trading.ts': 'export const PARTITION_BYTES = 101;\n' });
    git(main, 'commit', '-q', '-am', 'an unaccounted edit');
    await expectMergeRefused('quests', ownTestsRunner, /chunk-check fails for trading on the combined tree[\s\S]*src\/trading\.ts changed after it/);
  });

  it("vouches for signed-off code the merge renumbered, so allocating a ledger number voids no sign-off (#435)", async () => {
    const signedWorld = `// Ruling @trading.1: prices are public.\n${world(1, 0)}`;
    await buildShared('trading', {
      worldFile: signedWorld,
      extra: { 'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: the core loop.\n\n### Ruling @trading.1\n- Decision: prices are public.\n' },
    });

    const result = await chunkMerge(main, 'trading', { runTests: ownTestsRunner });
    expect(result.refusals).toEqual([]);
    expect(result.allocated).toEqual({ 'Ruling @trading.1': 'Ruling 2' });
    expect(await read(main, 'src/world.ts')).toBe(`// Ruling 2: prices are public.\n${world(1, 0)}`);
    expect(result.vouched).toEqual([{ path: 'src/world.ts', chunks: ['trading'], why: 'renumbered' }]);
    expect(await read(main, 'design/MERGE-SIGNOFFS.md')).toContain('### src/world.ts');
    expect((await assessSignoffs(main)).get('trading')).toEqual({
      problems: [],
      sharedEdits: [{ path: 'src/world.ts', coveredBy: 'trading', how: 'merged' }],
    });
    expect(status()).toBe('');
  });

  describe('a test-runner config the main line edited after a chunk signed it off (#479)', () => {
    const config = (exclude: string[], more = '') =>
      `import { defineConfig } from 'vitest/config';\n` +
      `export default defineConfig({\n  test: {\n    exclude: ${JSON.stringify(exclude)},${more}\n  },\n});\n`;

    /**
     * Vitest as it really behaves: a test file named on the command line that the config excludes
     * is skipped without a word, and the run still exits 0. Only the files that ran say otherwise.
     */
    const configRunner: TestRunner = async (projectDir, files) => {
      const text = await read(projectDir, 'vitest.config.ts');
      const run = await ownTestsRunner(projectDir, files);
      return 'refused' in run ? run : { ...run, ran: files.filter((f) => !text.includes(`"${f}"`)) };
    };

    /**
     * Trading signs off vitest.config.ts with its code, with a second test file of its own; then the
     * main line edits only the config, to `edited`.
     */
    async function tradingSignsTheConfig(edited: string): Promise<void> {
      await write(main, { 'vitest.config.ts': config(['node_modules/**']) });
      git(main, 'add', '-A');
      git(main, 'commit', '-q', '-m', 'vitest config');
      const chunk = (await sharedChunkMd('trading', TRADING_CLAIM))
        .replace('| src/world.ts | written |', '| src/world.ts | written |\n| vitest.config.ts | written |')
        .replace('| tests/trading.test.ts | 1 | yes |', '| tests/trading.test.ts | 1 | yes |\n| tests/trading-prices.test.ts | 1 | yes |');
      await buildShared('trading', {
        extra: {
          'design/chunks/trading/CHUNK.md': chunk,
          'tests/trading-prices.test.ts': '// trading prices\n',
          'vitest.config.ts': config(['node_modules/**', 'dist/**']),
        },
      });
      expect((await chunkMerge(main, 'trading', { runTests: configRunner })).refusals).toEqual([]);
      // Quests shares no file with trading; only the config stands between it and the main line.
      await buildOnBranch('quests', 100);
      await write(main, { 'vitest.config.ts': edited });
      git(main, 'commit', '-q', '-am', 'tests: change the vitest config');
    }

    it("vouches for an edit to test.exclude with the signed chunk's own checks, so it voids no sign-off", async () => {
      await tradingSignsTheConfig(config(['node_modules/**', 'dist/**', '.worktrees/**', '**/tests/browser/**']));
      expect((await assessSignoffs(main)).get('trading')!.problems.join('\n')).toMatch(/vitest\.config\.ts changed after it/);

      const result = await chunkMerge(main, 'quests', { runTests: configRunner });
      expect(result.refusals).toEqual([]);
      expect(result.alongside).toEqual([]);
      expect(result.vouched).toEqual([{ path: 'vitest.config.ts', chunks: ['trading'], why: 'test-config' }]);
      expect(await read(main, 'design/MERGE-SIGNOFFS.md')).toContain('### vitest.config.ts');
      expect((await assessSignoffs(main)).get('trading')).toEqual({
        problems: [],
        sharedEdits: [{ path: 'vitest.config.ts', coveredBy: 'trading', how: 'merged' }],
      });
      expect(status()).toBe('');
    });

    it("refuses when the edit excludes one of the chunk's own test files, though vitest exits 0 without it", async () => {
      await tradingSignsTheConfig(config(['node_modules/**', 'dist/**', 'tests/trading-prices.test.ts']));
      await expectMergeRefused(
        'quests',
        configRunner,
        /trading's own tests did not all run on the combined tree, so this merge cannot vouch for vitest\.config\.ts \(a test-runner config edited since the chunk signed it off\): tests\/trading-prices\.test\.ts did not run/,
      );
    });

    const editExclude = () => tradingSignsTheConfig(config(['node_modules/**', 'dist/**', '.worktrees/**']));

    it("refuses when the run does not report which files ran, since vitest's report is then missing or unreadable", async () => {
      await editExclude();
      const unreported: TestRunner = async (projectDir, files) => {
        const run = await configRunner(projectDir, files);
        return 'refused' in run ? run : { ok: run.ok, output: run.output };
      };
      await expectMergeRefused(
        'quests',
        unreported,
        /trading's own tests cannot be confirmed on the combined tree, so this merge cannot vouch for vitest\.config\.ts[^:]*: vitest's JSON report, which names the test files it ran, is missing or unreadable/,
      );
    });

    it("refuses when the run also ran a file outside the chunk's own, which could share state with its tests", async () => {
      // Vitest runs every collected file whose path contains a named one, and an include edit can add one.
      await editExclude();
      const alsoRan: TestRunner = async (projectDir, files) => {
        const run = await configRunner(projectDir, files);
        return 'refused' in run || files.length === 0 ? run : { ...run, ran: [...(run.ran ?? []), 'extra/tests/trading.test.ts'] };
      };
      await expectMergeRefused(
        'quests',
        alsoRan,
        /trading's own tests did not run alone on the combined tree, so this merge cannot vouch for vitest\.config\.ts[^:]*: extra\/tests\/trading\.test\.ts ran with them/,
      );
    });

    it('aborts the merge, leaving the main line as it was, when a check throws', async () => {
      await editExclude();
      const before = head();
      const throws: TestRunner = async () => {
        throw new Error('the test runner broke');
      };
      await expect(chunkMerge(main, 'quests', { runTests: throws })).rejects.toThrow('the test runner broke');
      expect([head(), status()]).toEqual([before, '']);
      await expect(fs.access(join(main, '.git/MERGE_HEAD'))).rejects.toThrow();
    });

    it('does not vouch for any other edit to the config, which voids the sign-off as before', async () => {
      // A setup file can mock what the chunk's tests exercise, so this is not a collection change.
      await tradingSignsTheConfig(config(['node_modules/**', 'dist/**'], "\n    setupFiles: ['tests/setup.ts'],"));
      await expectMergeRefused('quests', configRunner, /chunks\/trading\/CHUNK\.md's sign-off \([^)]*\) was for different code: vitest\.config\.ts changed after it/);
    });
  });

  it('refuses a branch that writes the merge sign-offs itself', async () => {
    await buildOnBranch('trading', 100, { 'design/MERGE-SIGNOFFS.md': '# Merge Sign-offs\n' });
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner });
    expect(result.refusals.join('\n')).toMatch(/design\/MERGE-SIGNOFFS\.md/);
  });
});

describe('resolveDesignConflicts', () => {
  const conflict = (ours: string, base: string, theirs: string) =>
    `before\n<<<<<<< HEAD\n${ours}||||||| base\n${base}=======\n${theirs}>>>>>>> chunk/x\nafter\n`;

  it('keeps both sides of two appends at the same place', () => {
    const result = resolveDesignConflicts(conflict('- idea a\n', '', '- idea b\n'));
    expect(result).toEqual({ text: 'before\n- idea a\n- idea b\nafter\n', unresolved: 0 });
  });

  it('keeps the main line\'s session lock', () => {
    const result = resolveDesignConflicts(
      conflict('Session Lock: "a,b @ run"\n', 'Session Lock: "a,b @ old"\n', 'Session Lock: none\n'),
    );
    expect(result).toEqual({ text: 'before\nSession Lock: "a,b @ run"\nafter\n', unresolved: 0 });
  });

  it('leaves a real edit conflict for a person to resolve', () => {
    const result = resolveDesignConflicts(conflict('- Decision: yes\n', '- Decision: maybe\n', '- Decision: no\n'));
    expect(result.unresolved).toBe(1);
  });
});
