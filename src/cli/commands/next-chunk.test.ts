import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { nextChunks, nextChunkCommand } from './next-chunk.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

/**
 * #1660: a chunk waiting on the designer (a rules question, parked) does not stop a run while a
 * chunk that does not build on it remains. The run stops only when every remaining chunk is
 * waiting on the designer, directly or through what it depends on.
 */

function entry(slug: string, status: string, dependsOn?: string): string {
  const lines = [`### ${slug}`, `- What it builds: ${slug}`];
  if (dependsOn !== undefined) lines.push(`- Depends on: ${dependsOn}`);
  lines.push('- Milestone: none', `- Status (derived from chunks/${slug}/CHUNK.md): ${status}`, '');
  return lines.join('\n');
}

function sketch(...entries: string[]): string {
  return ['# Sketch', '', '## Ordered Chunk List', '', ...entries].join('\n');
}

const GAME = sketch(
  entry('core-loop', 'verified', 'none'),
  entry('trading', 'approved', 'core-loop'),
  entry('quests', 'proposed', 'core-loop'),
  entry('markets', 'proposed', 'trading'),
  entry('legacy', 'proposed'),
);

function run(openGate: string): string {
  return ['# Run', '', 'Run Status: active', '', `Open Gate: ${openGate}`, '', 'Stop Reason: none', ''].join('\n');
}

async function project(sketchText: string, runText?: string): Promise<string> {
  const dir = join(tempTree('bs-next-chunk-'), 'proj');
  await fs.mkdir(join(dir, 'design'), { recursive: true });
  await fs.writeFile(join(dir, 'design', 'SKETCH.md'), sketchText);
  if (runText !== undefined) await fs.writeFile(join(dir, 'design', 'RUN.md'), runText);
  return dir;
}

describe('nextChunks', () => {
  it('builds in list order when nothing waits on the designer', async () => {
    const next = await nextChunks(await project(GAME, run('none')));
    expect(next).toEqual({ buildable: ['trading', 'quests'], waiting: [], remaining: 4 });
  });

  it('reads a project with no RUN.md as nothing waiting', async () => {
    expect((await nextChunks(await project(GAME))).buildable[0]).toBe('trading');
  });

  it('skips a chunk parked on a rules question, and every chunk built on it, and keeps building the rest', async () => {
    const next = await nextChunks(await project(GAME, run('trading — may a trade include a debt?')));
    // markets depends on trading; legacy has no Depends on line, so it depends on every earlier chunk.
    expect(next).toEqual({ buildable: ['quests'], waiting: ['trading'], remaining: 4 });
  });

  it('reads every gate in a "; "-separated Open Gate list', async () => {
    const next = await nextChunks(await project(GAME, run('`trading` — a debt question; quests — a timing question')));
    expect(next.waiting).toEqual(['trading', 'quests']);
    expect(next.buildable).toEqual([]);
  });

  it('reports nothing remaining when every chunk is verified', async () => {
    const done = sketch(entry('core-loop', 'verified', 'none'), entry('final', 'verified (user-waived)', 'core-loop'));
    expect(await nextChunks(await project(done, run('none')))).toEqual({ buildable: [], waiting: [], remaining: 0 });
  });
});

describe('nextChunkCommand', () => {
  let out: string[];
  let err: string[];
  beforeEach(() => {
    out = [];
    err = [];
    process.exitCode = undefined;
    vi.spyOn(console, 'log').mockImplementation((m: string) => void out.push(m));
    vi.spyOn(console, 'error').mockImplementation((m: string) => void err.push(m));
  });
  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('names the chunk to build next, and exits zero', async () => {
    await nextChunkCommand({ project: await project(GAME, run('trading — a debt question')) });
    expect(process.exitCode).toBeUndefined();
    expect(out.join('\n')).toMatch(/^Build next: quests\./m);
  });

  it('exits non-zero when every remaining chunk waits on the designer, naming the open gates', async () => {
    await nextChunkCommand({ project: await project(GAME, run('trading — a; quests — b')) });
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/Every remaining chunk waits on the designer.*trading, quests/s);
  });

  it('says the game is built when nothing remains', async () => {
    const done = sketch(entry('core-loop', 'verified', 'none'));
    await nextChunkCommand({ project: await project(done), json: true });
    expect(process.exitCode).toBeUndefined();
    expect(JSON.parse(out.join('\n'))).toEqual({ buildable: [], waiting: [], remaining: 0 });
  });
});
