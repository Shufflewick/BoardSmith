import { existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import chalk from 'chalk';

import type { Game, GameOptions } from '../../engine/index.js';
import { simulateRandomGames } from '../../testing/random-simulation.js';
import { getProjectContext, loadGameDefinition } from './game-runtime.js';

interface SimulateOptions {
  games: string;
  seed?: string;
  players: string;
  json?: boolean;
}

interface BoardSmithConfig {
  paths?: {
    rules?: string;
  };
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
}

export interface RunSimulationResult {
  games: PerGameReport[];
  baseSeed: string;
  anyFailed: boolean;
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
  });

  const games: PerGameReport[] = results.games.map((g, index) => {
    const status: GameStatus = g.completed ? 'complete' : g.stuck ? 'stuck' : 'error';
    return {
      index,
      seed: g.seed,
      status,
      turns: g.actionCount,
      winner: g.winners ?? null,
      ...(g.error !== undefined ? { error: g.error } : {}),
    };
  });

  return {
    games,
    baseSeed: results.seed,
    anyFailed: results.games.some(g => !g.completed),
  };
}

const STATUS_ICON: Record<GameStatus, string> = {
  complete: chalk.green('✓'),
  stuck: chalk.red('✗'),
  error: chalk.red('✗'),
};

function printHumanReport(report: RunSimulationResult): void {
  console.log(chalk.cyan(`\nSimulation Results (seed: ${report.baseSeed}):\n`));

  for (const g of report.games) {
    const icon = STATUS_ICON[g.status];
    console.log(`  ${icon} Game ${g.index} (seed ${g.seed}): ${g.status} — ${g.turns} turn(s)`);
  }

  const total = report.games.length;
  const completeCount = report.games.filter(g => g.status === 'complete').length;
  const stuckCount = report.games.filter(g => g.status === 'stuck').length;
  const errorCount = report.games.filter(g => g.status === 'error').length;

  console.log('');
  console.log(chalk.bold(`${completeCount}/${total} complete, ${stuckCount} stuck, ${errorCount} errored`));

  const failing = report.games.filter(g => g.status !== 'complete');
  if (failing.length > 0) {
    console.log('');
    for (const g of failing) {
      console.log(chalk.red(`Game ${g.index} ${g.status} (seed ${g.seed}).`));
      if (g.error) {
        console.log(chalk.dim(`  ${g.error}`));
      }
      console.log(chalk.dim(`  Replay: boardsmith simulate --games 1 --seed ${g.seed}`));
    }
  }
  console.log('');
}

export async function simulateCommand(options: SimulateOptions): Promise<void> {
  const cwd = process.cwd();

  const configPath = join(cwd, 'boardsmith.json');
  if (!existsSync(configPath)) {
    console.error(chalk.red('Error: boardsmith.json not found'));
    console.error(chalk.dim('Make sure you are in a BoardSmith game project directory'));
    process.exit(1);
  }

  const config: BoardSmithConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  const rulesPath = config.paths?.rules ? resolve(cwd, config.paths.rules) : join(cwd, 'src', 'rules');

  const rulesIndexPath = join(rulesPath, 'index.ts');
  if (!existsSync(rulesIndexPath)) {
    console.error(chalk.red(`Error: Rules not found at ${rulesIndexPath}`));
    console.error(chalk.dim('Make sure your game has a src/rules/index.ts that exports gameDefinition'));
    process.exit(1);
  }

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
    console.error(chalk.red('Failed to load game rules:'), error);
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; do not mask the original error
    }
    process.exit(1);
    return;
  }

  let report: RunSimulationResult;
  try {
    report = await runSimulation(gameDefinition.gameClass as new (options: GameOptions) => Game, {
      count: gamesCount,
      players: playersCount,
      seed: options.seed,
    });
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; do not fail the command over it
    }
  }

  if (options.json) {
    console.log(JSON.stringify(report.games, null, 2));
  } else {
    printHumanReport(report);
  }

  process.exitCode = report.anyFailed ? 1 : 0;
}
