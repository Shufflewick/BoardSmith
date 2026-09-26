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

/**
 * #415: a page many chunks cite for different parts (a designer-decisions page) is not one unit.
 * Two chunks conflict when they cite the same SECTION of a slice: the section a `§"<name>"`
 * citation names, or the section holding a cited line. A citation of the bare page claims every
 * section of it.
 */
const DECISIONS = [
  '# Designer Decisions (p.2)', //                      1
  '', //                                                2
  'Source: rulebook/source/REQUIREMENTS.md', //         3
  '', //                                                4
  'p.2, Designer Decisions > Battlefield:', //          5
  '- The board is 60 by 30 spaces.', //                 6
  '- Two towers per player.', //                        7
  '', //                                                8
  'p.2, Designer Decisions > Economy:', //              9
  '- Income goes up by 200 each round.', //            10
  '- A player may buy 2 packs a round.', //            11
  '', //                                               12
  'p.2, Designer Decisions > Battle:', //              13
  '- Draw: each player loses 10 percent.', //          14
  '', //                                               15
  '## Unit Schedules', //                              16
  '', //                                               17
  '### Crawler', //                                    18
  '| 263 | 79 |', //                                   19
  '',
].join('\n');

function sectionSketch(entries: Array<[slug: string, citations: string]>): string {
  return [
    '# Sketch',
    '',
    '## Ordered Chunk List',
    '',
    entry('core-loop', [
      '- Citations: rulebook/01-turns.md',
      '- Depends on: none',
      '- Milestone: core-loop',
      '- Status (derived from chunks/core-loop/CHUNK.md): verified',
    ]),
    ...entries.map(([slug, citations]) =>
      entry(slug, [
        `- Citations: ${citations}`,
        '- Depends on: core-loop',
        '- Milestone: none',
        '- Status: proposed (sketch-level — no CHUNK.md yet)',
      ]),
    ),
  ].join('\n');
}

async function sectionProject(
  entries: Array<[slug: string, citations: string]>,
  chunkMds: Record<string, string> = {},
): Promise<string> {
  const dir = join(tempTree('bs-parallel-check-sections-'), 'proj');
  const files: Record<string, string> = {
    'SKETCH.md': sectionSketch(entries),
    'rulebook/01-turns.md': '# Turns\n',
    'rulebook/02-designer-decisions.md': DECISIONS,
    ...Object.fromEntries(Object.entries(chunkMds).map(([slug, text]) => [`chunks/${slug}/CHUNK.md`, text])),
  };
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(dirname(join(dir, 'design', rel)), { recursive: true });
    await fs.writeFile(join(dir, 'design', rel), text);
  }
  return dir;
}

function interpretation(slug: string, body: string[]): string {
  return [`# Chunk: ${slug}`, '', 'Status: approved', '', '## Interpretation', '', ...body, '', '## Newly Discovered Citations', '', '_None._', ''].join('\n');
}

