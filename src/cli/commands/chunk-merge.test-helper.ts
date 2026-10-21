/**
 * THE GAME PROJECT AND CHUNK BRANCHES THE chunk-merge*.test.ts FILES MERGE (#294): `setUp` makes a
 * fresh main line at `main` for each test, and `buildOnBranch` builds a chunk on a branch beside it.
 */
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { recordSignoff } from './chunk-signoff.js';
import { recordPassingVerify } from '../lib/verify-result.test-helper.js';
import type { TestRunner } from './constraint-check.js';
import type { TypeCheckRun } from './validate.js';

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf-8' });

export async function write(dir: string, files: Record<string, string>): Promise<void> {
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(dirname(join(dir, rel)), { recursive: true });
    await fs.writeFile(join(dir, rel), text);
  }
}

export const read = (dir: string, rel: string) => fs.readFile(join(dir, rel), 'utf-8');

/**
 * The measurement test the constraint names, run as code: the world partition is the sum of every
 * `PARTITION_BYTES` a chunk adds under src/, and the budget is 512.
 */
export const budgetRunner: TestRunner = async (projectDir, files) => {
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

/** The project's type check, standing in for vue-tsc, which these fixtures do not install. */
export const typeCheck = async (): Promise<TypeCheckRun> => ({
  result: { name: 'TypeScript', passed: true, message: 'No type errors' },
  programFiles: [],
  compilerReport: [],
});

export function sketchEntry(slug: string, citations: string, milestone = 'none'): string {
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

export async function chunkMd(slug: string): Promise<string> {
  const template = await fs.readFile(
    new URL('../slash-command/bs/templates/CHUNK.template.md', import.meta.url),
    'utf-8',
  );
  return template
    .replace(/^Status: proposed$/m, 'Status: built')
    .replace('<!-- | src/... | written / pending | -->', `| src/${slug}.ts | written |`)
    .replace(/(## Constraints Review\n(?:<!--[\s\S]*?-->\n)?)/, '$1- C1: held. tests/budget.test.ts\n');
}

export let main: string;

export async function setUp(): Promise<void> {
  const tree = tempTree('bs-chunk-merge-');
  main = join(tree, 'game');
  await write(main, {
    'boardsmith.json': JSON.stringify({ name: 'game' }),
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
export async function buildOnBranch(slug: string, bytes: number, extra: Record<string, string> = {}): Promise<string> {
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
    [`tests/${slug}.test.ts`]: `// ${slug}'s test\n`,
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

export const head = () => git(main, 'rev-parse', 'HEAD').trim();
export const status = () => git(main, 'status', '--porcelain', '--untracked-files=no');
