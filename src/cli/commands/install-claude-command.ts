/**
 * Install BoardSmith Agent Skills for Claude Code
 *
 * This installs the bs- skill family (bs-ingest-rules, bs-build-chunk, bs-check-status,
 * bs-insert-chunk, bs-generate-ai) globally so users can design and build BoardSmith games
 * directly within Claude Code conversations.
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
  local?: boolean; // Install to ./.claude/skills instead of global
  /**
   * Skip the global `npm link` step — used by tests to avoid a global side-effect.
   * Default unset/false, so real installs still link.
   */
  skipLink?: boolean;
}

/** The 5 bs- skill entry points, mapped from their source file to their installed skill name. */
const SKILL_ENTRY_POINTS: Array<{ source: string; skillName: string }> = [
  { source: join('bs', 'ingest-rules.md'), skillName: 'bs-ingest-rules' },
  { source: join('bs', 'build-chunk.md'), skillName: 'bs-build-chunk' },
  { source: join('bs', 'check-status.md'), skillName: 'bs-check-status' },
  { source: join('bs', 'insert-chunk.md'), skillName: 'bs-insert-chunk' },
  { source: 'generate-ai-instructions.md', skillName: 'bs-generate-ai' },
];

/** Shared reference directories copied as flat siblings under the skills root. */
const SHARED_DIRS = ['build', 'ingest', 'templates', 'aspects'];

/** Filter applied to every recursive tree copy: never ship test files. */
function excludeTestFiles(src: string): boolean {
  return !src.endsWith('.test.ts');
}

/** Every filesystem path this installer owns under `targetDir`. */
function ownedPaths(targetDir: string): string[] {
  return [
    ...SKILL_ENTRY_POINTS.map(({ skillName }) => join(targetDir, skillName)),
    ...SHARED_DIRS.map((dirName) => join(targetDir, dirName)),
    join(targetDir, 'state-machine.md'),
  ];
}

/**
 * The full set of paths a complete install must contain. Used to distinguish a complete
 * install (short-circuit as "already installed") from a partial/interrupted one (proceed).
 */
function expectedInstallPaths(targetDir: string): string[] {
  return [
    ...SKILL_ENTRY_POINTS.map(({ skillName }) => join(targetDir, skillName, 'SKILL.md')),
    ...SHARED_DIRS.map((dirName) => join(targetDir, dirName)),
    join(targetDir, 'state-machine.md'),
  ];
}

/** True only when EVERY expected install path is present (a complete, non-partial install). */
async function isFullyInstalled(targetDir: string): Promise<boolean> {
  for (const path of expectedInstallPaths(targetDir)) {
    try {
      await fs.access(path);
    } catch {
      return false; // Missing piece → partial/absent install
    }
  }
  return true;
}

/**
 * Copy the Agent Skills tree (5 SKILL.md entry points + shared reference tree) into targetDir.
 *
 * Returns true if anything was installed, false if it already existed and force was not set.
 */
