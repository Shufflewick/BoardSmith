/**
 * WeightEvolver - Focused class for evolving bot weights on existing objectives.
 * This is the streamlined replacement for auto-discovery training.
 */
import type { ObjectiveWeight, TrainingProgress } from './types.js';
import { loadTrainingBundle } from './training-bundle.js';
import { runParallelBenchmarks } from './parallel-benchmark.js';
import { createSeededRandom, mintSeed } from '../utils/random.js';
import { generateOffspring, selectBest } from './evolution.js';

/**
 * Configuration for weight evolution.
 */
export interface WeightEvolverConfig {
  /** Number of worker threads (default: os.cpus().length - 1) */
  workerCount?: number;
  /** Number of evolution generations (default: 5) */
  evolutionGenerations?: number;
  /** Number of offspring per generation (default: 20) */
  evolutionLambda?: number;
  /** Number of parents to select (default: 5) */
  evolutionMu?: number;
  /** Initial mutation strength (default: 1.0) */
  evolutionSigma?: number;
  /** Games per benchmark evaluation (default: 50) */
  evolutionBenchmarkGames?: number;
  /** MCTS iterations for benchmarking (default: 100) */
  benchmarkMCTSIterations?: number;
  /** Game timeout in ms (default: 30000). Only for an unseeded evolution; refused with `seed`. */
  gameTimeout?: number;
  /** Max actions per game (default: 1000) */
  maxActionsPerGame?: number;
  /**
   * Seed for a reproducible evolution (#699): mutation, selection, every
   * benchmark game and every search are seeded from it, and benchmarks run
   * with no clock bound (`reproducible`), so the same seed and settings give
   * the same weights whatever the worker count. Without one, the evolver draws
   * a fresh seed for mutation and the games, and each search is unseeded and
   * clock-bounded.
   */
  seed?: string;
  /** Progress callback */
  onProgress?: (progress: TrainingProgress) => void;
}

/**
 * Result of weight evolution.
 */
export interface WeightEvolutionResult {
  /** The weights to keep: the search's pick if the confirmation accepted it, otherwise the original weights */
  objectives: ObjectiveWeight[];
  /**
   * The search's best score (win rate 0-1). The top of many noisy scores, so it
   * overstates the pick's strength (#870); `confirmation` measures it.
   */
  bestFitness: number;
  /** Initial fitness before evolution (win rate 0-1) */
  initialFitness: number;
  /** The rematch of the search's pick against the original, or undefined when the search kept the original */
  confirmation?: WeightConfirmation;
}

/**
 * The search's pick and the original weights, benchmarked again on the same
 * fresh games, which the search never played.
 */
export interface WeightConfirmation {
  /** Games each set played */
  games: number;
  /** The original weights' win rate (0-1) */
  originalWinRate: number;
  /** The search pick's win rate (0-1) */
  candidateWinRate: number;
  /** Whether the pick won by enough to keep it (see {@link confirmsImprovement}) */
  accepted: boolean;
}

/** Games each set plays in the confirmation, split evenly between the seats. */
const CONFIRMATION_GAMES = 400;
/** One-sided 95% critical value of the standard normal. */
const Z_95 = 1.645;

/**
 * Whether the pick's win rate beats the original's by more than chance explains:
 * a one-sided pooled two-proportion z-test at 5% over `games` games each.
 *
 * When the pick is no stronger, it is accepted at most about 5% of the time; the
 * shared games correlate the two scores, which only lowers that. At 400 games
 * each, a pick 10 points stronger than an original at 50% is accepted about 88%
 * of the time, 15 points about 99%, and 5 points about 41%.
 */
function confirmsImprovement(originalWinRate: number, candidateWinRate: number, games: number): boolean {
  const pooled = (originalWinRate + candidateWinRate) / 2;
  return candidateWinRate - originalWinRate > Z_95 * Math.sqrt((2 * pooled * (1 - pooled)) / games);
}

const DEFAULT_CONFIG: Required<Omit<WeightEvolverConfig, 'seed' | 'onProgress' | 'workerCount' | 'gameTimeout'>> = {
  evolutionGenerations: 5,
  evolutionLambda: 20,
  evolutionMu: 5,
  evolutionSigma: 1.0,
  evolutionBenchmarkGames: 50,
  benchmarkMCTSIterations: 100,
  maxActionsPerGame: 1000,
};

