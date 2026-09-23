import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { DESIGN_DIR, WAIVERS_MD } from '../lib/project-paths.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import {
  SIGNOFF_HEADING,
  SIGNOFF_BEGIN,
  SIGNOFF_END,
  checkSignoff,
  recordSignoff,
  recordWaiver,
  recordReopen,
  parseSignoff,
} from './chunk-signoff.js';
import { chunkCheckCommand, chunkProvenanceStatusCommand } from './chunk-provenance.js';

/**
 * #291: an orchestrated run accepted its own gates and marked four chunks `verified` with playtest
 * items nobody observed, and stretched a one-chunk "machine playtest" decision over every later
 * chunk. These tests pin the code half of the fix: `verified` is derived from a recorded sign-off,
 * never typed, and a waiver is good only for the chunks it names, until it expires.
 */

let tree: string;

beforeEach(() => {
  tree = tempTree('bs-chunk-signoff-');
  process.exitCode = undefined;
});

const NOW = new Date('2026-09-23T12:00:00Z');

interface ChunkSpec {
  slug: string;
  status?: string;
  ui?: 'none' | 'touches' | 'major';
  milestone?: 'none' | 'core-loop' | 'scoring' | 'final-acceptance';
  checklist?: string[];
  /** Build Manifest rows: project-relative path to file contents, written to disk too. */
  manifest?: Record<string, string>;
}