async function copySkillTree(
  boardsmithRoot: string,
  targetDir: string,
  force: boolean
): Promise<boolean> {
  const slashCommandDir = join(boardsmithRoot, 'src', 'cli', 'slash-command');
  const bsDir = join(slashCommandDir, 'bs');

  // "Already installed" must mean the FULL expected set is present, not a single sentinel.
  // A partial/interrupted install (e.g. first SKILL.md written but shared tree never copied)
  // must NOT short-circuit as complete — it falls through to a clean re-copy that finishes it.
  if (!force && (await isFullyInstalled(targetDir))) {
    return false; // Fully installed, not overwriting
  }

  // Pre-clean every installer-owned path before copying so the result is authoritative:
  // fs.cp merges into an existing tree and never deletes orphans (renamed/removed upstream
  // files), so a --force reinstall (or completing a partial install) must delete first to
  // produce a tree identical to a fresh install. Only paths this installer owns are removed —
  // never the user's wider ~/.claude/skills tree. fs.rm with force:true is a no-op if absent.
  for (const path of ownedPaths(targetDir)) {
    await fs.rm(path, { recursive: true, force: true });
  }

  // Entry points: read each source .md verbatim, write to <targetDir>/<skillName>/SKILL.md
  for (const { source, skillName } of SKILL_ENTRY_POINTS) {
    const sourcePath = join(slashCommandDir, source);
    const skillDir = join(targetDir, skillName);
    await fs.mkdir(skillDir, { recursive: true });
    const content = await fs.readFile(sourcePath, 'utf-8');
    await fs.writeFile(join(skillDir, 'SKILL.md'), content);
  }

  // Shared reference dirs: copy recursively, excluding *.test.ts, as flat siblings.
  for (const dirName of SHARED_DIRS) {
    const srcDir = dirName === 'aspects' ? join(slashCommandDir, 'aspects') : join(bsDir, dirName);
    const destDir = join(targetDir, dirName);
    await fs.cp(srcDir, destDir, { recursive: true, filter: excludeTestFiles });
  }

  // state-machine.md: single file copy.
  await fs.copyFile(join(bsDir, 'state-machine.md'), join(targetDir, 'state-machine.md'));

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
    ? join(process.cwd(), '.claude', 'skills')
    : join(homedir(), '.claude', 'skills');

  // Create skills directory if it doesn't exist
  await fs.mkdir(targetDir, { recursive: true });

  const force = options.force ?? false;

  const installed = await copySkillTree(boardsmithRoot, targetDir, force);

  if (!installed) {
    console.log(chalk.yellow('BoardSmith skills already installed at:'));
    console.log(chalk.gray(`  ${targetDir}`));
    console.log('');
    console.log('Use --force to overwrite.');
    return;
  }

  // Link BoardSmith globally so `npx boardsmith` works anywhere
  if (!options.skipLink) {
    console.log(chalk.gray('Linking BoardSmith globally...'));
    try {
      execSync('npm link --force', { cwd: boardsmithRoot, stdio: 'pipe' });
      console.log(chalk.green('✓ BoardSmith linked globally'));
    } catch (err) {
      // Check if it's ALREADY linked globally without touching the network. A bare
      // `npx boardsmith --version` would DOWNLOAD and execute a registry package named
      // "boardsmith" when none is linked locally — an unrequested network side-effect,
      // a supply-chain surface if a squatter owns that name, and a hang/prompt in CI.
      // `npm ls -g` only inspects already-installed global packages and never fetches.
      try {
        execSync('npm ls -g --depth=0 boardsmith', { stdio: 'pipe' });
        console.log(chalk.green('✓ BoardSmith already linked globally'));
      } catch {
        console.error(chalk.yellow('Warning: Could not link BoardSmith globally.'));
        console.error(chalk.gray('You may need to run with sudo or fix npm permissions.'));
        console.error(chalk.gray(`Manual fix: cd ${boardsmithRoot} && npm link`));
      }
    }
  }

  console.log(chalk.green('✓ Installed BoardSmith skills for Claude Code'));
  console.log('');
  console.log(chalk.gray(`  Location: ${targetDir}`));
  console.log(chalk.gray(`  BoardSmith: ${boardsmithRoot}`));
  console.log('');
  console.log('Skills:');
  console.log(chalk.cyan('  bs-ingest-rules') + chalk.gray('  - Ingest a rulebook and produce the initial sketch/chunk plan'));
  console.log(chalk.cyan('  bs-build-chunk') + chalk.gray('   - Build, test, audit, and playtest one chunk at a time'));
  console.log(chalk.cyan('  bs-check-status') + chalk.gray('  - Report sketch/chunk progress and next steps'));
  console.log(chalk.cyan('  bs-insert-chunk') + chalk.gray('  - Insert a new chunk into an existing sketch'));
  console.log(chalk.cyan('  bs-generate-ai') + chalk.gray('   - Generate AI evaluation functions for a game chunk'));
  console.log('');
  console.log(chalk.gray('Each skill reads from a shared reference tree (build/, ingest/,'));
  console.log(chalk.gray('templates/, aspects/, state-machine.md) installed alongside it.'));
  console.log(chalk.gray('Projects built with an older BoardSmith skill are auto-detected'));
  console.log(chalk.gray('and offered a one-time conversion by bs-ingest-rules.'));
  console.log('');

  if (options.local) {
    console.log(chalk.yellow('Note: Installed locally to this project.'));
    console.log('Run without --local to install globally.');
  }
}

export async function uninstallClaudeCommand(options: { local?: boolean } = {}): Promise<void> {
  const targetDir = options.local
    ? join(process.cwd(), '.claude', 'skills')
    : join(homedir(), '.claude', 'skills');

  let removedAny = false;

  const itemsToRemove = [
    ...SKILL_ENTRY_POINTS.map(({ skillName }) => skillName),
    ...SHARED_DIRS,
    'state-machine.md',
  ];

  for (const item of itemsToRemove) {
    const itemPath = join(targetDir, item);
    try {
      await fs.access(itemPath);
    } catch {
      continue; // Doesn't exist, skip
    }
    await fs.rm(itemPath, { recursive: true, force: true });
    console.log(chalk.gray(`  Removed: ${itemPath}`));
    removedAny = true;
  }

  if (removedAny) {
    console.log(chalk.green('✓ Uninstalled BoardSmith skills'));
  } else {
    console.log(chalk.yellow('No BoardSmith skills found.'));
  }
}
