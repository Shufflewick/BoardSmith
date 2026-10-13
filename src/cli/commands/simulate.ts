import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

import { playGame, gameSeed, type SingleGameResult } from '../../sim/play-game.js';
import { random, mcts, type Policy, type SimulatedGame } from '../../sim/policies.js';
import { parseBotLevel } from '../../bot/index.js';
import { getProjectContext, importRuntimeBundle, toPosix } from './game-runtime.js';
import { parseGameOptionFlags } from './dev.js';
import { selectGameOptions, type GameOptionSelection } from '../../session/game-option-selection.js';
import type { GameOptionDefinition } from '../../session/types.js';
import { requireGameProject, resolveRulesDir, requireRulesIndex } from '../lib/game-project.js';
import { simulateReplayCommand } from '../lib/replay-command.js';
import { withCommandBuildDir } from '../lib/command-build-dir.js';

interface SimulateOptions {
  /** Games per player count. */
  games: string;
  seed?: string;
  /** One game's own seed, as a failing game reports it: plays exactly that game. */
  replay?: string;
  /** Comma-separated player counts; every count the game declares when omitted. */
  players?: string;
  json?: boolean;
  /** Repeatable `--game-option key=value`, mirroring `boardsmith dev`. */
  gameOption?: string[];
  /** Repeatable `--policy name` (every seat) or `--policy seat=name` (one seat). */
  policy?: string[];
}

interface BoardSmithConfig {
  paths?: {
    rules?: string;
  };
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
 * asked about. Throws an actionable error on an unknown key, a malformed
 * flag, or a value outside a select option's declared choices.
 */
export function resolveSimulationGameOptions(
  declaredOptions: Record<string, GameOptionDefinition> | undefined,
  rawFlags: string[] | undefined,
): GameOptionSelection {
  return selectGameOptions(declaredOptions, parseGameOptionFlags(rawFlags));
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
    if (!/^\d+$/.test(part) || Number(part) < 1) {
      throw new Error(`--players takes positive whole numbers separated by commas (e.g. 2,4,6), got "${raw}".`);
    }
    const count = Number(part);
    if ((minPlayers !== undefined && count < minPlayers) || (maxPlayers !== undefined && count > maxPlayers)) {
      throw new Error(`--players ${count} is outside this game's range of ${minPlayers} to ${maxPlayers} players.`);
    }
    return count;
  });
  const repeated = counts.find((count, i) => counts.indexOf(count) !== i);
  if (repeated !== undefined) throw new Error(`--players names ${repeated} more than once, got "${raw}".`);
  return counts;
}

const BUILT_IN_POLICIES = 'random, mcts:<level>';

/** The policy a `--policy` name stands for: a built-in, or one of the project's. */
function policyNamed(name: string, project: Record<string, Policy>): Policy {
  if (name === 'random') return random();
  if (name.startsWith('mcts:')) return mcts(parseBotLevel(name.slice('mcts:'.length)));
  // Named by its key, so an error names the policy the author listed, not the builder it came from.
  // `choose` is called on the policy itself, so a class policy keeps its prototype and `this`.
  if (Object.hasOwn(project, name)) {
    const policy = project[name];
    return { name, choose: (turn) => policy.choose(turn) };
  }
  const names = [BUILT_IN_POLICIES, ...Object.keys(project)].join(', ');
  throw new Error(
    `Unknown policy "${name}". Use one of: ${names}; or add it to the policies src/sim/index.ts exports.`,
  );
}

/** Refuse a project policy list entry that is not a policy or that takes a built-in name. */
function checkProjectPolicies(project: Record<string, unknown>): Record<string, Policy> {
  for (const [name, policy] of Object.entries(project)) {
    if (name === 'random' || name.startsWith('mcts:')) {
      throw new Error(`src/sim/index.ts names a policy "${name}", which is a built-in policy's name. Rename it.`);
    }
    const candidate = policy as Partial<Policy> | null;
    if (typeof candidate?.name !== 'string' || typeof candidate.choose !== 'function') {
      throw new Error(
        `src/sim/index.ts's policy "${name}" is not a policy. Build it with greedy, random or mcts from boardsmith/sim.`,
      );
    }
  }
  return project as Record<string, Policy>;
}