async function makeProject(chunks: ChunkSpec[]): Promise<string> {
  const project = join(tree, 'game');
  const design = join(project, DESIGN_DIR);
  await fs.mkdir(design, { recursive: true });

  const template = await fs.readFile(
    new URL('../slash-command/bs/templates/CHUNK.template.md', import.meta.url),
    'utf-8',
  );

  const sketchEntries: string[] = [];
  for (const c of chunks) {
    const status = c.status ?? 'built';
    const ui = c.ui ?? 'touches';
    const milestone = c.milestone ?? 'core-loop';
    const checklist = c.checklist ?? ['Draw a card', 'Pass the turn'];

    let text = template.replace(/^Status: proposed$/m, `Status: ${status}`);
    text = text.replace(/(## ui:\n<!--[\s\S]*?-->\n)none\n/, `$1${ui}\n`);
    text = text.replace(
      '- [ ] <!-- item 1 -->\n- [ ] <!-- item 2 -->',
      checklist.map((item) => `- [ ] ${item}`).join('\n'),
    );
    const manifest = c.manifest ?? {};
    text = text.replace(
      '<!-- | src/... | written / pending | -->',
      Object.keys(manifest).map((path) => `| ${path} | written |`).join('\n'),
    );
    for (const [path, content] of Object.entries(manifest)) {
      const onDisk = path.endsWith('DECISIONS.md') ? join(design, path) : join(project, path);
      await fs.mkdir(join(onDisk, '..'), { recursive: true });
      await fs.writeFile(onDisk, content);
    }
    const chunkDir = join(design, 'chunks', c.slug);
    await fs.mkdir(chunkDir, { recursive: true });
    await fs.writeFile(join(chunkDir, 'CHUNK.md'), text);

    sketchEntries.push(
      [
        `### ${c.slug}`,
        `- What it builds: ${c.slug}`,
        `- Citations: none`,
        `- ui: ${ui}`,
        `- Milestone: ${milestone}`,
        `- Status (derived from chunks/${c.slug}/CHUNK.md): ${status}`,
        `- Rules Staleness (derived from chunks/${c.slug}/CHUNK.md): clear`,
        `- Test script (outcome-based): play it`,
        '',
      ].join('\n'),
    );
  }
  await fs.writeFile(
    join(design, 'SKETCH.md'),
    `# Sketch\n\n## Ordered Chunk List\n\n${sketchEntries.join('\n')}\n### later-tail\n- What it builds: later\n- ui: none\n- Milestone: none\n- Status: proposed (sketch-level — no CHUNK.md yet)\n`,
  );
  return project;
}

async function readChunk(project: string, slug: string): Promise<string> {
  return fs.readFile(join(project, DESIGN_DIR, 'chunks', slug, 'CHUNK.md'), 'utf-8');
}

async function readSketch(project: string): Promise<string> {
  return fs.readFile(join(project, DESIGN_DIR, 'SKETCH.md'), 'utf-8');
}

async function setStatusByHand(project: string, slug: string, status: string): Promise<void> {
  const path = join(project, DESIGN_DIR, 'chunks', slug, 'CHUNK.md');
  const text = await fs.readFile(path, 'utf-8');
  await fs.writeFile(path, text.replace(/^Status:.*$/m, `Status: ${status}`));
}

describe('recordSignoff — a designer sign-off is the only way a playtested chunk becomes verified', () => {
  it('writes who, when, and which items were observed, then derives Status: verified in CHUNK.md and SKETCH.md', async () => {
    const project = await makeProject([{ slug: 'deal' }]);
    await recordSignoff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });

    const chunk = await readChunk(project, 'deal');
    expect(chunk).toMatch(/^Status: verified$/m);
    expect(chunk).toContain(SIGNOFF_HEADING);
    const parsed = parseSignoff(chunk);
    expect(parsed.state).toBe('recorded');
    expect(parsed.record).toEqual({
      basis: 'designer',
      by: 'Jane Designer',
      when: '2026-09-23T12:00:00.000Z',
      observed: [1, 2],
      code: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(await readSketch(project)).toContain(
      '- Status (derived from chunks/deal/CHUNK.md): verified',
    );
  });

  it('refuses when a checklist item has no observation recorded', async () => {
    const project = await makeProject([{ slug: 'deal', checklist: ['a', 'b', 'c'] }]);
    await expect(
      recordSignoff('deal', { project, by: 'Jane Designer', observed: '1,3', now: NOW }),
    ).rejects.toThrow(/item 2/);
    expect(await readChunk(project, 'deal')).toMatch(/^Status: built$/m);
  });

  it('refuses a sign-off by the run itself', async () => {
    const project = await makeProject([{ slug: 'deal' }]);
    for (const by of ['orchestrator', 'Claude', 'the run', 'subagent', 'automated']) {
      await expect(
        recordSignoff('deal', { project, by, observed: '1,2', now: NOW }),
      ).rejects.toThrow(/designer/i);
    }
  });

  it('refuses an automated sign-off for a chunk that needs a designer playtest', async () => {
    const project = await makeProject([{ slug: 'deal', ui: 'major', milestone: 'scoring' }]);
    await expect(
      recordSignoff('deal', { project, automated: 'sim pass, tests/deal.test.ts', now: NOW }),
    ).rejects.toThrow(/designer/i);
  });

  it('accepts an automated sign-off, with its evidence, for a chunk no designer playtests', async () => {
    const project = await makeProject([{ slug: 'rules', ui: 'none', milestone: 'none' }]);
    await recordSignoff('rules', { project, automated: 'sim pass, tests/rules.test.ts', now: NOW });
    const chunk = await readChunk(project, 'rules');
    expect(chunk).toMatch(/^Status: verified$/m);
    expect(parseSignoff(chunk).record).toMatchObject({
      basis: 'automated',
      evidence: 'sim pass, tests/rules.test.ts',
    });
  });

  it('refuses unless the chunk is built', async () => {
    const project = await makeProject([{ slug: 'deal', status: 'approved' }]);
    await expect(
      recordSignoff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW }),
    ).rejects.toThrow(/built/);
  });

  it('refuses when more than one basis is given', async () => {
    const project = await makeProject([{ slug: 'deal' }]);
    await expect(
      recordSignoff('deal', {
        project,
        by: 'Jane Designer',
        observed: '1,2',
        waiver: 'W1',
        now: NOW,
      }),
    ).rejects.toThrow(/one of/i);
  });
});

