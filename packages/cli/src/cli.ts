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
  .option('--players <count>', 'Number of player tabs to open', '2')
  .option('--worker-port <port>', 'Worker/API server port', '8787')
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

// Publishing
program
  .command('publish')
  .description('Publish game to boardsmith.io')
  .option('--dry-run', 'Show what would be published without uploading')
  .action(publishCommand);

program.parse();
