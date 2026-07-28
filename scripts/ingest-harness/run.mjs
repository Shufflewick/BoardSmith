#!/usr/bin/env node
/**
 * scripts/ingest-harness/run.mjs
 *
 * Live-agent driver for the `/bs-ingest-rules` produced-artifact harness (Phase 170, Plan 06).
 *
 * Stages a throwaway project with this repo's CURRENT WORKING TREE skill text installed
 * project-locally, drives a real headless `claude` session through `/bs-ingest-rules` against a
 * real rulebook PDF, and reports Plan 05's nine produced-artifact checks plus gate item (g)
 * (the reference game's git-cleanliness invariant).
 *
 * This is an OPERATOR/AGENT-INVOKED tool, never CI. See README.md for the full determinism
 * rationale. It is deliberately NOT wired into `npm test`, `npm run audit`, or any
 * `vitest.config.ts` include pattern — a live agent run is not deterministic and must not be
 * allowed to flake the 3211-test suite.
 *
 * SANDBOXING (operator-directed, 2026-07-27): the source rulebook is copied into the throwaway
 * tree at stage time (`{workDir}/source-under-test/<filename>`) and the driven session is
 * granted NO filesystem path outside `{workDir}` — no additional-directory access grant flag is
 * ever passed to `claude`.
 * The reference game repo (`--reference-repo`) is used only to read+hash the source and to
 * assert cleanliness before/after; it is never the driven session's cwd and never granted to it.
 *
 * MULTI-TURN REBUILD (operator-directed, 2026-07-27, harness-repair): the original `drive` sent
 * ONE prompt instructing the session to auto-answer its own per-section confirmation prompts and
 * proceed without asking, then reported 10/10 (three consecutive headless runs). A human then ran
 * the same skill text interactively and scored 1/10 (`170-GATE2-INDEX.md`) — the human session
 * accumulated many turns of context (name derivation, a clarifying question, four separate
 * per-section confirmations, an edition answer) before reaching Step 3, and worked from the plan
 * it had formed early rather than from the skill text on the page. The single-shot
 * auto-answer-and-proceed instruction collapsed exactly the session shape that produced the real
 * failure, so the harness measured a mechanism nobody actually uses.
 *
 * `drive` now pins a session id (`--session-id`) on turn 1 and resumes it (`--resume`) for every
 * subsequent turn, feeding a small scripted sequence of plausible designer answers one at a time
 * and instructing the session to ask and WAIT rather than auto-answer — reproducing accumulated
 * multi-turn context instead of a single all-in-one instruction. Turn count is a first-class
 * signal: a run that "completes" in 1-2 turns has not exercised the interactive shape at all, and
 * hitting `--max-turns` is a reported failure, never a silent pass.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readdirSync, statSync, copyFileSync, appendFileSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { checkIngestArtifacts, CHECK_IDS } from './check.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const DEFAULTS = {
  workDir: '/tmp/bs-ingest-harness',
  source: path.join(os.homedir(), 'BoardSmithGames', 'seven', 'rules.pdf'),
  expectHash: '5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880',
  referenceRepo: path.join(os.homedir(), 'BoardSmithGames', 'seven'),
  maxTurns: 25,
};

function parseArgs(argv) {
  const opts = {
    workDir: DEFAULTS.workDir,
    source: DEFAULTS.source,
    expectHash: DEFAULTS.expectHash,
    referenceRepo: DEFAULTS.referenceRepo,
    model: undefined,
    json: false,
    subcommand: undefined,
    maxTurns: DEFAULTS.maxTurns,
    turnsOnly: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--work-dir') opts.workDir = argv[++i];
    else if (a === '--source') opts.source = argv[++i];
    else if (a === '--expect-hash') opts.expectHash = argv[++i];
    else if (a === '--reference-repo') opts.referenceRepo = argv[++i];
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--max-turns') opts.maxTurns = Number(argv[++i]);
    else if (a === '--turns-only') opts.turnsOnly = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else rest.push(a);
  }
  opts.subcommand = rest[0];
  if (!Number.isInteger(opts.maxTurns) || opts.maxTurns < 1) {
    fail(`--max-turns must be a positive integer, got: ${opts.maxTurns}`);
  }
  // Expand ~ if a caller passes it literally (os.homedir() defaults never need this).
  for (const key of ['workDir', 'source', 'referenceRepo']) {
    if (opts[key] && opts[key].startsWith('~')) {
      opts[key] = path.join(os.homedir(), opts[key].slice(1));
    }
    opts[key] = path.resolve(opts[key]);
  }
  return opts;
}

function printHelp() {
  console.log(`
scripts/ingest-harness/run.mjs — live-agent ingest harness driver

Usage:
  node scripts/ingest-harness/run.mjs [stage|drive|assert] [options]
  node scripts/ingest-harness/run.mjs [options]   (runs stage, drive, assert in order)

Subcommands:
  stage    Recreate the throwaway project dir, install this repo's current skill text into it
           project-locally, sandbox-copy the source rulebook in, and baseline the reference repo.
  drive    Spawn a real, MULTI-TURN headless claude session against the staged project: turn 1
           pins a session id and invokes /bs-ingest-rules, then each subsequent turn resumes that
           same session with a scripted designer answer, reproducing accumulated interactive
           context instead of one single-shot auto-answer instruction.
  assert   Report the nine produced-artifact checks plus gate item (g), print a summary and the
           turn-count diagnostic, exit 0 only if all ten pass.

Options:
  --work-dir <dir>         Throwaway project root (default: ${DEFAULTS.workDir})
  --source <path>          Rulebook PDF to ingest (default: ${DEFAULTS.source})
  --expect-hash <sha256>   Expected SHA-256 of --source (default: ${DEFAULTS.expectHash})
  --reference-repo <dir>   Git repo containing --source, asserted clean before/after
                           (default: ${DEFAULTS.referenceRepo})
  --model <model>          Model passed through to the driven claude session
  --max-turns <n>          Turn cap for 'drive' (default: ${DEFAULTS.maxTurns}). Hitting the cap
                           without seeing HARNESS-STEP3-COMPLETE is a reported FAILURE, never a
                           silent pass.
  --turns-only             Diagnostic mode: print only how many turns the most recent 'drive' run
                           took (and whether it hit the cap) and exit — skips the nine
                           produced-artifact checks entirely. Exit 1 if the turn cap was hit.
  --json                   Emit assert's result as a single JSON object on stdout
  --help                   Show this help
`);
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function fail(message) {
  console.error(`FATAL: ${message}`);
  process.exit(1);
}

function stateFilePath(workDir) {
  return path.join(workDir, '.harness-stage-state.json');
}

// ---------------------------------------------------------------------------
// stage
// ---------------------------------------------------------------------------

function stage(opts) {
  const { workDir, source, expectHash, referenceRepo } = opts;

  console.log(`[stage] recreating throwaway dir: ${workDir}`);
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  console.log(`[stage] installing current working tree's skill text into ${workDir} (--local --force)`);
  execFileSync('node', [path.join(REPO_ROOT, 'bin', 'boardsmith.js'), 'claude', '--local', '--force'], {
    cwd: workDir,
    stdio: 'inherit',
  });

  const skillProbe = path.join(workDir, '.claude', 'skills', 'bs-ingest-rules', 'SKILL.md');
  const sharedProbe = path.join(workDir, '.claude', 'skills', 'bs-shared', 'ingest', 'transcription-subagent.md');
  if (!existsSync(skillProbe)) fail(`install did not land: missing ${skillProbe}`);
  if (!existsSync(sharedProbe)) fail(`install did not land: missing ${sharedProbe}`);
  console.log(`[stage] install verified: ${skillProbe}`);
  console.log(`[stage] install verified: ${sharedProbe}`);

  // Assert the global tree was untouched: no entry under ~/.claude/skills has an mtime newer
  // than this process's start time. Report as a stated line, not a silent pass.
  const startTime = STAGE_START_TIME;
  const globalSkillsDir = path.join(os.homedir(), '.claude', 'skills');
  let globalUntouched = true;
  let newestGlobalMtime = null;
  if (existsSync(globalSkillsDir)) {
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const st = statSync(full);
        if (newestGlobalMtime === null || st.mtimeMs > newestGlobalMtime) newestGlobalMtime = st.mtimeMs;
        if (st.mtimeMs > startTime) globalUntouched = false;
        if (entry.isDirectory()) walk(full);
      }
    };
    walk(globalSkillsDir);
  }
  console.log(
    `[stage] global skill tree assertion: ${globalUntouched ? 'PASS' : 'FAIL'} — ` +
      `${globalSkillsDir} newest mtime ${newestGlobalMtime ? new Date(newestGlobalMtime).toISOString() : '(empty/absent)'} ` +
      `vs process start ${new Date(startTime).toISOString()}`,
  );
  if (!globalUntouched) {
    fail(`global skill tree at ${globalSkillsDir} was modified during --local install — this must never happen`);
  }

  // Reference-game baseline for gate item (g).
  if (!existsSync(source)) fail(`--source does not exist: ${source}`);
  const sourceHash = sha256File(source);
  if (sourceHash.toLowerCase() !== String(expectHash).toLowerCase()) {
    fail(
      `--expect-hash mismatch: source ${source} hashes to ${sourceHash} but --expect-hash was ${expectHash} — ` +
        `the proof target has drifted; every downstream number would be invalidated`,
    );
  }
  console.log(`[stage] source hash verified: ${source} matches --expect-hash`);

  let refStatus;
  try {
    refStatus = execFileSync('git', ['-C', referenceRepo, 'status', '--porcelain'], { encoding: 'utf8' });
  } catch (err) {
    fail(`could not run git status in --reference-repo ${referenceRepo}: ${err.message}`);
  }
  if (refStatus.trim() !== '') {
    fail(
      `--reference-repo ${referenceRepo} has a dirty working tree:\n${refStatus}\n` +
        `A dirty reference repo means a prior run already violated the read-only invariant. Refusing to proceed.`,
    );
  }
  const refHead = execFileSync('git', ['-C', referenceRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  console.log(`[stage] reference repo ${referenceRepo} is clean at HEAD ${refHead}`);

  // Sandbox the source: copy the source rulebook into the throwaway tree BEFORE the driven
  // session ever runs, so the reference repo is structurally unreachable from it.
  const sourceUnderTestDir = path.join(workDir, 'source-under-test');
  mkdirSync(sourceUnderTestDir, { recursive: true });
  const sourceFileName = path.basename(source);
  const stagedCopyPath = path.join(sourceUnderTestDir, sourceFileName);
  copyFileSync(source, stagedCopyPath);
  const copyHash = sha256File(stagedCopyPath);
  if (copyHash.toLowerCase() !== String(expectHash).toLowerCase()) {
    fail(`sandboxed copy ${stagedCopyPath} hash ${copyHash} does not match --expect-hash ${expectHash}`);
  }
  console.log(`[stage] sandboxed copy verified: ${stagedCopyPath} matches --expect-hash`);

  const state = {
    workDir,
    source,
    sourceFileName,
    stagedCopyPath,
    expectHash: expectHash.toLowerCase(),
    referenceRepo,
    refHead,
    stagedAt: new Date().toISOString(),
  };
  writeFileSync(stateFilePath(workDir), JSON.stringify(state, null, 2));
  console.log(`[stage] complete. state recorded at ${stateFilePath(workDir)}`);
  return state;
}

const STAGE_START_TIME = Date.now();

// ---------------------------------------------------------------------------
// drive
// ---------------------------------------------------------------------------

function buildInitialPrompt(state) {
  // Deliberately no restatement/paraphrase of the ingest contract — only the invocation, the
  // rulebook's absolute path (the STAGED COPY's path, never the reference repo's), a project
  // name, and operating instructions that tell the session to follow its OWN per-section
  // confirmation protocol and wait for answers — never to auto-answer itself. Auto-answering
  // itself is exactly what collapsed the session shape that produced the false-green baseline
  // (see the MULTI-TURN REBUILD note at the top of this file).
  // The path is passed as the skill's optional INVOCATION ARGUMENT, not described in prose.
  // That is how a designer supplies it, and it is what lets Step 1 archive the source — the
  // scheduling fix in 6db99d5c. Describing it in a sentence instead would test a path real
  // usage does not take, and would leave the archive to Step 3, where it never runs.
  return [
    `/bs-ingest-rules ${state.stagedCopyPath}`,
    ``,
    `Project name: Seven.`,
    ``,
    `A designer is present for this session and will answer interactively, one message at a`,
    `time, exactly as a real designer would. Follow your own per-section confirmation protocol`,
    `exactly as written: ask each question or present each per-section confirmation the way you`,
    `normally would, then STOP and wait for the designer's reply. Do not answer on the`,
    `designer's behalf, and do not proceed past any confirmation or approval gate until the`,
    `designer's next message explicitly confirms it.`,
    ``,
    `When — and only when — you have completed Step 3 (Synthesis), print exactly the line`,
    `HARNESS-STEP3-COMPLETE`,
    `as your final output before stopping. Do not proceed to Step 4 or beyond.`,
  ].join('\n');
}

// Small scripted sequence of plausible designer answers, consumed one per resumed turn. The
// specific wording matters far less than the fact that these are separate turns accumulating in
// the SAME session (via --resume) rather than one single-shot instruction — see the human gate
// in 170-GATE2-INDEX.md for the shape being reproduced: name derivation, a clarifying question,
// four separate per-section confirmations, and an edition answer, in that rough order.
const ANSWER_SEQUENCE = [
  'Yes, "Seven" is the right project name — go ahead with that.',
  'No edition is stated anywhere in the rulebook. Treat it as "none stated."',
  'Yes, that section looks right — please continue to the next one.',
  'Yes, that section looks right — please continue to the next one.',
  'Yes, that section looks right — please continue to the next one.',
  'Yes, that section looks right — please continue to the next one.',
];
const DEFAULT_ANSWER = 'Yes, confirmed — please continue.';

/** answerIndex is 0-based over resumed turns only (the first resume is index 0). */
function nextAnswer(answerIndex) {
  return answerIndex < ANSWER_SEQUENCE.length ? ANSWER_SEQUENCE[answerIndex] : DEFAULT_ANSWER;
}

