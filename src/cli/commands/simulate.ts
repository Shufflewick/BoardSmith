import { existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

import type { Game, GameOptions } from '../../engine/index.js';
import {
  simulateRandomGames,
  replayRandomGame,
  type SingleGameResult,
} from '../../testing/random-simulation.js';
import { getProjectContext, loadGameDefinition } from './game-runtime.js';
import { parseGameOptionFlags } from './dev.js';
import { validateGameOptionSelection, type DevOptionDef } from '../dev-host/config-types.js';
import type { GameOptionDefinition } from '../../session/types.js';
import { requireGameProject, resolveRulesDir, requireRulesIndex } from '../lib/game-project.js';
import { simulateReplayCommand } from '../lib/replay-command.js';

interface SimulateOptions {
  games: string;
  seed?: string;
  /** One game's own seed, as a failing game reports it: plays exactly that game. */
  replay?: string;
  players: string;
  json?: boolean;
  /** Repeatable `--game-option key=value`, mirroring `boardsmith dev`. */
  gameOption?: string[];
}

interface BoardSmithConfig {
  paths?: {
    rules?: string;
  };
}

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
): Record<string, unknown> {
  const selection: Record<string, unknown> = parseGameOptionFlags(rawFlags);
  const declaredList: DevOptionDef[] = Object.entries(declaredOptions ?? {}).map(
    ([id, def]) => ({ id, ...(def as object) }) as DevOptionDef,
  );
  validateGameOptionSelection(declaredList, selection);
  return selection;
}

/** Stable per-game status enum for the CLI's `--json` output. */
type GameStatus = 'complete' | 'stuck' | 'error';

/** Stable per-game report shape (CONTEXT: {index, seed, status, turns, winner, error?}). */
export interface PerGameReport {
  index: number;
  seed: string;
  status: GameStatus;
  turns: number;
  winner: number[] | null;
  error?: string;
}

export interface RunSimulationOptions {
  count: number;
  players: number;
  seed?: string;
  timeout?: number;
  maxActions?: number;
  /**
   * Game-specific options forwarded to every simulated game (`--game-option
   * key=value`). Without them a simulation only ever exercises the game's
   * default configuration, so a game whose longest or heaviest mode is gated
   * by an option gets a green result that says nothing about that mode.
   */
  gameOptions?: Record<string, unknown>;
}

export interface RunSimulationResult {
  games: PerGameReport[];
  baseSeed: string;
}

/** Map one simulated game to the CLI's stable per-game report shape. */
function toPerGameReport(g: SingleGameResult, index: number): PerGameReport {
  const status: GameStatus = g.completed ? 'complete' : g.stuck ? 'stuck' : 'error';
  const error = g.error
    ?? (g.timedOut ? 'Game exceeded the simulation timeout.'
      : g.exceededMaxActions ? 'Game exceeded the maximum action count.'
      : undefined);
  return {
    index,
    seed: g.seed,
    status,
    turns: g.actionCount,
    winner: g.winners ?? null,
    ...(error !== undefined ? { error } : {}),
  };
}

/**
 * Run a seeded batch of random games against `gameClass` and map results to
 * the CLI's stable per-game report shape. Testable in isolation (no esbuild,
 * no child process) — pass a bare game class constructor directly.
 */
export async function runSimulation<G extends Game>(
  gameClass: new (options: GameOptions) => G,
  options: RunSimulationOptions,
): Promise<RunSimulationResult> {
  const results = await simulateRandomGames(gameClass, {
    count: options.count,
    playerCounts: [options.players],
    seed: options.seed,
    timeout: options.timeout,
    maxActions: options.maxActions,
    gameOptions: options.gameOptions,
  });

  return {
    games: results.games.map(toPerGameReport),
    baseSeed: results.seed,
  };
}

interface RunReplayOptions {
  /** The game's own seed, as {@link PerGameReport.seed} reports it. */
  seed: string;
  players: number;
  gameOptions?: Record<string, unknown>;
}

/**
 * Play one game again by its own seed (`--replay`), with the same limits a
 * batch run gives every game, so a failure a batch reported replays the same.
 */
