import type { Game } from '@boardsmith/engine';
import { GameRunner, type GameRunnerOptions } from '@boardsmith/runtime';
import { createBot, type AIConfig } from '@boardsmith/ai';
import type { GameClass, LearnedObjective } from './types.js';

/**
 * Seeded random number generator for reproducible random player
 */
class SeededRandom {
  private seed: number;

  constructor(seed: string) {
    this.seed = 0;
    for (let i = 0; i < seed.length; i++) {
      this.seed = ((this.seed << 5) - this.seed + seed.charCodeAt(i)) | 0;
    }
  }

  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  pick<T>(array: T[]): T {
    return array[Math.floor(this.next() * array.length)];
  }
}

/**
 * Configuration for a single player in a benchmark game
 */
export interface PlayerConfig {
  /** Whether to use AI (true) or random moves (false) */
  useAI: boolean;
  /** MCTS iterations if using AI */
  iterations?: number;
  /** Learned objectives to guide MCTS if using AI */
  objectives?: LearnedObjective[];
}

/**
 * Benchmark configuration
 */
export interface BenchmarkConfig {
  /** Number of games to run */
  gameCount?: number;
  /** Timeout per game in ms */
  timeout?: number;
  /** Maximum actions per game */
  maxActions?: number;
  /** Base seed for reproducibility */
  seed?: string;
  /** MCTS iterations for the trained AI (default 100 for quality evaluation) */
  mctsIterations?: number;
}

/**
 * Benchmark result
 */
export interface BenchmarkResult {
  /** Overall win rate of trained AI (0-1) */
  winRate: number;
  /** Number of wins */
  wins: number;
  /** Number of losses */
  losses: number;
  /** Number of draws */
  draws: number;
  /** Total games played */
  gamesPlayed: number;
  /** Games where trained AI was player 0 */
  gamesAsPlayer0: number;
  /** Games where trained AI was player 1 */
  gamesAsPlayer1: number;
  /** Win rate when playing as player 0 */
  winRateAsPlayer0: number;
  /** Win rate when playing as player 1 */
  winRateAsPlayer1: number;
}

/**
 * Benchmark a trained AI against a random baseline.
 *
 * Plays games where trained AI faces random player in both positions
 * to eliminate first-player advantage bias.
 *
 * @param GameClass - The game class constructor
 * @param gameType - The game type identifier
 * @param objectives - Learned objectives from training
 * @param config - Benchmark configuration
 * @returns Benchmark results with win rate statistics
 */
export async function benchmarkAI<G extends Game>(
  GameClass: GameClass<G>,
  gameType: string,
  objectives: LearnedObjective[],
  config: BenchmarkConfig = {}
): Promise<BenchmarkResult> {
  const gameCount = config.gameCount ?? 100;
  const timeout = config.timeout ?? 60000;
  const maxActions = config.maxActions ?? 300;
  const seed = config.seed ?? 'benchmark';
  const mctsIterations = config.mctsIterations ?? 100;

  let wins = 0;
  let losses = 0;
  let draws = 0;

  let winsAsPlayer0 = 0;
  let gamesAsPlayer0 = 0;
  let winsAsPlayer1 = 0;
  let gamesAsPlayer1 = 0;

  // Split games evenly: half with trained AI as player 0, half as player 1
  const halfCount = Math.floor(gameCount / 2);

  // Run games with trained AI as player 0
  for (let i = 0; i < halfCount; i++) {
    const result = await runBenchmarkGame(
      GameClass,
      gameType,
      {
        trainedPlayerIndex: 0,
        objectives,
        mctsIterations,
        timeout,
        maxActions,
        seed: `${seed}-p0-${i}`,
      }
    );

    gamesAsPlayer0++;
    if (result === 'win') {
      wins++;
      winsAsPlayer0++;
    } else if (result === 'loss') {
      losses++;
    } else {
      draws++;
    }
  }

  // Run games with trained AI as player 1
  for (let i = 0; i < halfCount; i++) {
    const result = await runBenchmarkGame(
      GameClass,
      gameType,
      {
        trainedPlayerIndex: 1,
        objectives,
        mctsIterations,
        timeout,
        maxActions,
        seed: `${seed}-p1-${i}`,
      }
    );

    gamesAsPlayer1++;
    if (result === 'win') {
      wins++;
      winsAsPlayer1++;
    } else if (result === 'loss') {
      losses++;
    } else {
      draws++;
    }
  }

  // Handle odd game count - run one more as player 0
  if (gameCount % 2 !== 0) {
    const result = await runBenchmarkGame(
      GameClass,
      gameType,
      {
        trainedPlayerIndex: 0,
        objectives,
        mctsIterations,
        timeout,
        maxActions,
        seed: `${seed}-extra`,
      }
    );

    gamesAsPlayer0++;
    if (result === 'win') {
      wins++;
      winsAsPlayer0++;
    } else if (result === 'loss') {
      losses++;
    } else {
      draws++;
    }
  }

  const gamesPlayed = wins + losses + draws;

  return {
    winRate: gamesPlayed > 0 ? wins / gamesPlayed : 0,
    wins,
    losses,
    draws,
    gamesPlayed,
    gamesAsPlayer0,
    gamesAsPlayer1,
    winRateAsPlayer0: gamesAsPlayer0 > 0 ? winsAsPlayer0 / gamesAsPlayer0 : 0,
    winRateAsPlayer1: gamesAsPlayer1 > 0 ? winsAsPlayer1 / gamesAsPlayer1 : 0,
  };
}