/**
 * True only if the completion marker appears as its OWN line (trimmed exact match), never as a
 * mere substring anywhere in the transcript. A live session frequently *discusses* the marker
 * without emitting it — e.g. "I won't print `HARNESS-STEP3-COMPLETE` — Step 3 never ran" — and a
 * naive `.includes()` check reads that refusal as a false completion. Discovered live during this
 * driver's own validation run (turn 7 of a stuck session explicitly refused to emit the marker,
 * quoting it only to explain why, and a substring check still flagged it as HARNESS-STEP3-COMPLETE).
 */
function outputEmitsCompletionMarker(out) {
  return out.split('\n').some((line) => line.trim() === 'HARNESS-STEP3-COMPLETE');
}

// `drive` is implemented as `driveAsync` below (it needs to `await import('node:child_process')`
// for `spawnSync`, and `main()` is itself async) — see driveAsync().

// ---------------------------------------------------------------------------
// assert
// ---------------------------------------------------------------------------

function findProjectDir(workDir) {
  const entries = readdirSync(workDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const candidates = entries.filter((e) => {
    const rb = path.join(workDir, e.name, 'rulebook');
    return existsSync(rb) && statSync(rb).isDirectory();
  });
  if (candidates.length !== 1) {
    fail(
      `expected exactly one immediate subdirectory of ${workDir} containing a rulebook/ directory, ` +
        `found ${candidates.length}: [${candidates.map((c) => c.name).join(', ')}]`,
    );
  }
  return path.join(workDir, candidates[0].name);
}

function turnDiagnosticLine(state) {
  const turnsTaken = state.turnsTaken ?? 'unknown (no drive state recorded)';
  const maxTurns = state.maxTurns ?? 'unknown';
  const stoppedReason = state.stoppedReason ?? 'unknown';
  const hitCap = state.hitTurnCap === true;
  return (
    `Turns taken: ${turnsTaken} (cap: ${maxTurns}, stopped: ${stoppedReason})` +
    (hitCap ? ' — TURN CAP HIT: reported as a failure, not evaluated further as a pass.' : '')
  );
}

function assertCmd(opts) {
  const { workDir, referenceRepo } = opts;
  const statePath = stateFilePath(workDir);
  if (!existsSync(statePath)) fail(`no stage state found at ${statePath} — run 'stage' (and 'drive') first`);
  const state = JSON.parse(readFileSync(statePath, 'utf8'));

  if (opts.turnsOnly) {
    console.log('');
    console.log(turnDiagnosticLine(state));
    console.log('');
    console.log(
      '[assert] --turns-only: skipped the nine produced-artifact checks. A run that "completes"',
    );
    console.log('in 1-2 turns has not reproduced interactive session shape at all.');
    process.exit(state.hitTurnCap ? 1 : 0);
  }

  const projectDir = findProjectDir(workDir);
  const { pass: artifactsPass, checks } = checkIngestArtifacts({
    projectDir,
    sourceFileName: state.sourceFileName,
    expectedSourceHash: state.expectHash,
  });

  // Gate item (g): re-run the reference repo checks and compare against what stage() recorded.
  const refStatusNow = execFileSync('git', ['-C', referenceRepo, 'status', '--porcelain'], { encoding: 'utf8' });
  const refHeadNow = execFileSync('git', ['-C', referenceRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const gClean = refStatusNow.trim() === '';
  const gHeadMatches = refHeadNow === state.refHead;
  const gPass = gClean && gHeadMatches;
  const gDetail = gPass
    ? `reference repo unchanged: clean, HEAD ${refHeadNow} matches recorded ${state.refHead}`
    : `reference repo CHANGED: clean=${gClean} (status: ${refStatusNow.trim() || '(none)'}), head-matches=${gHeadMatches} (now ${refHeadNow} vs recorded ${state.refHead})`;
  const gCheck = { id: 'reference-repo-unmodified', letter: 'g', label: '~/BoardSmithGames/seven unmodified', pass: gPass, detail: gDetail };

  const allChecks = [...checks, gCheck];
  const overallPass = artifactsPass && gPass;
  const passCount = allChecks.filter((c) => c.pass).length;

  console.log('');
  console.log(`Project directory: ${projectDir}`);
  console.log(turnDiagnosticLine(state));
  console.log('');
  console.log('| # | id | letter | PASS/FAIL | detail |');
  console.log('|---|----|--------|-----------|--------|');
  allChecks.forEach((c, i) => {
    console.log(`| ${i + 1} | ${c.id} | ${c.letter} | ${c.pass ? 'PASS' : 'FAIL'} | ${c.detail} |`);
  });
  console.log('');
  console.log(`SUMMARY: ${passCount}/${allChecks.length} checks passing.`);
  console.log(overallPass ? 'OVERALL: PASS' : 'OVERALL: FAIL');

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          projectDir,
          pass: overallPass,
          passCount,
          total: allChecks.length,
          checks: allChecks,
          turnsTaken: state.turnsTaken ?? null,
          maxTurns: state.maxTurns ?? null,
          stoppedReason: state.stoppedReason ?? null,
          hitTurnCap: state.hitTurnCap === true,
        },
        null,
        2,
      ),
    );
  }

  process.exit(overallPass ? 0 : 1);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || opts.subcommand === '--help') {
    printHelp();
    process.exit(0);
  }

  if (opts.subcommand === 'stage') {
    stage(opts);
    return;
  }
  if (opts.subcommand === 'drive') {
    await driveAsync(opts);
    return;
  }
  if (opts.subcommand === 'assert') {
    assertCmd(opts);
    return;
  }
  if (!opts.subcommand) {
    stage(opts);
    await driveAsync(opts);
    assertCmd(opts);
    return;
  }
  fail(`unknown subcommand: ${opts.subcommand}. Use stage, drive, assert, or no subcommand to run all three.`);
}

