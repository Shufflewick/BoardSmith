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
import { auditCommand } from './commands/audit.js';
import { contractCommand } from './commands/contract.js';
import { harnessIngestCommand } from './commands/harness-ingest.js';
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
import {
  verifyClassifyPairsCommand,
  verifyClassifyRecordCommand,
  verifyClassifyStatusCommand,
} from './commands/verify-classify.js';
import {
  verifyImpactGateCommand,
  verifyImpactAdjudicateCommand,
  verifyImpactApplyCommand,
  verifyImpactStatusCommand,
} from './commands/verify-impact.js';
import {
  verifyRulingRecheckCommand,
  verifyRulingRecordCommand,
} from './commands/verify-ruling-recheck.js';
import { verifyRepairStatusCommand } from './commands/verify-repair.js';
import {
  verifyDeriveCheckCommand,
  verifyDeriveRecordCommand,
} from './commands/verify-derive-check.js';
import {
  verifyExampleReplayCommand,
  verifyExampleRecordCommand,
  verifyExampleTranslateCommand,
} from './commands/verify-example-replay.js';
import { verifySourceFreeCheckCommand } from './commands/verify-source-free.js';
import { verifyCloseRecordCommand } from './commands/verify-close-record.js';
import { verifyExampleEmitCommand } from './commands/example-test-emit.js';
import { evolveBotWeightsCommand } from './commands/evolve-bot-weights.js';
import { packCommand } from './commands/pack.js';
import { doctorCommand } from './commands/doctor.js';

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
  .option('--bot <players...>', 'Player positions to be bot (e.g., --bot 1 or --bot 2 4)')
  .option('--bot-level <level>', 'bot difficulty: easy, medium, hard, expert, or iteration count', 'medium')
  .option('--game-option <kv...>', 'Select a declared game option as key=value (repeatable, e.g. --game-option difficulty=hard rounds=5)')
  .option('--preset <name>', 'Apply a declared preset\'s whole bundle of game option values (and player count, if the preset declares one)')
  .option('--lock-teaching', 'Disable bot hint, move-quality heatmap, bot-vs-bot demo, and tutorial (action help stays enabled)')
  .option('--seed <file>', 'Seed the initial game state from a recorded GameStateSnapshot JSON file instead of a fresh start (FEAT-01)')
  .option('--no-open', 'Do not auto-launch a browser tab (use when driving the dev host from a script/CI, so an uncontrolled tab does not claim seat 1)')
  .action(devCommand);

// Testing
program
  .command('test [patterns...]')
  .description('Run this workspace\'s tests (the game\'s, or BoardSmith\'s own)')
  .option('-w, --watch', 'Watch mode - re-run tests on changes')
  .option('--coverage', 'Generate coverage report')
  .action(testCommand);

// Building
program
  .command('build')
  .description('Build this workspace for distribution (a game bundle, or BoardSmith\'s CLI)')
  .option('-o, --out-dir <dir>', 'Output directory', 'dist')
  .action(buildCommand);

// Packing for local development
program
  .command('pack')
  .description('Create tarballs of all public packages for local installation')
  .option('-o, --out-dir <dir>', 'Output directory for tarballs', '.boardsmith/tarballs')
  .option(
    '-t, --target <path>',
    'Copy tarballs to a target project and update its dependencies (repeatable — '
    + 'all targets receive the same tarball)',
    (value: string, previous: string[] = []) => [...previous, value],
  )
  .action(packCommand);

// Validation
program
  .command('validate')
  .description('Validate game before publishing')
  .action(validateCommand);

// Linting
program
  .command('lint')
  .description('Run every lint check this workspace configures (ESLint, Stylelint, BoardSmith pitfalls)')
  .option('--fix', 'Auto-fix what the underlying linters can fix')
  .option('--eslint', 'Run only ESLint')
  .option('--css', 'Run only Stylelint')
  .option('--pitfalls', 'Run only the BoardSmith pitfall checks')
  .action(lintCommand);

// Code-quality audits
program
  .command('audit')
  .description('Run code-quality audits (dead code and duplication)')
  .option('--dead-code', 'Run only the dead-code audit')
  .option('--duplication', 'Run only the duplication audit')
  .action(auditCommand);

