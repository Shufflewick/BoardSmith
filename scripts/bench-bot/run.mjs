#!/usr/bin/env node
/**
 * The bot speed benchmark (#630).
 *
 *   node scripts/bench-bot/run.mjs [game ...] [--out <file>]
 *
 * With no game it runs the catalogue table games below, from ~/BoardSmithGames,
 * and MERC when it is checked out (all read only). A game is a catalogue name (`chess`, `hex-19`) or the directory
 * of any game project. For each game it plays a seeded game of random moves to
 * an early, a middle and a late position, and there runs every difficulty
 * preset and a fixed-step search, against the BoardSmith in THIS checkout. It
 * prints the report as Markdown, and `--out` also writes it to a file;
 * docs/bot-speed-baseline.md is the committed baseline.
 *
 * It measures in production mode, as a worker child runs, whatever NODE_ENV the
 * shell has. docs/bot-system.md, "Measuring bot speed", says how to read it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, homedir, loadavg, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatReport } from './report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const GAMES_DIR = join(homedir(), 'BoardSmithGames');

/**
 * The catalogue table games, with the table sizes the 2026-10-10 measurement
 * used (#628). MERC is run when it is checked out, and left out with a note
 * when it is not.
 */
const CATALOGUE = [
  { name: 'checkers', dir: join(GAMES_DIR, 'checkers'), playerCount: 2 },
  { name: 'chess', dir: join(GAMES_DIR, 'chess'), playerCount: 2 },
  { name: 'cribbage', dir: join(GAMES_DIR, 'cribbage'), playerCount: 2 },
  { name: 'go-fish', dir: join(GAMES_DIR, 'go-fish'), playerCount: 4 },
  { name: 'hex-11', dir: join(GAMES_DIR, 'hex'), playerCount: 2, options: { boardSize: 11 } },
  { name: 'hex-19', dir: join(GAMES_DIR, 'hex'), playerCount: 2, options: { boardSize: 19 } },
  { name: 'seven', dir: join(GAMES_DIR, 'seven'), playerCount: 7 },
  { name: 'merc', dir: join(homedir(), 'Dropbox', 'MERC', 'BoardSmith', 'MERC'), whereCheckedOut: true },
];

const isGameProject = (dir) => existsSync(join(dir, 'boardsmith.json'));

function parseArgs(args) {
  const outAt = args.indexOf('--out');
  if (outAt !== -1 && args[outAt + 1] === undefined) throw new Error('--out needs a file to write the report to.');
  const out = outAt === -1 ? undefined : resolve(args[outAt + 1]);
  const games = args.filter((_, at) => outAt === -1 || (at !== outAt && at !== outAt + 1));
  return { out, games };
}

/** What to run for one argument: a catalogue game, or a game project directory at its smallest table. */
function setupFor(arg) {
  const listed = CATALOGUE.find((entry) => entry.name === arg);
  if (listed) {
    if (!isGameProject(listed.dir)) {
      throw new Error(
        `${listed.name} is not checked out at ${listed.dir}. ` +
          (listed.whereCheckedOut
            ? 'Check it out there, or name only the games you have.'
            : 'Clone the catalogue with bash ~/ShufflewickPub/scripts/clone-game-catalogue.sh, or name only the games you have.'),
      );
    }
    return listed;
  }
  const dir = resolve(arg);
  if (!isGameProject(dir)) {
    throw new Error(
      `"${arg}" is neither a catalogue game (${CATALOGUE.map((entry) => entry.name).join(', ')}) ` +
        'nor a game project directory (one with a boardsmith.json).',
    );
  }
  return { name: basename(dir), dir };
}

/** The checkout `dir` is in: its short commit and whether it has uncommitted changes, or nothing outside git. */
function checkout(dir) {
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  try {
    return { commit: git('rev-parse', '--short', 'HEAD'), dirty: git('status', '--porcelain') !== '' };
  } catch {
    return {};
  }
}

/**
 * The games named, or with none named the whole catalogue less any game that
 * is run only where it is checked out and is not, with why each was skipped.
 */
function selectGames(games) {
  if (games.length > 0) return { setups: games.map(setupFor), skipped: [] };
  const missing = CATALOGUE.filter((entry) => entry.whereCheckedOut && !isGameProject(entry.dir));
  return {
    setups: CATALOGUE.filter((entry) => !missing.includes(entry)).map((entry) => setupFor(entry.name)),
    skipped: missing.map((entry) => `${entry.name}, which is not checked out at ${entry.dir}`),
  };
}

async function main() {
  // Production mode, as in a worker child, where `isDevMode()` is false. The
  // engine reads it when asked, so it holds for the bundles loaded below; the
  // bundles report what the engine saw, and the report refuses anything else.
  process.env.NODE_ENV = 'production';
  const { out, games } = parseArgs(process.argv.slice(2));
  const { setups, skipped } = selectGames(games);
  for (const reason of skipped) process.stderr.write(`bench-bot: skipping ${reason}\n`);

  await import('tsx');
  const { importRuntimeBundle } = await import('../../src/cli/commands/game-runtime.ts');
  const { resolveRulesDir, requireRulesIndex } = await import('../../src/cli/lib/game-project.ts');

  const loadBefore = loadavg();
  const results = [];
  let devMode = false;
  for (const setup of setups) {
    process.stderr.write(`bench-bot: ${setup.name}\n`);
    const config = JSON.parse(readFileSync(join(setup.dir, 'boardsmith.json'), 'utf8'));
    const rulesPath = resolveRulesDir(setup.dir, config);
    requireRulesIndex(rulesPath);
    const tempDir = mkdtempSync(join(tmpdir(), 'bench-bot-'));
    try {
      const bundle = await importRuntimeBundle({
        rulesPath,
        tempDir,
        name: 'bench',
        context: 'monorepo',
        exports: [`export { runBench } from ${JSON.stringify(join(HERE, 'probe.mjs'))};`],
      });
      const playerCount = setup.playerCount ?? bundle.gameDefinition.minPlayers;
      const run = await bundle.runBench(bundle.gameDefinition, { playerCount, options: setup.options ?? {} });
      devMode ||= run.devMode;
      results.push({ name: setup.name, ...checkout(setup.dir), playerCount, plies: run.plies, positions: run.positions });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  const report = formatReport(
    {
      date: new Date().toISOString(),
      ...checkout(REPO),
      node: process.version,
      devMode,
      loadBefore,
      loadAfter: loadavg(),
      cpus: cpus().length,
      cpuModel: cpus()[0]?.model ?? 'unknown CPU',
      skipped,
    },
    results,
  );
  if (out) writeFileSync(out, report);
  process.stdout.write(report);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`bench-bot: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
