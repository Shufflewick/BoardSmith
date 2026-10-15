import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { gitOutput as git } from './git-output.js';
import { sha256Hex } from './hash.js';
import type { MutationFingerprints } from './mutant-cache.js';

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
const UNTRUSTED = `${MUTATION_EQUIVALENCES} is not the unchanged ledger from a valid, fully trusted signed commit. ${AGAIN}`;
const INCOMPLETE = 'This result has an incomplete equivalent-mutant review. Run `boardsmith verify` again.';

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

async function readLedger(projectDir: string): Promise<{ text: string; records: EquivalentMutant[] } | undefined> {
  const path = join(projectDir, MUTATION_EQUIVALENCES);
  const stat = await fs.lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (stat === undefined) return undefined;
  if (!stat.isFile()) throw new Error(`${MUTATION_EQUIVALENCES} must be a regular tracked file. ${AGAIN}`);
  const text = await fs.readFile(path, 'utf8');
  return { text, records: parseEquivalences(text) };
}

/** Git's external trust configuration authenticates the reviewer; the CLI never supplies trust. */
export async function readEquivalenceReview(projectDir: string, pinnedCommit?: string): Promise<EquivalenceReview | undefined> {
  const ledger = await readLedger(projectDir);
  if (!ledger) return undefined;
  return { records: ledger.records, basis: await verifyLedgerCommit(projectDir, ledger.text, pinnedCommit) };
}

async function ledgerBlob(projectDir: string, ref: string): Promise<string> {
  const prefix = (await git(projectDir, ['rev-parse', '--show-prefix'])).trim();
  return git(projectDir, ['show', `${ref}:${prefix}${MUTATION_EQUIVALENCES}`]);
}

async function requireLedgerBlob(projectDir: string, text: string, refs: string[]): Promise<void> {
  for (const ref of refs) if (await ledgerBlob(projectDir, ref) !== text) throw new Error(UNTRUSTED);
}

function requireReviewCommit(commit: string): void {
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error(UNTRUSTED);
}

async function verifyLedgerCommit(projectDir: string, text: string, pinnedCommit?: string): Promise<EquivalenceReview['basis']> {
  let commit: string;
  try {
    commit = pinnedCommit ?? (await git(projectDir, ['log', '-1', '--format=%H', 'HEAD', '--', MUTATION_EQUIVALENCES])).trim();
    requireReviewCommit(commit);
    await requireLedgerBlob(projectDir, text, [commit, pinnedCommit ? '' : 'HEAD']);
  } catch {
    throw new Error(UNTRUSTED);
  }
  return verifyLedgerSignature(projectDir, text, commit);
}

async function verifyLedgerSignature(projectDir: string, text: string, commit: string): Promise<EquivalenceReview['basis']> {
  let signature: string[];
  try {
    await git(projectDir, ['-c', 'gpg.minTrustLevel=fully', 'verify-commit', commit]);
    signature = (await git(projectDir, ['-c', 'gpg.minTrustLevel=fully', 'show', '-s', '--format=%G?%x00%GT%x00%GS%x00%GF', commit])).trim().split('\0');
  } catch {
    throw new Error(UNTRUSTED);
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

function matchesBasis(review: EquivalenceReview, basis: EquivalenceBasis): boolean {
  return Object.entries(review.basis).every(([key, value]) => basis[key as keyof EquivalenceBasis] === value);
}

async function pinnedReview(projectDir: string, basis: EquivalenceBasis): Promise<EquivalenceReview> {
  requireReviewCommit(basis.reviewCommit);
  const text = await ledgerBlob(projectDir, basis.reviewCommit);
  return { records: parseEquivalences(text), basis: await verifyLedgerSignature(projectDir, text, basis.reviewCommit) };
}

/** Closed chunks retain what was reviewed then; later work is covered by the normal code sign-offs. */
export async function historicalEquivalenceProblem(projectDir: string, basis: EquivalenceBasis): Promise<string | undefined> {
  if (!completeBasis(basis)) return INCOMPLETE;
  try {
    const reviewed = await pinnedReview(projectDir, basis);
    const current = await readLedger(projectDir);
    if (!matchesBasis(reviewed, basis) || !current) return `The equivalent-mutant review used by this sign-off changed. ${AGAIN}`;
    await requireLedgerBlob(projectDir, current.text, ['']);
    for (const id of basis.ids) {
      const record = reviewed.records.find((entry) => entry.id === id);
      if (!record || !isDeepStrictEqual(record, current.records.find((entry) => entry.id === id))) {
        return `A selected equivalent-mutant review was removed or changed after sign-off. ${AGAIN}`;
      }
    }
  } catch (error) {
    return (error as Error).message;
  }
  return undefined;
}

/** Recheck a saved done claim after the ledger, installed code, tool or signer trust changes. */
export async function equivalenceBasisProblem(projectDir: string, basis: EquivalenceBasis, cache: MutationFingerprints): Promise<string | undefined> {
  if (!completeBasis(basis)) return INCOMPLETE;
  try {
    const review = await readEquivalenceReview(projectDir, basis.reviewCommit);
    if (!review || !matchesBasis(review, basis)) {
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