// The engine contract — what the platform is promised, and how it learns the
// promise changed. See docs/engine-contract.md.
program
  .command('contract')
  .description("Check (or record) the engine contract the game platform vendors against")
  .option('--update', 'Record a new contract revision from the current engine')
  .option('--summary <text>', 'One sentence describing the change, for the platform team (required with --update)')
  .option('--breaking', 'Also bump bundleProtocol — invalidates every published bundle')
  .action(contractCommand);

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

// Bot Weight Evolution (new focused command)
program
  .command('evolve-bot-weights')
  .description('Optimize bot weights through evolutionary self-play (requires existing bot.ts)')
  .option('--generations <count>', 'Evolution generations (default: 5)')
  .option('--population <count>', 'Population size per generation (default: 20)')
  .option('-m, --mcts <iterations>', 'MCTS iterations for benchmarking (default: 100)')
  .option('--workers <count>', 'Number of worker threads (default: CPU cores - 1)')
  .option('-v, --verbose', 'Show detailed progress')
  .action(evolveBotWeightsCommand);

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
  .option(
    '--reverified-no-code-change <range>',
    'Record a re-verification that found no code change (e.g. <verified-hash>..<head> — 0 manifest files changed)',
  )
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
// `doctor` is the layout's migration path (issue #6): every design artifact belongs under
// `design/`, every throwaway script under `.boardsmith/scratch/`. Report-by-default so a bare run
// is safe to script, non-zero when anything is out of place so a skill notices without parsing
// output, and idempotent so every bs- skill can open with it.
program
  .command('doctor')
  .description("Check a game project's layout (design/ artifacts, stray scratch files) and optionally repair it")
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--fix', 'Move misplaced files into place instead of only reporting them')
  .option('--json', 'Emit JSON instead of human-readable output')
  .option('--quiet', 'Suppress the human-readable report')
  .action(doctorCommand);

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

// Verify classification: VERIFY-03's recordable, resumable verdicts on top of the same run-scoped
// ledger (174-CONTEXT.md decision 5). Findings exit 0 (decision 7) — only a tool failure (unknown
// run, no rulebook/) is non-zero.
program
  .command('verify-classify-pairs')
  .description(
    "Enumerate a verify run's live/staged slice pairs with provenance and rule-bearing line " +
      'counts (read-only, machine-readable)',
  )
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--run-id <id>', 'Report on a specific run instead of the most recent')
  .option('--live-slice <path>', 'Restrict the report to pairs containing this rulebook/ slice')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyClassifyPairsCommand);

program
  .command('verify-classify-record')
  .description(
    'Record one classification verdict for a pair, atomically appended to the run\'s ledger ' +
      '(stale and provenance are derived, never supplied)',
  )
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .requiredOption('--run-id <id>', 'The run to record against')
  .requiredOption('--pair-id <id>', 'The pair id to classify (see verify-classify-pairs)')
  .option(
    '--label <value>',
    'cosmetic | sharper | contradictory — missing or unrecognized records "unclassified"',
  )
  .option('--evidence <text>', 'Free-prose evidence — nothing parses this')
  .option(
    '--quoted-pass1 <text>',
    'Verbatim quote from the live (pass-1) slice — required for sharper/contradictory',
  )
  .option(
    '--quoted-pass2 <text>',
    'Verbatim quote from the staged (pass-2) slice — required for sharper/contradictory',
  )
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyClassifyRecordCommand);

program
  .command('verify-classify-status')
  .description(
    'Report which pairs still need classifying, summary counts, and per-chunk staleness ' +
      'verdicts (read-only, machine-readable)',
  )
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--run-id <id>', 'Report on a specific run instead of the most recent')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyClassifyStatusCommand);

// Verify impact / repair gating: VERIFY-04's contradiction gate, VERIFY-05's staleness write, and
// VERIFY-06's repair-gate disposition (175-CONTEXT.md). Findings exit 0 (172-CONTEXT.md decision
// 6) — only a tool failure (unknown run, no chunks/, missing RULINGS.md) is non-zero. None of
// these commands registers a bypass option of any kind (decision 9) — a contradictory finding
// always stops the pass and a stale write always refuses while any contradiction is pending.
program
  .command('verify-impact-gate')
  .description(
    'Report every contradictory verdict awaiting human adjudication, with both readings ' +
      'quoted side by side (read-only, machine-readable)',
  )
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--run-id <id>', 'Report on a specific run instead of the most recent')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyImpactGateCommand);

