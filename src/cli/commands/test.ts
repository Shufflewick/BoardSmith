import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import chalk from 'chalk';

interface TestOptions {
  watch?: boolean;
  coverage?: boolean;
}

export async function testCommand(options: TestOptions): Promise<void> {
  const cwd = process.cwd();

  // Validate project
  const configPath = join(cwd, 'boardsmith.json');
  if (!existsSync(configPath)) {
    console.error(chalk.red('Error: boardsmith.json not found'));
    console.error(chalk.dim('Make sure you are in a BoardSmith game project directory'));
    process.exit(1);
  }

  // Check for test files
  const testsDir = join(cwd, 'tests');
  if (!existsSync(testsDir)) {
    console.log(chalk.yellow('No tests directory found.'));
    console.log(chalk.dim('Create tests in the tests/ directory'));
    process.exit(0);
  }

  console.log(chalk.cyan('\nRunning game tests...\n'));

  // Build vitest args
  const args = ['vitest', 'run'];

  if (options.watch) {
    args[1] = 'watch';
  }

  if (options.coverage) {
    args.push('--coverage');
  }

  // Run vitest via npx
  const child = spawn('npx', args, {
    cwd,
    stdio: 'inherit',
    shell: true,
  });

  child.on('close', (code) => {
    if (code === 0) {
      console.log(chalk.green('\nAll tests passed!\n'));
    } else {
      console.log(chalk.red(`\nTests failed with exit code ${code}\n`));
      process.exit(code || 1);
    }
  });

  child.on('error', (error) => {
    console.error(chalk.red('Failed to run tests:'), error.message);
    console.log(chalk.dim('\nMake sure vitest is installed:'));
    console.log(chalk.dim('  npm install -D vitest\n'));
    process.exit(1);
  });
}
