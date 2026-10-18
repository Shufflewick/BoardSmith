import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { requireGameProject } from '../lib/game-project.js';
import { sha256Hex } from '../lib/hash.js';
import { openMutantCache } from '../lib/mutant-cache.js';
import { MUTATION_EQUIVALENCES, parseEquivalences, type EquivalentMutant } from '../lib/mutation-equivalences.js';
import { checkoutState } from '../lib/verify-result.js';
import { collectMutants, observeMutant } from './test-step-mutation.js';
import { changedSince, runBase, verifiableCommit } from './verify.js';

async function requireUnchangedContext(projectDir: string, commit: string, mutant: { file: string; source: string }, id: string): Promise<void> {
  const after = await checkoutState(projectDir);
  const current = await openMutantCache(projectDir);
  if ('problem' in after || !after.clean || after.commit !== commit || current.fingerprint(mutant) !== id) {
    throw new Error('The source or execution context changed during preparation. Commit your work and prepare the review again.');
  }
}

/** Prepares evidence for a reviewer's signed commit; it grants no approval itself. */
export async function mutationEquivalenceCommand(id: string, options: {
  project?: string; base?: string; contract: string; proof: string;
}): Promise<void> {
  const projectDir = resolve(options.project ?? process.cwd());
  requireGameProject(projectDir);
  if (!options.contract.trim() || !options.proof.trim()) throw new Error('Provide both a nonempty valid-input --contract and a complete equivalence --proof.');
  const commit = await verifiableCommit(projectDir);
  const cache = await openMutantCache(projectDir);
  if (cache.unavailable) throw new Error(`Equivalence cannot be bound to this execution context: ${cache.unavailable}. Fix it, then retry.`);
  const base = await runBase(projectDir, options);
  const mutants = await collectMutants(projectDir, (await changedSince(projectDir, base.commit)).code);
  const matches = mutants.filter((mutant) => cache.fingerprint(mutant) === id);
  if (matches.length !== 1) throw new Error('That mutant ID does not identify one current mutation. Run `boardsmith verify` again and use its ID with the same --base.');
  const mutant = matches[0];
  const outcome = await observeMutant(projectDir, mutant);
  if (outcome !== 'survived') {
    const why = { killed: 'was killed by the suite', 'timed-out': 'timed out', unreached: `is in ${mutant.file}, which no test loads` }[outcome];
    throw new Error(`The selected mutant ${why}. Only a normally completed survivor can receive an equivalence review.`);
  }
  await requireUnchangedContext(projectDir, commit, mutant, id);
  const record: EquivalentMutant = {
    id, file: mutant.file, line: mutant.line, description: mutant.description,
    originalSourceHash: sha256Hex(await fs.readFile(mutant.absPath)), mutantSourceHash: sha256Hex(mutant.source),
    change: mutant.change, contract: options.contract.trim(), proof: options.proof.trim(),
  };
  const path = join(projectDir, MUTATION_EQUIVALENCES);
  const existing = await fs.readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  const entries = existing === undefined ? [] : parseEquivalences(existing);
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify({ format: 1, entries: [...entries.filter((entry) => entry.id !== id), record] }, null, 2)}\n`);
  console.log(`Prepared ${MUTATION_EQUIVALENCES} for ${mutant.file}:${mutant.line}: ${mutant.description}.`);
  console.log(`At source offset ${mutant.change.offset}: ${JSON.stringify(mutant.change.before)} -> ${JSON.stringify(mutant.change.after)}.`);
  console.log('A reviewer must inspect the exact mutation, valid-input contract and proof, then commit the ledger with `git commit -S`. Run `boardsmith verify` again with the same --base.');
}