interface BenchmarkGameOptions {
  trainedPlayerIndex: number;
  objectives: LearnedObjective[];
  mctsIterations: number;
  timeout: number;
  maxActions: number;
  seed: string;
}

type GameOutcome = 'win' | 'loss' | 'draw';

/**
 * Run a single benchmark game
 */
async function runBenchmarkGame<G extends Game>(
  GameClass: GameClass<G>,
  gameType: string,
  options: BenchmarkGameOptions
): Promise<GameOutcome> {
  const { trainedPlayerIndex, objectives, mctsIterations, timeout, maxActions, seed } = options;
  const randomPlayerIndex = trainedPlayerIndex === 0 ? 1 : 0;
  const rng = new SeededRandom(seed);
  const startTime = Date.now();

  try {
    const runnerOptions: GameRunnerOptions<G> = {
      GameClass,
      gameType,
      gameOptions: {
        playerCount: 2,
        seed,
      },
    };
    const runner = new GameRunner(runnerOptions);
    let flowState = runner.start();

    // Create objectives function for MCTS
    const aiObjectives = createObjectivesFunction(objectives);

    let actionCount = 0;

    while (!flowState.complete && actionCount < maxActions) {
      if (Date.now() - startTime > timeout) break;
      if (!flowState.awaitingInput) break;

      const currentPlayer = flowState.currentPlayer;
      if (currentPlayer === undefined) break;

      const availableActions = flowState.availableActions ?? [];
      if (availableActions.length === 0) break;

      let action: string | undefined;
      let args: Record<string, unknown> = {};

      if (currentPlayer === trainedPlayerIndex) {
        // Trained AI plays with MCTS + objectives
        const bot = createBot(
          runner.game,
          GameClass,
          gameType,
          currentPlayer,
          runner.actionHistory,
          mctsIterations,
          objectives.length > 0 ? { objectives: aiObjectives } : undefined
        );

        try {
          const move = await bot.play();
          action = move.action;
          args = move.args;
        } catch {
          // Bot failed, fall back to random
          action = rng.pick(availableActions);
        }
      } else {
        // Random player
        action = rng.pick(availableActions);
      }

      if (!action) break;

      const result = runner.performAction(action, currentPlayer, args);
      if (!result.success) break;

      actionCount++;
      flowState = runner.getFlowState() ?? flowState;
    }

    // Determine outcome
    if (!flowState.complete) {
      return 'draw'; // Game didn't complete - treat as draw
    }

    const winners = (runner.game.settings.winners as number[]) ?? [];

    if (winners.length === 0) {
      return 'draw';
    }

    if (winners.includes(trainedPlayerIndex)) {
      // Check if it's a shared win (draw)
      if (winners.includes(randomPlayerIndex)) {
        return 'draw';
      }
      return 'win';
    }

    return 'loss';
  } catch {
    return 'draw'; // Game crashed - treat as draw
  }
}

/**
 * Create an objectives function from learned objectives
 */
function createObjectivesFunction(
  learnedObjectives: LearnedObjective[]
): AIConfig['objectives'] {
  return (game: Game, playerIndex: number) => {
    const objectives: Record<string, { checker: () => boolean; weight: number }> = {};

    for (const obj of learnedObjectives) {
      objectives[obj.featureId] = {
        checker: () => {
          // Placeholder - objectives will be regenerated from features at runtime
          // The actual evaluation happens through the feature system
          return false;
        },
        weight: obj.weight,
      };
    }

    return objectives;
  };
}
