import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, extname, sep } from 'node:path';
import { build, type Plugin as EsbuildPlugin } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';

import type { GameDefinition } from '../../session/index.js';
import { DECLARED_GAME_OPTIONS_KEY, withDeclaredGameOptions } from '../../session/game-option-selection.js';

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

/**
 * esbuild plugin that loads `import text from './data/cards.csv?raw'` as the
 * file's text, as Vite and vitest do, so card data reaches every rules bundle.
 */
const rawImportPlugin: EsbuildPlugin = {
  name: 'boardsmith-raw',
  setup(esbuildBuild) {
    esbuildBuild.onResolve({ filter: /\?raw$/ }, async (args) => {
      const found = await esbuildBuild.resolve(args.path.slice(0, -'?raw'.length), {
        kind: args.kind,
        importer: args.importer,
        resolveDir: args.resolveDir,
      });
      return found.errors.length > 0 ? { errors: found.errors } : { path: found.path, namespace: 'boardsmith-raw' };
    });
    esbuildBuild.onLoad({ filter: /.*/, namespace: 'boardsmith-raw' }, (args) => ({
      contents: readFileSync(args.path),
      loader: 'text',
    }));
  },
};

/** {@link importRuntimeBundle} was asked to replace files the rules never import; `files` are their absolute paths. */
export class UnimportedRedirectError extends Error {
  constructor(readonly files: string[]) {
    super(`The rules never import ${files.join(' or ')}, so replacing it would change nothing.`);
  }
}

/** Marks the inner resolve of {@link redirectPlugin}, so it does not answer itself. */
const REDIRECTING = Symbol('boardsmith-redirecting');

/**
 * esbuild plugin that builds the rules with each file `redirects` names
 * replaced by another (`boardsmith simulate --compare <data file>=...`),
 * however the rules import it, `?raw` included. `imported` collects the files
 * it replaced, so a file the rules never import can be refused.
 */