/**
 * WeightEvolver focuses solely on evolving weights for existing objectives.
 * Use /bs-build-bot to create objectives, then WeightEvolver to tune weights.
 */
export class WeightEvolver {
  private gameModulePath: string;
  private gameType: string;
  private config: WeightEvolverConfig;
  /** What mutation, selection and the benchmark games are seeded from: the configured seed, or a fresh one per evolver. */
  private evolutionSeed: string;

  /**
   * Create a new WeightEvolver.
   *
   * @param gameModulePath - Absolute path to the game's training bundle (see
   *   `TrainingBundle`), which this process and each worker import
   * @param gameType - The game type identifier
   * @param config - Evolution configuration
   */
  constructor(
    gameModulePath: string,
    gameType: string,
    config: WeightEvolverConfig = {}
  ) {
    this.gameModulePath = gameModulePath;
    this.gameType = gameType;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.evolutionSeed = config.seed ?? mintSeed();
  }

  /**
   * Evolve weights for the given objectives.
   *
   * @param objectives - Existing objectives to evolve weights for
   * @returns Evolution result with optimized objectives and fitness
   */
  async evolve(objectives: ObjectiveWeight[]): Promise<WeightEvolutionResult> {
    if (objectives.length === 0) {
      throw new Error('No objectives provided for evolution');
    }
    if (this.config.seed !== undefined && this.config.gameTimeout !== undefined) {
      throw new Error(
        `A seeded evolution (seed "${this.config.seed}") cannot also have a gameTimeout: a benchmark game cut ` +
          'short by the clock would make the weights differ from run to run. Drop gameTimeout (maxActionsPerGame ' +
          'still bounds each game), or drop the seed.',
      );
    }

    // Every weight must name one of the game's objectives. Checked here, in
    // this process, so a bad weight fails before any worker starts.
    const bundle = await loadTrainingBundle(this.gameModulePath);
    const { gameClass, bot } = bundle.gameDefinition;
    bundle.weightedBot(gameClass, this.gameType, bot, objectives);

    // Benchmark initial objectives to get baseline
    this.config.onProgress?.({
      iteration: 0,
      totalIterations: this.config.evolutionGenerations ?? 5,
      gamesCompleted: 0,
      totalGames: this.config.evolutionBenchmarkGames ?? 50,
      bestWinRate: 0,
      objectiveCount: objectives.length,
      message: 'Benchmarking initial objectives...',
    });

    const initialFitnesses = await runParallelBenchmarks(
      this.gameModulePath,
      this.gameType,
      [objectives],
      {
        gameCount: this.config.evolutionBenchmarkGames ?? 50,
        mctsIterations: this.config.benchmarkMCTSIterations ?? 100,
        maxActions: this.config.maxActionsPerGame,
        ...this.benchmarkSeeding('initial'),
      },
      { workerCount: this.config.workerCount }
    );

    const initialFitness = initialFitnesses[0];

    const search = await this.runEvolution(objectives, initialFitness);
    return { ...(await this.confirm(objectives, search)), bestFitness: search.bestFitness, initialFitness };
  }

  /**
   * The weights to keep: the search's pick only if, benchmarked again beside the
   * original on games seeded from a stage the search never used, it wins by more
   * than chance, since its search score is the luckiest of many (#870).
   */
  private async confirm(
    original: ObjectiveWeight[],
    { objectives: candidate, bestFitness }: { objectives: ObjectiveWeight[]; bestFitness: number },
  ): Promise<{ objectives: ObjectiveWeight[]; confirmation?: WeightConfirmation }> {
    if (candidate === original) return { objectives: original };
    const generations = this.config.evolutionGenerations ?? 5;
    this.config.onProgress?.({
      iteration: generations,
      totalIterations: generations,
      gamesCompleted: 0,
      totalGames: 2,
      bestWinRate: bestFitness,
      objectiveCount: candidate.length,
      message: `Confirming the best weights against the original on ${CONFIRMATION_GAMES} fresh games each...`,
    });
    const [originalWinRate, candidateWinRate] = await runParallelBenchmarks(
      this.gameModulePath,
      this.gameType,
      [original, candidate],
      {
        gameCount: CONFIRMATION_GAMES,
        mctsIterations: this.config.benchmarkMCTSIterations ?? 100,
        maxActions: this.config.maxActionsPerGame,
        ...this.benchmarkSeeding('confirm'),
      },
      { workerCount: this.config.workerCount },
    );
    const accepted = confirmsImprovement(originalWinRate, candidateWinRate, CONFIRMATION_GAMES);
    return {
      objectives: accepted ? candidate : original,
      confirmation: { games: CONFIRMATION_GAMES, originalWinRate, candidateWinRate, accepted },
    };
  }

