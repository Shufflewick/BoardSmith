import { join, resolve } from 'node:path';

/**
 * Where a bs-built game project keeps everything the `bs-` skills author.
 *
 * ONE directory holds every design artifact — the ledgers (`SKETCH.md`,
 * `RULINGS.md`, `DECISIONS.md`, …), the per-chunk directories, and the
 * transcribed rulebook. Before this existed they were loose in the project
 * root, mixed in with `src/`, `tests/`, `package.json` and whatever scratch
 * scripts a session happened to leave behind (issue #6).
 *
 * Single source of truth: every command that reads or writes a design artifact
 * derives its path from here, so the layout can never drift between commands.
 * Use `boardsmith doctor --fix` to move a pre-`design/` project into place.
 */
export const DESIGN_DIR = 'design';

/**
 * Absolute path to a project's design directory.
 *
 * Nearly every command wants this rather than the project root: `rulebook/…`
 * and `chunks/…` citations inside the design docs are written **relative to
 * the design directory**, so resolving them against this path keeps every
 * citation string in every existing project valid across the move.
 */
export function designDir(projectDir: string): string {
  return join(projectDir, DESIGN_DIR);
}

/** The transcribed rulebook slices + archived source, relative to `designDir`. */
export const RULEBOOK_DIR = 'rulebook';

/** The per-chunk directories, relative to `designDir`. */
export const CHUNKS_DIR = 'chunks';

/**
 * Absolute path to a project's `design/rulebook/`.
 *
 * Named `design*` rather than the bare `rulebookDir`/`chunksDir` on purpose:
 * those are the conventional local variable names throughout the commands, and
 * a shadowed import reads as a call to itself.
 */
export function designRulebookDir(projectDir: string): string {
  return join(designDir(projectDir), RULEBOOK_DIR);
}

/** Absolute path to a project's `design/chunks/`. */
export function designChunksDir(projectDir: string): string {
  return join(designDir(projectDir), CHUNKS_DIR);
}

/** Absolute path to one chunk's `CHUNK.md`. */
export function chunkMdPath(projectDir: string, slug: string): string {
  return join(designChunksDir(projectDir), slug, CHUNK_MD);
}

/** A chunk's `CHUNK.md` path relative to the design directory — the form used in messages. */
export function relChunkMdPath(slug: string): string {
  return join(CHUNKS_DIR, slug, CHUNK_MD);
}

/** Filename of a chunk's spec, inside `design/chunks/<slug>/`. */
export const CHUNK_MD = 'CHUNK.md';

/**
 * The design ledgers that live directly in `design/`.
 *
 * Named rather than spelled inline so a rename is a one-line change and a typo
 * is a compile error.
 */
export const SKETCH_MD = 'SKETCH.md';
export const RULINGS_MD = 'RULINGS.md';
export const DECISIONS_MD = 'DECISIONS.md';
export const ASSETS_MD = 'ASSETS.md';
export const DESIGN_MD = 'DESIGN.md';
export const BRIEF_MD = 'BRIEF.md';
export const BOARDSMITH_BUGS_MD = 'BOARDSMITH-BUGS.md';

/** Every ledger `design/` owns, in the order `boardsmith doctor` reports them. */
export const DESIGN_LEDGERS = [
  BRIEF_MD,
  SKETCH_MD,
  DESIGN_MD,
  DECISIONS_MD,
  RULINGS_MD,
  ASSETS_MD,
  BOARDSMITH_BUGS_MD,
] as const;

/** Absolute path to a ledger in `design/`. */
export function designPath(projectDir: string, ...segments: string[]): string {
  return join(designDir(projectDir), ...segments);
}

/**
 * Where a session writes throwaway scripts — repro drivers, one-off probes,
 * capture harnesses.
 *
 * It lives under the already-gitignored `.boardsmith/`, so anything dropped
 * here is invisible to git and cannot become the tracked `_dbg.mjs` /
 * `_cap_tmp.mjs` litter that issue #6 was filed about. The skills point every
 * ad-hoc script here; `boardsmith doctor` reports root-level scratch that
 * escaped.
 */
export const SCRATCH_DIR = join('.boardsmith', 'scratch');

/** Absolute path to a project's scratch directory. */
export function scratchDir(projectDir: string): string {
  return join(projectDir, SCRATCH_DIR);
}

/**
 * Resolve a path as it is WRITTEN in a bs- design doc to where it actually sits on disk.
 *
 * Inside `design/`, every path is design-relative: a Build Manifest cites `rulebook/02-punch.md`,
 * SKETCH.md points at `chunks/<slug>/CHUNK.md`. Outside it, paths are project-relative:
 * `src/rules/index.ts`, `tests/punch.test.ts`, `boardsmith.json`. This function is the ONE place
 * that knows which is which, so a caller can hand it either form and get the real path back.
 *
 * The distinction is not cosmetic: `rulebook/02-punch.md` on disk is `design/rulebook/02-punch.md`,
 * and resolving it against the project root instead silently reads nothing.
 *
 * Uses `resolve`, not `join`, so an absolute or `..`-escaping input still lands OUTSIDE
 * `projectDir` and a caller's containment check can catch it. `join` would quietly graft
 * `/etc/passwd` onto the project root and defeat that check.
 */
export function resolveDesignRelative(projectDir: string, path: string): string {
  const base = isDesignArtifact(path) ? join(projectDir, DESIGN_DIR) : projectDir;
  return resolve(base, path);
}

/** True when a doc-written path names something `design/` owns rather than the project root. */
export function isDesignArtifact(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith(`${RULEBOOK_DIR}/`)) return true;
  if (normalized.startsWith(`${CHUNKS_DIR}/`)) return true;
  return (DESIGN_LEDGERS as readonly string[]).includes(normalized);
}