/**
 * One policy per seat of a `playerCount` game, from the `--policy` flags: a
 * bare name sets every seat, `seat=name` sets one, and seats no flag names
 * play `random`. `project` is the policies the project's `src/sim/index.ts`
 * exports. Throws on an unknown name, a seat the game does not have, or a seat
 * named twice.
 */
export function seatPolicies(
  flags: readonly string[] | undefined,
  project: Record<string, Policy> | undefined,
  playerCount: number,
): Policy[] {
  const known = checkProjectPolicies(project ?? {});
  let everySeat: string | undefined;
  const bySeat = new Map<number, string>();
  for (const flag of flags ?? []) {
    const seatFlag = /^(\d+)=(.+)$/.exec(flag);
    if (!seatFlag) {
      if (everySeat !== undefined) {
        throw new Error(`--policy ${everySeat} and --policy ${flag} give more than one policy for every seat. Give one, and set single seats with seat=name.`);
      }
      everySeat = flag;
      continue;
    }
    const seat = Number(seatFlag[1]);
    if (seat < 1 || seat > playerCount) {
      throw new Error(`--policy ${flag} names seat ${seat}, which a ${playerCount}-player game does not have. Seats are 1 to ${playerCount}.`);
    }
    if (bySeat.has(seat)) throw new Error(`--policy names seat ${seat} more than once.`);
    bySeat.set(seat, seatFlag[2]);
  }
  return Array.from({ length: playerCount }, (_, i) => policyNamed(bySeat.get(i + 1) ?? everySeat ?? 'random', known));
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
}

/** The statistics of one player count, reported only when every game finished. */
export interface PlayerCountReport {
  players: number;
  games: number;
  /** Seat -> share of games that seat won alone. */
  winShare: Record<number, number>;
  /** Share of games won by no seat or shared by several. */
  tieRate: number;
  /** Game length in actions. */
  length: { mean: number; min: number; max: number };
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
  /** One policy per seat for a game of that many players. */
  policiesFor: (playerCount: number) => Policy[];
  maxActions?: number;
  /**
   * Game-specific options forwarded to every simulated game (`--game-option
   * key=value`). Without them a simulation only ever exercises the game's
   * default configuration, so a game whose longest or heaviest mode is gated
   * by an option gets a green result that says nothing about that mode.
   */
  gameOptions?: Record<string, unknown>;
}

/** Map one simulated game to the CLI's stable per-game report shape. */
function toPerGameReport(g: SingleGameResult, index: number): PerGameReport {
  const status: GameStatus = g.completed ? 'complete' : g.stuck ? 'stuck' : 'error';
  const error = g.error ?? (g.exceededMaxActions ? 'Game exceeded the maximum action count.' : undefined);
  return {
    index,
    seed: g.seed,
    players: g.playerCount,
    status,
    turns: g.actionCount,
    winner: g.winners ?? null,
    ...(error !== undefined ? { error } : {}),
  };
}

/** The statistics of one player count's finished games. */
function playerCountReport(players: number, games: PerGameReport[]): PlayerCountReport {
  const wins = new Map<number, number>();
  for (const g of games) if (g.winner?.length === 1) wins.set(g.winner[0], (wins.get(g.winner[0]) ?? 0) + 1);
  // One pass, not Math.min(...turns): spreading a large run overflows the stack.
  const length = { sum: 0, min: Infinity, max: -Infinity };
  for (const { turns } of games) {
    length.sum += turns;
    length.min = Math.min(length.min, turns);
    length.max = Math.max(length.max, turns);
  }
  return {
    players,
    games: games.length,
    winShare: Object.fromEntries(Array.from({ length: players }, (_, i) => [i + 1, (wins.get(i + 1) ?? 0) / games.length])),
    tieRate: games.filter((g) => g.winner?.length !== 1).length / games.length,
    length: { mean: length.sum / games.length, min: length.min, max: length.max },
  };
}