program
  .command('verify-impact-adjudicate')
  .description(
    "Record the human's resolution of one contradictory finding: append a RULINGS.md entry, " +
      'or record it UNADJUDICATED',
  )
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--run-id <id>', 'Report on a specific run instead of the most recent')
  .requiredOption('--pair-id <id>', 'The contradictory pair id to adjudicate (see the pending-adjudication report)')
  .requiredOption('--outcome <resolved|UNADJUDICATED>', 'The recorded adjudication outcome')
  .option('--decision <text>', "The human's decision, required for --outcome resolved")
  .option('--citation <text>', 'Citation interpreted or overridden, required for --outcome resolved')
  .option('--rationale <text>', 'Rationale, required for --outcome resolved')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyImpactAdjudicateCommand);

program
  .command('verify-impact-apply')
  .description(
    "Write the rules-staleness marker into every affected chunk's CHUNK.md then SKETCH.md, and " +
      "record the run's impact map (refuses while any contradiction is un-adjudicated)",
  )
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--run-id <id>', 'Report on a specific run instead of the most recent')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyImpactApplyCommand);

program
  .command('verify-impact-status')
  .description(
    "Report the run's impact map: which chunks are rules-stale, each one's line-level " +
      "attributions, and whether repair re-opens its playtest gate (read-only, machine-readable)",
  )
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--run-id <id>', 'Report on a specific run instead of the most recent')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyImpactStatusCommand);

// CHECK-01 / CHECK-02 (176-CONTEXT.md): re-checking every RULINGS.md entry against the fresh
// staged transcription, and reporting each rules-stale chunk's next repair step. Neither command
// registers a bypass option of any kind — the same no-bypass discipline verify-impact-* holds.
program
  .command('verify-ruling-recheck')
  .description(
    "Re-check every RULINGS.md entry against the fresh staged transcription, reporting one of " +
      'four verdicts (still-needed / resolved-by-source / contradicted / undetermined) per ' +
      'non-superseded ruling (read-only, machine-readable)',
  )
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--run-id <id>', 'Report against a specific verify run instead of the most recent')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyRulingRecheckCommand);

// `verify-ruling-record` is the ONLY write surface for CHECK-01's ledger, mirroring the
// check/record pairing every sibling already had (verify-classify-record, verify-derive-record,
// verify-example-record). Without it a dispatched ruling's verdict could be judged but never
// recorded, so `verify-ruling-recheck` reported `pending` forever. Deliberately unlike
// `verify-classify-record`, an unrecognized `--verdict` is NOT softened to a catch-all member:
// CHECK-01's enum has none, and `undetermined` is a real judgment a subagent must choose, never a
// coercion target. No bypass option of any kind, per the discipline noted above.
program
  .command('verify-ruling-record')
  .description(
    "Record one dispatched ruling's re-check verdict, atomically upsert-appended into the run's " +
      'RULING-VERDICTS ledger (the ONLY write surface for CHECK-01)',
  )
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .requiredOption('--run-id <id>', 'The verify run this verdict was judged against')
  .requiredOption('--number <n>', 'The RULINGS.md entry number this verdict is for')
  .requiredOption(
    '--verdict <v>',
    'still-needed | resolved-by-source | contradicted | undetermined',
  )
  .requiredOption(
    '--reasoning <text>',
    "The judgment's reasoning — the artifact this check exists to produce",
  )
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyRulingRecordCommand);

program
  .command('verify-repair')
  .description(
    "Report each rules-stale chunk's fresh staged slice paths and its next verify-episode audit " +
      'round plan (read-only, machine-readable) — dispatching the audit lenses and the repair ' +
      'loop itself is verify/repair-dispatch.md\'s job, never this command\'s',
  )
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--run-id <id>', 'Report against a specific verify run instead of the most recent')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyRepairStatusCommand);

// CHECK-04 (177.1-CONTEXT.md decision 2): dual-enumeration derived-line check — two
// independently-dispatched enumerators (claude-opus-5, claude-haiku-4-5-20251001) each read a
// slice's quote lines, a reconciler (claude-sonnet-5) grounds their overlap and cross-checks it
// against every `Derived (p.N):` line, and the CLI classifies each into one of eight verdicts
// (corroborated / corroborated-by-composition / uncorroborated / contradicted /
// quote-unverified / absence-corroborated / absence-contradicted / absence-unverifiable). Advisory
// — the check always exits 0; a non-corroboration is worth a human glance, never a build gate.
// Both commands are project-level and source-free BY CONSTRUCTION — neither registers --run-id
// or any bypass option of any kind. `verify-derive-record` is the ONLY write surface for
// CHECK-04's ledger (carried forward from CR-05).
program
  .command('verify-derive-check')
  .description(
    'Enumerate every rule-bearing Derived line project-wide, join each to its recorded ' +
      'dual-enumeration verdict, and hand back the exact enumerator dispatch payload for every ' +
      'slice still pending (read-only, project-level, source-free, machine-readable, exits 0 ' +
      'unconditionally)',
  )
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyDeriveCheckCommand);

