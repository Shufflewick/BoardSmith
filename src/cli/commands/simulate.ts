import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import chalk from 'chalk';

import { availableParallelism } from 'node:os';
import { gameSeed, type SingleGameResult } from '../../sim/play-game.js';
import type { SimulatedGame } from '../../sim/policies.js';
import { buildReport, formatReport, formatComparison, reportCsv, type PlayerCountReport } from '../../sim/report.js';
import { cliSourceFile, getProjectContext, importRuntimeBundle, runtimeBundlePath, toPosix, UnimportedRedirectError } from './game-runtime.js';
import { seatPolicies, type ShardRequest, type SimulationBundle } from '../lib/sim-shard.js';
import { playOnWorkers } from '../lib/sim-workers.js';
import { buildVariants, parseCompare, type CompareDimension, type Variant } from '../lib/sim-variants.js';
import { parseGameOptionFlags } from './dev.js';
import { declaredGameOptionsOf, selectDesignerGameOptions, type GameOptionSelection } from '../../session/game-option-selection.js';
import type { GameOptionDefinition } from '../../session/types.js';
import { requireGameProject, resolveRulesDir, requireRulesIndex } from '../lib/game-project.js';
import { simulateReplayCommand } from '../lib/replay-command.js';
import { withCommandBuildDir } from '../lib/command-build-dir.js';
import { parsePositiveWholeNumber } from '../../utils/positive-whole-number.js';

interface SimulateOptions {
  /** Games per player count. */
  games: string;
  seed?: string;
  /** One game's own seed, as a failing game reports it: plays exactly that game. */
  replay?: string;
  /** Comma-separated player counts; every count the game declares when omitted. */
  players?: string;
  json?: boolean;
  csv?: boolean;
  /** Repeatable `--game-option key=value`, mirroring `boardsmith dev`. */
  gameOption?: string[];
  /** Repeatable `--policy name` (every seat) or `--policy seat=name` (one seat). */
  policy?: string[];
  /** Repeatable `--compare <dimension>=v1,v2,...`: the variants to play side by side. */
  compare?: string[];
  /** Worker threads to play on; every core when omitted. */
  jobs?: string;
}

interface BoardSmithConfig {
  paths?: {
    rules?: string;
  };
  /** The one declaration of the game's options (#701), designer-only ones included. */
  gameOptions?: unknown;
}

/** A game stops as hung after this many actions; a report run has no wall-clock limit. */
const MAX_ACTIONS = 10000;

/**
 * Resolve repeatable `--game-option key=value` flags against the game's own
 * declared options, coercing each value to its declared type.
 *
 * Simulating only the default configuration is how a game's worst case stays
 * invisible: the longest or heaviest mode is usually behind an option, and a
 * harness that cannot reach it reports green about a configuration nobody
 * asked about. A designer-only option is set here like any other: the
 * simulator is one of the designer's tools (#687). Throws an actionable error
 * on an unknown key, a malformed flag, or a value outside a select option's
 * declared choices.
 */
export function resolveSimulationGameOptions(
  declaredOptions: Record<string, GameOptionDefinition> | undefined,
  rawFlags: string[] | undefined,
): GameOptionSelection {
  return selectDesignerGameOptions(declaredOptions, parseGameOptionFlags(rawFlags));
}

/**
 * The player counts `--players` names (`2,4,6`), or every count from the
 * game's `minPlayers` to its `maxPlayers` when it is omitted. Throws on a
 * count that is not a positive whole number or is outside the declared range.
 */
export function parsePlayerCounts(
  raw: string | undefined,
  game: { minPlayers?: number; maxPlayers?: number },
): number[] {
  const { minPlayers, maxPlayers } = game;
  if (raw === undefined) {
    if (minPlayers === undefined || maxPlayers === undefined) {
      throw new Error('This game declares no minPlayers and maxPlayers, so name the player counts with --players (e.g. --players 2,4).');
    }
    return Array.from({ length: maxPlayers - minPlayers + 1 }, (_, i) => minPlayers + i);
  }
  const counts = raw.split(',').map((part) => {
    const count = parsePositiveWholeNumber('--players', part);
    if ((minPlayers !== undefined && count < minPlayers) || (maxPlayers !== undefined && count > maxPlayers)) {
      throw new Error(`--players ${count} is outside this game's range of ${minPlayers} to ${maxPlayers} players.`);
    }
    return count;
  });
  const repeated = counts.find((count, i) => counts.indexOf(count) !== i);
  if (repeated !== undefined) throw new Error(`--players names ${repeated} more than once, got "${raw}".`);
  return counts;
}