/** Play `games` in order and report them. */
async function playAndReport(
  definition: SimulatedGame,
  baseSeed: string,
  games: Array<{ seed: string; players: number }>,
  options: Pick<RunSimulationOptions, 'policiesFor' | 'maxActions' | 'gameOptions'>,
): Promise<RunSimulationResult> {
  const played: PerGameReport[] = [];
  for (const [index, game] of games.entries()) {
    const result = await playGame(definition, {
      playerCount: game.players,
      seed: game.seed,
      policies: options.policiesFor(game.players),
      maxActions: options.maxActions ?? MAX_ACTIONS,
      gameOptions: options.gameOptions,
    });
    played.push(toPerGameReport(result, index));
  }
  const failing = played.filter((g) => g.status !== 'complete');
  const counts = [...new Set(games.map((g) => g.players))];
  const report = failing.length > 0
    ? null
    : counts.map((players) => playerCountReport(players, played.filter((g) => g.players === players)));
  return { baseSeed, failing, report };
}

/**
 * Play `gamesPerCount` seeded games at each player count and report them.
 * Testable in isolation (no esbuild, no child process): pass a game
 * definition directly.
 */
export async function runSimulation(
  definition: SimulatedGame,
  options: RunSimulationOptions,
): Promise<RunSimulationResult> {
  const baseSeed = options.seed ?? crypto.randomUUID();
  const games = options.playerCounts.flatMap((players) =>
    Array.from({ length: options.gamesPerCount }, (_, i) => ({ seed: gameSeed(baseSeed, players, i), players })),
  );
  return playAndReport(definition, baseSeed, games, options);
}

interface RunReplayOptions {
  /** The game's own seed, as {@link PerGameReport.seed} reports it. */
  seed: string;
  players: number;
  policies: Policy[];
  gameOptions?: Record<string, unknown>;
}

/**
 * Play one game again by its own seed (`--replay`), with the same limits a
 * batch run gives every game, so a failure a batch reported replays the same.
 */
export async function runReplay(definition: SimulatedGame, options: RunReplayOptions): Promise<RunSimulationResult> {
  return playAndReport(definition, options.seed, [{ seed: options.seed, players: options.players }], {
    policiesFor: () => options.policies,
    gameOptions: options.gameOptions,
  });
}

const percent = (share: number) => `${Math.round(share * 1000) / 10}%`;

function printHumanReport(
  heading: string,
  result: RunSimulationResult,
  gameOptions: Record<string, unknown>,
  policyFlags: readonly string[],
): void {
  console.log(chalk.cyan(`\n${heading}\n`));

  for (const g of result.failing) {
    console.log(chalk.red(`Game ${g.index} ${g.status} (seed ${g.seed}) after ${g.turns} action(s).`));
    if (g.error) console.log(chalk.dim(`  ${g.error}`));
    console.log(chalk.dim(`  Replay: ${simulateReplayCommand({ seed: g.seed, playerCount: g.players }, gameOptions, policyFlags)}`));
  }
  if (result.report === null) {
    console.log(chalk.bold(`\n${result.failing.length} game(s) did not finish, so no statistics are reported.\n`));
    return;
  }

  for (const r of result.report) {
    console.log(chalk.bold(`${r.players} players: all ${r.games} games complete`));
    const shares = Object.entries(r.winShare).map(([seat, share]) => `seat ${seat} ${percent(share)}`);
    console.log(`  Win share: ${shares.join(', ')}`);
    console.log(`  Ties: ${percent(r.tieRate)}`);
    console.log(`  Length: mean ${Math.round(r.length.mean * 10) / 10}, min ${r.length.min}, max ${r.length.max} actions`);
  }
  console.log('');
}

