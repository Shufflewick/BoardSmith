import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { build as viteBuild } from 'vite';
import chalk from 'chalk';
import ora from 'ora';
import { BUNDLE_PROTOCOL_VERSION } from '../../engine/protocol-version.js';
import { getProjectContext, loadGameDefinition } from './game-runtime.js';
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
  protocolVersion: number,
): Record<string, unknown> {
  return {
    ...config,
    buildTime: new Date().toISOString(),
    version: (config.version as string | undefined) || '1.0.0',
    // Stamp the engine ABI version so the executor can reject a bundle built
    // against an incompatible BoardSmith (INFRA-04). Automatic — authors never
    // set this; it comes from the BoardSmith building the bundle.
    engineProtocol: protocolVersion,
    // Derived — never copied from the raw config spread. Overwrites any
    // stale playerCount that may still be present in boardsmith.json.
    playerCount: {
      min: gameDefinition.minPlayers,
      max: gameDefinition.maxPlayers,
    },
  };
}

export async function buildCommand(options: BuildOptions): Promise<void> {
  const cwd = process.cwd();
  const outDir = options.outDir || 'dist';

  // Detect context - build is only for game projects, not the library
  const context = getProjectContext(cwd);
  if (context === 'monorepo') {
    console.error(chalk.red('Error: boardsmith build is for game projects, not the BoardSmith library'));
    console.error(chalk.dim('To build BoardSmith itself, use the appropriate build tooling.'));
    process.exit(1);
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
    const tempDir = join(cwd, '.boardsmith');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    let gameDefinition: GameDefinition;
    try {
      ({ gameDefinition } = await loadGameDefinition(rulesPath, tempDir, context));
    } finally {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup; do not mask the original error
      }
    }

    const manifest = deriveManifest(config, gameDefinition, BUNDLE_PROTOCOL_VERSION);

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