/** Stable per-game status enum for the CLI's `--json` output. */
type GameStatus = 'complete' | 'stuck' | 'error';

/** One game as the CLI reports it. */
export interface PerGameReport {
  index: number;
  seed: string;
  players: number;
  status: GameStatus;
  turns: number;
  winner: number[] | null;
  error?: string;
  /**
   * The game failed in production mode and finished when played again in
   * development mode, which `--replay` plays in, so no replay command can show it.
   */
  productionOnly?: true;
}

/** A run's games: those that did not finish, and the report, which is `null` when any did not. */
export interface RunSimulationResult {
  baseSeed: string;
  failing: PerGameReport[];
  report: PlayerCountReport[] | null;
}

export interface RunSimulationOptions {
  gamesPerCount: number;
  playerCounts: number[];
  seed?: string;
  /** The `--policy` flags that pick each seat's policy; every seat plays `random` without them. */
  policyFlags?: readonly string[];
  maxActions?: number;
  /**
   * Game-specific options forwarded to every simulated game (`--game-option
   * key=value`). Without them a simulation only ever exercises the game's
   * default configuration, so a game whose longest or heaviest mode is gated
   * by an option gets a green result that says nothing about that mode.
   */
  gameOptions?: Record<string, unknown>;
  /** Worker threads to play on. */
  jobs: number;
}

/** What a production-only failure says, after the production failure's own text. */
const PRODUCTION_ONLY =
  'This game fails only in production mode: played again in development mode, it finished, so --replay cannot show it. ' +
  'That usually means game code changes state inside a callback that only describes the game ' +
  '(a choices, condition or filter callback), which production mode caches.';

/**
 * Why a game did not finish: the development-mode replay's message when there is one, or, when
 * the replay finished, the production message and that it fails only in production mode.
 */
function failure(g: SingleGameResult, inDevMode: SingleGameResult | undefined): Pick<PerGameReport, 'error' | 'productionOnly'> {
  const own = g.error ?? (g.exceededMaxActions ? 'Game exceeded the maximum action count.' : undefined);
  if (inDevMode?.completed) return { error: [own, PRODUCTION_ONLY].filter(Boolean).join(' '), productionOnly: true };
  const error = inDevMode?.error ?? own;
  return error === undefined ? {} : { error };
}

/** Map one simulated game, and its development-mode replay when it failed, to the CLI's stable per-game report shape. */
function toPerGameReport(g: SingleGameResult, index: number, inDevMode?: SingleGameResult): PerGameReport {
  const status: GameStatus = g.completed ? 'complete' : g.stuck ? 'stuck' : 'error';
  return {
    index,
    seed: g.seed,
    players: g.playerCount,
    status,
    turns: g.actionCount,
    winner: g.winners ?? null,
    ...failure(g, inDevMode),
  };
}

/** The request that plays `games` with the run's policies, options and limit. */
function shardRequest(
  games: ShardRequest['games'],
  options: Pick<RunSimulationOptions, 'policyFlags' | 'gameOptions' | 'maxActions'>,
): ShardRequest {
  return { games, policyFlags: options.policyFlags ?? [], gameOptions: options.gameOptions ?? {}, maxActions: options.maxActions ?? MAX_ACTIONS };
}

/**
 * Play `gamesPerCount` seeded games at each player count on worker threads in
 * production mode, play each failing game again in development mode for the
 * rules error's real text, and report them.
 */
