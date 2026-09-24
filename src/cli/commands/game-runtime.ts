import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { build, type Plugin as EsbuildPlugin } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';

import type { GameDefinition } from '../../session/index.js';

// Workspace detection lives in lib/ so non-game commands (audit, lint, test)
// can ask the same question without importing the game runtime's esbuild
// machinery. Re-exported here because this module's consumers already treat
// `game-runtime` as the game-loading entry point.
export { getProjectContext, type ProjectContext } from '../lib/project-context.js';

// Get the CLI's directory to find the monorepo root.
// HAZARD: this depends on this file's directory depth (and differs between
// tsx-src and built-dist layouts). This file MUST live in the same directory
// as dev.ts (src/cli/commands/) so the relative path math below stays correct.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// __dirname is <repo>/src/cli/commands (tsx-src) or <repo>/dist/cli/commands
// (built-dist); three levels up reaches <repo> in both layouts. NOTE: the
// monorepo-context branch below is currently unreachable in practice (there is
// no boardsmith.json at the BoardSmith monorepo root, so getProjectContext
// never returns 'monorepo' today) — this depth math only matters if a future
// monorepo-context consumer is added.
export const cliMonorepoRoot = resolve(__dirname, '..', '..', '..');

/**
 * WHAT `boardsmith/<x>` MEANS INSIDE THIS CHECKOUT, READ FROM THE PACKAGE'S OWN
 * `exports`.
 *
 * It used to be a hand-written map of specifier → `src/` subdirectory, and a
 * hand-written copy of a list that already exists is a list that drifts. It
 * had: eight of the package's nineteen entries, with `boardsmith/world`,
 * `boardsmith/persistence`, `boardsmith/session-host`, `boardsmith/types`,
 * `boardsmith/utils`, `boardsmith/asset-scan` and `boardsmith/eslint-plugin`
 * all missing -- so in monorepo context a world project's rules could not
 * resolve the module that makes it a world at all, and the person who hit it
 * would be debugging rules that would not load for a reason nothing named.
 *
 * `package.json`'s `exports` is not a second list to keep in step: it is THE
 * definition of what a game may import, enforced by Node itself for every
 * standalone project. Deriving from it makes the two contexts agree by
 * construction -- a new entry needs no edit here, and one that is missing here
 * cannot exist. It also resolves the subpaths the old map could not express:
 * `boardsmith/ui/auto-ui` is its own export pointing at
 * `src/ui/components/auto-ui/`, which the previous code tried to rebuild from
 * a directory name and a guess at the layout, and could not.
 *
 * READ ONCE, ON FIRST USE. Not at module load: every CLI command imports this
 * file, and only the monorepo-context loaders below need the manifest -- so a
 * checkout whose `package.json` cannot be read fails where it is used, saying
 * what it wanted, rather than taking every command down at import time.
 */
let sourceEntries: ReadonlyMap<string, string> | null = null;