  /**
   * Run evolutionary weight optimization.
   */
  private async runEvolution(
    initialObjectives: ObjectiveWeight[],
    initialFitness: number
  ): Promise<{ objectives: ObjectiveWeight[]; bestFitness: number }> {
    const generations = this.config.evolutionGenerations ?? 5;
    const mu = this.config.evolutionMu ?? 5;
    const lambda = this.config.evolutionLambda ?? 20;
    let sigma = this.config.evolutionSigma ?? 1.0;
    const benchmarkGames = this.config.evolutionBenchmarkGames ?? 50;

    // Initialize parent population with slight variations
    const rng = createSeededRandom(`${this.evolutionSeed}-init`);
    let parents: ObjectiveWeight[][] = [initialObjectives];

    // Fill initial population with mutations
    const initialOffspring = generateOffspring([initialObjectives], mu - 1, sigma * 0.5, rng);
    parents = [...parents, ...initialOffspring];

    // Track best solution
    let bestObjectives = initialObjectives;
    let bestFitness = initialFitness;

    for (let gen = 1; gen <= generations; gen++) {
      this.config.onProgress?.({
        iteration: gen,
        totalIterations: generations,
        gamesCompleted: 0,
        totalGames: lambda,
        bestWinRate: bestFitness,
        objectiveCount: bestObjectives.length,
        message: `Evolution ${gen}/${generations}: Generating ${lambda} offspring...`,
      });

      // Generate offspring
      const genRng = createSeededRandom(`${this.evolutionSeed}-gen-${gen}`);
      const offspring = generateOffspring(parents, lambda, sigma, genRng);

      // Combine parents + offspring
      const population = [...parents, ...offspring];

      this.config.onProgress?.({
        iteration: gen,
        totalIterations: generations,
        gamesCompleted: 0,
        totalGames: population.length,
        bestWinRate: bestFitness,
        objectiveCount: bestObjectives.length,
        message: `Evolution ${gen}/${generations}: Evaluating ${population.length} candidates...`,
      });

      // Evaluate all candidates in parallel
      const fitnesses = await runParallelBenchmarks(
        this.gameModulePath,
        this.gameType,
        population,
        {
          gameCount: benchmarkGames,
          mctsIterations: this.config.benchmarkMCTSIterations ?? 100,
          maxActions: this.config.maxActionsPerGame,
          ...this.benchmarkSeeding(`gen-${gen}`),
        },
        { workerCount: this.config.workerCount },
        (completed, total) => {
          this.config.onProgress?.({
            iteration: gen,
            totalIterations: generations,
            gamesCompleted: completed,
            totalGames: total,
            bestWinRate: bestFitness,
            objectiveCount: bestObjectives.length,
            message: `Evolution ${gen}/${generations}: Evaluated ${completed}/${total}`,
          });
        }
      );

      // Find best from this generation
      for (let i = 0; i < fitnesses.length; i++) {
        if (fitnesses[i] > bestFitness) {
          bestFitness = fitnesses[i];
          bestObjectives = population[i];
        }
      }

      // Select best µ as new parents
      parents = selectBest(population, fitnesses, mu);

      // Decay sigma for finer search
      sigma *= 0.9;

      this.config.onProgress?.({
        iteration: gen,
        totalIterations: generations,
        gamesCompleted: population.length,
        totalGames: population.length,
        bestWinRate: bestFitness,
        objectiveCount: bestObjectives.length,
        message: `Evolution ${gen}/${generations}: Best fitness ${(bestFitness * 100).toFixed(1)}%`,
      });
    }

    return { objectives: bestObjectives, bestFitness };
  }

  /**
   * A benchmark's game seed, derived from the evolution's own and named by
   * `stage`. A seeded evolution's benchmarks are also reproducible; an
   * unseeded one's keep their clock bound (see {@link WeightEvolverConfig.seed}).
   */
  private benchmarkSeeding(stage: string): { seed: string; reproducible: true } | { seed: string; timeout: number } {
    const seed = `${this.evolutionSeed}-${stage}`;
    return this.config.seed === undefined
      ? { seed, timeout: this.config.gameTimeout ?? 30000 }
      : { seed, reproducible: true };
  }
}
