import type { Game, FlowState, SerializedAction } from '@boardsmith/engine';
import { GameRunner, type GameRunnerOptions } from '@boardsmith/runtime';
import { createBot, type BotConfig, type AIConfig } from '@boardsmith/ai';
import type {
  GameClass,
  CandidateFeature,
  GameData,
  StateSnapshot,
  LearnedObjective,
} from './types.js';

/**
 * Seeded random number generator
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

  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }

  pick<T>(array: T[]): T {
    return array[this.nextInt(array.length)];
  }
}

/**
 * Options for simulation
 */
export interface SimulationOptions {
  /** Number of games to simulate */
  gameCount: number;
  /** Player count for games */
  playerCount: number;
  /** Features to evaluate */
  features: CandidateFeature[];
  /** Timeout per game in ms */
  timeout: number;
  /** Maximum actions per game */
  maxActions: number;
  /** Base seed for reproducibility */
  seed: string;
  /** AI configuration for players (if using AI instead of random) */
  aiConfig?: {
    useAI: boolean;
    iterations?: number;
    objectives?: LearnedObjective[];
  };
  /** Progress callback */
  onProgress?: (completed: number, total: number) => void;
}

/**
 * Simulation results
 */
export interface SimulationResults {
  /** All game data */
  games: GameData[];
  /** Number of completed games */
  completedGames: number;
  /** Total states collected */
  totalStates: number;
  /** Average actions per completed game */
  averageActions: number;
}

/**
 * Run multiple game simulations and collect training data
 */
export async function runSimulations<G extends Game>(
  GameClass: GameClass<G>,
  gameType: string,
  options: SimulationOptions
): Promise<SimulationResults> {
  const games: GameData[] = [];
  let totalStates = 0;
  let completedGames = 0;
  let totalActions = 0;

  for (let i = 0; i < options.gameCount; i++) {
    const gameSeed = `${options.seed}-game-${i}`;

    const gameData = await simulateSingleGame(
      GameClass,
      gameType,
      {
        ...options,
        seed: gameSeed,
      }
    );

    games.push(gameData);

    if (gameData.completed) {
      completedGames++;
      totalActions += gameData.totalActions;
    }
    totalStates += gameData.states.length;

    if (options.onProgress) {
      options.onProgress(i + 1, options.gameCount);
    }
  }

  return {
    games,
    completedGames,
    totalStates,
    averageActions: completedGames > 0 ? totalActions / completedGames : 0,
  };
}

/**
 * Simulate a single game and collect data
 */
async function simulateSingleGame<G extends Game>(
  GameClass: GameClass<G>,
  gameType: string,
  options: SimulationOptions
): Promise<GameData> {
  const rng = new SeededRandom(options.seed);
  const startTime = Date.now();

  const states: StateSnapshot[] = [];
  let actionCount = 0;
  let completed = false;
  let winners: number[] = [];

  try {
    // Create game runner with proper options object
    const runnerOptions: GameRunnerOptions<G> = {
      GameClass,
      gameType,
      gameOptions: {
        playerCount: options.playerCount,
        seed: options.seed,
      },
    };
    const runner = new GameRunner(runnerOptions);

    // Start the game
    let flowState = runner.start();

    // Create AI objectives if using learned weights
    let aiObjectives: AIConfig['objectives'] | undefined;
    if (options.aiConfig?.objectives && options.aiConfig.objectives.length > 0) {
      aiObjectives = createObjectivesFunction(options.aiConfig.objectives);
    }

    // Run game loop
    while (!flowState.complete && actionCount < options.maxActions) {
      // Check timeout
      if (Date.now() - startTime > options.timeout) {
        break;
      }

      if (!flowState.awaitingInput) {
        break;
      }

      const currentPlayer = flowState.currentPlayer;
      if (currentPlayer === undefined) break;

      // Get available actions (with fallback to empty array)
      const availableActions = flowState.availableActions ?? [];

      // Collect state snapshot before action
      const snapshot = collectStateSnapshot(
        runner.game,
        currentPlayer,
        actionCount,
        options.features,
        availableActions
      );

      // Choose action
      let action: string | undefined;
      let args: Record<string, unknown> = {};

      if (options.aiConfig?.useAI && availableActions.length > 0) {
        // Use MCTS bot
        const iterations = options.aiConfig.iterations ?? 10;
        const bot = createBot(
          runner.game,
          GameClass,
          gameType,
          currentPlayer,
          runner.actionHistory,
          iterations,
          aiObjectives ? { objectives: aiObjectives } : undefined
        );

        try {
          const move = await bot.play();
          action = move.action;
          args = move.args;
        } catch {
          // Bot failed, fall back to random
          action = pickRandomAction(availableActions, rng);
        }
      } else {
        // Random action selection
        action = pickRandomAction(availableActions, rng);
      }

      if (!action) break;

      // Record action in snapshot
      snapshot.actionTaken = action;
      snapshot.actionArgs = args;
      states.push(snapshot);

      // Execute action
      const result = runner.performAction(action, currentPlayer, args);
      if (!result.success) {
        // Try another action or give up
        break;
      }

      actionCount++;
      flowState = runner.getFlowState() ?? flowState;
    }

    // Check completion and winners
    completed = flowState.complete;
    if (completed) {
      winners = (runner.game.settings.winners as number[]) ?? [];
    }

  } catch (error) {
    // Game crashed - mark as incomplete
    completed = false;
  }

  return {
    gameId: options.seed,
    playerCount: options.playerCount,
    states,
    winners,
    totalActions: actionCount,
    completed,
  };
}

/**
 * Collect a state snapshot with feature values
 */
function collectStateSnapshot(
  game: Game,
  decidingPlayer: number,
  actionNumber: number,
  features: CandidateFeature[],
  availableActions: string[]
): StateSnapshot {
  const featureValues = new Map<string, boolean>();

  for (const feature of features) {
    try {
      const value = feature.evaluate(game, decidingPlayer);
      featureValues.set(feature.id, value);
    } catch {
      // Feature evaluation failed - skip
      featureValues.set(feature.id, false);
    }
  }

  return {
    actionNumber,
    decidingPlayer,
    featureValues,
    availableActions,
  };
}

/**
 * Pick a random valid action
 */
function pickRandomAction(
  availableActions: string[],
  rng: SeededRandom
): string | undefined {
  if (availableActions.length === 0) return undefined;
  return rng.pick(availableActions);
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
          try {
            // Re-create the evaluate function from the feature
            // This is a simplified version - in practice we'd need to serialize/deserialize
            return false; // Placeholder
          } catch {
            return false;
          }
        },
        weight: obj.weight,
      };
    }

    return objectives;
  };
}

/**
 * Run simulations with progress reporting
 */
export async function runSimulationsWithProgress<G extends Game>(
  GameClass: GameClass<G>,
  gameType: string,
  options: SimulationOptions,
  features: CandidateFeature[]
): Promise<SimulationResults> {
  return runSimulations(GameClass, gameType, {
    ...options,
    features,
  });
}
