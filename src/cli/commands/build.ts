import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { build as viteBuild } from 'vite';
import chalk from 'chalk';
import ora from 'ora';

interface BuildOptions {
  outDir?: string;
}

/**
 * Detect if we're running in the BoardSmith monorepo or a standalone game project.
 * - Monorepo: Has src/engine/ directory (collapsed structure)
 * - Standalone: Has boardsmith.json but no src/engine/
 */
function getProjectContext(cwd: string): 'monorepo' | 'standalone' {
  const hasSrcEngine = existsSync(join(cwd, 'src', 'engine'));
  const hasBoardsmithJson = existsSync(join(cwd, 'boardsmith.json'));

  // If we're in the monorepo root, it has src/engine
  if (hasSrcEngine) return 'monorepo';

  // Standalone game project
  if (hasBoardsmithJson) return 'standalone';

  // Fallback - treat as standalone (will fail with proper error if neither)
  return 'standalone';
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
    await viteBuild({
      root: cwd,
      build: {
        outDir: join(outDir, 'rules'),
        lib: {
          entry: join(cwd, 'src/rules/index.ts'),
          name: config.name,
          fileName: 'rules',
          formats: ['es'],
        },
        rollupOptions: {
          // Mark boardsmith and all its subpath exports as external
          external: ['boardsmith', /^boardsmith\//],
        },
        emptyOutDir: true,
      },
      logLevel: 'warn',
    });
    spinner.succeed('Game rules built');

    // Build UI (Vue -> JS bundle)
    spinner.start('Building UI...');
    await viteBuild({
      root: cwd,
      build: {
        outDir: join(outDir, 'ui'),
        emptyOutDir: true,
      },
      logLevel: 'warn',
    });
    spinner.succeed('UI built');

    // Copy and update config
    spinner.start('Generating manifest...');
    const manifest = {
      ...config,
      buildTime: new Date().toISOString(),
      version: config.version || '1.0.0',
    };

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