async function driveAsync(opts) {
  const { workDir, model, maxTurns } = opts;
  const statePath = stateFilePath(workDir);
  if (!existsSync(statePath)) fail(`no stage state found at ${statePath} — run 'stage' first`);
  const state = JSON.parse(readFileSync(statePath, 'utf8'));

  const initialPrompt = buildInitialPrompt(state);
  if (!initialPrompt.includes(state.stagedCopyPath)) fail('constructed prompt does not name the staged copy path');
  if (initialPrompt.includes(state.referenceRepo)) fail('constructed prompt leaks the reference repo path');

  const sessionId = randomUUID();
  console.log(`[drive] multi-turn session id: ${sessionId} (max ${maxTurns} turns, cwd=${workDir})`);
  console.log(`[drive] NOTE: no additional-directory access grant flag is passed. The session has no path outside ${workDir}.`);

  const logPath = path.join(workDir, 'harness-session.log');
  writeFileSync(
    logPath,
    `# harness session log\n# started: ${new Date().toISOString()}\n# cwd: ${workDir}\n` +
      `# session-id: ${sessionId}\n# max-turns: ${maxTurns}\n\n`,
  );

  const { spawnSync } = await import('node:child_process');
  const start = Date.now();

  let turn = 1;
  let message = initialPrompt;
  let stoppedReason = null;
  let lastCode = 0;

  for (;;) {
    const args = ['--print', '--dangerously-skip-permissions'];
    args.push(...(turn === 1 ? ['--session-id', sessionId] : ['--resume', sessionId]));
    if (model) args.push('--model', model);
    args.push(message);

    console.log(
      `[drive] turn ${turn}/${maxTurns}: spawning claude ${args.slice(0, -1).join(' ')} <message> (${
        turn === 1 ? 'new session' : 'resume'
      })`,
    );
    const res = spawnSync('claude', args, { cwd: workDir, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });
    const out = res.stdout ?? '';
    const err = res.stderr ?? '';
    const code = res.status ?? 1;
    lastCode = code;

    appendFileSync(
      logPath,
      `\n=== TURN ${turn} (${turn === 1 ? 'new session --session-id' : 'resume --resume'} ${sessionId}) ===\n` +
        `MESSAGE SENT:\n${message}\n\nEXIT CODE: ${code}\n\nSTDOUT:\n${out}\n\nSTDERR:\n${err}\n`,
    );
    process.stdout.write(out);
    process.stderr.write(err);

    if (code !== 0) {
      stoppedReason = 'nonzero-exit';
      console.log(`[drive] turn ${turn} exited non-zero (${code}) — stopping the multi-turn loop.`);
      console.log(`[drive] non-zero exit is reported but does NOT skip 'assert' — a crashed session that still wrote artifacts is worth inspecting.`);
      break;
    }

    if (outputEmitsCompletionMarker(out)) {
      stoppedReason = 'completed';
      break;
    }

    if (turn >= maxTurns) {
      stoppedReason = 'turn-cap';
      console.log(
        `[drive] hit --max-turns (${maxTurns}) without seeing HARNESS-STEP3-COMPLETE — this is a` +
          ` REPORTED FAILURE, not a silent pass.`,
      );
      break;
    }

    // Prepare the next turn: resume the SAME session with the next scripted answer. This is
    // the property under test — each resume accumulates context in one session, unlike the
    // single-shot auto-answer prompt this driver replaces.
    message = nextAnswer(turn - 1);
    turn += 1;
  }

  const durationMs = Date.now() - start;
  console.log(
    `[drive] session stopped after ${turn} turn(s), reason=${stoppedReason}, exit code ${lastCode}, ` +
      `${(durationMs / 1000).toFixed(1)}s`,
  );

  const driveState = {
    ...state,
    sessionId,
    driveExitCode: lastCode,
    driveDurationMs: durationMs,
    turnsTaken: turn,
    maxTurns,
    stoppedReason,
    hitTurnCap: stoppedReason === 'turn-cap',
    drivenAt: new Date().toISOString(),
  };
  writeFileSync(statePath, JSON.stringify(driveState, null, 2));

  if (opts.turnsOnly) {
    console.log(
      `[drive] --turns-only: turnsTaken=${turn} maxTurns=${maxTurns} stoppedReason=${stoppedReason} ` +
        `hitTurnCap=${driveState.hitTurnCap}`,
    );
  }

  return driveState;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
