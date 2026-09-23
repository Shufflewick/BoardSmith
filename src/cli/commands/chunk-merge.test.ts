import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { chunkMerge, resolveDesignConflicts } from './chunk-merge.js';
import { recordSignoff } from './chunk-signoff.js';
import { checkConstraints, type TestRunner } from './constraint-check.js';

/**
 * #294: `boardsmith chunk-merge` is the one way a chunk built on its own branch reaches the main
 * line. It merges serially, allocates ledger numbers on the combined tree, re-runs the tree-wide
 * checks there, and refuses (leaving the main line as it was) when the combined tree fails a
 * check each branch passed alone: the sotf failure, where each chunk measured only its own growth
 * in a shared partition and nobody measured the total (Shufflewick/sotf#24, #25).
 */

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
const budgetRunner: TestRunner = async (projectDir) => {
  const src = join(projectDir, 'src');
  let total = 0;
  for (const name of await fs.readdir(src)) {
    const m = /PARTITION_BYTES = (\d+)/.exec(await read(src, name));
    if (m) total += Number(m[1]);
  }
  return total <= 512
    ? { ok: true, output: `partition ${total} bytes` }
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
  main = join(tempTree('bs-chunk-merge-'), 'game');
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
      '- Pipeline: build-chunk',
      '- Dispatched at: 2026-09-01T00:00:00Z',
      '- Finished at: 2026-09-01T01:00:00Z',
      '- Outcome: closed',
      '- Detail: n/a',
      '',
    ].join('\n'),
    ...extra,
  });
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
