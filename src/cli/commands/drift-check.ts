/**
 * `drift-check.ts` — CHECK-05: the code-drift check.
 *
 * For each chunk, diffs its `## Build Manifest` file list against the commit recorded in its
 * `## Verified Commit Hash`, and reports every chunk whose code moved since a human approved it
 * (172-CONTEXT.md decision 9). Works retroactively on every existing chunk — there is no
 * close-time write this check depends on.
 *
 * THIS IS THE FIRST COMMAND IN THE CODEBASE TO SHELL OUT TO GIT AS A SUBPROCESS. It sets the
 * convention Phase 173 will copy:
 *   - `execFile` with an argv array, never `exec`/`execSync` with a shell string. `init.ts` uses
 *     `execSync` for a FIXED, hard-coded command (`git init`); this module's hash comes from a
 *     hand-editable `CHUNK.md`, so that pattern is deliberately NOT copied here.
 *   - `cwd` is mandatory and explicit on every invocation, and is always the resolved GAME
 *     project directory — never BoardSmith's own repo. The wrong `cwd` silently diffs the wrong
 *     repository (T-172-03).
 *   - A hash pulled from a `CHUNK.md` is untrusted input flowing into a git argv. `execFile`
 *     already prevents shell interpretation, but an argv element beginning with `-` is still read
 *     by git as a FLAG (e.g. `--upload-pack=touch /tmp/pwned`) — the `/^[0-9a-f]{7,40}$/` hash
 *     regex below is what closes that hole, and it runs BEFORE git is ever invoked (T-172-01).
 *
 * Zero rulebook or source access anywhere in this module (source-free by construction, same as
 * `trace-check.ts`) — the only external process this file spawns is `git`.
 *
 * READ-ONLY. No mutating `fs` call and no mutating git subcommand (only `diff`, `rev-parse`,
 * `merge-base`) appears anywhere in this file's body. Pinned directly by a before/after
 * whole-project byte-hash test, the same T-171-19 class `chunk-provenance.ts:706-714` and
 * `trace-check.ts` pin.
 */

import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { join, relative, resolve as pathResolve, sep } from 'node:path';
import {
  type Finding,
  parseBuildManifest,
  extractVerifiedCommitHash,
  resolveManifestPath,
} from './build-manifest.js';

/**
 * A hand-written promisified wrapper, NOT `promisify(execFile)`. Node's `execFile` carries a
 * `util.promisify.custom` implementation that `promisify()` prefers when present; a test-time
 * mock of `execFile` (`vi.fn(actual.execFile)`) does not carry that symbol over, which silently
 * changes `promisify`'s resolution shape from `{ stdout, stderr }` to a positional `[stdout,
 * stderr]` array. Calling the callback form directly here keeps behavior identical whether
 * `execFile` is the real implementation or a test mock wrapping it.
 */
