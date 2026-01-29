#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { devCommand } from './commands/dev.js';
import { buildCommand } from './commands/build.js';
import { testCommand } from './commands/test.js';
import { validateCommand } from './commands/validate.js';
import { publishCommand } from './commands/publish.js';
import { lintCommand } from './commands/lint.js';
import { analyzeCommand } from './commands/analyze.js';
import { installClaudeCommand, uninstallClaudeCommand } from './commands/install-claude-command.js';
import { evolveAIWeightsCommand } from './commands/evolve-ai-weights.js';
import { packCommand } from './commands/pack.js';

const program = new Command();

program
  .name('boardsmith')
  .description('BoardSmith CLI - Build and run board games')
  .version('0.0.1');

// Project initialization
program
  .command('init <name>')
  .description('Create a new BoardSmith game project')
  .option('-t, --template <template>', 'Template to use (default: card-game)', 'card-game')
  .action(initCommand);

// Development
program
  .command('dev')
  .description('Start local development server')
  .option('-p, --port <port>', 'UI server port', '5173')
  .option('--host <host>', 'Host to bind servers to (e.g., 0.0.0.0 for network access)')
  .option('--players <count>', 'Number of player tabs to open', '2')
  .option('-w, --worker-port <port>', 'Worker/API server port', '8787')
  .option('--ai <players...>', 'Player positions to be AI (e.g., --ai 1 or --ai 0 2)')
  .option('--ai-level <level>', 'AI difficulty: easy, medium, hard, expert, or iteration count', 'medium')
  .option('--lobby', 'Open game lobby instead of auto-creating a game')
  .option('--persist [path]', 'Persist games to SQLite (default: .boardsmith/games.db)')
  .option('--debug', 'Enable debug mode for verbose logging of actions, flow, and commands')
  .action(devCommand);

// Testing
program
  .command('test')
  .description('Run game tests')
  .option('-w, --watch', 'Watch mode - re-run tests on changes')
  .option('--coverage', 'Generate coverage report')
  .action(testCommand);

// Building
program
  .command('build')
  .description('Build game for production')
  .option('-o, --out-dir <dir>', 'Output directory', 'dist')
  .action(buildCommand);

// Packing for local development
program
  .command('pack')
  .description('Create tarballs of all public packages for local installation')
  .option('-o, --out-dir <dir>', 'Output directory for tarballs', '.boardsmith/tarballs')
  .option('-t, --target <path>', 'Copy tarballs to target project and update dependencies')
  .action(packCommand);

// Validation
program
  .command('validate')
  .description('Validate game before publishing')
  .option('--fix', 'Attempt to auto-fix issues')
  .option('--skip-simulation', 'Skip random game simulation')
  .action(validateCommand);

// Linting
program
  .command('lint')
  .description('Check for common BoardSmith pitfalls and issues')
  .option('--fix', 'Attempt to auto-fix issues (coming soon)')
  .action(lintCommand);

// Analysis
program
  .command('analyze')
  .description('Analyze game complexity and structure')
  .option('--json', 'Output results as JSON')
  .option('-v, --verbose', 'Show detailed information')
  .action(analyzeCommand);

// AI Weight Evolution (new focused command)
program
  .command('evolve-ai-weights')
  .description('Optimize AI weights through evolutionary self-play (requires existing ai.ts)')
  .option('--generations <count>', 'Evolution generations (default: 5)')
  .option('--population <count>', 'Population size per generation (default: 20)')
  .option('-m, --mcts <iterations>', 'MCTS iterations for benchmarking (default: 100)')
  .option('--workers <count>', 'Number of worker threads (default: CPU cores - 1)')
  .option('-v, --verbose', 'Show detailed progress')
  .action(evolveAIWeightsCommand);

// Publishing
program
  .command('publish')
  .description('Publish game to boardsmith.io')
  .option('--dry-run', 'Show what would be published without uploading')
  .action(publishCommand);

// Claude Code integration
const claudeCmd = program
  .command('claude')
  .description('Install Claude Code slash commands for game design')
  .option('--force', 'Overwrite existing slash commands')
  .option('--local', 'Install to current project instead of globally')
  .action(installClaudeCommand);

claudeCmd
  .command('uninstall')
  .description('Remove /design-game and /generate-ai slash commands')
  .option('--local', 'Uninstall from current project instead of globally')
  .action(uninstallClaudeCommand);

program.parse();
