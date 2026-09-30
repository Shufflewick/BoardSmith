import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_REVISION } from '../../contract/index.js';
import { readBoardsmithVersion } from './boardsmith-version.js';
import { gitOutput as git } from './git-output.js';

/**
 * The outcomes of `boardsmith verify`'s mutants, kept so a re-verify runs only the mutants whose
 * outcome could have changed (#452).
 *
 * The bs- skills verify a chunk several times: at the end of `test`, before the designer's
 * sign-off, and as the last step of `close`. Between those runs they commit only design records
 * (the sign-off, the verified hash, the ledgers, the run log). Each run still does the full suite,
 * typecheck, build and validate for the commit it is on; this cache spares only the mutants.
 *
 * An outcome is stored under a key made of everything the whole-suite run under that mutant could
 * depend on:
 *
 * - the mutant: its file and the file's whole mutated text;
 * - every file of the project in the commit, by content, except `BOOKKEEPING_RECORDS`. That covers
 *   the other code, every test, the configs and `package-lock.json` (the installed packages);
 * - the BoardSmith that ran it (`toolRevision`), and the Node version.
 *
 * So a commit that changes nothing but bookkeeping reuses every outcome, and any other change,
 * however small, runs every mutant again. A mutant that ran past its time limit is never stored: on
 * a busy machine that can be the load, not the mutant, so it is tried again next time.
 *
 * The cache is `.boardsmith/verify/mutants.json`, out of git like the results. `save` writes only
 * the outcomes the run looked up or recorded, so the file holds one run's worth and never grows.
 * `boardsmith verify` saves only when the tree stayed clean for the whole run, since the key is
 * computed from the commit and would not describe files edited mid-run.
 */

const CACHE_FORMAT = 1;

type CachedOutcome = 'killed' | 'survived';

/** A mutant as the cache sees it: which project file, and that file's whole mutated text. */
interface MutantText {
  file: string;
  source: string;
}

/**
 * The design records the bs- skills commit after a chunk's code and tests have been verified: the
 * sign-off and close bookkeeping in CHUNK.md, SKETCH.md and the ledgers, and the orchestrator's
 * run journal and run logs. Paths are relative to the project. Everything else in `design/` stays
 * in the key: a test may read `DESIGN.md` or a rulebook slice, and evidence can be a script.
 */
export const BOOKKEEPING_RECORDS: readonly RegExp[] = Object.freeze([
  /^design\/(SKETCH|DECISIONS|RULINGS|QUESTIONS|FILINGS|ASSETS|RUN|MERGE-SIGNOFFS|GATE-TRANSITION)\.md$/,
  /^design\/chunks\/[^/]+\/CHUNK\.md$/,
  /^design\/run-log\/[^/]+\.md$/,
]);

const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

/**
 * The BoardSmith at `root`. An installed copy is named by its version and engine revision. A git
 * checkout (as a game linked to a local BoardSmith has) is also named by its commit and by the
 * content of its uncommitted and untracked changes, so editing BoardSmith is a new revision.
 */
export async function toolRevision(root: string): Promise<string> {
  const release = `boardsmith@${readBoardsmithVersion()} engine ${ENGINE_REVISION}`;
  let top: string;
  try {
    top = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    return release;
  }
  const [realTop, realRoot] = await Promise.all([fs.realpath(top), fs.realpath(root)]);
  if (realTop !== realRoot) return release;

  const commit = (await git(root, ['rev-parse', 'HEAD'])).trim();
  const hash = createHash('sha256');
  hash.update(await git(root, ['diff', '--binary', '--no-ext-diff', 'HEAD', '--']));
  const untracked = (await git(root, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean).sort();
  for (const path of untracked) {
    hash.update(`\0${path}\0`);
    hash.update(await fs.readFile(join(root, path)));
  }
  return `${release} ${commit} ${hash.digest('hex')}`;
}

/** The content of every file in the project at HEAD except the bookkeeping records. */
async function projectTreeHash(projectDir: string): Promise<string> {
  const listing = await git(projectDir, ['ls-tree', '-r', '-z', 'HEAD', '--', '.']);
  const entries = listing
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      return { object: line.slice(0, tab), path: line.slice(tab + 1) };
    })
    .filter(({ path }) => !BOOKKEEPING_RECORDS.some((re) => re.test(path)))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sha256(entries.map(({ object, path }) => `${object}\t${path}`).join('\0'));
}

export function mutantCachePath(projectDir: string): string {
  return join(projectDir, '.boardsmith', 'verify', 'mutants.json');
}

async function readEntries(path: string): Promise<Map<string, CachedOutcome>> {
  try {
    const file = JSON.parse(await fs.readFile(path, 'utf-8')) as { format?: number; outcomes?: Record<string, CachedOutcome> };
    if (file.format !== CACHE_FORMAT || typeof file.outcomes !== 'object' || file.outcomes === null) return new Map();
    return new Map(Object.entries(file.outcomes).filter(([, o]) => o === 'killed' || o === 'survived'));
  } catch {
    return new Map();
  }
}

export interface MutantCache {
  /** The stored outcome of `mutant` for the project's HEAD, or undefined when it must run. */
  get(mutant: MutantText): CachedOutcome | undefined;
  set(mutant: MutantText, outcome: CachedOutcome): void;
  /** Writes the outcomes this run looked up or recorded, and only those. */
  save(): Promise<void>;
}

/** The cache for the commit checked out in `projectDir`, as run by the BoardSmith named `revision`. */
export async function openMutantCache(projectDir: string, revision: string): Promise<MutantCache> {
  const path = mutantCachePath(projectDir);
  const stored = await readEntries(path);
  const tree = await projectTreeHash(projectDir);
  const used = new Map<string, CachedOutcome>();
  const keyOf = (m: MutantText) => sha256(JSON.stringify([CACHE_FORMAT, revision, process.version, tree, m.file, sha256(m.source)]));

  return {
    get(mutant) {
      const key = keyOf(mutant);
      const outcome = stored.get(key);
      if (outcome !== undefined) used.set(key, outcome);
      return outcome;
    },
    set(mutant, outcome) {
      used.set(keyOf(mutant), outcome);
    },
    async save() {
      await fs.mkdir(join(path, '..'), { recursive: true });
      const partial = `${path}.${process.pid}.tmp`;
      await fs.writeFile(partial, `${JSON.stringify({ format: CACHE_FORMAT, outcomes: Object.fromEntries(used) })}\n`);
      await fs.rename(partial, path);
    },
  };
}