export async function runSimulation(rules: LoadedSimulation, options: RunSimulationOptions): Promise<RunSimulationResult> {
  const baseSeed = options.seed ?? crypto.randomUUID();
  const games = options.playerCounts.flatMap((players) =>
    Array.from({ length: options.gamesPerCount }, (_, i) => ({ seed: gameSeed(baseSeed, players, i), players })),
  );
  const played = await playOnWorkers(rules.bundlePath, shardRequest(games, options), options.jobs, 'production');
  const failed = [...played.keys()].filter((i) => !played[i].completed);
  const inDevMode = await playOnWorkers(rules.bundlePath, shardRequest(failed.map((i) => games[i]), options), options.jobs, 'development');
  const failing = failed.map((i, n) => toPerGameReport(played[i], i, inDevMode[n]));
  return { baseSeed, failing, report: failing.length > 0 ? null : buildReport(rules.gameDefinition.metrics, played) };
}

interface RunReplayOptions {
  /** The game's own seed, as {@link PerGameReport.seed} reports it. */
  seed: string;
  players: number;
  policyFlags?: readonly string[];
  gameOptions?: Record<string, unknown>;
}

/**
 * Play one game again by its own seed (`--replay`), in development mode and
 * with the same limits a batch run gives every game, so a failure a batch
 * reported replays the same, with the same message.
 */
export async function runReplay(rules: LoadedSimulation, options: RunReplayOptions): Promise<RunSimulationResult> {
  const [game] = await playOnWorkers(rules.bundlePath, shardRequest([{ seed: options.seed, players: options.players }], options), 1, 'development');
  const failing = game.completed ? [] : [toPerGameReport(game, 0)];
  return { baseSeed: options.seed, failing, report: failing.length > 0 ? null : buildReport(rules.gameDefinition.metrics, [game]) };
}

/** A loaded simulation bundle, and the file it was loaded from, which worker threads import. */
export type LoadedSimulation = SimulationBundle & {
  gameDefinition: SimulatedGame;
  bundlePath: string;
};

/**
 * The rules' game definition, the project's own policies and the runner, bundled together so they
 * share one engine. `redirects` swaps data files for a `--compare` variant (absolute paths); each
 * bundle needs its own `name`.
 */
