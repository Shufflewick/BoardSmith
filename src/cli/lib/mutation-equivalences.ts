import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { gitOutput as git } from './git-output.js';
import { sha256Hex } from './hash.js';
import type { MutantCache } from './mutant-cache.js';

export const MUTATION_EQUIVALENCES = 'design/MUTATION-EQUIVALENCES.json';

export interface EquivalentMutant {
  id: string;
  file: string;
  line: number;
  description: string;
  originalSourceHash: string;
  mutantSourceHash: string;
  contract: string;
  proof: string;
  change: { offset: number; before: string; after: string };
}

export interface EquivalenceBasis {
  ledgerHash: string;
  reviewCommit: string;
  reviewer: string;
  signerFingerprint: string;
  ids: string[];
}

export interface EquivalenceReview {
  records: EquivalentMutant[];
  basis: Omit<EquivalenceBasis, 'ids'>;
}

const AGAIN = `Review the valid-input contract and proof in ${MUTATION_EQUIVALENCES}, commit that file with \`git commit -S\` using a trusted reviewer key, then run \`boardsmith verify\` again.`;
const HASH = /^[a-f0-9]{64}$/;

function validChange(change: EquivalentMutant['change']): boolean {
  return change && Number.isInteger(change.offset) && change.offset >= 0 &&
    typeof change.before === 'string' && typeof change.after === 'string' && change.before !== change.after;
}

function validRecord(value: unknown): value is EquivalentMutant {
  if (!value || typeof value !== 'object') return false;
  const record = value as EquivalentMutant;
  const hashes = (['id', 'originalSourceHash', 'mutantSourceHash'] as const).every((key) => typeof record[key] === 'string' && HASH.test(record[key]));
  const words = (['file', 'description', 'contract', 'proof'] as const).every((key) => typeof record[key] === 'string' && record[key].trim() !== '');
  return hashes && words && validChange(record.change) && Number.isInteger(record.line) && record.line >= 1;
}

/** The persisted ledger is untrusted input, including when a valid signature covers it. */
export function parseEquivalences(text: string): EquivalentMutant[] {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error(`${MUTATION_EQUIVALENCES} is not valid JSON. ${AGAIN}`); }
  const ledger = value as { format?: unknown; entries?: unknown } | null;
  if (!ledger || ledger.format !== 1 || !Array.isArray(ledger.entries)) {
    throw new Error(`${MUTATION_EQUIVALENCES} needs format 1 and an entries array. ${AGAIN}`);
  }
  const ids = new Set<string>();
  return ledger.entries.map((entry: unknown) => {
    if (!validRecord(entry) || ids.has(entry.id)) {
      throw new Error(`${MUTATION_EQUIVALENCES} has an incomplete or duplicate entry. Each mutant needs its exact ID, source hashes, location, valid-input contract and equivalence proof. ${AGAIN}`);
    }
    ids.add(entry.id);
    return entry;
  });
}

/** Git's external trust configuration authenticates the reviewer; the CLI never supplies trust. */
export async function readEquivalenceReview(projectDir: string): Promise<EquivalenceReview | undefined> {
  const path = join(projectDir, MUTATION_EQUIVALENCES);
  const stat = await fs.lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (stat === undefined) return undefined;
  if (!stat.isFile()) throw new Error(`${MUTATION_EQUIVALENCES} must be a regular tracked file. ${AGAIN}`);
  const text = await fs.readFile(path, 'utf8');
  const records = parseEquivalences(text);
  return { records, basis: await verifyLedgerCommit(projectDir, text) };
}

async function verifyLedgerCommit(projectDir: string, text: string): Promise<EquivalenceReview['basis']> {
  let commit: string;
  let signature: string[];
  try {
    commit = (await git(projectDir, ['log', '-1', '--format=%H', 'HEAD', '--', MUTATION_EQUIVALENCES])).trim();
    if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('no committed review');
    const prefix = (await git(projectDir, ['rev-parse', '--show-prefix'])).trim();
    if (await git(projectDir, ['show', `${commit}:${prefix}${MUTATION_EQUIVALENCES}`]) !== text ||
        await git(projectDir, ['show', `HEAD:${prefix}${MUTATION_EQUIVALENCES}`]) !== text) throw new Error('the signed blob differs');
    await git(projectDir, ['-c', 'gpg.minTrustLevel=fully', 'verify-commit', commit]);
    signature = (await git(projectDir, ['-c', 'gpg.minTrustLevel=fully', 'show', '-s', '--format=%G?%x00%GT%x00%GS%x00%GF', commit])).trim().split('\0');
  } catch {
    throw new Error(`${MUTATION_EQUIVALENCES} is not the unchanged ledger from a valid, fully trusted signed commit. ${AGAIN}`);
  }
  const [status, trust, reviewer, signerFingerprint] = signature;
  if (status !== 'G' || !['fully', 'ultimate'].includes(trust) || !reviewer || !signerFingerprint) {
    throw new Error(`${MUTATION_EQUIVALENCES}'s reviewer signature is not valid and fully trusted. ${AGAIN}`);
  }
  return { ledgerHash: sha256Hex(text), reviewCommit: commit, reviewer, signerFingerprint };
}

function completeBasis(basis: EquivalenceBasis): boolean {
  return basis && typeof basis === 'object' && Array.isArray(basis.ids) && basis.ids.length > 0;
}

/** Recheck a saved done claim after the ledger, installed code, tool or signer trust changes. */
export async function equivalenceBasisProblem(projectDir: string, basis: EquivalenceBasis, cache: MutantCache): Promise<string | undefined> {
  if (!completeBasis(basis)) {
    return 'This result has an incomplete equivalent-mutant review. Run `boardsmith verify` again.';
  }
  try {
    const review = await readEquivalenceReview(projectDir);
    if (!review ||
      Object.entries(review.basis).some(([key, value]) => basis[key as keyof EquivalenceBasis] !== value)) {
      return `The equivalent-mutant review used by this result changed. ${AGAIN}`;
    }
    for (const id of basis.ids) {
      const record = review.records.find((entry) => entry.id === id);
      if (!record || cache.fingerprint({ file: record.file, sourceHash: record.mutantSourceHash }) !== id) {
        return `The equivalent-mutant review no longer covers the current source, tests or installed tools. ${AGAIN}`;
      }
    }
  } catch (error) {
    return (error as Error).message;
  }
  return undefined;
}