export async function runReplay<G extends Game>(
  gameClass: new (options: GameOptions) => G,
  options: RunReplayOptions,
): Promise<PerGameReport> {
  const result = await replayRandomGame(gameClass, {
    seed: options.seed,
    playerCount: options.players,
    gameOptions: options.gameOptions,
  });
  return toPerGameReport(result, 0);
}

const STATUS_ICON: Record<GameStatus, string> = {
  complete: chalk.green('✓'),
  stuck: chalk.red('✗'),
  error: chalk.red('✗'),
};

function printHumanReport(
  heading: string,
  games: PerGameReport[],
  players: number,
  gameOptions: Record<string, unknown>,
): void {
  console.log(chalk.cyan(`\n${heading}\n`));

  for (const g of games) {
    const icon = STATUS_ICON[g.status];
    console.log(`  ${icon} Game ${g.index} (seed ${g.seed}): ${g.status} — ${g.turns} turn(s)`);
  }

  const total = games.length;
  const completeCount = games.filter(g => g.status === 'complete').length;
  const stuckCount = games.filter(g => g.status === 'stuck').length;
  const errorCount = games.filter(g => g.status === 'error').length;

  console.log('');
  console.log(chalk.bold(`${completeCount}/${total} complete, ${stuckCount} stuck, ${errorCount} errored`));

  const failing = games.filter(g => g.status !== 'complete');
  if (failing.length > 0) {
    console.log('');
    for (const g of failing) {
      console.log(chalk.red(`Game ${g.index} ${g.status} (seed ${g.seed}).`));
      if (g.error) {
        console.log(chalk.dim(`  ${g.error}`));
      }
      console.log(chalk.dim(`  Replay: ${simulateReplayCommand({ seed: g.seed, playerCount: players }, gameOptions)}`));
    }
  }
  console.log('');
}

export async function simulateCommand(options: SimulateOptions): Promise<void> {
  const cwd = process.cwd();

  const configPath = requireGameProject(cwd);

  const config: BoardSmithConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  const rulesPath = resolveRulesDir(cwd, config);
  requireRulesIndex(rulesPath);

  const gamesCount = Number(options.games);
  const playersCount = Number(options.players);
  if (!Number.isInteger(gamesCount) || gamesCount < 1) {
    console.error(chalk.red(`Error: --games must be a positive integer, got "${options.games}"`));
    process.exitCode = 1;
    return;
  }
  if (!Number.isInteger(playersCount) || playersCount < 1) {
    console.error(chalk.red(`Error: --players must be a positive integer, got "${options.players}"`));
    process.exitCode = 1;
    return;
  }

  const context = getProjectContext(cwd);

  const tempDir = join(cwd, '.boardsmith');
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  let gameDefinition;
  try {
    ({ gameDefinition } = await loadGameDefinition(rulesPath, tempDir, context));
  } catch (error) {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; do not mask the original error
    }
    // THROWN, NOT PRINTED (#240): `cli.ts`'s handler renders it as one line,
    // where the error object printed its whole stack and internal paths.
    throw new Error(
      `Failed to load this game's rules: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let gameOptions: Record<string, unknown>;
  try {
    gameOptions = resolveSimulationGameOptions(gameDefinition.gameOptions, options.gameOption);
  } catch (error) {
    console.error(chalk.red((error as Error).message));
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; do not mask the original error
    }
    process.exitCode = 1;
    return;
  }

  const gameClass = gameDefinition.gameClass as new (options: GameOptions) => Game;
  let heading: string;
  let games: PerGameReport[];
  try {
    if (options.replay !== undefined) {
      games = [await runReplay(gameClass, { seed: options.replay, players: playersCount, gameOptions })];
      heading = `Replay of game seed ${options.replay}:`;
    } else {
      const report = await runSimulation(gameClass, {
        count: gamesCount,
        players: playersCount,
        seed: options.seed,
        gameOptions,
      });
      games = report.games;
      heading = `Simulation Results (seed: ${report.baseSeed}):`;
    }
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; do not fail the command over it
    }
  }

  if (options.json) {
    console.log(JSON.stringify(games, null, 2));
  } else {
    printHumanReport(heading, games, playersCount, gameOptions);
  }

  process.exitCode = games.some(g => g.status !== 'complete') ? 1 : 0;
}