/** The rules' game definition and the project's own policies, bundled together so they share one engine. */
async function loadSimulation(
  cwd: string,
  rulesPath: string,
  tempDir: string,
): Promise<{ gameDefinition: SimulatedGame & { gameOptions?: Record<string, GameOptionDefinition> }; policies: Record<string, Policy> | undefined }> {
  const simIndex = join(cwd, 'src', 'sim', 'index.ts');
  const hasSim = existsSync(simIndex);
  try {
    const module = await importRuntimeBundle({
      rulesPath,
      tempDir,
      name: 'simulate',
      context: getProjectContext(cwd),
      exports: hasSim ? [`export { policies } from ${JSON.stringify(toPosix(simIndex))};`] : [],
    });
    return { gameDefinition: module.gameDefinition, policies: module.policies as Record<string, Policy> | undefined };
  } catch (error) {
    // THROWN, NOT PRINTED (#240): `cli.ts`'s handler renders it as one line,
    // where the error object printed its whole stack and internal paths.
    throw new Error(
      `Failed to load this game's rules${hasSim ? ' and src/sim/index.ts' : ''}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function simulateCommand(options: SimulateOptions): Promise<void> {
  const cwd = process.cwd();

  const configPath = requireGameProject(cwd);

  const config: BoardSmithConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  const rulesPath = resolveRulesDir(cwd, config);
  requireRulesIndex(rulesPath);

  const gamesCount = Number(options.games);
  if (!Number.isInteger(gamesCount) || gamesCount < 1) {
    console.error(chalk.red(`Error: --games must be a positive integer, got "${options.games}"`));
    process.exitCode = 1;
    return;
  }
  const policyFlags = options.policy ?? [];

  // This run's own build directory (#543), removed once the games have run; never `.boardsmith/`
  // itself (#391).
  const outcome = await withCommandBuildDir(cwd, 'simulate', async (tempDir) => {
    const { gameDefinition, policies } = await loadSimulation(cwd, rulesPath, tempDir);

    let gameOptions: Record<string, unknown>;
    let playerCounts: number[];
    try {
      gameOptions = resolveSimulationGameOptions(gameDefinition.gameOptions, options.gameOption);
      playerCounts = parsePlayerCounts(options.players, gameDefinition);
      if (options.replay !== undefined && playerCounts.length !== 1) {
        throw new Error(`--replay plays one game, so --players must name its one player count, got "${options.players ?? ''}".`);
      }
      // Every player count's seats are checked before the first game is played.
      for (const count of playerCounts) seatPolicies(policyFlags, policies, count);
    } catch (error) {
      console.error(chalk.red((error as Error).message));
      return undefined;
    }

    const policiesFor = (count: number) => seatPolicies(policyFlags, policies, count);
    if (options.replay !== undefined) {
      const result = await runReplay(gameDefinition, {
        seed: options.replay,
        players: playerCounts[0],
        policies: policiesFor(playerCounts[0]),
        gameOptions,
      });
      return { heading: `Replay of game seed ${options.replay}:`, result, gameOptions, playerCounts };
    }
    const result = await runSimulation(gameDefinition, {
      gamesPerCount: gamesCount,
      playerCounts,
      seed: options.seed,
      policiesFor,
      gameOptions,
    });
    return { heading: `Simulation Results (seed: ${result.baseSeed}):`, result, gameOptions, playerCounts };
  });
  if (outcome === undefined) {
    process.exitCode = 1;
    return;
  }
  const { heading, result, gameOptions, playerCounts } = outcome;

  if (options.json) {
    const run = { seed: result.baseSeed, gamesPerCount: options.replay === undefined ? gamesCount : 1, players: playerCounts, policies: policyFlags, gameOptions };
    console.log(JSON.stringify({ run, games: result.failing, report: result.report }, null, 2));
  } else {
    printHumanReport(heading, result, gameOptions, policyFlags);
  }

  process.exitCode = result.failing.length > 0 ? 1 : 0;
}