export function boardsmithSourceEntries(): ReadonlyMap<string, string> {
  if (sourceEntries !== null) return sourceEntries;

  const manifestPath = join(cliMonorepoRoot, 'package.json');
  let manifest: { exports?: Record<string, unknown> };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { exports?: Record<string, unknown> };
  } catch (error) {
    throw new Error(
      `Could not read ${manifestPath}, so 'boardsmith/...' imports cannot be resolved from ` +
        `source. This is the BoardSmith checkout's own manifest and it is where every ` +
        `entrypoint is declared: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const declared = Object.entries(manifest.exports ?? {});
  if (declared.length === 0) {
    throw new Error(
      `${manifestPath} declares no "exports", so nothing says what 'boardsmith/...' means. ` +
        'Every entrypoint a game may import is declared there.',
    );
  }

  const entries = new Map<string, string>();
  for (const [subpath, target] of declared) {
    // A conditional export names the file under `import`/`types`; a plain one
    // IS the file. Anything else is an export this loader cannot serve, and it
    // is left out rather than guessed at -- Node would refuse it too.
    const file =
      typeof target === 'string'
        ? target
        : ((target as { import?: string; types?: string } | null)?.import ??
          (target as { types?: string } | null)?.types);
    if (typeof file !== 'string') continue;
    entries.set(
      subpath === '.' ? 'boardsmith' : `boardsmith/${subpath.replace(/^\.\//, '')}`,
      resolve(cliMonorepoRoot, file),
    );
  }

  sourceEntries = entries;
  return entries;
}

/**
 * esbuild plugin to resolve boardsmith/* imports to the monorepo source.
 * Only used in monorepo context - standalone games resolve from node_modules.
 * Returns a no-op plugin for standalone context.
 */
function boardsmithResolvePlugin(context: 'monorepo' | 'standalone'): EsbuildPlugin {
  if (context === 'standalone') {
    return {
      name: 'boardsmith-resolve-noop',
      setup() {
        // No-op: let normal resolution handle boardsmith imports
      },
    };
  }

  return {
    name: 'boardsmith-resolve',
    setup(esbuildBuild) {
      esbuildBuild.onResolve({ filter: /^boardsmith(\/.*)?$/ }, (args) => {
        // A specifier the package does not export is left to esbuild, which
        // refuses it by name. Inventing a path for it would turn a typo into a
        // missing file somewhere in the library.
        const file = boardsmithSourceEntries().get(args.path);
        return file === undefined ? undefined : { path: file };
      });
    },
  };
}

/** Forward-slash an absolute path for use in a Vite module specifier / `/@fs/` URL. */
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Bundle and load ONLY the author's `gameDefinition` (Node side), via a
 * synthetic esbuild live-bundle entry that re-exports it from the project's
 * rules index. Unlike `dev.ts`'s `loadGameRuntime`, this does NOT re-export
 * `executeOp` — callers needing full action execution (the dev multiplayer
 * host) must use `loadGameRuntime` instead; `simulate` only needs the bare
 * `gameClass` to hand to `simulateRandomGames`/`createTestGame`, which run the
 * engine directly without the stateless-ops executor.
 *
 * SECURITY NOTE (T-125-03, accepted risk): like `dev`/`build`, this
 * dynamic-imports the project's OWN rules module — arbitrary code from the
 * project being simulated executes in this CLI process. This is the same
 * trust model as every other BoardSmith CLI command; there is no
 * untrusted-third-party input path (a developer only ever simulates their own
 * game).
 */
export async function loadGameDefinition(
  rulesPath: string,
  tempDir: string,
  context: 'monorepo' | 'standalone',
): Promise<{ gameDefinition: GameDefinition }> {
  const module = await importRuntimeBundle({ rulesPath, tempDir, name: 'simulate', context, exports: [] });
  return { gameDefinition: module.gameDefinition };
}

/**
 * THE ABSOLUTE PATH OF ONE OF THE CLI'S OWN SOURCE FILES, for an `exports` line
 * of {@link importRuntimeBundle} that must be built beside the rules.
 *
 * The package ships `src/`, and this module runs either from it under tsx
 * (`src/cli/commands`) or inlined in the CLI bundle (`dist/cli.js`), so the file
 * is looked for under both. `pathUnderCli` is relative to `src/cli`.
 */
export function cliSourceFile(pathUnderCli: string): string {
  const candidates = [join(__dirname, '..', pathUnderCli), join(__dirname, '..', 'src', 'cli', pathUnderCli)];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(
      `this BoardSmith install is missing its own source file src/cli/${pathUnderCli}. ` +
        'Reinstall boardsmith so the package is whole',
    );
  }
  return found;
}

/**
 * BUNDLE THE PROJECT'S RULES, AND WHATEVER MUST SHARE THEIR ENGINE, AND LOAD IT.
 *
 * ONE esbuild bundle, because a game's rules are built with the engine inlined:
 * anything that touches the elements they build -- `executeOp` for a table, the
 * world host for a world (#283) -- has to come out of the same bundle, or it
 * runs on a second copy of the engine whose classes and functions the rules'
 * elements do not share.
 *
 * `exports` are extra `export ... from ...;` lines for the entry, beside the
 * `gameDefinition` every bundle exports. The import is cache-busted, so calling
 * this again after an edit is a genuine re-read of the author's source.
 */
export async function importRuntimeBundle(args: {
  rulesPath: string;
  tempDir: string;
  /** Names the entry and bundle files in `tempDir`, so loaders cannot collide. */
  name: string;
  context: 'monorepo' | 'standalone';
  exports: readonly string[];
}): Promise<{ gameDefinition: GameDefinition } & Record<string, unknown>> {
  const rulesIndexPath = join(args.rulesPath, 'index.ts');
  const entryPath = join(args.tempDir, `${args.name}-entry.ts`);
  writeFileSync(
    entryPath,
    [`export { gameDefinition } from ${JSON.stringify(toPosix(rulesIndexPath))};`, ...args.exports].join(
      '\n',
    ),
  );
  const bundlePath = join(args.tempDir, `${args.name}-bundle.mjs`);

  await build({
    entryPoints: [entryPath],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: bundlePath,
    logLevel: 'silent',
    plugins: [boardsmithResolvePlugin(args.context)],
  });

  const moduleUrl = pathToFileURL(bundlePath).href;
  const module = (await import(`${moduleUrl}?t=${Date.now()}`)) as Record<string, unknown>;

  if (!module.gameDefinition) {
    throw new Error('Rules module must export a gameDefinition');
  }

  return module as { gameDefinition: GameDefinition } & Record<string, unknown>;
}
