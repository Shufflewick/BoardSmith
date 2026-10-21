/**
 * Signed equivalent-mutant dispositions (#713): what a signed equivalence does to verification.
 * The equivalence tests are split across two files so they run side by side (#1319).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { sha256Hex } from '../lib/hash.js';
import { openMutantCache } from '../lib/mutant-cache.js';
import { verifiedProblem, verifyResultPath, writeVerifyResult } from '../lib/verify-result.js';
import { runDiffMutationCheck } from './test-step-mutation.js';
import { runVerify } from './verify.js';
import { spawnCli } from '../spawn-cli.test-helper.js';
import {
  CLASSIFIER,
  CONTRACT,
  EQUIVALENCE_LEDGER,
  PROOF,
  added,
  approveClassifier,
  checks,
  equivalenceProject,
} from './mutation-equivalence.test-helper.js';

afterEach(() => vi.unstubAllEnvs());
vi.setConfig({ testTimeout: 120_000 });

describe('signed equivalent-mutant dispositions (#713)', () => {
  it('represents a genuinely surviving equivalent separately, reruns it, and preserves raw outcomes', async () => {
    const fixture = await equivalenceProject();
    const { project, git } = fixture;
    const { id, equivalent } = await approveClassifier(fixture);
    const completed = await fs.readFile(join(project, '.boardsmith/completed'), 'utf8');
    const nextCache = await openMutantCache(project);
    const result = await runDiffMutationCheck({ projectDir: project, added, cache: nextCache, log: () => {} });

    expect(result.summary).toEqual({ files: 1, mutants: 3, killed: 2, survived: 0, timedOut: 0, equivalent: 1, unreached: 0 });
    expect(result.survivors).toEqual([]);
    expect(result.reused).toBe(2);
    expect(result).toMatchObject({ equivalents: [{ id, reviewer: 'reviewer@example.test', reviewCommit: git('rev-parse', 'HEAD') }] });
    expect((await fs.readFile(join(project, '.boardsmith/completed'), 'utf8')).slice(completed.length)).toBe('1212');
    expect(nextCache.get(equivalent)).toBe('survived');
    expect(await fs.readFile(join(project, 'src/classify.ts'), 'utf8')).toBe(CLASSIFIER);
  });

  it('reports reviewed equivalence truthfully and revokes saved verification when reviewer trust changes', async () => {
    const fixture = await equivalenceProject();
    await approveClassifier(fixture);
    const { result } = await runVerify({ projectDir: fixture.project, base: fixture.base, checks, log: () => {} });
    const mutation = result.checks.find((c) => c.name === 'mutation')!;
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(mutation.summary).toMatch(/2.*killed.*1.*equivalent/i);
    expect(mutation.summary).not.toMatch(/every.*made a test fail/i);
    expect(await verifiedProblem(fixture.project)).toBeUndefined();
    await fs.writeFile(verifyResultPath(fixture.project, result.commit), JSON.stringify(result, (key, value) => key === 'equivalence' ? null : key === 'equivalent' ? 0 : value));
    expect(await verifiedProblem(fixture.project)).toEqual(expect.stringMatching(/incomplete equivalent-mutant review.*boardsmith verify/));
    await writeVerifyResult(fixture.project, result);
    await fs.writeFile(fixture.allowed, '');
    expect(await verifiedProblem(fixture.project)).toEqual(expect.stringMatching(/trusted.*review|review.*trusted/i));
    await expect(runDiffMutationCheck({ projectDir: fixture.project, added, cache: await openMutantCache(fixture.project), log: () => {} })).rejects.toThrow(/trusted.*signed commit/);
  });

  it('prepares an exact reviewable mutation only after the real baseline and mutant both finish green', async () => {
    const fixture = await equivalenceProject();
    const { project, base } = fixture;
    const result = await runDiffMutationCheck({ projectDir: project, added, cache: await openMutantCache(project), log: () => {} });
    const completed = await fs.readFile(join(project, '.boardsmith/completed'), 'utf8');
    const run = await spawnCli(['mutation-equivalence', result.survivors[0].id!, '--project', project, '--base', base, '--contract', CONTRACT, '--proof', PROOF], project);
    expect(run, run.stderr).toMatchObject({ code: 0 });
    const ledger = JSON.parse(await fs.readFile(join(project, EQUIVALENCE_LEDGER), 'utf8'));
    expect(ledger.entries).toEqual([expect.objectContaining({
      contract: CONTRACT, proof: PROOF, originalSourceHash: sha256Hex(CLASSIFIER),
      change: { offset: CLASSIFIER.indexOf('<'), before: '<', after: '<=' },
    })]);
    expect((await fs.readFile(join(project, '.boardsmith/completed'), 'utf8')).slice(completed.length)).toBe('1212');
    expect(run.stdout).toMatch(/review.*git commit -S/is);
    await expect(runDiffMutationCheck({ projectDir: project, added, cache: await openMutantCache(project), log: () => {} })).rejects.toThrow(/trusted.*signed commit/);
  });

  it('still fails verification for meaningful survivors alongside a signed equivalent', async () => {
    const fixture = await equivalenceProject({ 'src/unchecked.ts': 'export function fee(price: number): number {\n  return price * 2;\n}\n' });
    await approveClassifier(fixture);
    const { result } = await runVerify({ projectDir: fixture.project, base: fixture.base, checks, log: () => {} });
    const mutation = result.checks.find((c) => c.name === 'mutation')!;
    expect(mutation).toMatchObject({ passed: false, counts: { mutants: 6, killed: 2, equivalent: 1, survived: 3, timedOut: 0 } });
    expect(mutation.findings).toHaveLength(3);
    expect(mutation.findings!.every((finding) => finding.file === 'src/unchecked.ts')).toBe(true);
    expect(await verifiedProblem(fixture.project)).toEqual(expect.stringMatching(/3 of 6 mutants.*survived/));
  });

  it('rejects tampered working bytes and an unsigned ledger-changing commit', async () => {
    const fixture = await equivalenceProject();
    const { ledger } = await approveClassifier(fixture);
    ledger.entries[0].proof += ' Reviewed additional context.';
    await fs.writeFile(join(fixture.project, EQUIVALENCE_LEDGER), JSON.stringify(ledger));
    const run = async () => runDiffMutationCheck({ projectDir: fixture.project, added, cache: await openMutantCache(fixture.project), log: () => {} });
    await expect(run()).rejects.toThrow(/unchanged ledger.*trusted signed commit/);
    fixture.git('add', EQUIVALENCE_LEDGER);
    fixture.git('commit', '-qm', 'an unsigned review is insufficient');
    await expect(run()).rejects.toThrow(/trusted signed commit/);
  });
});