function redirectPlugin(redirects: ReadonlyMap<string, string>, imported: Set<string>): EsbuildPlugin {
  return {
    name: 'boardsmith-redirect',
    setup(esbuildBuild) {
      esbuildBuild.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData === REDIRECTING) return undefined;
        const found = await esbuildBuild.resolve(args.path, {
          kind: args.kind,
          importer: args.importer,
          resolveDir: args.resolveDir,
          namespace: args.namespace,
          pluginData: REDIRECTING,
        });
        const replacement = found.errors.length > 0 ? undefined : redirects.get(found.path);
        if (replacement === undefined) return undefined;
        imported.add(found.path);
        return { path: replacement, namespace: found.namespace };
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
 * The caller owns `tempDir` and removes it.
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
  gameOptions: unknown,
): Promise<GameDefinition> {
  const module = await importRuntimeBundle({ rulesPath, tempDir, name: 'definition', context, gameOptions, exports: [] });
  return module.gameDefinition;
}


/**
 * The package's own `src/`. The package ships it, and this module runs either
 * from it under tsx (`src/cli/commands/game-runtime.ts`) or inlined in the CLI
 * bundle (`dist/cli.js`), beside it; the file's own extension says which.
 */
const packageSrc = extname(__filename) === '.ts' ? resolve(__dirname, '..', '..') : resolve(__dirname, '..', 'src');

/**
 * THE ABSOLUTE PATH OF ONE OF THE PACKAGE'S OWN SOURCE FILES, for an `exports`
 * line of {@link importRuntimeBundle} that must be built beside the rules.
 * `pathUnderSrc` is relative to `src/`.
 */
export function packageSourceFile(pathUnderSrc: string): string {
  const file = join(packageSrc, pathUnderSrc);
  if (!existsSync(file)) {
    throw new Error(
      `this BoardSmith install is missing its own source file src/${pathUnderSrc}. ` +
        'Reinstall boardsmith so the package is whole',
    );
  }
  return file;
}

/** {@link packageSourceFile} for a file under `src/cli`; `pathUnderCli` is relative to it. */
export function cliSourceFile(pathUnderCli: string): string {
  return packageSourceFile(join('cli', pathUnderCli));
}

/** The real path of the `boardsmith` the rules in `rulesPath` import, found the way esbuild finds it, or undefined when none is installed. */
function installedBoardsmith(rulesPath: string): string | undefined {
  for (let dir = rulesPath; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', 'boardsmith');
    if (existsSync(candidate)) return realpathSync.native(candidate);
    if (dirname(dir) === dir) return undefined;
  }
}

/**
 * Refuse a bundle that holds this CLI's own source beside rules built on another
 * `boardsmith` install (#696). Each install brings its own engine, so the CLI's code
 * would check the rules' elements against classes they are not instances of, and
 * match nothing without a word. `inputs` are the bundle's source files, absolute.
 */
function requireOneBoardsmith(rulesPath: string, inputs: readonly string[]): void {
  const game = installedBoardsmith(rulesPath);
  // As esbuild names the CLI's files: the letter case this process was started with.
  const cliAsBundled = realpathSync(resolve(dirname(cliSourceFile('cli.ts')), '..', '..'));
  // The case on disk, so a link or a command typed in other case on macOS is still the same install.
  const cli = realpathSync.native(cliAsBundled);
  if (game === undefined || game === cli || !inputs.some((input) => input.startsWith(cliAsBundled + sep))) return;
  throw new Error(
    `This game's rules import boardsmith from ${game}, but this boardsmith command runs from ${cli}. ` +
      'The command builds its own code into the rules bundle, so the bundle would hold two copies of the engine ' +
      "that do not recognise each other's elements. Run the game's own boardsmith from the game's directory " +
      `(npx boardsmith ...), or install this boardsmith into the game (npm install ${cli}).`,
  );
}

/**
 * The entry `boardsmith build` bundles a game's published rules from (#701): all
 * the rules module exports, with its `gameDefinition` carrying `declarations`,
 * the game options `boardsmith.json` declares (already read and checked by
 * `parseGameOptionList`), under the key `withDeclaredGameOptions` uses. A
 * platform's `start` op reads them there, so it fills every option the host
 * left out, a designer-only one too, which no manifest lists. The entry imports
 * nothing a runner must provide beyond what the rules already import.
 */
export function rulesEntrySource(rulesIndexPath: string, declarations: Record<string, unknown>): string {
  const rules = JSON.stringify(toPosix(rulesIndexPath));
  // A namespace import, so rules with no gameDefinition reach the loader's
  // "must export a gameDefinition" message rather than a bundler error.
  return [
    `import * as rules from ${rules};`,
    `export * from ${rules};`,
    `export const gameDefinition = rules.gameDefinition && { ...rules.gameDefinition, [Symbol.for(${JSON.stringify(DECLARED_GAME_OPTIONS_KEY)})]: ${JSON.stringify(declarations)} };`,
    '',
  ].join('\n');
}

/**
 * BUNDLE THE PROJECT'S RULES, AND WHATEVER MUST SHARE THEIR ENGINE, AND LOAD IT.
 *
 * ONE esbuild bundle, because a game's rules are built with the engine inlined:
 * anything that touches the elements they build -- `executeOp` for a table, the
 * world host for a world (#283) -- has to come out of the same bundle, or it
 * runs on a second copy of the engine whose classes and functions the rules'
 * elements do not share.
 * For the same reason a bundle that takes CLI source from one install and the
 * rules' `boardsmith` from another is refused, naming both.
 *
 * `exports` are extra `export ... from ...;` lines for the entry, beside the
 * `gameDefinition` every bundle exports, which is returned carrying
 * `gameOptions` (`withDeclaredGameOptions`, which refuses a definition that
 * declares its own). The import is cache-busted, so calling this again after an
 * edit is a genuine re-read of the author's source.
 */
export async function importRuntimeBundle(args: {
  rulesPath: string;
  tempDir: string;
  /** Names the entry and bundle files in `tempDir`, so loaders cannot collide. */
  name: string;
  context: 'monorepo' | 'standalone';
  /** `boardsmith.json`'s `gameOptions` list, as read (absent when it declares none). */
  gameOptions: unknown;
  exports: readonly string[];
  /**
   * Absolute path -> absolute path of the file to bundle in its place. A file
   * the rules never import is refused, since replacing it would change nothing.
   */
  redirects?: ReadonlyMap<string, string>;
}): Promise<{ gameDefinition: GameDefinition; bundlePath: string } & Record<string, unknown>> {
  const rulesIndexPath = join(args.rulesPath, 'index.ts');
  const entryPath = join(args.tempDir, `${args.name}-entry.ts`);
  writeFileSync(
    entryPath,
    [
      // A namespace import, so rules with no gameDefinition reach the message below.
      `import * as rules from ${JSON.stringify(toPosix(rulesIndexPath))};`,
      'export const gameDefinition = rules.gameDefinition;',
      ...args.exports,
    ].join(
      '\n',
    ),
  );
  // The real path, so Node resolves the map's relative sources from where esbuild wrote them (macOS links /tmp and /var).
  const bundlePath = join(realpathSync(args.tempDir), `${args.name}-bundle.mjs`);
  const redirects = args.redirects ?? new Map<string, string>();
  const redirected = new Set<string>();

  const { metafile } = await build({
    entryPoints: [entryPath],
    metafile: true,
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: bundlePath,
    sourcemap: 'inline',
    // Node needs only the mappings to rewrite a stack; each rules save's bundle stays loaded.
    sourcesContent: false,
    logLevel: 'silent',
    plugins: [
      ...(redirects.size > 0 ? [redirectPlugin(redirects, redirected)] : []),
      boardsmithResolvePlugin(args.context),
      rawImportPlugin,
    ],
  });
  const unused = [...redirects.keys()].filter((path) => !redirected.has(path));
  if (unused.length > 0) throw new UnimportedRedirectError(unused);
  // In monorepo context the resolve plugin points every `boardsmith` import at this checkout already.
  if (args.context === 'standalone') {
    requireOneBoardsmith(args.rulesPath, Object.keys(metafile.inputs).map((input) => resolve(input)));
  }

  // With the inline map, a crash in the game names its line in the game's own source, not the bundle's (#1103).
  process.setSourceMapsEnabled(true);
  const moduleUrl = pathToFileURL(bundlePath).href;
  // The cache-bust is `load`, not `t`: Vite strips a `t=` query as its own HMR
  // timestamp, so under any Vite-based module runner (the test suite's) a `t`
  // bust answered the first bundle again and a rules reload re-ran the old rules.
  const module = (await import(`${moduleUrl}?load=${Date.now()}`)) as Record<string, unknown>;

  if (!module.gameDefinition) {
    throw new Error('Rules module must export a gameDefinition');
  }

  // boardsmith.json's game options, the one declaration (#701), as the
  // published bundle carries them (see rulesEntrySource).
  return {
    ...module,
    gameDefinition: withDeclaredGameOptions(module.gameDefinition as GameDefinition, args.gameOptions),
    // Where the bundle was written, for a worker that imports it again.
    bundlePath,
  };
}