describe('checkParallel by section (#415)', () => {
  it('allows two chunks that cite different named sections of one page', async () => {
    const dir = await sectionProject([
      ['board', 'rulebook/02-designer-decisions.md §"Designer Decisions > Battlefield"'],
      ['economy', 'rulebook/02-designer-decisions.md §"Designer Decisions > Economy"'],
    ]);
    expect(await checkParallel(dir, ['board', 'economy'])).toEqual([]);
  });

  it('refuses two chunks that cite the same section, naming the section and not only the page', async () => {
    const dir = await sectionProject([
      ['board', 'rulebook/02-designer-decisions.md §"Designer Decisions > Battlefield"'],
      ['towers', 'rulebook/02-designer-decisions.md §"Designer Decisions > Economy" §"Designer Decisions > Battlefield"'],
    ]);
    const refusals = await checkParallel(dir, ['board', 'towers']);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatch(
      /board and towers both cite rulebook\/02-designer-decisions\.md §"Designer Decisions > Battlefield" \(lines 5-8\)/,
    );
    expect(refusals[0]).not.toMatch(/Economy/);
  });

  it('places a cited line range in the section that holds it', async () => {
    const claims = (line: string) =>
      interpretation('x', ['1. **A rule.**', '   > a quote', `   Source: rulebook/02-designer-decisions.md:${line}`]);
    const dir = await sectionProject(
      [
        ['draw', 'rulebook/01-turns.md'],
        ['income', 'rulebook/01-turns.md'],
        ['board', 'rulebook/02-designer-decisions.md §"Designer Decisions > Battlefield"'],
      ],
      { draw: claims('14-14'), income: claims('10-11'), board: interpretation('board', []) },
    );
    // 01-turns.md is one section both cite, so compare each against the Battlefield chunk instead.
    expect(await checkParallel(dir, ['draw', 'board'])).toEqual([]);
    expect(await checkParallel(dir, ['income', 'board'])).toEqual([]);
    const dir2 = await sectionProject(
      [
        ['draw', 'rulebook/02-designer-decisions.md §"Designer Decisions > Battle"'],
        ['board', 'rulebook/02-designer-decisions.md §"Designer Decisions > Battlefield"'],
      ],
      { board: claims('13-14') },
    );
    expect((await checkParallel(dir2, ['draw', 'board'])).join('\n')).toMatch(
      /both cite rulebook\/02-designer-decisions\.md §"Designer Decisions > Battle" \(lines 13-15\)/,
    );
  });

  it('counts a heading citation as every section under that heading', async () => {
    const dir = await sectionProject([
      ['stats', 'rulebook/02-designer-decisions.md §"Unit Schedules"'],
      ['crawler', 'rulebook/02-designer-decisions.md:19'],
    ]);
    expect((await checkParallel(dir, ['stats', 'crawler'])).join('\n')).toMatch(/both cite rulebook\/02-designer-decisions\.md §"Crawler" \(lines 18-19\)/);
  });

  it('counts a citation of the bare page as every section of it, and says how to narrow it', async () => {
    const dir = await sectionProject([
      ['board', 'rulebook/02-designer-decisions.md (p.2, Battlefield)'],
      ['economy', 'rulebook/02-designer-decisions.md §"Designer Decisions > Economy"'],
    ]);
    const refusals = await checkParallel(dir, ['board', 'economy']);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatch(
      /board cites rulebook\/02-designer-decisions\.md as a whole page and economy cites its §"Designer Decisions > Economy" \(lines 9-12\)/,
    );
    expect(refusals[0]).toMatch(/§"<section>"/);
  });

  it('refuses a section name the slice does not have, listing the sections it does', async () => {
    const dir = await sectionProject([
      ['board', 'rulebook/02-designer-decisions.md §"Battlefield"'],
      ['economy', 'rulebook/02-designer-decisions.md §"Designer Decisions > Economy"'],
    ]);
    const refusals = (await checkParallel(dir, ['board', 'economy'])).join('\n');
    expect(refusals).toMatch(/board cites rulebook\/02-designer-decisions\.md §"Battlefield", which names no section of it/);
    expect(refusals).toMatch(/"Designer Decisions > Battlefield"/);
  });

  it('refuses a cited line past the end of the slice', async () => {
    const dir = await sectionProject([
      ['board', 'rulebook/02-designer-decisions.md:90-95'],
      ['economy', 'rulebook/02-designer-decisions.md §"Designer Decisions > Economy"'],
    ]);
    expect((await checkParallel(dir, ['board', 'economy'])).join('\n')).toMatch(
      /board cites rulebook\/02-designer-decisions\.md:90-95, but that slice has 19 lines/,
    );
  });

  it('does not count what a superseded claim cited', async () => {
    const dir = await sectionProject(
      [
        ['draw', 'rulebook/02-designer-decisions.md §"Designer Decisions > Battle"'],
        ['income', 'rulebook/02-designer-decisions.md §"Designer Decisions > Economy"'],
      ],
      {
        draw: interpretation('draw', [
          '1. **Draws cost income.**',
          '   > Income goes up by 200 each round.',
          '   Source: rulebook/02-designer-decisions.md:10',
          '',
          '2. **Draws cost 10 percent.** This supersedes claim 1 in full.',
          '   > Draw: each player loses 10 percent.',
          '   Source: rulebook/02-designer-decisions.md:14',
        ]),
      },
    );
    expect(await checkParallel(dir, ['draw', 'income'])).toEqual([]);
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