export async function loadSimulation(
  cwd: string,
  rulesPath: string,
  tempDir: string,
  gameOptions: unknown,
  name = 'simulate',
  redirects?: ReadonlyMap<string, string>,
): Promise<LoadedSimulation> {
  const simIndex = join(cwd, 'src', 'sim', 'index.ts');
  const hasSim = existsSync(simIndex);
  try {
    const module = await importRuntimeBundle({
      rulesPath,
      tempDir,
      name,
      context: getProjectContext(cwd),
      gameOptions,
      exports: [
        `export { playShard } from ${JSON.stringify(toPosix(cliSourceFile('lib/sim-shard.ts')))};`,
        ...(hasSim ? [`export { policies } from ${JSON.stringify(toPosix(simIndex))};`] : []),
      ],
      redirects,
    });
    return { ...(module as unknown as LoadedSimulation), bundlePath: runtimeBundlePath(tempDir, name) };
  } catch (error) {
    if (error instanceof UnimportedRedirectError) {
      const files = error.files.map((file) => toPosix(relative(cwd, file))).join(' and ');
      throw new Error(
        `--compare ${files}: the rules never import it, so playing another file in its place would change nothing. ` +
          'Name a data file the rules import (a CSV through ?raw, for example).',
      );
    }
    // THROWN, NOT PRINTED (#240): `cli.ts`'s handler renders it as one line,
    // where the error object printed its whole stack and internal paths.
    throw new Error(
      `Failed to load this game's rules${hasSim ? ' and src/sim/index.ts' : ''}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** A variant ready to play: its bundle, which has its data files swapped, and its resolved game options. */
interface PlannedVariant extends Variant {
  rules: LoadedSimulation;
  gameOptions: Record<string, unknown>;
}

/** One variant's run. */
interface VariantRun {
  variant: PlannedVariant;
  result: RunSimulationResult;
}

/**
 * Every variant the flags ask for, each with its bundle (one per distinct set of data swaps, the
 * base bundle when it swaps none), its options resolved and its seats checked at every player
 * count, before the first game is played.
 */
async function planVariants(
  base: LoadedSimulation,
  variants: Variant[],
  playerCounts: number[],
  bundle: (name: string, redirects: ReadonlyMap<string, string>) => Promise<LoadedSimulation>,
  cwd: string,
): Promise<PlannedVariant[]> {
  const bundles = new Map<string, LoadedSimulation>([['{}', base]]);
  const planned: PlannedVariant[] = [];
  for (const variant of variants) {
    const key = JSON.stringify(variant.data);
    let rules = bundles.get(key);
    if (rules === undefined) {
      const redirects = new Map(Object.entries(variant.data).map(([file, replacement]) => [resolve(cwd, file), resolve(cwd, replacement)]));
      rules = await bundle(`simulate-${bundles.size}`, redirects);
      bundles.set(key, rules);
    }
    const gameOptions = resolveSimulationGameOptions(declaredGameOptionsOf(rules.gameDefinition), variant.gameOptionFlags);
    for (const count of playerCounts) seatPolicies(variant.policyFlags, rules.policies, count);
    planned.push({ ...variant, rules, gameOptions });
  }
  return planned;
}

/** A positive whole number of worker threads, every core's worth when `--jobs` is not given. */
function parseJobs(raw: string | undefined): number {
  return raw === undefined ? availableParallelism() : parsePositiveWholeNumber('--jobs', raw);
}

/** The flags read before the rules are loaded. */
interface RunFlags {
  gamesPerCount: number;
  jobs: number;
  dimensions: CompareDimension[];
  /** The base seed, or the one game's own seed for `--replay`. */
  seed: string;
}

function parseRunFlags(options: SimulateOptions): RunFlags {
  return {
    gamesPerCount: parsePositiveWholeNumber('--games', options.games),
    jobs: parseJobs(options.jobs),
    dimensions: parseCompare(options.compare),
    seed: options.replay ?? options.seed ?? crypto.randomUUID(),
  };
}

/** The player counts and the variants, ready to play. Throws a message for the person running the command. */
async function planRun(
  cwd: string,
  options: SimulateOptions,
  flags: RunFlags,
  base: LoadedSimulation,
  bundle: (name: string, redirects: ReadonlyMap<string, string>) => Promise<LoadedSimulation>,
): Promise<{ playerCounts: number[]; variants: PlannedVariant[] }> {
  const playerCounts = parsePlayerCounts(options.players, base.gameDefinition);
  if (options.replay !== undefined && playerCounts.length !== 1) {
    throw new Error(`--replay plays one game, so --players must name its one player count, got "${options.players ?? ''}".`);
  }
  const run = { cwd, policyFlags: options.policy ?? [], gameOptionFlags: options.gameOption ?? [] };
  const wanted = buildVariants(flags.dimensions, run, declaredGameOptionsOf(base.gameDefinition));
  if (options.replay !== undefined && wanted.length !== 1) {
    throw new Error('--replay plays one game, so each --compare must give it one value.');
  }
  return { playerCounts, variants: await planVariants(base, wanted, playerCounts, bundle, cwd) };
}

/** Play one variant: the batch, or with `--replay` the one game. */
function runVariant(variant: PlannedVariant, options: SimulateOptions, flags: RunFlags, playerCounts: number[]): Promise<RunSimulationResult> {
  const { rules, policyFlags, gameOptions } = variant;
  if (options.replay !== undefined) {
    return runReplay(rules, { seed: flags.seed, players: playerCounts[0], policyFlags, gameOptions });
  }
  return runSimulation(rules, {
    gamesPerCount: flags.gamesPerCount,
    playerCounts,
    seed: flags.seed,
    policyFlags,
    gameOptions,
    jobs: flags.jobs,
  });
}

/** The run as JSON: `{ run, games, report }`, or `{ run, variants }` when it compares variants. */
function runJson(options: SimulateOptions, flags: RunFlags, playerCounts: number[], runs: VariantRun[]): string {
  const run = { seed: flags.seed, gamesPerCount: options.replay === undefined ? flags.gamesPerCount : 1, players: playerCounts };
  if (flags.dimensions.length === 0) {
    const [{ variant, result }] = runs;
    const plain = { run: { ...run, policies: variant.policyFlags, gameOptions: variant.gameOptions }, games: result.failing, report: result.report };
    return JSON.stringify(plain, null, 2);
  }
  const variants = runs.map(({ variant, result }) => ({
    label: variant.label,
    policies: variant.policyFlags,
    gameOptions: variant.gameOptions,
    data: variant.data,
    games: result.failing,
    report: result.report,
  }));
  return JSON.stringify({ run: { ...run, compare: flags.dimensions }, variants }, null, 2);
}

export async function simulateCommand(options: SimulateOptions): Promise<void> {
  const cwd = process.cwd();

  const configPath = requireGameProject(cwd);

  const config: BoardSmithConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  const rulesPath = resolveRulesDir(cwd, config);
  requireRulesIndex(rulesPath);

  let flags: RunFlags;
  try {
    flags = parseRunFlags(options);
  } catch (error) {
    console.error(chalk.red((error as Error).message));
    process.exitCode = 1;
    return;
  }

  // This run's own build directory (#543), removed once the games have run; never `.boardsmith/`
  // itself (#391).
  const outcome = await withCommandBuildDir(cwd, 'simulate', async (tempDir) => {
    const bundle = (name: string, redirects?: ReadonlyMap<string, string>) => loadSimulation(cwd, rulesPath, tempDir, config.gameOptions, name, redirects);
    const base = await bundle('simulate');
    let plan: Awaited<ReturnType<typeof planRun>>;
    try {
      plan = await planRun(cwd, options, flags, base, bundle);
    } catch (error) {
      console.error(chalk.red((error as Error).message));
      return undefined;
    }
    const runs: VariantRun[] = [];
    for (const variant of plan.variants) runs.push({ variant, result: await runVariant(variant, options, flags, plan.playerCounts) });
    return { playerCounts: plan.playerCounts, runs };
  });
  if (outcome === undefined) {
    process.exitCode = 1;
    return;
  }
  const { playerCounts, runs } = outcome;
  if (options.json) {
    console.log(runJson(options, flags, playerCounts, runs));
  } else {
    const heading = options.replay !== undefined ? `Replay of game seed ${flags.seed}:` : `Simulation Results (seed: ${flags.seed}):`;
    printResult(heading, runs, flags.dimensions.length > 0, options.csv === true);
  }
  process.exitCode = runs.some(({ result }) => result.failing.length > 0) ? 1 : 0;
}

/** Print a variant's games that did not finish, each with its replay command. */
function printFailures(print: (line: string) => void, { variant, result }: VariantRun, compared: boolean): void {
  if (compared && result.failing.length > 0) print(chalk.bold(`Variant ${variant.label}:`));
  for (const g of result.failing) {
    print(chalk.red(`Game ${g.index} ${g.status} (seed ${g.seed}) after ${g.turns} action(s).`));
    if (g.error) print(chalk.dim(`  ${g.error}`));
    if (g.productionOnly) continue;
    const replay = simulateReplayCommand({ seed: g.seed, playerCount: g.players }, variant.gameOptions, variant.policyFlags, variant.data);
    print(chalk.dim(`  Replay: ${replay}`));
  }
}

/**
 * Print a run as tables, or as CSV. Only CSV goes to stdout then: a run with an unfinished game
 * has none, and says why on stderr.
 */
function printResult(heading: string, runs: VariantRun[], compared: boolean, csv: boolean): void {
  const reports = runs.flatMap(({ variant, result }) => (result.report === null ? [] : [{ variant: variant.label, report: result.report }]));
  const finished = reports.length === runs.length;
  if (csv && finished) {
    console.log(reportCsv(reports));
    return;
  }
  const print = csv ? console.error : console.log;
  if (!csv) {
    console.log(chalk.cyan(`\n${heading}\n`));
    if (runs.length > 1) {
      console.log('Variants (each difference is from variant 1):');
      runs.forEach(({ variant }, i) => console.log(`  ${i + 1}  ${variant.label}`));
      console.log('');
    }
  }
  for (const run of runs) printFailures(print, run, compared);
  if (!finished) {
    const unfinished = runs.reduce((sum, { result }) => sum + result.failing.length, 0);
    print(chalk.bold(`\n${unfinished} game(s) did not finish, so no statistics are reported.\n`));
    return;
  }
  console.log(compared ? formatComparison(reports) : formatReport(reports[0].report));
}
