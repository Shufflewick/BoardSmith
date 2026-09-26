import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

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

/**
 * Every chunk directory's slug under `design/chunks/`, sorted; empty when the project has no
 * chunks yet. Any error other than the directory being absent is thrown, not read as "no chunks".
 */
export async function chunkSlugs(projectDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(designChunksDir(projectDir), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
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
/** The project's hard constraints and every state structure that grows, with its cap (#288). */
export const CONSTRAINTS_MD = 'CONSTRAINTS.md';
/** The filings ledger and the orchestrated-run journal, written by `/bs-build-game`. */
export const FILINGS_MD = 'FILINGS.md';
export const RUN_MD = 'RUN.md';
/** The answer cache `/bs-build-game` asks from and records into. */
export const QUESTIONS_MD = 'QUESTIONS.md';
/**
 * One run log per chunk, `design/run-log/<slug>.md` (#294). Chunks built at the same time on
 * separate branches each append only to their own file, so the log has no shared field for two
 * writers to collide on.
 */
export const RUN_LOG_DIR = 'run-log';
/** The references between chunks built at the same time, recorded by `boardsmith chunk-merge` (#294). */
export const CROSS_CHUNK_MD = 'CROSS-CHUNK.md';
/** Designer playtest waivers, written only by `boardsmith chunk-waiver` (#291). */
export const WAIVERS_MD = 'WAIVERS.md';
/**
 * The one-time record of chunks verified before the sign-off and claim-quote gates, written only
 * by `boardsmith chunk-gate-transition` (#397).
 */
export const GATE_TRANSITION_MD = 'GATE-TRANSITION.md';
/**
 * Source files two chunks built at the same time both edited, vouched for by the merge that
 * combined them, written only by `boardsmith chunk-merge` (#403).
 */
export const MERGE_SIGNOFFS_MD = 'MERGE-SIGNOFFS.md';

/** Every ledger `design/` owns, in the order `boardsmith doctor` reports them. */
export const DESIGN_LEDGERS = [
  BRIEF_MD,
  SKETCH_MD,
  DESIGN_MD,
  DECISIONS_MD,
  RULINGS_MD,
  ASSETS_MD,
  BOARDSMITH_BUGS_MD,
  WAIVERS_MD,
  GATE_TRANSITION_MD,
  MERGE_SIGNOFFS_MD,
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

/** The CLI commands that bundle a project's rules into a build directory of their own. */
type BuildingCommand = 'dev' | 'simulate' | 'build' | 'validate' | 'evolve-bot-weights';

/**
 * Where `command` writes the rules bundle it removes when it ends.
 *
 * Each command gets its own subdirectory of `.boardsmith/`, and removes only
 * that. `.boardsmith/` itself is never a command's to remove: it also holds the
 * scratch directory and the git worktrees of chunks built side by side, and
 * `boardsmith dev` stopping once deleted both (#391).
 */
export function commandBuildDir(projectDir: string, command: BuildingCommand): string {
  return join(projectDir, '.boardsmith', `${command}-tmp`);
}

/**
 * WHERE A PATH WRITTEN IN A DESIGN RECORD POINTS (#409). Every reader of a design record, whether
 * a Build Manifest row, a claim's `Source:`/`Searched:` line, or a script or capture a ledger or
 * verified chunk cites as evidence, resolves the path through this one rule, so a path one check
 * accepts is never refused by another:
 *
 *   - `~/...` is the home directory, as a shell reads it, and an absolute path is itself.
 *   - A path that names something `design/` owns (`rulebook/...`, `chunks/...`, `run-log/...`, or a
 *     ledger such as `DECISIONS.md`) is read from `design/`, where the records live.
 *   - A path that climbs out of `design/` (`../src/rules/world.ts`) is read from `design/` too, so
 *     it names the project's `src/rules/world.ts`. Read from the project root it could only name
 *     something outside the project, so this is the one meaning it can have.
 *   - Anything else (`src/...`, `tests/...`, `design/...`, `boardsmith.json`) is read from the
 *     project root.
 *   - A path that lands in the installed BoardSmith package (`../node_modules/boardsmith/src/...`,
 *     or `node_modules/boardsmith/src/...` from the root) is BoardSmith's own source or docs as the
 *     project has it installed, not a file of the game: `installedBoardSmithPath` says which file
 *     (#432). It is how a claim about how BoardSmith behaves cites the library, and the only way:
 *     `BoardSmith:<path>`, the form for a file in another repository, names no installed copy.
 *
 * The distinction is not cosmetic: `rulebook/02-punch.md` on disk is `design/rulebook/02-punch.md`,
 * and resolving it against the project root instead silently reads nothing.
 *
 * Uses `resolve`, not `join`, so an absolute or `..`-escaping input still lands OUTSIDE
 * `projectDir` and a caller's containment check can catch it. `join` would quietly graft
 * `/etc/passwd` onto the project root and defeat that check. `designRecordPath` is that check.
 */
export function resolveDesignRelative(projectDir: string, path: string): string {
  const written = path.replace(/\\/g, '/');
  if (written.startsWith('~/')) return resolve(homedir(), written.slice(2));
  const fromDesign = isDesignArtifact(written) || written === '..' || written.startsWith('../');
  return resolve(fromDesign ? designDir(projectDir) : projectDir, written);
}

/**
 * The project-relative, `/`-separated path a design record's written path names (see
 * `resolveDesignRelative` for the rule), or `undefined` when it names something outside the project.
 */
export function designRecordPath(projectDir: string, path: string): string | undefined {
  const rel = relative(resolve(projectDir), resolveDesignRelative(projectDir, path)).split(sep).join('/');
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) return undefined;
  return rel;
}

/** Where a game's installed BoardSmith package is, project-relative (#432). */
export const INSTALLED_BOARDSMITH_DIR = 'node_modules/boardsmith';

/**
 * The file inside the installed BoardSmith package that a project-relative path (as
 * `designRecordPath` gives it) names, such as `src/engine/flow/engine.ts`, or `undefined` when the
 * path names something of the project's own (#432). Such a file is in no commit of the game:
 * `node_modules/` is not committed, and a game built beside the library has it as a symlink to the
 * library's checkout. So a check that holds a project file to "it is in git" holds this one to
 * "the installed package has it", which is also the copy `claim-quote-check` reads its quote from.
 */
export function installedBoardSmithPath(rel: string): string | undefined {
  const prefix = `${INSTALLED_BOARDSMITH_DIR}/`;
  return rel.startsWith(prefix) && rel.length > prefix.length ? rel.slice(prefix.length) : undefined;
}

/**
 * Every file directly in `design/` that BoardSmith names, the ledgers `doctor` reports and the
 * records the build and merge commands keep beside them.
 */
const DESIGN_FILES: readonly string[] = [
  ...DESIGN_LEDGERS,
  CONSTRAINTS_MD,
  QUESTIONS_MD,
  FILINGS_MD,
  RUN_MD,
  CROSS_CHUNK_MD,
];

/** True when a doc-written path names something `design/` owns rather than the project root. */
export function isDesignArtifact(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  if ([RULEBOOK_DIR, CHUNKS_DIR, RUN_LOG_DIR].some((dir) => normalized.startsWith(`${dir}/`))) return true;
  return DESIGN_FILES.includes(normalized);
}
