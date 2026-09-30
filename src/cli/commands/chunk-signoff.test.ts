import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DESIGN_DIR, MERGE_SIGNOFFS_MD, WAIVERS_MD } from '../lib/project-paths.js';
import { appendMergeSignoffs } from '../lib/merge-signoffs.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { commitAll, recordPassingVerify } from '../lib/verify-result.test-helper.js';
import {
  SIGNOFF_HEADING,
  SIGNOFF_BEGIN,
  SIGNOFF_END,
  assessSignoffs,
  checkSignoff,
  recordSignoff,
  recordWaiver,
  recordReopen,
  parseSignoff,
} from './chunk-signoff.js';
import { chunkCheckCommand, chunkProvenanceStatusCommand } from './chunk-provenance.js';
import {
  type ChunkSpec,
  makeChunkProject,
  readChunk,
  readSketch,
  setStatusByHand,
} from './chunk-project.test-helper.js';


/** Every sign-off here is made on a commit that passed `boardsmith verify` (#452), unless a test says otherwise. */
async function signOff(slug: string, options: Parameters<typeof recordSignoff>[1]): ReturnType<typeof recordSignoff> {
  await recordPassingVerify(options.project!);
  return recordSignoff(slug, options);
}

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

const makeProject = (chunks: ChunkSpec[]) => makeChunkProject(tree, chunks);

/** Runs chunk-check twice (the first run writes provenance) and expects the second to fail. */
async function expectChunkCheckRefuses(project: string, slug: string): Promise<void> {
  await chunkCheckCommand(slug, { project, json: true });
  process.exitCode = undefined;
  await chunkCheckCommand(slug, { project, json: true });
  expect(process.exitCode).toBe(1);
}

/** Types `verified` into the Status line and returns what checkSignoff says, which must name the fix. */
async function verifiedByHandProblems(project: string, slug: string): Promise<string> {
  await setStatusByHand(project, slug, 'verified');
  const problems = (await checkSignoff(project, slug)).join('\n');
  expect(problems).toContain(`boardsmith chunk-signoff ${slug}`);
  return problems;
}

describe('recordSignoff — a designer sign-off is the only way a playtested chunk becomes verified', () => {
  it('writes who, when, and which items were observed, then derives Status: verified in CHUNK.md and SKETCH.md', async () => {
    const project = await makeProject([{ slug: 'deal' }]);
    await signOff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });

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
      code: {},
    });
    expect(await readSketch(project)).toContain(
      '- Status (derived from chunks/deal/CHUNK.md): verified',
    );
  });

  it('refuses when a checklist item has no observation recorded', async () => {
    const project = await makeProject([{ slug: 'deal', checklist: ['a', 'b', 'c'] }]);
    await expect(
      signOff('deal', { project, by: 'Jane Designer', observed: '1,3', now: NOW }),
    ).rejects.toThrow(/item 2/);
    expect(await readChunk(project, 'deal')).toMatch(/^Status: built$/m);
  });

  it('refuses a sign-off by the run itself', async () => {
    const project = await makeProject([{ slug: 'deal' }]);
    for (const by of ['orchestrator', 'Claude', 'the run', 'subagent', 'automated']) {
      await expect(
        signOff('deal', { project, by, observed: '1,2', now: NOW }),
      ).rejects.toThrow(/designer/i);
    }
  });

  it('refuses an automated sign-off for a chunk that needs a designer playtest', async () => {
    const project = await makeProject([{ slug: 'deal', ui: 'major', milestone: 'scoring' }]);
    await expect(
      signOff('deal', { project, automated: 'sim pass, tests/deal.test.ts', now: NOW }),
    ).rejects.toThrow(/designer/i);
  });

  it('accepts an automated sign-off, with its evidence, for a chunk no designer playtests', async () => {
    const project = await makeProject([{ slug: 'rules', ui: 'none', milestone: 'none' }]);
    await signOff('rules', { project, automated: 'sim pass, tests/rules.test.ts', now: NOW });
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
      signOff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW }),
    ).rejects.toThrow(/built/);
  });

  it('refuses when more than one basis is given', async () => {
    const project = await makeProject([{ slug: 'deal' }]);
    await expect(
      signOff('deal', {
        project,
        by: 'Jane Designer',
        observed: '1,2',
        waiver: 'W1',
        now: NOW,
      }),
    ).rejects.toThrow(/one of/i);
  });
});