function execFileAsync(
  cmd: string,
  args: string[],
  options: { cwd: string },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    execFile(cmd, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolvePromise({ stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

/**
 * Closes T-172-01: a hand-edited `## Verified Commit Hash` is untrusted input reaching a git
 * argv. This is checked BEFORE any git invocation — an argv element beginning with `-` (e.g.
 * `--upload-pack=touch /tmp/pwned`) is still read by git as a flag even though `execFile`'s argv
 * form prevents shell interpretation. Only lower-case hex, 7–40 characters, ever reaches git.
 */
const HASH_SHAPE = /^[0-9a-f]{7,40}$/;

/** Sentinel returned instead of throwing when a hash cannot be resolved into a diff. */
export const UNRESOLVABLE = 'unresolvable' as const;

// -------------------------------------------------------------------------------------------
// Git plumbing (Task 1)
// -------------------------------------------------------------------------------------------

/**
 * `git diff --name-only <hash> HEAD`, run with an explicit `cwd` and a validated hash.
 *
 * Returns the `UNRESOLVABLE` sentinel — never throws — when the hash is not hash-shaped, or when
 * git cannot resolve it (unknown commit, shallow clone missing history, etc.). The caller
 * (`driftCheckCommand`) is responsible for treating `UNRESOLVABLE` as `drift-unknown`, not as a
 * tool failure: a bad hash in one chunk must never abort the whole run.
 */
export async function diffedFilesSince(
  projectDir: string,
  hash: string,
): Promise<string[] | typeof UNRESOLVABLE> {
  if (!HASH_SHAPE.test(hash)) return UNRESOLVABLE;

  try {
    const { stdout } = await execFileAsync('git', ['diff', '--name-only', hash, 'HEAD'], {
      cwd: projectDir,
    });
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return UNRESOLVABLE;
  }
}

/**
 * `git merge-base --is-ancestor <hash> HEAD` (exit 0 = yes, non-zero = no or unresolvable).
 * Distinguishes "hash exists but is not an ancestor of HEAD" from "hash unresolvable" — both map
 * to `drift-unknown` in the caller, but with a different `detail`. Never hand-parses `git log`.
 */
async function isAncestorOfHead(projectDir: string, hash: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['merge-base', '--is-ancestor', hash, 'HEAD'], { cwd: projectDir });
    return true;
  } catch {
    return false;
  }
}

async function resolveHead(projectDir: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: projectDir });
  return stdout.trim();
}

/**
 * Preflight per T-172-03: confirms `projectDir` is inside a git repository before any diff work
 * starts. `cwd` on this call is `projectDir` itself — if it is not a repo (or git is not
 * installed), git fails and this throws an actionable error naming the directory and the
 * `--project` flag, rather than silently falling back to running in BoardSmith's own repo.
 */
async function assertGitRepo(projectDir: string): Promise<void> {
  try {
    await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: projectDir });
  } catch {
    throw new Error(
      `${projectDir} is not a git repository (or git is not installed).\n` +
        `drift-check needs git history to diff each chunk's Build Manifest files against — run it ` +
        `from inside a game project's git repo, or pass --project <dir>.`,
    );
  }
}

// -------------------------------------------------------------------------------------------
// driftCheckCommand (Task 2)
// -------------------------------------------------------------------------------------------

export interface ChunkDrift {
  chunk: string;
  hash?: string;
  state: 'clean' | 'drifted' | 'unknown';
  /** Manifest files that changed between `hash` and HEAD. */
  changedFiles: string[];
  /** Manifest files no longer present on disk (decision 12 — the strongest drift signal). */
  missingFiles: string[];
  manifestFileCount: number;
}

