import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DESIGN_DIR, GATE_TRANSITION_MD } from '../lib/project-paths.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { checkSignoff, parseSignoff, recordSignoff, recordReopen } from './chunk-signoff.js';
import { recordGateTransition } from './chunk-gate-transition.js';
import { checkClaimQuotes } from './claim-quotes.js';
import { chunkProvenanceStatusCommand } from './chunk-provenance.js';
import {
  type ChunkSpec,
  makeChunkProject,
  readChunk,
  setStatusByHand,
} from './chunk-project.test-helper.js';

/**
 * #397: chunks verified before the sign-off gate (#291) and the claim-quote gate (#289) had no way
 * through either. `boardsmith chunk-gate-transition` is the one-time, designer-recorded transition:
 * it gives each such chunk a `transition` sign-off and records which of its claims had no quote,
 * and every other path to `verified` stays exactly as strict as before.
 */

let tree: string;

beforeEach(() => {
  tree = tempTree('bs-gate-transition-');
  process.exitCode = undefined;
});

const SIGNED = new Date('2026-09-23T12:00:00Z');
const NOW = new Date('2026-09-26T09:00:00Z');
const makeProject = (chunks: ChunkSpec[]) => makeChunkProject(tree, chunks);
const chunkPath = (project: string, slug: string) => join(project, DESIGN_DIR, 'chunks', slug, 'CHUNK.md');

const OLD_CLAIMS = [
  '1. **A player draws two cards each turn.** — cites rulebook/01-turn.md §"Draw"',
  '2. **Discards are public.** — cites rulebook/01-turn.md §"Discard"',
].join('\n');

/** The whole-file hash every sign-off recorded before #396: one SHA-256 over path/hash lines. */
function wholeFileHash(files: Record<string, string>): string {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const lines = Object.keys(files)
    .sort()
    .map((path) => `${path}\t${sha(files[path])}`);
  return sha(lines.join('\n'));
}

/** Rewrites a recorded sign-off into the pre-#396 form: one `Code:` line holding `hash`. */
async function makeWholeFileSignoff(project: string, slug: string, hash: string): Promise<void> {
  const text = await readChunk(project, slug);
  const withoutCode = text.replace(/^Code: .*\n/gm, '');
  await fs.writeFile(
    chunkPath(project, slug),
    withoutCode.replace('<!-- boardsmith:signoff:end -->', `Code: ${hash}\n<!-- boardsmith:signoff:end -->`),
  );
}

describe('before the transition, the refusals name it', () => {
  it('a verified chunk made before sign-offs existed is refused, naming chunk-gate-transition', async () => {
    const project = await makeProject([{ slug: 'deal', status: 'verified', preGate: true }]);
    const problems = (await checkSignoff(project, 'deal')).join('\n');
    expect(problems).toContain('boardsmith chunk-gate-transition --by');
  });

  it('an unquoted claim of a verified chunk is refused, naming chunk-gate-transition', async () => {
    const project = await makeProject([
      { slug: 'deal', status: 'verified', preGate: true, interpretation: OLD_CLAIMS },
    ]);
    const { refusals } = await checkClaimQuotes(project, 'deal');
    expect(refusals).toHaveLength(2);
    expect(refusals.join('\n')).toContain('boardsmith chunk-gate-transition');
  });

  it('a verified chunk scaffolded WITH a sign-off section was verified under the gate: no transition is offered', async () => {
    const project = await makeProject([{ slug: 'deal' }]);
    await setStatusByHand(project, 'deal', 'verified');
    const problems = (await checkSignoff(project, 'deal')).join('\n');
    expect(problems).not.toContain('chunk-gate-transition');
    expect(problems).toContain('boardsmith chunk-signoff deal');
  });
});

