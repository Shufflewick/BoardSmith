/**
 * Install BoardSmith slash commands for Claude Code
 *
 * This installs the /design-game and /generate-ai slash commands globally
 * so users can design games and generate AI directly within Claude Code conversations.
 */

import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface InstallOptions {
  force?: boolean;
  local?: boolean; // Install to ./.claude/commands instead of global
}

/**
 * Install a single slash command
 *
 * For commands with instructions files, embeds the full content to be self-contained.
 * No external file reads required when the command runs.
 */
async function installCommand(
  commandName: string,
  boardsmithRoot: string,
  targetDir: string,
  force: boolean
): Promise<boolean> {
  const targetPath = join(targetDir, `${commandName}.md`);

  // Check if command already exists
  try {
    await fs.access(targetPath);
    if (!force) {
      return false; // Already exists, not overwriting
    }
  } catch {
    // File doesn't exist, that's fine
  }

  const slashCommandDir = join(boardsmithRoot, 'src', 'cli', 'slash-command');
  let content: string;

  // Map command names to their instructions files
  const instructionsFiles: Record<string, string> = {
    'design-game': 'instructions.md',
    'generate-ai': 'generate-ai-instructions.md',
  };

  const instructionsFile = instructionsFiles[commandName];
  const instructionsPath = instructionsFile ? join(slashCommandDir, instructionsFile) : null;

  if (instructionsPath) {
    try {
      // Read instructions and create self-contained command
      const instructions = await fs.readFile(instructionsPath, 'utf-8');

      // Create self-contained command with embedded instructions
      const titles: Record<string, string> = {
        'design-game': 'Design a BoardSmith Game',
        'generate-ai': 'Generate AI for BoardSmith Game',
      };

      // Simple header - BoardSmith is linked globally so no path needed
      content = `# ${titles[commandName] ?? commandName}

${instructions}`;

    } catch (err) {
      console.error(chalk.red(`Error: Could not read instructions for ${commandName}.`));
      console.error(chalk.gray(`Looked in: ${instructionsPath}`));
      return false;
    }
  } else {
    // No instructions mapping - fall back to template
    const templatePath = join(slashCommandDir, `${commandName}.template.md`);
    try {
      const template = await fs.readFile(templatePath, 'utf-8');
      content = template.replace(/\{\{BOARDSMITH_ROOT\}\}/g, boardsmithRoot);
    } catch {
      console.error(chalk.red(`Error: Could not find ${commandName} template.`));
      console.error(chalk.gray(`Looked in: ${slashCommandDir}`));
      return false;
    }
  }

  // Write to target
  await fs.writeFile(targetPath, content);
  return true;
}

export async function installClaudeCommand(options: InstallOptions = {}): Promise<void> {
  // Determine BoardSmith root (go up from packages/cli/dist/ where bundled cli.js lives)
  const boardsmithRoot = resolve(__dirname, '../../..');

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

  const force = options.force ?? false;

  // Check if any commands already exist (without force)
  if (!force) {
    const designGamePath = join(targetDir, 'design-game.md');
    const generateAiPath = join(targetDir, 'generate-ai.md');
    let existingCommands = false;

    try {
      await fs.access(designGamePath);
      existingCommands = true;
    } catch {
      // doesn't exist
    }

    try {
      await fs.access(generateAiPath);
      existingCommands = true;
    } catch {
      // doesn't exist
    }

    if (existingCommands) {
      console.log(chalk.yellow('Slash commands already installed at:'));
      console.log(chalk.gray(`  ${targetDir}`));
      console.log('');
      console.log('Use --force to overwrite.');
      return;
    }
  }

  // Install both commands
  const designGameInstalled = await installCommand('design-game', boardsmithRoot, targetDir, force);
  const generateAiInstalled = await installCommand('generate-ai', boardsmithRoot, targetDir, force);

  if (!designGameInstalled && !generateAiInstalled) {
    console.error(chalk.red('Error: Failed to install slash commands.'));
    process.exit(1);
  }

  // Link BoardSmith globally so `npx boardsmith` works anywhere
  console.log(chalk.gray('Linking BoardSmith globally...'));
  try {
    execSync('npm link --force', { cwd: boardsmithRoot, stdio: 'pipe' });
    console.log(chalk.green('✓ BoardSmith linked globally'));
  } catch (err) {
    // Check if it's already linked by trying to run boardsmith
    try {
      execSync('npx boardsmith --version', { stdio: 'pipe' });
      console.log(chalk.green('✓ BoardSmith already linked globally'));
    } catch {
      console.error(chalk.yellow('Warning: Could not link BoardSmith globally.'));
      console.error(chalk.gray('You may need to run with sudo or fix npm permissions.'));
      console.error(chalk.gray(`Manual fix: cd ${boardsmithRoot} && npm link`));
    }
  }

  console.log(chalk.green('✓ Installed BoardSmith slash commands for Claude Code'));
  console.log('');
  console.log(chalk.gray(`  Location: ${targetDir}`));
  console.log(chalk.gray(`  BoardSmith: ${boardsmithRoot}`));
  console.log('');
  console.log('Commands:');
  console.log(chalk.cyan('  /design-game') + chalk.gray('  - Design and generate a new BoardSmith game'));
  console.log(chalk.cyan('  /generate-ai') + chalk.gray('  - Generate AI evaluation functions for existing game'));
  console.log('');
  console.log(chalk.gray('The /design-game skill is self-contained - no additional'));
  console.log(chalk.gray('frameworks or dependencies required.'));
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

  const designGamePath = join(targetDir, 'design-game.md');
  const generateAiPath = join(targetDir, 'generate-ai.md');

  let removedAny = false;

  // Remove design-game command
  try {
    await fs.unlink(designGamePath);
    console.log(chalk.gray(`  Removed: ${designGamePath}`));
    removedAny = true;
  } catch {
    // File doesn't exist
  }

  // Remove generate-ai command
  try {
    await fs.unlink(generateAiPath);
    console.log(chalk.gray(`  Removed: ${generateAiPath}`));
    removedAny = true;
  } catch {
    // File doesn't exist
  }

  if (removedAny) {
    console.log(chalk.green('✓ Uninstalled BoardSmith slash commands'));
  } else {
    console.log(chalk.yellow('No BoardSmith slash commands found.'));
  }
}
