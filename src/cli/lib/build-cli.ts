import { join } from 'node:path';
import { build } from 'esbuild';

/** Entry point of the CLI, relative to the BoardSmith repo root. */
export const CLI_ENTRY = 'src/cli/cli.ts';

/** Bundle emitted for published/packed installs, relative to the repo root. */
export const CLI_OUTFILE = 'dist/cli.js';

/**
 * Bundle the BoardSmith CLI itself to `dist/cli.js`.
 *
 * `bin/boardsmith.js` runs TypeScript straight from source inside this repo, so
 * this bundle only matters to consumers who install the package. It is
 * therefore built by the commands that produce an installable artifact
 * (`boardsmith build` in the library, and `boardsmith pack`) rather than by an
 * npm lifecycle hook — an explicit build cannot silently ship a stale bundle.
 */
export async function buildCli(repoRoot: string): Promise<void> {
  await build({
    entryPoints: [join(repoRoot, CLI_ENTRY)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: join(repoRoot, CLI_OUTFILE),
    // Dependencies are resolved from the installed package's own node_modules;
    // bundling them would duplicate (and stale-pin) every runtime dependency.
    packages: 'external',
  });
}
