import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { openMutantCache } from '../lib/mutant-cache.js';
import { chunkMerge } from './chunk-merge.js';
import { type ChunkSpec, makeChunkProject } from './chunk-project.test-helper.js';
import { checkSignoff, recordReopen, recordSignoff } from './chunk-signoff.js';
import { mutationEquivalenceCommand } from './mutation-equivalence.js';
import { CLASSIFIER, CONTRACT, EQUIVALENCE_LEDGER, PROOF, equivalenceProject } from './mutation-equivalence.test-helper.js';
import { runDiffMutationCheck } from './test-step-mutation.js';
import { runVerify, VERIFY_CHECKS } from './verify.js';

vi.setConfig({ testTimeout: 120_000 });
afterEach(() => vi.unstubAllEnvs());

async function verifyAndSignoff({ project, git }: Awaited<ReturnType<typeof equivalenceProject>>, slug = 'seat') {
  const outside = async () => ({ passed: true, summary: 'outside this merge fixture' });
  const { result } = await runVerify({ projectDir: project, chunk: slug, checks: { ...VERIFY_CHECKS, typecheck: outside, build: outside, validate: outside, smoke: outside }, log: () => {} });
  expect(result.checks.find((check) => check.name === 'mutation')).toMatchObject({ passed: true, counts: { equivalent: 1 } });
  await recordSignoff(slug, { project, automated: 'tests/classify.test.ts passed' });
  git('add', `design/chunks/${slug}/CHUNK.md`, 'design/SKETCH.md');
  git('commit', '-qm', `chunk-${slug}/close`);
}

/** The merge and its suite are real; unrelated build/type/validation checks are outside this fixture. */
async function signedChunk(extra: ChunkSpec[] = []) {
  const fixture = await equivalenceProject();
  const { project, git } = fixture;
  git('commit', '--amend', '-qm', 'chunk-seat/build');
  git('checkout', '-qb', 'chunk/seat');
  await makeChunkProject(dirname(project), [{ slug: 'seat', ui: 'none', milestone: 'none', manifest: { 'src/classify.ts': CLASSIFIER } }, ...extra]);
  git('add', 'design');
  git('commit', '-qm', 'record chunk contract');
  const run = await runDiffMutationCheck({ projectDir: project, added: new Map([['src/classify.ts', new Set([3])]]), cache: await openMutantCache(project), log: () => {} });
  const id = run.survivors[0].id!;
  await mutationEquivalenceCommand(id, { project, chunk: 'seat', contract: CONTRACT, proof: PROOF });
  git('add', EQUIVALENCE_LEDGER);
  git('commit', '-S', '-q', '-m', 'review classifier equivalence');
  await verifyAndSignoff(fixture);
  return { ...fixture, id };
}

