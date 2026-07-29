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
import { chunkCheckCommand, chunkProvenanceStatusCommand } from './commands/chunk-provenance.js';
import { traceCheckCommand } from './commands/trace-check.js';
import { driftCheckCommand } from './commands/drift-check.js';
import {
  verifyRunInitCommand,
  verifyRunRecordCommand,
  verifyRunStatusCommand,
} from './commands/verify-run.js';
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

// Provenance: record or repair a chunk's `## Verified Against` block. Same mechanical-work-
// belongs-in-code rationale as the ingest-* family above (171-CONTEXT.md).
program
  .command('chunk-check <slug>')
  .description("Record or repair a chunk's Verified Against provenance block, and exit non-zero if it was stale")
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(chunkCheckCommand);

program
  .command('chunk-provenance-status')
  .description('Report per-chunk verification provenance and drift (read-only)')
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(chunkProvenanceStatusCommand);

// CHECK-03/CHECK-05: the two source-free conformance sweeps (172-CONTEXT.md decisions 5-6).
// Unlike chunk-check above, these never write a file and never repair anything — there is
// nothing to repair, only findings to report — so they never exit non-zero for a finding.
// Non-zero is reserved for a TOOL failure (not a bs- project, not a git repo, etc.).
program
  .command('trace-check')
  .description('Report traceability gaps between Interpretation claims, rulings, and tests (read-only)')
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(traceCheckCommand);

program
  .command('drift-check')
  .description('Report chunks whose Build Manifest files changed since their verified commit (read-only)')
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(driftCheckCommand);

// Verify: staging-tree allocation + the append-only RUN.md resume ledger (VERIFY-02/VERIFY-08,
// 173-CONTEXT.md decisions 5/9/11). Mechanical work belongs in code, not in skill text a session
// executes from recall — same rationale as the ingest-*/chunk-check families above.
program
  .command('verify-run-init')
  .description("Allocate (or resume) a verify pass's non-destructive staging tree and RUN.md resume ledger")
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--run-id <id>', 'Resume an existing run instead of minting a fresh one')
  .option(
    '--ranges <json>',
    'JSON array of page-range ids to persist as this run\'s dispatch-plan manifest, ' +
      'e.g. \'["1-1","2-2"]\' (decided once at first init; ignored when resuming an existing run)',
  )
  .option('--json', 'Emit JSON instead of human-readable output')
  .action((options) => {
    let ranges: string[] | undefined;
    if (options.ranges !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(options.ranges);
      } catch {
        console.error('--ranges must be valid JSON, e.g. --ranges \'["1-1","2-2"]\'');
        process.exit(1);
      }
      if (!Array.isArray(parsed) || !parsed.every((r) => typeof r === 'string')) {
        console.error('--ranges must be a JSON array of strings, e.g. --ranges \'["1-1","2-2"]\'');
        process.exit(1);
      }
      ranges = parsed as string[];
    }
    return verifyRunInitCommand({ ...options, ranges });
  });

program
  .command('verify-run-record')
  .description(
    "Record a completed slice-unit, or a range-level marker, in a verify run's RUN.md ledger " +
      '(idempotent). Exactly one of --unit (with --slice), --complete-range, or --reset-range.',
  )
  .requiredOption('--run-id <id>', 'The run to record against')
  .option('--unit <unit-id>', 'The slice-unit id being recorded')
  .option('--slice <path>', "Path to the written slice, relative to the run's staging dir")
  .option('--range <range-id>', 'Tag this unit record with the manifest range it belongs to')
  .option('--complete-range <range-id>', 'Mark a manifest range as fully recorded')
  .option(
    '--reset-range <range-id>',
    'Supersede a partially-recorded range\'s prior units before redispatching it fresh',
  )
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyRunRecordCommand);

program
  .command('verify-run-status')
  .description('Report which slice-units are recorded for a verify run (read-only, machine-readable)')
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--run-id <id>', 'Report on a specific run instead of the most recent')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyRunStatusCommand);

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

// `program.parse()` does not await async action handlers — a rejection from one (any command
// that throws, e.g. an unreadable rulebook path or a missing chunk slug) would otherwise surface
// as a raw Node unhandled-rejection stack trace, leaking internal file paths and line numbers.
// CLAUDE.md forbids that ("never leak implementation details ... stack traces, internal paths"),
// and this is the same guarantee `ingestCheckCommand`/`chunkCheckCommand` already give on their
// own repair-then-fail terminal paths. `parseAsync()` awaits the action, so a thrown Error can be
// caught here once, for every command, and reported as a clean one-line message instead.
try {
  await program.parseAsync();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
