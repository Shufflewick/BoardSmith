import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { sha256Hex } from '../lib/hash.js';
import { openMutantCache } from '../lib/mutant-cache.js';
import { verifiedProblem, verifyResultPath, writeVerifyResult } from '../lib/verify-result.js';
import { generateMutants, runDiffMutationCheck } from './test-step-mutation.js';
import { VERIFY_CHECKS, runVerify } from './verify.js';
import { spawnCli } from '../spawn-cli.test-helper.js';
import { mutationEquivalenceCommand } from './mutation-equivalence.js';
import { CLASSIFIER, CONTRACT, EQUIVALENCE_LEDGER, PROOF, equivalenceProject } from './mutation-equivalence.test-helper.js';

afterEach(() => vi.unstubAllEnvs());
vi.setConfig({ testTimeout: 120_000 });

const added = new Map([['src/classify.ts', new Set([1, 2, 3, 4])]]);

async function approveClassifier(fixture: Awaited<ReturnType<typeof equivalenceProject>>) {
  const { project, git } = fixture;
  const cache = await openMutantCache(project);
  const before = await runDiffMutationCheck({ projectDir: project, added, cache, log: () => {} });
  expect(before.summary).toMatchObject({ mutants: 3, killed: 2, survived: 1, timedOut: 0 });
  expect(before.survivors[0]).toHaveProperty('id', expect.stringMatching(/^[a-f0-9]{64}$/));
  await cache.save();
  const id = before.survivors[0].id!;
  const equivalent = generateMutants('src/classify.ts', CLASSIFIER, added.get('src/classify.ts')!).find((m) => m.description === '< -> <=')!;
  const ledger = { format: 1, entries: [{
    id, file: equivalent.file, line: equivalent.line, description: equivalent.description,
    originalSourceHash: sha256Hex(CLASSIFIER), mutantSourceHash: sha256Hex(equivalent.source), contract: CONTRACT, proof: PROOF,
    change: { offset: CLASSIFIER.indexOf('<'), before: '<', after: '<=' },
  }] };
  await fs.mkdir(join(project, 'design'));
  await fs.writeFile(join(project, EQUIVALENCE_LEDGER), JSON.stringify(ledger));
  git('add', EQUIVALENCE_LEDGER);
  git('commit', '-S', '-q', '-m', 'review complete legal domain and equivalence proof');
  return { id, equivalent, ledger };
}

const checks = {
  ...VERIFY_CHECKS,
  typecheck: async () => ({ passed: true, summary: 'outside this mutation fixture' }),
  build: async () => ({ passed: true, summary: 'outside this mutation fixture' }),
  validate: async () => ({ passed: true, summary: 'outside this mutation fixture' }),
  smoke: async () => ({ passed: true, summary: 'outside this mutation fixture' }),
};