describe('waivers — scoped to named chunks, and they expire', () => {
  it('a waiver naming one chunk verifies that chunk as verified (user-waived)', async () => {
    const project = await makeProject([{ slug: 'world-shell' }, { slug: 'combat' }]);
    const id = await recordWaiver({
      project,
      chunks: 'world-shell',
      by: 'Jane Designer',
      expires: '2026-09-30',
      reason: 'machine playtest is enough for the shell',
      now: NOW,
    });
    expect(id).toBe('W1');
    const ledger = await fs.readFile(join(project, DESIGN_DIR, WAIVERS_MD), 'utf-8');
    expect(ledger).toContain('### Waiver W1');
    expect(ledger).toContain('Chunks: world-shell');

    await recordSignoff('world-shell', { project, waiver: 'W1', now: NOW });
    const chunk = await readChunk(project, 'world-shell');
    expect(chunk).toMatch(/^Status: verified \(user-waived\)$/m);
    expect(parseSignoff(chunk).record).toMatchObject({ basis: 'waiver', waiver: 'W1', by: 'Jane Designer' });
  });

  it('a waiver scoped to one chunk cannot be applied to another', async () => {
    const project = await makeProject([{ slug: 'world-shell' }, { slug: 'combat' }]);
    await recordWaiver({
      project,
      chunks: 'world-shell',
      by: 'Jane Designer',
      expires: '2026-09-30',
      reason: 'machine playtest',
      now: NOW,
    });
    await expect(recordSignoff('combat', { project, waiver: 'W1', now: NOW })).rejects.toThrow(
      /does not name combat/,
    );
    expect(await readChunk(project, 'combat')).toMatch(/^Status: built$/m);
  });

  it('an expired waiver is refused', async () => {
    const project = await makeProject([{ slug: 'world-shell' }]);
    await recordWaiver({
      project,
      chunks: 'world-shell',
      by: 'Jane Designer',
      expires: '2026-09-24',
      reason: 'machine playtest',
      now: NOW,
    });
    await expect(
      recordSignoff('world-shell', { project, waiver: 'W1', now: new Date('2026-09-25T00:00:01Z') }),
    ).rejects.toThrow(/expired/);
  });

  it('a waiver must name chunks that exist in the sketch, never a wildcard', async () => {
    const project = await makeProject([{ slug: 'world-shell' }]);
    for (const chunks of ['*', 'all', 'world-shell,every-later-chunk']) {
      await expect(
        recordWaiver({ project, chunks, by: 'Jane Designer', expires: '2026-09-30', reason: 'x', now: NOW }),
      ).rejects.toThrow();
    }
  });

  it('a waiver needs an expiry that has not already passed', async () => {
    const project = await makeProject([{ slug: 'world-shell' }]);
    await expect(
      recordWaiver({ project, chunks: 'world-shell', by: 'Jane Designer', expires: '2026-09-01', reason: 'x', now: NOW }),
    ).rejects.toThrow(/expir/);
    await expect(
      recordWaiver({ project, chunks: 'world-shell', by: 'Jane Designer', expires: 'soon', reason: 'x', now: NOW }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it('the run cannot grant a waiver to itself', async () => {
    const project = await makeProject([{ slug: 'world-shell' }]);
    await expect(
      recordWaiver({ project, chunks: 'world-shell', by: 'orchestrator', expires: '2026-09-30', reason: 'x', now: NOW }),
    ).rejects.toThrow(/designer/i);
  });

  it('a second waiver gets the next id', async () => {
    const project = await makeProject([{ slug: 'a' }, { slug: 'b' }]);
    const first = await recordWaiver({ project, chunks: 'a', by: 'Jane', expires: '2026-09-30', reason: 'x', now: NOW });
    const second = await recordWaiver({ project, chunks: 'b', by: 'Jane', expires: '2026-09-30', reason: 'y', now: NOW });
    expect([first, second]).toEqual(['W1', 'W2']);
  });
});

describe('checkSignoff — refuses a verified status that no sign-off backs', () => {
  it('Status: verified typed by hand, with no sign-off entry, is refused', async () => {
    const project = await makeProject([{ slug: 'deal' }]);
    await setStatusByHand(project, 'deal', 'verified');
    const problems = await checkSignoff(project, 'deal');
    expect(problems.join('\n')).toMatch(/no designer sign-off/i);
  });

  it('a chunk that is not yet verified has nothing to check', async () => {
    const project = await makeProject([{ slug: 'deal' }]);
    expect(await checkSignoff(project, 'deal')).toEqual([]);
  });

  it('a recorded designer sign-off passes', async () => {
    const project = await makeProject([{ slug: 'deal' }]);
    await recordSignoff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    expect(await checkSignoff(project, 'deal')).toEqual([]);
  });

  it('a sign-off copied from another chunk that cites a waiver not naming this chunk is refused', async () => {
    const project = await makeProject([{ slug: 'world-shell' }, { slug: 'combat' }]);
    await recordWaiver({ project, chunks: 'world-shell', by: 'Jane', expires: '2026-09-30', reason: 'x', now: NOW });
    await recordSignoff('world-shell', { project, waiver: 'W1', now: NOW });

    // The sotf failure: the run extends the one-chunk waiver by writing it into a later chunk.
    const shell = await readChunk(project, 'world-shell');
    const block = shell.slice(shell.indexOf(SIGNOFF_BEGIN), shell.indexOf(SIGNOFF_END) + SIGNOFF_END.length);
    const combatPath = join(project, DESIGN_DIR, 'chunks', 'combat', 'CHUNK.md');
    let combat = await fs.readFile(combatPath, 'utf-8');
    combat = combat.slice(0, combat.indexOf(SIGNOFF_BEGIN)) + block + combat.slice(combat.indexOf(SIGNOFF_END) + SIGNOFF_END.length);
    await fs.writeFile(combatPath, combat.replace(/^Status:.*$/m, 'Status: verified (user-waived)'));

    const problems = await checkSignoff(project, 'combat');
    expect(problems.join('\n')).toMatch(/W1 does not name combat/);
  });

  it('a status that does not match what the sign-off derives is refused', async () => {
    const project = await makeProject([{ slug: 'deal' }]);
    await recordSignoff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    await setStatusByHand(project, 'deal', 'verified (user-waived)');
    expect((await checkSignoff(project, 'deal')).join('\n')).toMatch(/derives "verified"/);
  });

  it('a hand-edited sign-off that drops an observed item is refused', async () => {
    const project = await makeProject([{ slug: 'deal', checklist: ['a', 'b', 'c'] }]);
    await recordSignoff('deal', { project, by: 'Jane Designer', observed: '1,2,3', now: NOW });
    const path = join(project, DESIGN_DIR, 'chunks', 'deal', 'CHUNK.md');
    const text = await fs.readFile(path, 'utf-8');
    await fs.writeFile(path, text.replace('Observed: 1, 2, 3', 'Observed: 1, 3'));
    expect((await checkSignoff(project, 'deal')).join('\n')).toMatch(/item 2/);
  });

  it('an automated sign-off on a chunk that needs a designer playtest is refused', async () => {
    const project = await makeProject([{ slug: 'rules', ui: 'none', milestone: 'core-loop' }]);
    await recordSignoff('rules', { project, automated: 'sim pass', now: NOW });
    // The sketch later marks it a UI chunk: the automated basis no longer covers it.
    const chunkPath = join(project, DESIGN_DIR, 'chunks', 'rules', 'CHUNK.md');
    const text = await fs.readFile(chunkPath, 'utf-8');
    await fs.writeFile(chunkPath, text.replace(/(## ui:\n<!--[\s\S]*?-->\n)none\n/, '$1touches\n'));
    expect((await checkSignoff(project, 'rules')).join('\n')).toMatch(/needs a designer playtest/);
  });
});

describe('chunk-check and chunk-provenance-status run the sign-off check', () => {
  it('chunk-check exits non-zero on a verified chunk with no sign-off, even once provenance is current', async () => {
    const project = await makeProject([{ slug: 'deal' }]);
    await setStatusByHand(project, 'deal', 'verified');
    await chunkCheckCommand('deal', { project, json: true }); // first run writes provenance
    process.exitCode = undefined;
    await chunkCheckCommand('deal', { project, json: true });
    expect(process.exitCode).toBe(1);
  });

  it('chunk-check passes a verified chunk whose sign-off is recorded', async () => {
    const project = await makeProject([{ slug: 'deal' }]);
    await recordSignoff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    await chunkCheckCommand('deal', { project, json: true });
    process.exitCode = undefined;
    await chunkCheckCommand('deal', { project, json: true });
    expect(process.exitCode).toBeUndefined();
  });

  it('chunk-provenance-status lists verified chunks without a valid sign-off', async () => {
    const project = await makeProject([{ slug: 'deal' }, { slug: 'shop' }]);
    await setStatusByHand(project, 'deal', 'verified');
    await recordSignoff('shop', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    const result = await chunkProvenanceStatusCommand({ project, quiet: true });
    expect(result.verifiedWithoutSignoff.map((e) => e.slug)).toEqual(['deal']);
  });
});

describe('a sign-off counts only for the chunk as it was signed (#295)', () => {
  const chunkPath = (project: string, slug: string) =>
    join(project, DESIGN_DIR, 'chunks', slug, 'CHUNK.md');

  it('sign off, reopen to built, hand-type verified: chunk-check refuses and names chunk-signoff', async () => {
    const project = await makeProject([{ slug: 'deal', manifest: { 'src/deal.ts': 'v1' } }]);
    await recordSignoff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    await recordReopen('deal', { project, reason: 'the discard pile shows face down', now: NOW });
    expect(await readChunk(project, 'deal')).toMatch(/^Status: built$/m);
    expect(await readSketch(project)).toContain('- Status (derived from chunks/deal/CHUNK.md): built');

    await setStatusByHand(project, 'deal', 'verified');
    const problems = (await checkSignoff(project, 'deal')).join('\n');
    expect(problems).toMatch(/reopened/i);
    expect(problems).toContain('boardsmith chunk-signoff deal');

    await chunkCheckCommand('deal', { project, json: true });
    process.exitCode = undefined;
    await chunkCheckCommand('deal', { project, json: true });
    expect(process.exitCode).toBe(1);
  });

  it('a code change after the sign-off voids it, even when Status is flipped by hand', async () => {
    const project = await makeProject([{ slug: 'deal', manifest: { 'src/deal.ts': 'v1' } }]);
    await recordSignoff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    await setStatusByHand(project, 'deal', 'built');
    await fs.writeFile(join(project, 'src/deal.ts'), 'v2');
    await setStatusByHand(project, 'deal', 'verified');
    const problems = (await checkSignoff(project, 'deal')).join('\n');
    expect(problems).toMatch(/src\/deal\.ts|Build Manifest/);
    expect(problems).toContain('boardsmith chunk-signoff deal');
  });

  it('adding a file to the Build Manifest after the sign-off voids it', async () => {
    const project = await makeProject([{ slug: 'deal', manifest: { 'src/deal.ts': 'v1' } }]);
    await recordSignoff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    await fs.writeFile(join(project, 'src/extra.ts'), 'new');
    const text = await readChunk(project, 'deal');
    await fs.writeFile(chunkPath(project, 'deal'), text.replace('| src/deal.ts | written |', '| src/deal.ts | written |\n| src/extra.ts | written |'));
    expect((await checkSignoff(project, 'deal')).length).toBeGreaterThan(0);
  });

  it('a design ledger in the manifest changing at close does not void the sign-off', async () => {
    const project = await makeProject([
      { slug: 'deal', manifest: { 'src/deal.ts': 'v1', 'DECISIONS.md': '# Decisions\n' } },
    ]);
    await recordSignoff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    await fs.writeFile(join(project, DESIGN_DIR, 'DECISIONS.md'), '# Decisions\n- rolled up\n');
    expect(await checkSignoff(project, 'deal')).toEqual([]);
  });

  it('a reopened chunk can be signed off afresh and then passes', async () => {
    const project = await makeProject([{ slug: 'deal', manifest: { 'src/deal.ts': 'v1' } }]);
    await recordSignoff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    await recordReopen('deal', { project, reason: 'rework', now: NOW });
    await fs.writeFile(join(project, 'src/deal.ts'), 'v2');
    await recordSignoff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    expect(await checkSignoff(project, 'deal')).toEqual([]);
  });

  it('reopen refuses a chunk that is not verified, and needs a reason', async () => {
    const project = await makeProject([{ slug: 'deal' }]);
    await expect(recordReopen('deal', { project, reason: 'rework', now: NOW })).rejects.toThrow(/not verified/);
    await recordSignoff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    await expect(recordReopen('deal', { project, reason: ' ', now: NOW })).rejects.toThrow(/--reason/);
    expect(await readChunk(project, 'deal')).toMatch(/^Status: verified$/m);
  });
});