describe('recordGateTransition — the one-time transition', () => {
  it('gives every pre-gate verified chunk a transition sign-off that keeps its status, and records it in the ledger', async () => {
    const project = await makeProject([
      { slug: 'deal', status: 'verified', preGate: true, manifest: { 'src/deal.ts': 'v1' } },
      { slug: 'shop', status: 'verified (user-waived)', preGate: true },
      { slug: 'later', status: 'built', preGate: true },
    ]);
    const result = await recordGateTransition({ project, by: 'Jane Designer', now: NOW });
    expect(result.transitioned.map((t) => t.slug)).toEqual(['deal', 'shop']);

    const deal = await readChunk(project, 'deal');
    expect(deal).toMatch(/^Status: verified$/m);
    expect(parseSignoff(deal).record).toMatchObject({
      basis: 'transition',
      by: 'Jane Designer',
      when: NOW.toISOString(),
      status: 'verified',
      code: { 'src/deal.ts': expect.stringMatching(/^[0-9a-f]{64}$/) },
    });
    expect(await readChunk(project, 'shop')).toMatch(/^Status: verified \(user-waived\)$/m);
    expect(await checkSignoff(project, 'deal')).toEqual([]);
    expect(await checkSignoff(project, 'shop')).toEqual([]);
    expect(parseSignoff(await readChunk(project, 'later')).state).toBe('absent');

    const ledger = await fs.readFile(join(project, DESIGN_DIR, GATE_TRANSITION_MD), 'utf-8');
    expect(ledger).toContain('- By: Jane Designer');
    expect(ledger).toContain('### deal');
    expect(ledger).toContain('### shop');
    expect(ledger).not.toContain('### later');
    expect((await chunkProvenanceStatusCommand({ project, quiet: true })).verifiedWithoutSignoff).toEqual([]);
  });

  it('keeps a whole-file sign-off whose code still matches, file by file, with its basis unchanged', async () => {
    const project = await makeProject([{ slug: 'deal', manifest: { 'src/deal.ts': 'v1' } }]);
    await recordSignoff('deal', { project, by: 'Jane Designer', observed: '1,2', now: SIGNED });
    await makeWholeFileSignoff(project, 'deal', wholeFileHash({ 'src/deal.ts': 'v1' }));

    const result = await recordGateTransition({ project, by: 'Jane Designer', now: NOW });
    expect(result.kept).toEqual([{ slug: 'deal', basis: 'designer' }]);
    expect(result.transitioned).toEqual([]);
    expect(parseSignoff(await readChunk(project, 'deal')).record).toMatchObject({
      basis: 'designer',
      by: 'Jane Designer',
      when: SIGNED.toISOString(),
      observed: [1, 2],
      code: { 'src/deal.ts': expect.stringMatching(/^[0-9a-f]{64}$/) },
    });
    expect(await checkSignoff(project, 'deal')).toEqual([]);
  });

  it('records a whole-file sign-off whose code has moved as a transition, naming the earlier sign-off', async () => {
    const project = await makeProject([
      { slug: 'deal', ui: 'none', milestone: 'none', manifest: { 'src/deal.ts': 'v1' } },
    ]);
    await recordSignoff('deal', { project, automated: 'sim pass', now: SIGNED });
    await makeWholeFileSignoff(project, 'deal', wholeFileHash({ 'src/deal.ts': 'v0' }));

    const result = await recordGateTransition({ project, by: 'Jane Designer', now: NOW });
    expect(result.transitioned).toEqual([
      expect.objectContaining({ slug: 'deal', status: 'verified', reason: expect.stringContaining(SIGNED.toISOString()) }),
    ]);
    expect(parseSignoff(await readChunk(project, 'deal')).record).toMatchObject({ basis: 'transition' });
    expect(await checkSignoff(project, 'deal')).toEqual([]);
  });

  it('does not excuse a chunk verified by hand under the gate', async () => {
    const project = await makeProject([{ slug: 'deal' }, { slug: 'old', status: 'verified', preGate: true }]);
    await setStatusByHand(project, 'deal', 'verified');
    const result = await recordGateTransition({ project, by: 'Jane Designer', now: NOW });
    expect(result.transitioned.map((t) => t.slug)).toEqual(['old']);
    expect((await checkSignoff(project, 'deal')).join('\n')).toMatch(/no designer sign-off/);
  });

  it('runs once per project', async () => {
    const project = await makeProject([{ slug: 'deal', status: 'verified', preGate: true }]);
    await recordGateTransition({ project, by: 'Jane Designer', now: NOW });
    await expect(recordGateTransition({ project, by: 'Jane Designer', now: NOW })).rejects.toThrow(
      /already recorded .*Jane Designer/,
    );
  });

  it('finishes a transition a crash interrupted, from the ledger, and never adds a chunk to it', async () => {
    const project = await makeProject([
      { slug: 'deal', status: 'verified', preGate: true },
      { slug: 'shop', status: 'verified', preGate: true },
    ]);
    await recordGateTransition({ project, by: 'Jane Designer', now: NOW });
    // As if the run died after the ledger and one chunk were written.
    const shop = await readChunk(project, 'shop');
    await fs.writeFile(chunkPath(project, 'shop'), shop.replace(/^## Sign-off\n[\s\S]*?(?=^## )/m, ''));
    expect(await checkSignoff(project, 'shop')).not.toEqual([]);

    const resumed = await recordGateTransition({ project, by: 'Jane Designer', now: new Date('2026-09-27T00:00:00Z') });
    expect(resumed.transitioned.map((t) => t.slug)).toEqual(['shop']);
    expect(await checkSignoff(project, 'shop')).toEqual([]);
    expect(parseSignoff(await readChunk(project, 'shop')).record).toMatchObject({ when: NOW.toISOString() });
  });

  it('refuses a transition recorded by the run itself', async () => {
    const project = await makeProject([{ slug: 'deal', status: 'verified', preGate: true }]);
    await expect(recordGateTransition({ project, by: 'orchestrator', now: NOW })).rejects.toThrow(/designer/i);
    await expect(fs.access(join(project, DESIGN_DIR, GATE_TRANSITION_MD))).rejects.toThrow();
  });

  it('writes nothing when no chunk needs the transition', async () => {
    const project = await makeProject([{ slug: 'deal' }]);
    const result = await recordGateTransition({ project, by: 'Jane Designer', now: NOW });
    expect(result).toMatchObject({ transitioned: [], kept: [], claims: {} });
    await expect(fs.access(join(project, DESIGN_DIR, GATE_TRANSITION_MD))).rejects.toThrow();
  });
});

describe('after the transition', () => {
  it('a transition sign-off typed into a chunk the ledger does not name is refused', async () => {
    const project = await makeProject([
      { slug: 'deal', status: 'verified', preGate: true },
      { slug: 'shop' },
    ]);
    await recordGateTransition({ project, by: 'Jane Designer', now: NOW });
    const deal = await readChunk(project, 'deal');
    const block = deal.slice(deal.indexOf('<!-- boardsmith:signoff:begin -->'), deal.indexOf('<!-- boardsmith:signoff:end -->'));
    const shop = await readChunk(project, 'shop');
    await fs.writeFile(
      chunkPath(project, 'shop'),
      shop
        .replace(/<!-- boardsmith:signoff:begin -->[\s\S]*?(?=<!-- boardsmith:signoff:end -->)/, block)
        .replace(/^Status:.*$/m, 'Status: verified'),
    );
    expect((await checkSignoff(project, 'shop')).join('\n')).toMatch(/does not name shop/);
  });

  it('a transitioned chunk that is reopened needs a real sign-off, like any other', async () => {
    const project = await makeProject([{ slug: 'deal', status: 'verified', preGate: true }]);
    await recordGateTransition({ project, by: 'Jane Designer', now: NOW });
    await recordReopen('deal', { project, reason: 'rework', now: NOW });
    await setStatusByHand(project, 'deal', 'verified');
    expect((await checkSignoff(project, 'deal')).join('\n')).toMatch(/reopened/);
  });

  it('the transition sign-off covers a later edit to a file it shares, as a later sign-off does', async () => {
    const project = await makeProject([
      { slug: 'deal', manifest: { 'src/rules.ts': 'v1' } },
      { slug: 'old', status: 'verified', preGate: true, manifest: { 'src/rules.ts': 'v1' } },
    ]);
    await recordSignoff('deal', { project, by: 'Jane Designer', observed: '1,2', now: SIGNED });
    await fs.writeFile(join(project, 'src/rules.ts'), 'v2, from the older chunk');
    await recordGateTransition({ project, by: 'Jane Designer', now: NOW });
    expect(await checkSignoff(project, 'deal')).toEqual([]);
  });

  it('claim-quote-check accepts the unquoted claims it recorded, and marks them', async () => {
    const project = await makeProject([
      { slug: 'deal', status: 'verified', preGate: true, interpretation: OLD_CLAIMS },
    ]);
    const result = await recordGateTransition({ project, by: 'Jane Designer', now: NOW });
    expect(result.claims).toEqual({ deal: [1, 2] });
    const checked = await checkClaimQuotes(project, 'deal');
    expect(checked.refusals).toEqual([]);
    expect(checked.claims.map((c) => [c.number, c.preGate])).toEqual([
      [1, true],
      [2, true],
    ]);
  });

  it('a recorded claim whose text changed, and a claim added since, each need a quote', async () => {
    const project = await makeProject([
      { slug: 'deal', status: 'verified', preGate: true, interpretation: OLD_CLAIMS },
    ]);
    await recordGateTransition({ project, by: 'Jane Designer', now: NOW });
    const edited = OLD_CLAIMS.replace('Discards are public.', 'Discards are public, and face up.');
    const text = await readChunk(project, 'deal');
    await fs.writeFile(
      chunkPath(project, 'deal'),
      text.replace(OLD_CLAIMS, `${edited}\n3. **A new claim with no quote.**`),
    );
    const refusals = (await checkClaimQuotes(project, 'deal')).refusals.join('\n');
    expect(refusals).toMatch(/Claim 2 changed since/);
    expect(refusals).toMatch(/Claim 3 has no quoted passage/);
    expect(refusals).not.toMatch(/Claim 1\b/);
    expect(refusals).not.toContain('chunk-gate-transition --by');
  });

  it('records no claims for a chunk that is not verified', async () => {
    const project = await makeProject([
      { slug: 'deal', status: 'verified', preGate: true },
      { slug: 'later', status: 'built', preGate: true, interpretation: OLD_CLAIMS },
    ]);
    const result = await recordGateTransition({ project, by: 'Jane Designer', now: NOW });
    expect(result.claims).toEqual({});
    expect((await checkClaimQuotes(project, 'later')).refusals).toHaveLength(2);
  });
});