describe('signed equivalent-mutant dispositions (#713)', () => {
  it('represents a genuinely surviving equivalent separately, reruns it, and preserves raw outcomes', async () => {
    const fixture = await equivalenceProject();
    const { project, git } = fixture;
    const { id, equivalent } = await approveClassifier(fixture);
    const completed = await fs.readFile(join(project, '.boardsmith/completed'), 'utf8');
    const nextCache = await openMutantCache(project);
    const result = await runDiffMutationCheck({ projectDir: project, added, cache: nextCache, log: () => {} });

    expect(result.summary).toEqual({ files: 1, mutants: 3, killed: 2, survived: 0, timedOut: 0, equivalent: 1 });
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

  it('rejects incomplete proof records and duplicate mutant identities, even when signed', async () => {
    const fixture = await equivalenceProject();
    const { ledger } = await approveClassifier(fixture);
    const record = ledger.entries[0];
    for (const entries of [[{ ...record, contract: '' }], [{ ...record, proof: '  ' }], [record, record], [{ ...record, mutantSourceHash: 'wrong' }]]) {
      await fs.writeFile(join(fixture.project, EQUIVALENCE_LEDGER), JSON.stringify({ format: 1, entries }));
      fixture.git('add', EQUIVALENCE_LEDGER);
      fixture.git('commit', '-S', '-q', '-m', 'invalid signed record');
      await expect(runDiffMutationCheck({ projectDir: fixture.project, added, cache: await openMutantCache(fixture.project), log: () => {} })).rejects.toThrow(/incomplete or duplicate entry/);
    }
  });

  it('leaves stale source approvals unresolved and rejects saved results after the installed context changes', async () => {
    const fixture = await equivalenceProject();
    await approveClassifier(fixture);
    await runVerify({ projectDir: fixture.project, base: fixture.base, checks, log: () => {} });
    expect(await verifiedProblem(fixture.project)).toBeUndefined();
    const install = join(fixture.project, 'node_modules/.package-lock.json');
    const original = await fs.readFile(install, 'utf8');
    await fs.unlink(install);
    await fs.writeFile(install, `${original}\n`);
    expect(await verifiedProblem(fixture.project)).toEqual(expect.stringMatching(/no longer covers.*installed tools/));
    await fs.writeFile(install, original);
    await fs.writeFile(join(fixture.project, 'src/classify.ts'), `${CLASSIFIER}// source context changed\n`);
    fixture.git('add', 'src/classify.ts');
    fixture.git('commit', '-qm', 'change the reviewed source');
    const result = await runDiffMutationCheck({ projectDir: fixture.project, added, cache: await openMutantCache(fixture.project), log: () => {} });
    expect(result.summary).toMatchObject({ killed: 2, equivalent: 0, survived: 1 });
  });

  it('refuses preparation when the generated control is killed or the complete baseline fails', async () => {
    const fixture = await equivalenceProject();
    const different = generateMutants('src/classify.ts', CLASSIFIER, added.get('src/classify.ts')!).find((m) => m.description === '1.5 -> 2.5')!;
    const prepare = async () => mutationEquivalenceCommand((await openMutantCache(fixture.project)).fingerprint(different)!, {
      project: fixture.project, base: fixture.base, contract: CONTRACT, proof: PROOF,
    });
    await expect(prepare()).rejects.toThrow(/was killed.*normally completed survivor/);
    await fs.appendFile(join(fixture.project, 'tests/classify.test.ts'), "it('an unrelated regression', () => expect(true).toBe(false));\n");
    fixture.git('add', 'tests/classify.test.ts');
    fixture.git('commit', '-qm', 'an unrelated baseline failure');
    await expect(prepare()).rejects.toThrow(/complete baseline is not green.*unrelated regression/);
    await expect(fs.access(join(fixture.project, EQUIVALENCE_LEDGER))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a timed-out candidate instead of preparing an equivalent approval', async () => {
    const fixture = await equivalenceProject({
      'tests/classify.test.ts': `import { it, expect } from 'vitest';
import { isFirstSeat } from '../src/classify';
it('finishes the full legal domain in the baseline', async () => {
  if (process.env.BOARDSMITH_MUTANT) await new Promise(() => {});
  expect(isFirstSeat(1)).toBe(true);
  expect(isFirstSeat(2)).toBe(false);
}, 120000);
`,
    });
    const equivalent = generateMutants('src/classify.ts', CLASSIFIER, added.get('src/classify.ts')!).find((m) => m.description === '< -> <=')!;
    const id = (await openMutantCache(fixture.project)).fingerprint(equivalent)!;
    await expect(mutationEquivalenceCommand(id, { project: fixture.project, base: fixture.base, contract: CONTRACT, proof: PROOF })).rejects.toThrow(/timed out.*normally completed survivor/);
    await expect(fs.access(join(fixture.project, EQUIVALENCE_LEDGER))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readdir(join(fixture.project, '.boardsmith'))).toEqual([]);
  });

  it('cannot approve an equivalence when a linked dependency cannot be fingerprinted', async () => {
    const fixture = await equivalenceProject();
    const { id, equivalent } = await approveClassifier(fixture);
    const dependency = join(dirname(fixture.project), 'blocked-package');
    await fs.mkdir(dependency);
    await fs.writeFile(join(dependency, 'package.json'), '{"name":"blocked-package","version":"1.0.0"}');
    await fs.symlink(dependency, join(fixture.project, 'node_modules/blocked-package'), 'dir');
    await fs.chmod(dependency, 0);
    try {
      const cache = await openMutantCache(fixture.project);
      expect(cache.unavailable).toEqual(expect.stringMatching(/could not read/));
      expect(cache.fingerprint(equivalent)).toBeUndefined();
      const run = await runDiffMutationCheck({ projectDir: fixture.project, added, cache, log: () => {} });
      expect(run.summary).toMatchObject({ equivalent: 0, survived: 1 });
      await expect(mutationEquivalenceCommand(id, { project: fixture.project, base: fixture.base, contract: CONTRACT, proof: PROOF })).rejects.toThrow(/cannot be bound.*context/);
    } finally {
      await fs.chmod(dependency, 0o755);
    }
  });
});