export interface DriftCheckResult {
  chunks: ChunkDrift[];
  findings: Finding[];
  counts: { clean: number; drifted: number; unknown: number };
  head: string;
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.stat(absPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * `boardsmith drift-check [--json]` — enumerates `chunks/*␣/CHUNK.md`, for each one diffs its
 * `## Build Manifest` files against the commit recorded in `## Verified Commit Hash`, and reports
 * the three-state classification (decision 10): `clean`, `drifted`, or `unknown` — never
 * collapsed in either direction.
 *
 * Tool failure (no `chunks/` directory, not a git repo) throws a one-line actionable `Error`;
 * `cli.ts`'s top-level catch prints only `err.message`, never a stack trace or internal path
 * (CLAUDE.md, T-172-05). A FINDING never sets `process.exitCode` — findings exit 0
 * (172-CONTEXT.md decision 6).
 *
 * `--json`: `console.log(JSON.stringify(result, null, 2))` as the last thing computed, then
 * returns the result — the exact convention `trace-check.ts`/`chunk-provenance.ts` establish.
 * Otherwise: a grouped, count-first human report (`printHumanReport` below).
 */
export async function driftCheckCommand(
  options: { project?: string; json?: boolean } = {},
): Promise<DriftCheckResult> {
  const projectDir = pathResolve(options.project ?? process.cwd());

  await assertGitRepo(projectDir);
  const head = await resolveHead(projectDir);

  const chunksDir = join(projectDir, 'chunks');
  let chunkDirEntries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    chunkDirEntries = await fs.readdir(chunksDir, { withFileTypes: true });
  } catch {
    throw new Error(
      `No chunks/ directory in ${projectDir}.\n` +
        `This command looks for chunks/<slug>/CHUNK.md files — run it from a BoardSmith game\n` +
        `project directory, or pass --project <dir>.`,
    );
  }
  const slugs = chunkDirEntries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const findings: Finding[] = [];
  const chunks: ChunkDrift[] = [];
  const counts = { clean: 0, drifted: 0, unknown: 0 };

  // One diff / ancestor check per DISTINCT hash — several chunks can record the same commit, and
  // a per-chunk subprocess spawn on a 17-chunk game is wasteful.
  const diffCache = new Map<string, string[] | typeof UNRESOLVABLE>();
  const ancestorCache = new Map<string, boolean>();

  async function cachedDiff(hash: string): Promise<string[] | typeof UNRESOLVABLE> {
    let cached = diffCache.get(hash);
    if (cached === undefined) {
      cached = await diffedFilesSince(projectDir, hash);
      diffCache.set(hash, cached);
    }
    return cached;
  }
  async function cachedIsAncestor(hash: string): Promise<boolean> {
    let cached = ancestorCache.get(hash);
    if (cached === undefined) {
      cached = await isAncestorOfHead(projectDir, hash);
      ancestorCache.set(hash, cached);
    }
    return cached;
  }

  function markUnknown(slug: string, hash: string | undefined, manifestFileCount: number, detail: string): void {
    chunks.push({ chunk: slug, hash, state: 'unknown', changedFiles: [], missingFiles: [], manifestFileCount });
    counts.unknown++;
    findings.push({ kind: 'drift-unknown', chunk: slug, subject: slug, detail });
  }

  for (const slug of slugs) {
    let chunkText: string;
    try {
      chunkText = await fs.readFile(join(chunksDir, slug, 'CHUNK.md'), 'utf-8');
    } catch {
      continue; // a chunks/<slug> dir with no CHUNK.md is not this command's problem to report
    }

    const manifest = parseBuildManifest(chunkText);
    for (const rowIndex of manifest.pathlessRowIndexes) {
      findings.push({
        kind: 'manifest-file-missing',
        chunk: slug,
        subject: `row ${rowIndex}`,
        detail: `row ${rowIndex} has no path token`,
      });
    }

    if (!manifest.tabular) {
      findings.push({
        kind: 'manifest-file-missing',
        chunk: slug,
        subject: 'Build Manifest',
        detail: 'manifest is not table-shaped',
      });
      // A non-table-shaped manifest gives no computable file list — unknown, never clean
      // (reporting clean here would claim knowledge the tool does not have).
      markUnknown(slug, extractVerifiedCommitHash(chunkText), 0, 'manifest is not table-shaped; no computable diff base');
      continue;
    }

    const manifestPaths = [...new Set(manifest.entries.map((e) => e.path))];
    const hash = extractVerifiedCommitHash(chunkText);

    if (!hash) {
      markUnknown(slug, undefined, manifestPaths.length, 'no ## Verified Commit Hash recorded for this chunk');
      continue;
    }
    if (!HASH_SHAPE.test(hash)) {
      markUnknown(slug, hash, manifestPaths.length, `recorded hash "${hash}" is not a valid commit-hash shape`);
      continue;
    }

    const ancestor = await cachedIsAncestor(hash);
    if (!ancestor) {
      markUnknown(slug, hash, manifestPaths.length, `hash ${hash} is not resolvable as an ancestor of HEAD`);
      continue;
    }

    const diff = await cachedDiff(hash);
    if (diff === UNRESOLVABLE) {
      markUnknown(slug, hash, manifestPaths.length, `hash ${hash} could not be diffed against HEAD`);
      continue;
    }
    const diffSet = new Set(diff);

    const changedFiles: string[] = [];
    const missingFiles: string[] = [];

    for (const path of manifestPaths) {
      const resolved = resolveManifestPath(projectDir, path);
      if (resolved === 'escapes') {
        findings.push({
          kind: 'manifest-file-missing',
          chunk: slug,
          subject: path,
          detail: `manifest path escapes the project root: ${path}`,
        });
        continue;
      }

      // Decision 12: a manifest file absent from disk IS drift — the strongest signal, checked
      // regardless of whether the diff also names it.
      if (!(await fileExists(resolved))) {
        missingFiles.push(path);
        continue;
      }

      if (diffSet.has(path)) {
        changedFiles.push(path);
      }
    }

    const state: ChunkDrift['state'] = changedFiles.length > 0 || missingFiles.length > 0 ? 'drifted' : 'clean';
    chunks.push({ chunk: slug, hash, state, changedFiles, missingFiles, manifestFileCount: manifestPaths.length });
    counts[state]++;

    if (changedFiles.length > 0) {
      findings.push({
        kind: 'chunk-code-drifted',
        chunk: slug,
        subject: slug,
        detail: `changed since ${hash}: ${changedFiles.join(', ')}`,
      });
    }
    if (missingFiles.length > 0) {
      findings.push({
        kind: 'chunk-code-drifted',
        chunk: slug,
        subject: slug,
        detail: `manifest file(s) deleted from disk since ${hash}: ${missingFiles.join(', ')}`,
      });
    }
  }

  const result: DriftCheckResult = { chunks, findings, counts, head };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  printHumanReport(result);
  return result;
}

// -------------------------------------------------------------------------------------------
// Human report — count-first, grouped and truncated per chunk (172-CONTEXT.md's "report text
// formatting" item: measured expectation is 10/12 one-two-punch chunks drift, one with 19 changed
// files, so per-chunk truncation is what keeps the report readable).
// -------------------------------------------------------------------------------------------

const MAX_FILES_PER_CHUNK = 10;
const MAX_FINDINGS_SHOWN = 10;

function printHumanReport(result: DriftCheckResult): void {
  const { counts, chunks, findings, head } = result;

  console.log(`HEAD: ${head}`);
  console.log(`clean: ${counts.clean}  drifted: ${counts.drifted}  unknown: ${counts.unknown}`);

  for (const c of chunks) {
    if (c.state === 'clean') continue;

    if (c.state === 'unknown') {
      const detail = findings.find((f) => f.kind === 'drift-unknown' && f.chunk === c.chunk)?.detail ?? '';
      console.log(`  ${c.chunk} — unknown — ${detail}`);
      continue;
    }

    const files = [...c.changedFiles, ...c.missingFiles.map((f) => `${f} (deleted)`)];
    const shown = files.slice(0, MAX_FILES_PER_CHUNK);
    const remaining = files.length - shown.length;
    const tail = remaining > 0 ? ` +${remaining} more — run --json for the full list` : '';
    console.log(`  ${c.chunk} — drifted since ${c.hash} — ${shown.join(', ')}${tail}`);
  }

  const manifestFindings = findings.filter((f) => f.kind === 'manifest-file-missing');
  if (manifestFindings.length > 0) {
    console.log(`\nmanifest-file-missing (${manifestFindings.length})`);
    const shown = manifestFindings.slice(0, MAX_FINDINGS_SHOWN);
    for (const f of shown) {
      console.log(`  [${f.chunk || '-'}] ${f.subject}: ${f.detail}`);
    }
    const remaining = manifestFindings.length - shown.length;
    if (remaining > 0) {
      console.log(`  +${remaining} more — run --json for the full list`);
    }
  }
}