describe('recordSignoff — a chunk does not reach verified while a constraint does not hold (#288)', () => {
  const UNCAPPED = [
    '',
    '### G1',
    '- State: Almanac.mail, in the world partition',
    '- Grows with: players and time',
    '- Chunk: deal',
    '',
  ].join('\n');

  async function addStructure(project: string, extra: string): Promise<void> {
    const path = join(project, DESIGN_DIR, 'CONSTRAINTS.md');
    await fs.appendFile(path, UNCAPPED + extra);
  }

  it('refuses a sign-off while a growing structure has no cap and no ruling', async () => {
    const project = await makeProject([{ slug: 'deal' }]);
    await addStructure(project, '');
    await expect(
      signOff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW }),
    ).rejects.toThrow(/G1 .* has no cap/);
    expect(await readChunk(project, 'deal')).toMatch(/^Status: built$/m);
  });

  it('accepts it once a designer ruling allows the growth', async () => {
    const project = await makeProject([{ slug: 'deal' }]);
    await addStructure(project, '- Ruling: Ruling 1\n');
    await fs.writeFile(
      join(project, DESIGN_DIR, 'RULINGS.md'),
      '# Rulings\n\n## Ledger\n\n### Ruling 1\n- Decision: mail may grow without a cap.\n',
    );
    await signOff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    expect(await readChunk(project, 'deal')).toMatch(/^Status: verified$/m);
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

    await signOff('world-shell', { project, waiver: 'W1', now: NOW });
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
    await expect(signOff('combat', { project, waiver: 'W1', now: NOW })).rejects.toThrow(
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
      signOff('world-shell', { project, waiver: 'W1', now: new Date('2026-09-25T00:00:01Z') }),
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
    await signOff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    expect(await checkSignoff(project, 'deal')).toEqual([]);
  });

  it('a sign-off copied from another chunk that cites a waiver not naming this chunk is refused', async () => {
    const project = await makeProject([{ slug: 'world-shell' }, { slug: 'combat' }]);
    await recordWaiver({ project, chunks: 'world-shell', by: 'Jane', expires: '2026-09-30', reason: 'x', now: NOW });
    await signOff('world-shell', { project, waiver: 'W1', now: NOW });

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
    await signOff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    await setStatusByHand(project, 'deal', 'verified (user-waived)');
    expect((await checkSignoff(project, 'deal')).join('\n')).toMatch(/derives "verified"/);
  });

  it('a hand-edited sign-off that drops an observed item is refused', async () => {
    const project = await makeProject([{ slug: 'deal', checklist: ['a', 'b', 'c'] }]);
    await signOff('deal', { project, by: 'Jane Designer', observed: '1,2,3', now: NOW });
    const path = join(project, DESIGN_DIR, 'chunks', 'deal', 'CHUNK.md');
    const text = await fs.readFile(path, 'utf-8');
    await fs.writeFile(path, text.replace('Observed: 1, 2, 3', 'Observed: 1, 3'));
    expect((await checkSignoff(project, 'deal')).join('\n')).toMatch(/item 2/);
  });

  it('an automated sign-off on a chunk that needs a designer playtest is refused', async () => {
    const project = await makeProject([{ slug: 'rules', ui: 'none', milestone: 'core-loop' }]);
    await signOff('rules', { project, automated: 'sim pass', now: NOW });
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
    await expectChunkCheckRefuses(project, 'deal');
  });

  it('chunk-check passes a verified chunk whose sign-off is recorded', async () => {
    const project = await makeProject([{ slug: 'deal' }]);
    await signOff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    await chunkCheckCommand('deal', { project, json: true });
    process.exitCode = undefined;
    await chunkCheckCommand('deal', { project, json: true });
    expect(process.exitCode).toBeUndefined();
  });

  it('chunk-provenance-status lists verified chunks without a valid sign-off', async () => {
    const project = await makeProject([{ slug: 'deal' }, { slug: 'shop' }]);
    await setStatusByHand(project, 'deal', 'verified');
    await signOff('shop', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    const result = await chunkProvenanceStatusCommand({ project, quiet: true });
    expect(result.verifiedWithoutSignoff.map((e) => e.slug)).toEqual(['deal']);
  });
});

