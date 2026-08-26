import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { build as viteBuild } from 'vite';
import chalk from 'chalk';
import ora from 'ora';
import { BUNDLE_PROTOCOL_VERSION } from '../../engine/protocol-version.js';
import { ENGINE_REVISION } from '../../contract/index.js';
import { getProjectContext, loadGameDefinition } from './game-runtime.js';
import { buildCli, CLI_ENTRY, CLI_OUTFILE } from '../lib/build-cli.js';
import type { GameDefinition } from '../../session/index.js';

interface BuildOptions {
  outDir?: string;
}

/**
 * Pure manifest-derivation function (T-135-07). Takes the raw parsed
 * `boardsmith.json` config and the COMPILED `gameDefinition`, and returns the
 * publish manifest with `playerCount` explicitly computed from
 * `gameDefinition.minPlayers`/`maxPlayers` — set AFTER the `...config`
 * spread so the derived value always overwrites any stale/hand-edited
 * `playerCount` key that might be present in `config` (CLIX-01 / F9).
 *
 * Keeps the existing `playerCount: { min, max }` key name and shape to
 * preserve the external publish-platform contract (135-RESEARCH.md Open
 * Question A1).
 */
export function deriveManifest(
  config: Record<string, unknown>,
  gameDefinition: Pick<GameDefinition, 'minPlayers' | 'maxPlayers'>,
  engine: { protocol: number; revision: number },
): Record<string, unknown> {
  const { minPlayers, maxPlayers } = gameDefinition;
  // The platform syncs playerCount on every publish (the catalog must never
  // disagree with what the lobby enforces), so a bundle without it is
  // unpublishable — fail the build here with the fix, not later on the server.
  if (!Number.isInteger(minPlayers) || !Number.isInteger(maxPlayers)) {
    throw new Error(
      'Cannot determine player count: the game definition is missing minPlayers/maxPlayers. '
      + 'Declare both as integers in your gameDefinition (src/rules/index.ts), e.g. minPlayers: 2, maxPlayers: 4.',
    );
  }

  return {
    ...config,
    buildTime: new Date().toISOString(),
    version: (config.version as string | undefined) || '1.0.0',
    // Stamp the engine ABI version so the executor can reject a bundle built
    // against an incompatible BoardSmith (INFRA-04). Automatic — authors never
    // set this; it comes from the BoardSmith building the bundle.
    engineProtocol: engine.protocol,
    // Stamp the engine contract revision too. `engineProtocol` only moves on a
    // breaking ABI change, so it cannot express the far more common "this game
    // was built against a newer engine than the platform vendored" — which is
    // the skew that produces mystery runtime bugs. The platform rejects a
    // bundle whose revision exceeds its own. Also automatic.
    engineRevision: engine.revision,
    // Derived — never copied from the raw config spread. Overwrites any
    // stale playerCount that may still be present in boardsmith.json.
    playerCount: {
      min: gameDefinition.minPlayers,
      max: gameDefinition.maxPlayers,
    },
  };
}

/**
 * Build the BoardSmith library's own distributable: the bundled CLI.
 *
 * The engine/ui/session sources ship as TypeScript (see the package `exports`
 * map), so `dist/cli.js` is the only compiled artifact the library produces.
 */
async function buildLibrary(repoRoot: string): Promise<void> {
  console.log(chalk.cyan('\nBuilding BoardSmith CLI...\n'));
  const spinner = ora(`Bundling ${CLI_ENTRY}...`).start();

  try {
    await buildCli(repoRoot);
  } catch (error) {
    spinner.fail('CLI build failed');
    console.error(chalk.red('\nBuild error:'), error);
    process.exit(1);
  }

  spinner.succeed(`CLI built (${CLI_OUTFILE})`);
  console.log(chalk.dim('\n  Installed copies of BoardSmith run this bundle.'));
  console.log(chalk.dim('  Inside this repo the CLI always runs from source, so you rarely need it.\n'));
}

