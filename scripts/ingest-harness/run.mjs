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
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readdirSync, statSync, copyFileSync, appendFileSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { checkIngestArtifacts, CHECK_IDS } from './check.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const DEFAULTS = {
  workDir: '/tmp/bs-ingest-harness',
  source: path.join(os.homedir(), 'BoardSmithGames', 'seven', 'rules.pdf'),
  expectHash: '5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880',
  referenceRepo: path.join(os.homedir(), 'BoardSmithGames', 'seven'),
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
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--work-dir') opts.workDir = argv[++i];
    else if (a === '--source') opts.source = argv[++i];
    else if (a === '--expect-hash') opts.expectHash = argv[++i];
    else if (a === '--reference-repo') opts.referenceRepo = argv[++i];
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else rest.push(a);
  }
  opts.subcommand = rest[0];
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
  drive    Spawn a real headless claude session against the staged project.
  assert   Report the nine produced-artifact checks plus gate item (g), print a summary, exit
           0 only if all ten pass.

Options:
  --work-dir <dir>         Throwaway project root (default: ${DEFAULTS.workDir})
  --source <path>          Rulebook PDF to ingest (default: ${DEFAULTS.source})
  --expect-hash <sha256>   Expected SHA-256 of --source (default: ${DEFAULTS.expectHash})
  --reference-repo <dir>   Git repo containing --source, asserted clean before/after
                           (default: ${DEFAULTS.referenceRepo})
  --model <model>          Model passed through to the driven claude session
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

function buildPrompt(state) {
  // Deliberately no restatement/paraphrase of the ingest contract — only the invocation, the
  // rulebook's absolute path (the STAGED COPY's path, never the reference repo's), and the
  // no-human-present operating instructions.
  return [
    `/bs-ingest-rules`,
    ``,
    `A rulebook exists at this absolute path: ${state.stagedCopyPath}`,
    ``,
    `No human is present for this session. Answer every per-section confirmation prompt and`,
    `every approval gate affirmatively yourself and proceed without asking — do not wait for`,
    `input that will never arrive.`,
    ``,
    `Stop immediately after completing Step 3 (Synthesis) and print exactly the line`,
    `HARNESS-STEP3-COMPLETE`,
    `as your final output. Do not proceed to Step 4 or beyond.`,
  ].join('\n');
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

function assertCmd(opts) {
  const { workDir, referenceRepo } = opts;
  const statePath = stateFilePath(workDir);
  if (!existsSync(statePath)) fail(`no stage state found at ${statePath} — run 'stage' (and 'drive') first`);
  const state = JSON.parse(readFileSync(statePath, 'utf8'));

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
    console.log(JSON.stringify({ projectDir, pass: overallPass, passCount, total: allChecks.length, checks: allChecks }, null, 2));
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
  const { workDir, model } = opts;
  const statePath = stateFilePath(workDir);
  if (!existsSync(statePath)) fail(`no stage state found at ${statePath} — run 'stage' first`);
  const state = JSON.parse(readFileSync(statePath, 'utf8'));

  const prompt = buildPrompt(state);
  if (!prompt.includes(state.stagedCopyPath)) fail('constructed prompt does not name the staged copy path');
  if (prompt.includes(state.referenceRepo)) fail('constructed prompt leaks the reference repo path');

  const args = ['--print', '--dangerously-skip-permissions'];
  if (model) args.push('--model', model);
  args.push(prompt);

  console.log(`[drive] spawning: claude ${args.slice(0, -1).join(' ')} <prompt> (cwd=${workDir})`);
  console.log(`[drive] NOTE: no additional-directory access grant flag is passed. The session has no path outside ${workDir}.`);

  const logPath = path.join(workDir, 'harness-session.log');
  writeFileSync(logPath, `# harness session log\n# started: ${new Date().toISOString()}\n# cwd: ${workDir}\n\n`);

  const { spawnSync } = await import('node:child_process');
  const start = Date.now();
  const res = spawnSync('claude', args, { cwd: workDir, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });
  const durationMs = Date.now() - start;
  const combined = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  appendFileSync(logPath, combined);
  process.stdout.write(res.stdout ?? '');
  process.stderr.write(res.stderr ?? '');

  const code = res.status ?? 1;
  console.log(`[drive] session exited with code ${code} after ${(durationMs / 1000).toFixed(1)}s`);
  if (code !== 0) {
    console.log(`[drive] non-zero exit is reported but does NOT skip 'assert' — a crashed session that still wrote artifacts is worth inspecting.`);
  }

  const driveState = { ...state, driveExitCode: code, driveDurationMs: durationMs, drivenAt: new Date().toISOString() };
  writeFileSync(statePath, JSON.stringify(driveState, null, 2));
  return driveState;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
