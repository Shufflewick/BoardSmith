import { basename, dirname, extname, join } from 'node:path';
import { build, type BuildOptions } from 'esbuild';

/** Entry point of the CLI, relative to the BoardSmith repo root. */
export const CLI_ENTRY = 'src/cli/cli.ts';

/** Bundle emitted for published/packed installs, relative to the repo root. */
export const CLI_OUTFILE = 'dist/cli.js';

/**
 * The entry file of each worker thread the CLI starts, relative to the repo
 * root. A worker runs a file of its own, which the CLI bundle cannot contain,
 * so each is built to `dist/<name>.js` beside `dist/cli.js`, where the module
 * that starts it finds it as its sibling (#401). A new worker is added here;
 * `src/contract/shipped-imports.test.ts` fails for a shipped file that starts
 * one that is not.
 */
export const WORKER_ENTRIES: readonly string[] = ['src/bot-trainer/benchmark-worker.ts'];

/**
 * The vitest reporter `boardsmith test` hands vitest by path (#429). vitest
 * loads it as a file of its own, so like a worker it is built to
 * `dist/<name>.js` beside `dist/cli.js`, where `src/cli/lib/vitest-run.ts`
 * finds it as its sibling.
 */
export const VITEST_REPORTER_ENTRY = 'src/cli/lib/test-progress-reporter.ts';

/** The output name (no extension) of an entry file: `src/cli/cli.ts` is `cli`. */
function outputName(entry: string): string {
  return basename(entry, extname(entry));
}

/**
 * How the CLI bundle and its worker entries are built. `buildCli` writes them;
 * the shipped-imports gate (`src/contract/shipped-imports.test.ts`) builds them
 * in memory to read which packages they leave external and which files they
 * emit.
 */
export function cliBuildOptions(repoRoot: string): BuildOptions {
  return {
    entryPoints: Object.fromEntries(
      [CLI_ENTRY, ...WORKER_ENTRIES, VITEST_REPORTER_ENTRY].map((entry) => [outputName(entry), join(repoRoot, entry)]),
    ),
    absWorkingDir: repoRoot,
    bundle: true,
    platform: 'node',
    format: 'esm',
    outdir: join(repoRoot, dirname(CLI_OUTFILE)),
    // Dependencies are resolved from the installed package's own node_modules;
    // bundling them would duplicate (and stale-pin) every runtime dependency.
    packages: 'external',
  };
}

/**
 * Bundle the BoardSmith CLI itself to `dist/cli.js`, with its worker entries
 * and its vitest reporter beside it.
 *
 * `bin/boardsmith.js` runs TypeScript straight from source inside this repo, so
 * this bundle only matters to consumers who install the package. It is
 * therefore built by the commands that produce an installable artifact
 * (`boardsmith build` in the library, and `boardsmith pack`) rather than by an
 * npm lifecycle hook — an explicit build cannot silently ship a stale bundle.
 */
export async function buildCli(repoRoot: string): Promise<void> {
  await build(cliBuildOptions(repoRoot));
}