export async function buildCommand(options: BuildOptions): Promise<void> {
  const cwd = process.cwd();
  const outDir = options.outDir || 'dist';

  // `build` means "produce this workspace's distributable artifact". In a game
  // that is the rules/UI bundle below; in the BoardSmith library itself it is
  // the CLI bundle that installed copies of the package run.
  const context = getProjectContext(cwd);
  if (context === 'monorepo') {
    await buildLibrary(cwd);
    return;
  }

  // Validate project
  const configPath = join(cwd, 'boardsmith.json');
  if (!existsSync(configPath)) {
    console.error(chalk.red('Error: boardsmith.json not found'));
    console.error(chalk.dim('Make sure you are in a BoardSmith game project directory'));
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  console.log(chalk.cyan(`\nBuilding ${config.displayName || config.name}...\n`));

  const spinner = ora('Building game rules...').start();

  try {
    // Build rules (TypeScript -> JS)
    // copyPublicDir disabled — public/ is copied once to dist root below
    await viteBuild({
      root: cwd,
      build: {
        outDir: join(outDir, 'rules'),
        copyPublicDir: false,
        lib: {
          entry: join(cwd, 'src/rules/index.ts'),
          name: config.name,
          fileName: () => 'rules.js',
          formats: ['cjs'],
        },
        rollupOptions: {
          // Mark boardsmith and all its subpath exports as external
          external: ['boardsmith', /^boardsmith\//],
        },
        emptyOutDir: true,
        // Keep class names — the game engine uses constructor.name for element
        // type identification in serialized state and player views.
        minify: 'esbuild',
      },
      esbuild: {
        keepNames: true,
      },
      logLevel: 'warn',
    });
    spinner.succeed('Game rules built');

    // Build UI (Vue -> JS bundle)
    spinner.start('Building UI...');
    await viteBuild({
      root: cwd,
      base: './',
      build: {
        outDir: join(outDir, 'ui'),
        copyPublicDir: false,
        emptyOutDir: true,
      },
      logLevel: 'warn',
    });
    spinner.succeed('UI built');

    // Copy public/ assets once to dist root (not into each sub-build)
    const publicDir = join(cwd, 'public');
    if (existsSync(publicDir)) {
      cpSync(publicDir, join(cwd, outDir), { recursive: true });
    }

    // Copy and update config
    spinner.start('Generating manifest...');

    // Load the COMPILED gameDefinition (Node-side) so playerCount can be
    // derived from code, never copied from the raw boardsmith.json spread
    // (CLIX-01 / T-135-07 — mirrors simulate.ts:158-167).
    const rulesPath = join(cwd, 'src', 'rules');
    // Command-scoped subdirectory (WR-02): `.boardsmith` is SHARED — pack puts
    // tarballs in `.boardsmith/tarballs`, evolve-bot-weights reads
    // `.boardsmith/rules-bundle.mjs`, and a running dev server keeps its
    // runtime bundle there. Only ever create and delete what build owns.
    const tempDir = join(cwd, '.boardsmith', 'build-tmp');
    mkdirSync(tempDir, { recursive: true });

    let gameDefinition: GameDefinition;
    try {
      ({ gameDefinition } = await loadGameDefinition(rulesPath, tempDir, context));
    } finally {
      try {
        // Removes only build-tmp — never the shared .boardsmith parent.
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup; do not mask the original error
      }
    }

    const manifest = deriveManifest(config, gameDefinition, {
      protocol: BUNDLE_PROTOCOL_VERSION,
      revision: ENGINE_REVISION,
    });

    mkdirSync(join(cwd, outDir), { recursive: true });
    writeFileSync(
      join(cwd, outDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    spinner.succeed('Manifest generated');

    // Report build sizes
    console.log(chalk.green('\nBuild complete!\n'));
    console.log(chalk.dim(`  Output: ${outDir}/`));
    console.log(chalk.dim(`    rules/  - Game logic bundle`));
    console.log(chalk.dim(`    ui/     - User interface bundle`));
    console.log(chalk.dim(`    manifest.json - Game metadata\n`));

    console.log(chalk.cyan('Next steps:'));
    console.log(chalk.dim('  boardsmith validate  - Run pre-publish checks'));
    console.log(chalk.dim('  boardsmith publish   - Publish to boardsmith.io\n'));

  } catch (error) {
    spinner.fail('Build failed');
    console.error(chalk.red('\nBuild error:'), error);
    process.exit(1);
  }
}
