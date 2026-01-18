import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';

interface PublishOptions {
  dryRun?: boolean;
}

export async function publishCommand(options: PublishOptions): Promise<void> {
  const cwd = process.cwd();

  // Validate project
  const configPath = join(cwd, 'boardsmith.json');
  if (!existsSync(configPath)) {
    console.error(chalk.red('Error: boardsmith.json not found'));
    console.error(chalk.dim('Make sure you are in a BoardSmith game project directory'));
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));

  console.log(chalk.cyan(`\nPreparing to publish ${config.displayName || config.name}...\n`));

  // Check for built artifacts
  const distDir = join(cwd, 'dist');
  if (!existsSync(distDir)) {
    console.error(chalk.red('Error: No build found'));
    console.error(chalk.dim('Run `boardsmith build` first to create production bundles'));
    process.exit(1);
  }

  const spinner = ora('Validating build...').start();

  // Check manifest
  const manifestPath = join(distDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    spinner.fail('Invalid build');
    console.error(chalk.dim('manifest.json not found in dist/'));
    console.error(chalk.dim('Run `boardsmith build` to regenerate'));
    process.exit(1);
  }

  spinner.succeed('Build validated');

  if (options.dryRun) {
    console.log(chalk.yellow('\nDry run mode - no changes will be made\n'));
    console.log(chalk.dim('Would publish:'));
    console.log(chalk.dim(`  Game: ${config.displayName || config.name}`));
    console.log(chalk.dim(`  Version: ${config.version || '1.0.0'}`));
    console.log(chalk.dim(`  Players: ${config.playerCount?.min}-${config.playerCount?.max}`));
    console.log('');
    return;
  }

  // Check authentication (stub - platform not built yet)
  spinner.start('Checking authentication...');

  // Simulate auth check
  await sleep(500);
  spinner.warn('Authentication required');

  console.log(chalk.yellow('\nPublishing is not yet available.\n'));
  console.log(chalk.dim('The boardsmith.io platform is coming soon!'));
  console.log(chalk.dim('For now, use `boardsmith dev` to test your game locally.\n'));

  console.log(chalk.cyan('What you can do now:'));
  console.log(chalk.dim('  boardsmith dev       - Test locally with multiple players'));
  console.log(chalk.dim('  boardsmith validate  - Ensure your game meets requirements'));
  console.log(chalk.dim('  boardsmith build     - Create production bundles\n'));

  console.log(chalk.dim('Stay tuned for boardsmith.io launch!\n'));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
