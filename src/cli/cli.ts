#!/usr/bin/env node
import { Command } from 'commander';
import { readBoardsmithVersion } from './lib/boardsmith-version.js';
import { initCommand } from './commands/init.js';
import { devCommand } from './commands/dev.js';
import { buildCommand } from './commands/build.js';
import { testCommand } from './commands/test.js';
import { validateCommand } from './commands/validate.js';
import { publishCommand } from './commands/publish.js';
import { lintCommand } from './commands/lint.js';
import { analyzeCommand } from './commands/analyze.js';
import { simulateCommand } from './commands/simulate.js';
import { installClaudeCommand, uninstallClaudeCommand } from './commands/install-claude-command.js';
import {
  ingestArchiveCommand,
  ingestCheckCommand,
  ingestGapsCommand,
  ingestRelabelCommand,
} from './commands/ingest-archive.js';
import { evolveAIWeightsCommand } from './commands/evolve-ai-weights.js';
import { packCommand } from './commands/pack.js';

const program = new Command();

program
  .name('boardsmith')
  .description('BoardSmith CLI - Build and run board games')
  .version(readBoardsmithVersion());

// Project initialization
program
  .command('init <name>')
  .description('Create a new BoardSmith game project')
  .option('--rulebook <path>', 'Archive this source rulebook into the new project and write rulebook/INDEX.md provenance')
  .option('--edition <edition>', 'Edition string as stated in the rulebook (used with --rulebook)')
  .option('--without-rulebook', 'Explicitly declare no rulebook exists (the interview path supplies rulebook/ content)')
  .action(initCommand);

// Development
program
  .command('dev')
  .description('Start local development server')
  .option('-p, --port <port>', 'Dev host server port', '5173')
  .option('--host <host>', 'Host to bind the server to (default: 127.0.0.1, local-only; pass 0.0.0.0 or --lan to serve to your whole network; cannot be combined with --lan)')
  .option('--lan', 'Shorthand for --host 0.0.0.0 -- serves to your whole network (cannot be combined with --host)')
  .option('--players <count>', 'Initial number of players (default: the game\'s minPlayers)')
  .option('--ai <players...>', 'Player positions to be AI (e.g., --ai 1 or --ai 2 4)')
  .option('--ai-level <level>', 'AI difficulty: easy, medium, hard, expert, or iteration count', 'medium')
  .option('--game-option <kv...>', 'Select a declared game option as key=value (repeatable, e.g. --game-option difficulty=hard rounds=5)')
  .option('--preset <name>', 'Apply a declared preset\'s whole bundle of game option values (and player count, if the preset declares one)')
  .option('--lock-teaching', 'Disable AI hint, move-quality heatmap, AI-vs-AI demo, and tutorial (action help stays enabled)')
  .option('--seed <file>', 'Seed the initial game state from a recorded GameStateSnapshot JSON file instead of a fresh start (FEAT-01)')
  .option('--no-open', 'Do not auto-launch a browser tab (use when driving the dev host from a script/CI, so an uncontrolled tab does not claim seat 1)')
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
  .action(validateCommand);

// Linting
program
  .command('lint')
  .description('Check for common BoardSmith pitfalls and issues')
  .action(lintCommand);

// Analysis
program
  .command('analyze')
  .description('Analyze game complexity and structure')
  .option('--json', 'Output results as JSON')
  .option('-v, --verbose', 'Show detailed information')
  .action(analyzeCommand);

// Headless simulation
program
  .command('simulate')
  .description('Run seeded headless batch simulation and report pass/stuck/error per game')
  .option('--games <count>', 'Number of games to simulate', '10')
  .option('--seed <seed>', 'Base seed (per-game seeds derived and recorded in output)')
  .option('--players <count>', 'Player count for each simulated game', '2')
  .option('--json', 'Output results as JSON')
  .action(simulateCommand);

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
  .description('Publish game to shufflewick.pub')
  .option('--api-key <key>', 'API key (saved for future use)')
  .option('--publisher <slug>', 'Publisher slug that owns this game (required for a new game)')
  .option('--dry-run', 'Show what would be published without uploading')
  .option('--dev', 'Publish to the local dev platform (http://localhost:3006)')
  .option('--test', 'Publish to the test platform (test.shufflewick.pub)')
  .action(publishCommand);

// Ingest: deterministic archive + hash + INDEX provenance header.
// Mechanical work belongs in code, not in skill text an agent executes from recall.
program
  .command('ingest-archive <rulebook>')
  .description('Archive a source rulebook, hash it, and write rulebook/INDEX.md provenance header')
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--edition <edition>', 'Edition string as stated in the rulebook')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(ingestArchiveCommand);

program
  .command('ingest-gaps')
  .description('Relabel presentation-only Derived lines, then fill Open Rules Gaps from the slices')
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--skip-relabel', 'Do not relabel presentation-only Derived lines first')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(ingestGapsCommand);

program
  .command('ingest-check')
  .description('Repair ingest synthesis (gaps + Derived/Visual) and exit non-zero if it was stale')
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(ingestCheckCommand);

program
  .command('ingest-relabel')
  .description('Relabel Derived (p. lines that are pure presentation descriptions as Visual (p.')
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--dry-run', 'Report what would change without writing')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(ingestRelabelCommand);

// Claude Code integration
const claudeCmd = program
  .command('claude')
  .description('Install BoardSmith bs- skills for Claude Code')
  .option('--force', 'Overwrite existing skills')
  .option('--local', 'Install to current project instead of globally')
  .action(installClaudeCommand);

claudeCmd
  .command('uninstall')
  .description('Remove BoardSmith bs- skills')
  .option('--local', 'Uninstall from current project instead of globally')
  .action(uninstallClaudeCommand);

program.parse();
