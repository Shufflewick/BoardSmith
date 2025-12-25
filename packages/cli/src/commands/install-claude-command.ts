/**
 * Install BoardSmith slash command for Claude Code
 *
 * This installs the /design-game slash command globally so users can
 * design games directly within Claude Code conversations.
 */

import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface InstallOptions {
  force?: boolean;
  local?: boolean; // Install to ./.claude/commands instead of global
}

export async function installClaudeCommand(options: InstallOptions = {}): Promise<void> {
  // Determine BoardSmith root (go up from packages/cli/dist/commands)
  const boardsmithRoot = resolve(__dirname, '../../../..');

  // Verify this is actually a BoardSmith installation
  try {
    const packageJson = await fs.readFile(join(boardsmithRoot, 'package.json'), 'utf-8');
    const pkg = JSON.parse(packageJson);
    if (!pkg.name?.includes('boardsmith')) {
      throw new Error('Not a BoardSmith installation');
    }
  } catch {
    console.error(chalk.red('Error: Could not find BoardSmith installation.'));
    console.error(chalk.gray(`Looked in: ${boardsmithRoot}`));
    process.exit(1);
  }

  // Determine target directory
  const targetDir = options.local
    ? join(process.cwd(), '.claude', 'commands')
    : join(homedir(), '.claude', 'commands');

  // Create commands directory if it doesn't exist
  await fs.mkdir(targetDir, { recursive: true });

  const targetPath = join(targetDir, 'design-game.md');

  // Check if command already exists
  try {
    await fs.access(targetPath);
    if (!options.force) {
      console.log(chalk.yellow('Slash command already installed at:'));
      console.log(chalk.gray(`  ${targetPath}`));
      console.log('');
      console.log('Use --force to overwrite.');
      return;
    }
  } catch {
    // File doesn't exist, that's fine
  }

  // Read template - look in src directory (not dist) since .md files aren't compiled
  const templatePath = join(boardsmithRoot, 'packages', 'cli', 'src', 'slash-command', 'design-game.template.md');
  let template: string;

  try {
    template = await fs.readFile(templatePath, 'utf-8');
  } catch {
    console.error(chalk.red('Error: Could not find slash command template.'));
    console.error(chalk.gray(`Looked in: ${templatePath}`));
    process.exit(1);
  }

  // Replace placeholder with actual path
  const content = template.replace(/\{\{BOARDSMITH_ROOT\}\}/g, boardsmithRoot);

  // Write to target
  await fs.writeFile(targetPath, content);

  console.log(chalk.green('✓ Installed BoardSmith slash command for Claude Code'));
  console.log('');
  console.log(chalk.gray(`  Location: ${targetPath}`));
  console.log(chalk.gray(`  BoardSmith: ${boardsmithRoot}`));
  console.log('');
  console.log('Usage in Claude Code:');
  console.log(chalk.cyan('  /design-game'));
  console.log('');

  if (options.local) {
    console.log(chalk.yellow('Note: Installed locally to this project.'));
    console.log('Run without --local to install globally.');
  }
}

export async function uninstallClaudeCommand(options: { local?: boolean } = {}): Promise<void> {
  const targetDir = options.local
    ? join(process.cwd(), '.claude', 'commands')
    : join(homedir(), '.claude', 'commands');

  const targetPath = join(targetDir, 'design-game.md');

  try {
    await fs.unlink(targetPath);
    console.log(chalk.green('✓ Uninstalled BoardSmith slash command'));
    console.log(chalk.gray(`  Removed: ${targetPath}`));
  } catch {
    console.log(chalk.yellow('Slash command not found.'));
  }
}
