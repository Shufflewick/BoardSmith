#!/usr/bin/env node
/**
 * The balance simulator speed benchmark (#556).
 *
 *   node scripts/bench-sim/run.mjs [--games <n>] [--out <file>]
 *
 * Scaffolds a project with `boardsmith init --sim` in a temp directory, writes
 * the code blocks of docs/balance-simulator.md into it (its final, with
 * abilities, game), and times `boardsmith simulate` from THIS checkout with the
 * random and greedy policies: at 2, 4 and 6 players one at a time, then all
 * three in one command. `--games` is per player count, 3,000 by default. It
 * prints the report as Markdown, and `--out` also writes it to a file;
 * docs/sim-speed-baseline.md is the committed baseline.
 *
 * Run it on a quiet machine: the report records the load average, but cannot
 * take it out of the numbers.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatSpeedReport } from './report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const CLI = join(REPO, 'bin', 'boardsmith.js');
const POLICIES = ['random', 'greedy'];
const PLAYER_COUNTS = [2, 4, 6];

export function parseArgs(args) {
  const valueOf = (flag) => {
    const at = args.indexOf(flag);
    if (at === -1) return undefined;
    if (args[at + 1] === undefined) throw new Error(`${flag} needs a value.`);
    return args[at + 1];
  };
  const known = new Set(['--games', '--out']);
  const unknown = args.filter((arg, at) => arg.startsWith('--') && !known.has(arg) && !known.has(args[at - 1]));
  if (unknown.length > 0) throw new Error(`Unknown option ${unknown[0]}. Use --games <n> and --out <file>.`);
  const games = Number(valueOf('--games') ?? 3000);
  if (!Number.isInteger(games) || games < 1) throw new Error('--games must be a whole number of games, 1 or more.');
  const out = valueOf('--out');
  return { games, out: out === undefined ? undefined : resolve(out) };
}

/** Runs the CLI in `cwd`, failing loudly with its output when it fails. */
function cli(cwd, args) {
  const ran = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (ran.status !== 0) {
    throw new Error(`boardsmith ${args.join(' ')} failed:\n${ran.stdout}${ran.stderr}`);
  }
  return ran.stdout;
}

/** The worked example's final game, in a project of its own under `parent`. */
async function exampleProject(parent) {
  await import('tsx');
  const { balanceSimulatorSteps } = await import('../../docs/balance-simulator-steps.ts');
  cli(parent, ['init', 'bazaar', '--sim', '--without-rulebook']);
  const dir = join(parent, 'bazaar');
  mkdirSync(join(dir, 'node_modules'));
  symlinkSync(REPO, join(dir, 'node_modules', 'boardsmith'), 'dir');
  for (const step of balanceSimulatorSteps()) {
    if (step.kind !== 'file') continue;
    mkdirSync(dirname(join(dir, step.path)), { recursive: true });
    writeFileSync(join(dir, step.path), step.body);
  }
  return dir;
}

/** Times one simulate run, which must finish every game. */
function timeRun(dir, policy, players, games) {
  const started = process.hrtime.bigint();
  const output = JSON.parse(cli(dir, [
    'simulate', '--games', String(games), '--players', players, '--policy', policy, '--seed', 'bench', '--json',
  ]));
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  if (output.games.length > 0 || output.report === null) {
    throw new Error(`${policy} at ${players} players left ${output.games.length} game(s) unfinished.`);
  }
  return { policy, players, games: games * players.split(',').length, seconds };
}

function checkout() {
  const git = (...args) => spawnSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).stdout.trim();
  return { commit: git('rev-parse', '--short', 'HEAD'), dirty: git('status', '--porcelain') !== '' };
}

async function main() {
  const { games, out } = parseArgs(process.argv.slice(2));
  const parent = mkdtempSync(join(tmpdir(), 'bench-sim-'));
  try {
    const dir = await exampleProject(parent);
    const loadBefore = loadavg();
    const rows = [];
    for (const policy of POLICIES) {
      for (const players of PLAYER_COUNTS) {
        process.stderr.write(`bench-sim: ${policy} at ${players} players\n`);
        rows.push(timeRun(dir, policy, String(players), games));
      }
      process.stderr.write(`bench-sim: ${policy} at ${PLAYER_COUNTS.join(',')} players\n`);
      rows.push(timeRun(dir, policy, PLAYER_COUNTS.join(','), games));
    }
    const report = formatSpeedReport(
      {
        date: new Date().toISOString(),
        ...checkout(),
        node: process.version,
        cpus: cpus().length,
        cpuModel: cpus()[0]?.model ?? 'unknown CPU',
        loadBefore,
        loadAfter: loadavg(),
        games,
      },
      rows,
    );
    if (out) writeFileSync(out, report);
    process.stdout.write(report);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`bench-sim: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
