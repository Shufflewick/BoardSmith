import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { checkParallel, parallelCheckCommand } from './parallel-check.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

/**
 * #294: two chunks may be built at the same time only when the sketch shows neither depends on
 * the other and their rulebook citations do not overlap. The sotf run built auctions, quests and
 * world evolution at once with nothing checking either condition, and the three shared venues.
 */

function entry(slug: string, lines: string[]): string {
  return [`### ${slug}`, `- What it builds: ${slug}`, ...lines, ''].join('\n');
}

const SKETCH = [
  '# Sketch',
  '',
  'Session Lock: none',
  '',
  '## Ordered Chunk List',
  '',
  entry('core-loop', [
    '- Citations: rulebook/01-turns.md',
    '- Depends on: none',
    '- Milestone: core-loop',
    '- Status (derived from chunks/core-loop/CHUNK.md): verified',
  ]),
  entry('trading', [
    '- Citations: rulebook/04-trading.md, rulebook/05-market.md',
    '- Depends on: core-loop',
    '- Milestone: none',
    '- Status (derived from chunks/trading/CHUNK.md): approved',
  ]),
  entry('quests', [
    '- Citations: rulebook/07-quests.md',
    '- Depends on: core-loop',
    '- Milestone: none',
    '- Status (derived from chunks/quests/CHUNK.md): proposed',
  ]),
  entry('auctions', [
    '- Citations: rulebook/05-market.md, rulebook/06-auctions.md',
    '- Depends on: core-loop',
    '- Milestone: none',
    '- Status (derived from chunks/auctions/CHUNK.md): proposed',
  ]),
  entry('venues', [
    '- Citations: rulebook/08-venues.md',
    '- Depends on: trading',
    '- Milestone: none',
    '- Status (derived from chunks/venues/CHUNK.md): proposed',
  ]),
  entry('legacy', [
    '- Citations: rulebook/09-legacy.md',
    '- Milestone: none',
    '- Status (derived from chunks/legacy/CHUNK.md): proposed',
  ]),
  entry('tail', ['- Depends on: core-loop', '- Milestone: none', '- Status: proposed (sketch-level — no CHUNK.md yet)']),
  entry('final', [
    '- Citations: rulebook/01-turns.md',
    '- Depends on: core-loop',
    '- Milestone: final-acceptance',
    '- Status (derived from chunks/final/CHUNK.md): proposed',
  ]),
].join('\n');

function chunkMd(slug: string, newlyDiscovered = '_None._'): string {
  return [`# Chunk: ${slug}`, '', 'Status: proposed', '', '## Interpretation', '', '## Newly Discovered Citations', '', newlyDiscovered, ''].join('\n');
}

const RULEBOOK = ['01-turns', '04-trading', '05-market', '06-auctions', '07-quests', '08-venues', '09-legacy'];

async function project(extra: Record<string, string> = {}): Promise<string> {
  const tree = tempTree('bs-parallel-check-');
  const dir = join(tree, 'proj');
  const files: Record<string, string> = { 'SKETCH.md': SKETCH };
  for (const name of RULEBOOK) files[`rulebook/${name}.md`] = `# ${name}\n`;
  for (const slug of ['core-loop', 'trading', 'quests', 'auctions', 'venues', 'legacy', 'final']) {
    files[`chunks/${slug}/CHUNK.md`] = chunkMd(slug);
  }
  Object.assign(files, extra);
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(dirname(join(dir, 'design', rel)), { recursive: true });
    await fs.writeFile(join(dir, 'design', rel), text);
  }
  return dir;
}

describe('checkParallel', () => {
  it('allows two chunks that depend only on verified work and cite different rules', async () => {
    expect(await checkParallel(await project(), ['trading', 'quests'])).toEqual([]);
  });

  it('refuses two chunks whose citations overlap, naming the shared slice', async () => {
    const refusals = await checkParallel(await project(), ['trading', 'auctions']);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatch(/trading and auctions both cite rulebook\/05-market\.md/);
  });

  it('counts the citations a chunk discovered while it was built, not only the sketch line', async () => {
    const dir = await project({ 'chunks/quests/CHUNK.md': chunkMd('quests', '- rulebook/04-trading.md: quests pay in goods') });
    const refusals = await checkParallel(dir, ['trading', 'quests']);
    expect(refusals.join('\n')).toMatch(/both cite rulebook\/04-trading\.md/);
  });

  it('refuses a chunk whose dependency is not verified yet', async () => {
    const refusals = await checkParallel(await project(), ['trading', 'venues']);
    expect(refusals.join('\n')).toMatch(/venues depends on trading, which is not verified/);
  });

  it('refuses a chunk with no Depends on line, a chunk with no citations, and a milestone that runs alone', async () => {
    const refusals = (await checkParallel(await project(), ['legacy', 'tail', 'final'])).join('\n');
    expect(refusals).toMatch(/legacy has no "- Depends on:" line/);
    expect(refusals).toMatch(/tail has no rulebook citations/);
    expect(refusals).toMatch(/final is the final-acceptance chunk/);
  });

  it('refuses a verified chunk, an unknown slug, and a single chunk', async () => {
    const dir = await project();
    expect((await checkParallel(dir, ['core-loop', 'quests'])).join('\n')).toMatch(/core-loop is already verified/);
    expect((await checkParallel(dir, ['nope', 'quests'])).join('\n')).toMatch(/no chunk "nope"/);
    expect((await checkParallel(dir, ['quests'])).join('\n')).toMatch(/at least two/);
  });

  it('refuses a citation that names no rulebook slice, since overlap cannot then be ruled out', async () => {
    const dir = await project({ 'chunks/quests/CHUNK.md': chunkMd('quests', '- rulebook/99-gone.md') });
    expect((await checkParallel(dir, ['trading', 'quests'])).join('\n')).toMatch(/quests cites rulebook\/99-gone\.md/);
  });
});

describe('parallelCheckCommand', () => {
  beforeEach(() => {
    for (const stream of ['log', 'error'] as const) vi.spyOn(console, stream).mockImplementation(() => {});
    process.exitCode = undefined;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('exits zero when the chunks may run together and non-zero when they may not', async () => {
    const dir = await project();
    await parallelCheckCommand(['trading', 'quests'], { project: dir });
    expect(process.exitCode).toBeUndefined();
    await parallelCheckCommand(['trading', 'auctions'], { project: dir });
    expect(process.exitCode).toBe(1);
  });

  it('refuses a slug that is a path', async () => {
    await parallelCheckCommand(['../x', 'quests'], { project: await project() });
    expect(process.exitCode).toBe(1);
  });
});