program
  .command('verify-derive-record')
  .description(
    "Read one slice's two enumerator returns and its reconciler return, classify every " +
      "Derived line into one of CHECK-04's eight dual-enumeration verdicts, and atomically " +
      'upsert-append every classification into the project-level ledger (the ONLY write ' +
      'surface for CHECK-04)',
  )
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .requiredOption('--slice-path <path>', 'The rulebook/ slice the Derived lines live in')
  .requiredOption('--enumerator-a <file>', "Enumerator A's structured JSON return (claude-opus-5)")
  .requiredOption(
    '--enumerator-b <file>',
    "Enumerator B's structured JSON return (claude-haiku-4-5-20251001)",
  )
  .requiredOption(
    '--reconciler <file>',
    "The reconciler's structured JSON return (claude-sonnet-5)",
  )
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyDeriveRecordCommand);

// CHECK-06 (178-CONTEXT.md decision 12): worked-example replay — an extractor turns a rulebook
// slice's worked examples into structured specs, a translator turns each spec into a runnable
// test against the real engine, and the CLI records one of four verdicts (agrees / disagrees /
// example-inconsistent / unexecutable) per example. A `disagrees` verdict is gated on quote
// provenance (`QuoteVerifiedProvenance`): only when the example's supporting quotes are verified
// against an archived, hash-verified source is a mismatch reported as a genuine code defect —
// otherwise it is downgraded to an explicitly lower-confidence finding, never a confident
// accusation against the code. `verify-example-replay` is advisory on the verify side (always
// exits 0); the build side's own consumer (`build/test.md`) treats a mismatch as build-blocking.
// Both commands are project-level and source-free BY CONSTRUCTION — neither registers a run
// identifier flag or any bypass option of any kind. `verify-example-record` is the ONLY write
// surface for CHECK-06's ledger. `verify-example-translate` produces the SECOND dispatch's
// payload from the FIRST dispatch's return; it writes nothing, and it is what skill prose cites
// instead of describing the game's API surface.
program
  .command('verify-example-replay')
  .description(
    'Enumerate every live rulebook slice project-wide, join each to its recorded worked-example ' +
      'replay verdicts, and hand back the extraction dispatch payload for every slice still ' +
      'pending (read-only, project-level, source-free, machine-readable, exits 0 unconditionally)',
  )
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--json', 'Emit JSON instead of human-readable output')
  .option('--chunk <slug>', 'Scope the report to exactly one chunk\'s cited slices')
  .action(verifyExampleReplayCommand);

program
  .command('verify-example-record')
  .description(
    "Read one slice's extractor and translator structured JSON returns, gate every mismatch on " +
      "quote provenance, and atomically upsert-append every worked-example verdict into the " +
      "project-level ledger (the ONLY write surface for CHECK-06)",
  )
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .requiredOption('--slice-path <path>', 'The rulebook/ slice the worked examples live in')
  .requiredOption('--extraction <file>', "The extractor's structured JSON return")
  .requiredOption('--translation <file>', "The translator's structured JSON return")
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyExampleRecordCommand);

program
  .command('verify-example-translate')
  .description(
    "Read one slice's extractor structured JSON return, assign every surviving example's " +
      'identity itself, and emit its translation dispatch payload built from the generated ' +
      "project's real exported API surface (read-only, writes nothing, exits 0 unconditionally)",
  )
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .requiredOption('--slice-path <path>', 'The rulebook/ slice the worked examples live in')
  .requiredOption('--extraction <file>', "The extractor's structured JSON return")
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyExampleTranslateCommand);