describe('equivalence-backed signoffs at the actual chunk merge boundary (#713)', () => {
  it('preserves a closed chunk through disjoint work and a signed approval append, while retaining its selected proof and trust checks', async () => {
    const fixture = await signedChunk([{ slug: 'later', ui: 'none', milestone: 'none' }]);
    const { project, git } = fixture;
    git('checkout', '-qb', 'chunk/later');
    await fs.writeFile(join(project, 'src/later.ts'), CLASSIFIER);
    await fs.writeFile(join(project, 'tests/later.test.ts'), (await fs.readFile(join(project, 'tests/classify.test.ts'), 'utf8')).replace('../src/classify', '../src/later'));
    const path = join(project, 'design/chunks/later/CHUNK.md');
    await fs.writeFile(path, (await fs.readFile(path, 'utf8')).replace('|------|--------|', '|------|--------|\n| src/later.ts | written |'));
    git('add', 'src/later.ts', 'tests/later.test.ts', 'design/chunks/later/CHUNK.md');
    git('commit', '-qm', 'chunk-later/build');
    expect(await checkSignoff(project, 'seat')).toEqual([]);

    const run = await runDiffMutationCheck({ projectDir: project, added: new Map([['src/later.ts', new Set([3])]]), cache: await openMutantCache(project), log: () => {} });
    expect(run.summary).toMatchObject({ killed: 2, survived: 1, timedOut: 0 });
    await mutationEquivalenceCommand(run.survivors[0].id!, { project, chunk: 'later', contract: CONTRACT, proof: PROOF });
    git('add', EQUIVALENCE_LEDGER);
    git('commit', '-S', '-q', '-m', 'review the later chunk equivalence');
    await verifyAndSignoff(fixture, 'later');
    expect(await checkSignoff(project, 'seat')).toEqual([]);
    expect(await checkSignoff(project, 'later')).toEqual([]);
    git('checkout', '-q', 'main');
    expect(await chunkMerge(project, 'later')).toMatchObject({ merged: true, refusals: [] });
    expect(git('status', '--porcelain')).toBe('');

    const ledgerPath = join(project, EQUIVALENCE_LEDGER);
    const original = await fs.readFile(ledgerPath, 'utf8');
    const ledger = JSON.parse(original);
    for (const entries of [ledger.entries.slice(1), ledger.entries.map((entry: { id: string; proof: string }) => entry.id === fixture.id ? { ...entry, proof: 'An unsigned replacement of the original proof.' } : entry)]) {
      await fs.writeFile(ledgerPath, JSON.stringify({ format: 1, entries }));
      git('add', EQUIVALENCE_LEDGER);
      expect((await checkSignoff(project, 'seat')).join(' ')).toMatch(/selected equivalent-mutant review was removed or changed/);
      await fs.writeFile(ledgerPath, original);
      git('add', EQUIVALENCE_LEDGER);
    }
    await fs.writeFile(fixture.allowed, '');
    expect((await checkSignoff(project, 'seat')).join(' ')).toMatch(/fully trusted/);
  });

  it.each(['removed', 'tampered', 'untrusted'] as const)('refuses and rolls back when the review is %s after signoff', async (change) => {
    const fixture = await signedChunk();
    if (change === 'removed') fixture.git('rm', EQUIVALENCE_LEDGER);
    if (change === 'tampered') {
      const path = join(fixture.project, EQUIVALENCE_LEDGER);
      await fs.writeFile(path, (await fs.readFile(path, 'utf8')).replace(PROOF, 'An unsigned replacement proof.'));
      fixture.git('add', EQUIVALENCE_LEDGER);
    }
    if (change === 'untrusted') await fs.writeFile(fixture.allowed, '');
    else fixture.git('commit', '-qm', `review ${change} after signoff`);
    fixture.git('checkout', '-q', 'main');
    const head = fixture.git('rev-parse', 'HEAD');
    const merged = await chunkMerge(fixture.project, 'seat');
    expect(merged).toMatchObject({ merged: false });
    expect(merged.refusals.join(' ')).toMatch(/equivalent-mutant review|fully trusted/);
    expect(fixture.git('rev-parse', 'HEAD')).toBe(head);
    expect(fixture.git('status', '--porcelain')).toBe('');
  });

  it('merges an unchanged reviewed context when the signed ledger is introduced only by the chunk branch', async () => {
    const fixture = await signedChunk();
    fixture.git('checkout', '-q', 'main');
    await expect(fs.stat(join(fixture.project, EQUIVALENCE_LEDGER))).rejects.toThrow();
    const merged = await chunkMerge(fixture.project, 'seat');
    expect(merged).toMatchObject({ merged: true, refusals: [] });
    expect(fixture.git('status', '--porcelain')).toBe('');
    expect(await fs.readFile(join(fixture.project, EQUIVALENCE_LEDGER), 'utf8')).toContain(PROOF);
  });

  it('refuses and rolls back a combined staged source context that the review did not cover', async () => {
    const fixture = await signedChunk();
    fixture.git('checkout', '-q', 'main');
    await fs.writeFile(join(fixture.project, 'src/new-runtime.ts'), 'export const runtime = 1;\n');
    fixture.git('add', 'src/new-runtime.ts');
    fixture.git('commit', '-qm', 'extend main runtime after the review');
    const head = fixture.git('rev-parse', 'HEAD');
    const merged = await chunkMerge(fixture.project, 'seat');
    expect(merged).toMatchObject({ merged: false });
    expect(merged.refusals.join(' ')).toMatch(/no longer covers the current source/);
    expect(merged.refusals.join(' ')).toMatch(/rebase.*current main/i);
    expect(fixture.git('rev-parse', 'HEAD')).toBe(head);
    expect(fixture.git('status', '--porcelain')).toBe('');
  });

  it('checks the final alongside ledger write and permits retry after rebasing onto current main', async () => {
    const fixture = await signedChunk();
    fixture.git('checkout', '-q', 'main');
    const other = 'design/chunks/other/CHUNK.md';
    await fs.mkdir(join(fixture.project, 'design/chunks/other'), { recursive: true });
    await fs.writeFile(join(fixture.project, other), 'Status: built\n');
    fixture.git('add', other);
    fixture.git('commit', '-qm', 'Merge chunk other (chunk/other)');
    const head = fixture.git('rev-parse', 'HEAD');
    const merged = await chunkMerge(fixture.project, 'seat');
    expect(merged).toMatchObject({ merged: false });
    expect(merged.refusals.join(' ')).toMatch(/no longer covers the current source/);
    expect(fixture.git('rev-parse', 'HEAD')).toBe(head);
    expect(fixture.git('status', '--porcelain')).toBe('');
    await expect(fs.stat(join(fixture.project, 'design/CROSS-CHUNK.md'))).rejects.toThrow();

    fixture.git('checkout', '-q', 'chunk/seat');
    fixture.git('rebase', 'main');
    await recordReopen('seat', { project: fixture.project, reason: 'Review the rebased execution context.' });
    fixture.git('add', 'design/chunks/seat/CHUNK.md', 'design/SKETCH.md');
    fixture.git('commit', '-qm', 'chunk-seat/reopen');
    await mutationEquivalenceCommand(fixture.id, { project: fixture.project, chunk: 'seat', contract: CONTRACT, proof: `${PROOF} Reviewed again after rebasing onto current main.` });
    fixture.git('add', EQUIVALENCE_LEDGER);
    fixture.git('commit', '-S', '-q', '-m', 'review the rebased equivalence');
    await verifyAndSignoff(fixture);
    fixture.git('checkout', '-q', 'main');
    expect(await chunkMerge(fixture.project, 'seat')).toMatchObject({ merged: true, refusals: [] });
    expect(fixture.git('status', '--porcelain')).toBe('');
  });
});