describe('a sign-off counts only for the chunk as it was signed (#295)', () => {
  const chunkPath = (project: string, slug: string) =>
    join(project, DESIGN_DIR, 'chunks', slug, 'CHUNK.md');

  it('sign off, reopen to built, hand-type verified: chunk-check refuses and names chunk-signoff', async () => {
    const project = await makeProject([{ slug: 'deal', manifest: { 'src/deal.ts': 'v1' } }]);
    await signOff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    await recordReopen('deal', { project, reason: 'the discard pile shows face down', now: NOW });
    expect(await readChunk(project, 'deal')).toMatch(/^Status: built$/m);
    expect(await readSketch(project)).toContain('- Status (derived from chunks/deal/CHUNK.md): built');

    const problems = await verifiedByHandProblems(project, 'deal');
    expect(problems).toMatch(/reopened/i);
    await expectChunkCheckRefuses(project, 'deal');
  });

  it('a code change after the sign-off voids it, even when Status is flipped by hand', async () => {
    const project = await makeProject([{ slug: 'deal', manifest: { 'src/deal.ts': 'v1' } }]);
    await signOff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    await setStatusByHand(project, 'deal', 'built');
    await fs.writeFile(join(project, 'src/deal.ts'), 'v2');
    expect(await verifiedByHandProblems(project, 'deal')).toMatch(/src\/deal\.ts changed after it/);
  });

  it('adding a file to the Build Manifest after the sign-off voids it', async () => {
    const project = await makeProject([{ slug: 'deal', manifest: { 'src/deal.ts': 'v1' } }]);
    await signOff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    await fs.writeFile(join(project, 'src/extra.ts'), 'new');
    const text = await readChunk(project, 'deal');
    await fs.writeFile(chunkPath(project, 'deal'), text.replace('| src/deal.ts | written |', '| src/deal.ts | written |\n| src/extra.ts | written |'));
    expect((await checkSignoff(project, 'deal')).length).toBeGreaterThan(0);
  });

  it('a design ledger in the manifest changing at close does not void the sign-off', async () => {
    const project = await makeProject([
      { slug: 'deal', manifest: { 'src/deal.ts': 'v1', 'DECISIONS.md': '# Decisions\n' } },
    ]);
    await signOff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    await fs.writeFile(join(project, DESIGN_DIR, 'DECISIONS.md'), '# Decisions\n- rolled up\n');
    expect(await checkSignoff(project, 'deal')).toEqual([]);
  });

  it('a reopened chunk can be signed off afresh and then passes', async () => {
    const project = await makeProject([{ slug: 'deal', manifest: { 'src/deal.ts': 'v1' } }]);
    await signOff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    await recordReopen('deal', { project, reason: 'rework', now: NOW });
    await fs.writeFile(join(project, 'src/deal.ts'), 'v2');
    await signOff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    expect(await checkSignoff(project, 'deal')).toEqual([]);
  });

  it('reopen refuses a chunk that is not verified, and needs a reason', async () => {
    const project = await makeProject([{ slug: 'deal' }]);
    await expect(recordReopen('deal', { project, reason: 'rework', now: NOW })).rejects.toThrow(/not verified/);
    await signOff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    await expect(recordReopen('deal', { project, reason: ' ', now: NOW })).rejects.toThrow(/--reason/);
    expect(await readChunk(project, 'deal')).toMatch(/^Status: verified$/m);
  });
});

