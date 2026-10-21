/**
 * Signed equivalent-mutant dispositions (#713): the records and candidates an equivalence refuses.
 * The equivalence tests are split across two files so they run side by side (#1319).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { openMutantCache } from '../lib/mutant-cache.js';
import { verifiedProblem } from '../lib/verify-result.js';
import { generateMutants, runDiffMutationCheck } from './test-step-mutation.js';
import { runVerify } from './verify.js';
import { mutationEquivalenceCommand } from './mutation-equivalence.js';
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

  it('refuses a mutant in a file no test loads, naming the file', async () => {
    const fixture = await equivalenceProject({ 'src/unloaded.ts': 'export function fee(price: number): number {\n  return price * 2;\n}\n' });
    // Node's permission model refuses node:inspector, so under it no test file has a record and every one runs for every mutant.
    vi.stubEnv('NODE_OPTIONS', '');
    const mutant = generateMutants('src/unloaded.ts', 'export function fee(price: number): number {\n  return price * 2;\n}\n', new Set([2]))[0];
    const id = (await openMutantCache(fixture.project)).fingerprint(mutant)!;
    await expect(mutationEquivalenceCommand(id, { project: fixture.project, base: fixture.base, contract: CONTRACT, proof: PROOF }))
      .rejects.toThrow('The selected mutant is in src/unloaded.ts, which no test loads. Only a normally completed survivor can receive an equivalence review.');
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