// VERIFY-09 (179-CONTEXT.md decision 1/4): source-free mode's one read-only CLI surface, over the
// step -> defect-class mapping and computation `verify-source-free.ts` owns. This command RENDERS
// `computeSourceFreeReport`'s pure result; it computes nothing itself.
//
// NO `--source-free`, no forcing flag, no `--assume-full`, and no scope-override option is
// registered here, now or ever: source-free is entered from disk state alone (the same
// `computeVerificationScope` every sibling provenance path already uses), never declared by a
// caller. A scope-declaring flag here is exactly how a project that HAS source could claim a
// reduced pass while still looking verified.
//
// Exit code is always 0 absent a genuine tool failure (an unreadable `--project` directory) —
// a reduced, honestly-degraded pass is a SUCCESSFUL pass, never a failure.
program
  .command('verify-source-free-check')
  .description(
    "Report a project's verification mode (full or source-free), its reduced scope and reason " +
      'when reduced, and every designer-facing defect class that goes unchecked as a result ' +
      '(read-only, source-free by construction, machine-readable, exits 0 unconditionally)',
  )
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifySourceFreeCheckCommand);

// VERIFY-09/PROV-02 (179-CONTEXT.md decision "WIRE IT"): a verify pass's Close durably records
// `## Verified Against` provenance for exactly the chunks it evaluated, reusing the ONE fenced
// writer (`recordVerifiedAgainst`, `chunk-provenance.ts`) `chunk-check` itself calls — never a
// second write path. The touched set is derived from `drift-check`'s own evaluated set, plus a
// staging run's ledger impact records when `--run` names one; this command never lists `chunks/`
// itself, so it can only ever record what a check actually looked at.
//
// NO scope-declaring option of any kind is registered here, now or ever: scope comes only from
// `computeVerificationScope(projectDir)` and disk state, per 171-CONTEXT.md decision 1 — no
// forcing flag, no `--source-free`, no `--assume-full`, no scope-override option.
//
// Exit code is ALWAYS 0 absent a genuine tool failure (an unreadable `--project`, a `--run` naming
// a run whose ledger does not exist) — deliberately UNLIKE `chunk-check`, which repairs-then-fails.
// A Close reports; it does not gate. A per-chunk write failure lands in `errors[]`, is printed
// loudly to stderr, and does not abort the remaining chunks or set a non-zero exit code.
program
  .command('verify-close-record')
  .description(
    "Durably record a verify pass's `## Verified Against` provenance for exactly the chunks it " +
      'evaluated, through the same fenced writer chunk-check uses (never a gate — exits 0 even ' +
      'when an individual chunk fails, reporting the failure loudly instead)',
  )
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option(
    '--run <run-id>',
    "The staging run whose impact-record affected slugs to include (optional — absent in " +
      'source-free mode, where no run ledger exists)',
  )
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyCloseRecordCommand);

// TEST-01 (178-CONTEXT.md decision 8): the build-side write surface — one generated example-test
// file per chunk (`tests/examples/<chunk>.examples.test.ts`), written idempotently and atomically.
// Reads the CHECK-06 ledger to learn which worked examples a chunk's cited slices carry and each
// one's verdict; `unexecutable`/`example-inconsistent` records are named-reason comments, never a
// test (decision 7). Every OTHER record's translated test code — carried on `--translated`, the
// third dispatch's structured return — is scanned against the measured GENERATED_TEST_SANDBOX_
// RULES subset (`example-test-emit.ts`, `178-06-MEASUREMENT/RESULTS.md`) before it ever reaches
// disk; a violation anywhere rejects the WHOLE emission. This command never writes the ledger —
// `verify-example-record` is the only write surface for that — and `verify-example-record` never
// writes a test file; the two write surfaces are disjoint by construction.
program
  .command('verify-example-emit')
  .description(
    "Write the one generated example-test file for --chunk from the CHECK-06 ledger's " +
      "recorded verdicts plus the third dispatch's translated test code, scanned against the " +
      'measured generated-test sandbox rule subset before it is ever written (idempotent, ' +
      'atomic, one file per chunk)',
  )
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .requiredOption('--chunk <slug>', "The chunk whose cited slices' worked examples to emit")
  .option(
    '--translated <file>',
    "The translator's (third dispatch's) structured JSON return — required only when the " +
      'chunk has at least one example recorded agrees/disagrees',
  )
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyExampleEmitCommand);

// Claude Code integration
const claudeCmd = // Live-agent ingest harness (BoardSmith repo only, operator-invoked)
program
  .command('harness-ingest')
  .description('Drive the live-agent /bs-ingest-rules produced-artifact harness (BoardSmith repo only)')
  .argument('[args...]', 'Flags forwarded verbatim to the harness (pass --help for its options)')
  .allowUnknownOption()
  .helpOption(false)
  .action(harnessIngestCommand);

program
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