describe('an edit to a shared file is accounted for by the chunk that made it (#396)', () => {
  const chunkPath = (project: string, slug: string) =>
    join(project, DESIGN_DIR, 'chunks', slug, 'CHUNK.md');
  const LATER = new Date('2026-09-24T12:00:00Z');

  /** A signed-off `deal`, then `shop` sharing its rules file, at the given status. */
  async function sharedProject(shopStatus: string): Promise<string> {
    const project = await makeProject([
      { slug: 'deal', manifest: { 'src/deal.ts': 'deal v1', 'src/rules.ts': 'rules v1' } },
      { slug: 'shop', status: shopStatus, manifest: { 'src/shop.ts': 'shop v1', 'src/rules.ts': 'rules v1' } },
    ]);
    await signOff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    return project;
  }

  it('records one content hash per source file the Build Manifest names', async () => {
    const project = await sharedProject('approved');
    const record = parseSignoff(await readChunk(project, 'deal')).record;
    expect(Object.keys(record!.code).sort()).toEqual(['src/deal.ts', 'src/rules.ts']);
    expect(record!.code['src/deal.ts']).toMatch(/^[0-9a-f]{64}$/);
    expect(await readChunk(project, 'deal')).toMatch(/^Code: src\/rules\.ts [0-9a-f]{64}$/m);
  });

  it('a later chunk still being built that names the file keeps the earlier sign-off, and says so', async () => {
    const project = await sharedProject('built');
    await fs.writeFile(join(project, 'src/rules.ts'), 'rules v2, with the shop rules added');
    expect(await checkSignoff(project, 'deal')).toEqual([]);
    const deal = (await assessSignoffs(project)).get('deal')!;
    expect(deal.sharedEdits).toEqual([{ path: 'src/rules.ts', coveredBy: 'shop', how: 'being-built' }]);
  });

  it('a later sign-off that saw the edited file keeps the earlier sign-off', async () => {
    const project = await sharedProject('built');
    await fs.writeFile(join(project, 'src/rules.ts'), 'rules v2, with the shop rules added');
    await signOff('shop', { project, by: 'Jane Designer', observed: '1,2', now: LATER });
    expect(await checkSignoff(project, 'deal')).toEqual([]);
    expect(await checkSignoff(project, 'shop')).toEqual([]);
    const deal = (await assessSignoffs(project)).get('deal')!;
    expect(deal.sharedEdits).toEqual([{ path: 'src/rules.ts', coveredBy: 'shop', how: 'signed-off' }]);
  });

  it('an edit no later sign-off saw and no chunk being built names voids every sign-off naming the file', async () => {
    const project = await sharedProject('built');
    await signOff('shop', { project, by: 'Jane Designer', observed: '1,2', now: LATER });
    await fs.writeFile(join(project, 'src/rules.ts'), 'rules v3, edited after both sign-offs');
    for (const slug of ['deal', 'shop']) {
      const problems = (await checkSignoff(project, slug)).join('\n');
      expect(problems).toContain('src/rules.ts');
      expect(problems).toContain(`boardsmith chunk-signoff ${slug}`);
    }
  });

  it('a merge that vouched for the file as it is now keeps the earlier sign-off; a stale or older record does not (#403)', async () => {
    const project = await sharedProject('built');
    await signOff('shop', { project, by: 'Jane Designer', observed: '1,2', now: LATER });
    const merged = 'rules v3, as the merge combined deal and shop';
    await fs.writeFile(join(project, 'src/rules.ts'), merged);
    const record = (content: string, when: Date) =>
      appendMergeSignoffs(undefined, [
        { path: 'src/rules.ts', content, chunks: ['deal', 'shop'], merge: 'chunk/shop abc into def', when: when.toISOString() },
      ]);
    const ledger = join(project, DESIGN_DIR, MERGE_SIGNOFFS_MD);
    const sha = createHash('sha256').update(merged).digest('hex');

    await fs.writeFile(ledger, record(sha, new Date('2026-09-26T00:00:00Z')));
    expect(await checkSignoff(project, 'deal')).toEqual([]);
    expect((await assessSignoffs(project)).get('shop')!.sharedEdits).toEqual([
      { path: 'src/rules.ts', coveredBy: 'deal, shop', how: 'merged' },
    ]);

    await fs.writeFile(ledger, record(createHash('sha256').update('rules v2').digest('hex'), new Date('2026-09-26T00:00:00Z')));
    expect((await checkSignoff(project, 'deal')).join('\n')).toContain('src/rules.ts');

    await fs.writeFile(ledger, record(sha, new Date('2026-09-01T00:00:00Z')));
    expect((await checkSignoff(project, 'shop')).join('\n')).toContain('src/rules.ts');
  });

  it('an edit to a file only this chunk names is not covered by another chunk being built', async () => {
    const project = await sharedProject('built');
    await fs.writeFile(join(project, 'src/deal.ts'), 'deal v2, reworked without a reopen');
    expect((await checkSignoff(project, 'deal')).join('\n')).toContain('src/deal.ts');
  });

  it('a sign-off older than this one does not cover a later edit, even when its content matches', async () => {
    const project = await makeProject([
      { slug: 'shop', manifest: { 'src/rules.ts': 'rules v1' } },
      { slug: 'deal', manifest: { 'src/rules.ts': 'rules v1' } },
    ]);
    await signOff('shop', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    await fs.writeFile(join(project, 'src/rules.ts'), 'rules v2');
    await signOff('deal', { project, by: 'Jane Designer', observed: '1,2', now: LATER });
    // Put back to what only the OLDER sign-off saw: nobody signed the tree after deal's.
    await fs.writeFile(join(project, 'src/rules.ts'), 'rules v1');
    expect((await checkSignoff(project, 'deal')).join('\n')).toContain('src/rules.ts');
  });

  it('a chunk that is proposed or already verified is not "being built" and covers nothing', async () => {
    const project = await sharedProject('proposed');
    await fs.writeFile(join(project, 'src/rules.ts'), 'rules v2');
    expect((await checkSignoff(project, 'deal')).join('\n')).toContain('src/rules.ts');
  });

  it('a design file named with its design/ prefix (a ledger close writes) is not code', async () => {
    const project = await makeProject([{ slug: 'deal', manifest: { 'src/deal.ts': 'v1' } }]);
    await fs.writeFile(join(project, DESIGN_DIR, 'ASSETS.md'), '# Assets\n');
    const text = await readChunk(project, 'deal');
    await fs.writeFile(chunkPath(project, 'deal'), text.replace('| src/deal.ts | written |', '| src/deal.ts | written |\n| design/ASSETS.md | written |'));
    await signOff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    await fs.writeFile(join(project, DESIGN_DIR, 'ASSETS.md'), '# Assets\n- a row close added\n');
    expect(await checkSignoff(project, 'deal')).toEqual([]);
    expect(Object.keys(parseSignoff(await readChunk(project, 'deal')).record!.code)).toEqual(['src/deal.ts']);
  });

  it('a sign-off with the old single whole-file hash is refused, naming the one-time transition', async () => {
    const project = await makeProject([{ slug: 'deal', manifest: { 'src/deal.ts': 'v1' } }]);
    await signOff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
    const text = await readChunk(project, 'deal');
    await fs.writeFile(
      chunkPath(project, 'deal'),
      text.replace(/^Code: .*$/m, `Code: ${'a'.repeat(64)}`),
    );
    expect(parseSignoff(await readChunk(project, 'deal')).state).toBe('whole-file');
    expect((await checkSignoff(project, 'deal')).join('\n')).toContain('boardsmith chunk-gate-transition');
  });

  it('chunk-provenance-status reports shared edits apart from the chunks without a valid sign-off', async () => {
    const project = await sharedProject('built');
    await fs.writeFile(join(project, 'src/rules.ts'), 'rules v2');
    const result = await chunkProvenanceStatusCommand({ project, quiet: true });
    expect(result.verifiedWithoutSignoff).toEqual([]);
    expect(result.signoffSharedEdits).toEqual([
      { slug: 'deal', edits: [{ path: 'src/rules.ts', coveredBy: 'shop', how: 'being-built' }] },
    ]);
  });
});

describe('recordSignoff: a sign-off is a done claim, and needs a passing boardsmith verify for HEAD (#452)', () => {
  it('refuses a chunk whose project has no verify result for the commit checked out, touching nothing', async () => {
    const project = await makeProject([{ slug: 'deal' }]);
    await recordPassingVerify(project);
    await fs.writeFile(join(project, 'src-change.ts'), 'export const more = 1;\n');
    await commitWithoutVerify(project);
    const before = await readChunk(project, 'deal');
    await expect(signOffUnverified(project)).rejects.toThrow(/No `boardsmith verify` result for the current commit.*Run `boardsmith verify`/s);
    expect(await readChunk(project, 'deal')).toBe(before);
  });

  it('refuses while the working tree has uncommitted changes, even when HEAD passed', async () => {
    const project = await makeProject([{ slug: 'deal' }]);
    await recordPassingVerify(project);
    await fs.writeFile(join(project, 'notes.md'), 'not committed\n');
    await expect(signOffUnverified(project)).rejects.toThrow(/uncommitted changes.*boardsmith verify/s);
  });

  it('refuses a project that is not a git repository, saying how to get a result', async () => {
    const project = await makeProject([{ slug: 'deal' }]);
    await expect(signOffUnverified(project)).rejects.toThrow(/not a git repository.*boardsmith verify/s);
  });
});

function signOffUnverified(project: string): Promise<unknown> {
  return recordSignoff('deal', { project, by: 'Jane Designer', observed: '1,2', now: NOW });
}

async function commitWithoutVerify(project: string): Promise<void> {
  commitAll(project, 'more work, not verified');
}
