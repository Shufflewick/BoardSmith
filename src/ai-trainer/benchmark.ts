import type { Game } from '../engine/index.js';
import { GameRunner, type GameRunnerOptions } from '../runtime/index.js';
import { createBot, type AIConfig } from '../ai/index.js';
import { SeededRandom } from '../utils/random.js';
import type { GameClass, LearnedObjective, CandidateFeature } from './types.js';

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
  /** Candidate features for evaluating objectives (required for objectives to work) */
  features?: CandidateFeature[];
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
  const features = config.features ?? [];

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
        features,
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
        features,
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
        features,
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
  features: CandidateFeature[];
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
  const { trainedPlayerIndex, objectives, features, mctsIterations, timeout, maxActions, seed } = options;
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
    const aiObjectives = createObjectivesFunction(objectives, features);

    let actionCount = 0;

    while (!flowState.complete && actionCount < maxActions) {
      if (Date.now() - startTime > timeout) break;
      if (!flowState.awaitingInput) break;

      // currentPlayer is a POSITION (1-indexed), trainedPlayerIndex is an INDEX (0-indexed)
      const currentPlayer = flowState.currentPlayer;
      if (currentPlayer === undefined) break;

      const availableActions = flowState.availableActions ?? [];
      if (availableActions.length === 0) break;

      let action: string | undefined;
      let args: Record<string, unknown> = {};

      // Convert index to position for comparison
      const trainedPosition = trainedPlayerIndex + 1;
      if (currentPlayer === trainedPosition) {
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
          // Bot failed, fall back to random (1 iteration = essentially random)
          const fallbackBot = createBot(
            runner.game,
            GameClass,
            gameType,
            currentPlayer,
            runner.actionHistory,
            1
          );
          const fallbackMove = await fallbackBot.play();
          action = fallbackMove.action;
          args = fallbackMove.args;
        }
      } else {
        // Random player uses bot with 1 MCTS iteration (essentially random but with valid args)
        const randomBot = createBot(
          runner.game,
          GameClass,
          gameType,
          currentPlayer,
          runner.actionHistory,
          1 // Minimal MCTS = nearly random
        );

        try {
          const move = await randomBot.play();
          action = move.action;
          args = move.args;
        } catch {
          // If bot fails, pick random action (will likely fail if selections required)
          action = rng.pick(availableActions);
        }
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

    // winners contains player POSITIONS (1-indexed), not indices (0-indexed)
    const winners = (runner.game.settings.winners as number[]) ?? [];

    if (winners.length === 0) {
      return 'draw';
    }

    // Convert 0-indexed player index to 1-indexed position for comparison
    const trainedPosition = trainedPlayerIndex + 1;
    const randomPosition = randomPlayerIndex + 1;

    if (winners.includes(trainedPosition)) {
      // Check if it's a shared win (draw)
      if (winners.includes(randomPosition)) {
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
  learnedObjectives: LearnedObjective[],
  features: CandidateFeature[]
): AIConfig['objectives'] {
  // Build feature lookup map
  const featureMap = new Map(features.map(f => [f.id, f]));

  return (game: Game, playerIndex: number) => {
    const objectives: Record<string, { checker: () => number; weight: number }> = {};

    for (const obj of learnedObjectives) {
      const feature = featureMap.get(obj.featureId);
      if (!feature) continue;

      objectives[obj.featureId] = {
        checker: () => {
          // Evaluate the feature and convert boolean to number (0 or 1)
          return feature.evaluate(game, playerIndex) ? 1 : 0;
        },
        weight: obj.weight,
      };
    }

    return objectives;
  };
}
