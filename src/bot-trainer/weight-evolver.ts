/**
 * WeightEvolver - Focused class for evolving bot weights on existing objectives.
 * This is the streamlined replacement for auto-discovery training.
 */
import type { ObjectiveWeight, TrainingProgress } from './types.js';
import { loadTrainingBundle } from './training-bundle.js';
import { runParallelBenchmarks } from './parallel-benchmark.js';
import { createSeededRandom } from '../utils/random.js';
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
  /** Game timeout in ms (default: 30000) */
  gameTimeout?: number;
  /** Max actions per game (default: 1000) */
  maxActionsPerGame?: number;
  /** Random seed for reproducibility */
  seed?: string;
  /** Progress callback */
  onProgress?: (progress: TrainingProgress) => void;
}

/**
 * Result of weight evolution.
 */
export interface WeightEvolutionResult {
  /** Optimized objectives with new weights */
  objectives: ObjectiveWeight[];
  /** Best fitness achieved (win rate 0-1) */
  bestFitness: number;
  /** Initial fitness before evolution (win rate 0-1) */
  initialFitness: number;
}

const DEFAULT_CONFIG: Required<Omit<WeightEvolverConfig, 'seed' | 'onProgress' | 'workerCount'>> = {
  evolutionGenerations: 5,
  evolutionLambda: 20,
  evolutionMu: 5,
  evolutionSigma: 1.0,
  evolutionBenchmarkGames: 50,
  benchmarkMCTSIterations: 100,
  gameTimeout: 30000,
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

    // Every weight must name one of the game's objectives. Checked here, in
    // this process, because a worker that refuses a candidate scores it 0
    // and evolution would carry on tuning weights that do nothing.
    const bundle = await loadTrainingBundle(this.gameModulePath);
    const { gameClass, bot } = bundle.gameDefinition;
    bundle.weightedBot(gameClass, this.gameType, bot, objectives);

    // Benchmark initial objectives to get baseline
    this.reportProgress({
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
        timeout: this.config.gameTimeout,
        maxActions: this.config.maxActionsPerGame,
        seed: `${this.config.seed ?? 'evolve'}-initial`,
      },
      { workerCount: this.config.workerCount }
    );

    const initialFitness = initialFitnesses[0];

    // Run evolution
    const result = await this.runEvolution(objectives, initialFitness);

    return {
      objectives: result.objectives,
      bestFitness: result.bestFitness,
      initialFitness,
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
    const rng = createSeededRandom(`${this.config.seed ?? 'evolution'}-init`);
    let parents: ObjectiveWeight[][] = [initialObjectives];

    // Fill initial population with mutations
    const initialOffspring = generateOffspring([initialObjectives], mu - 1, sigma * 0.5, rng);
    parents = [...parents, ...initialOffspring];

    // Track best solution
    let bestObjectives = initialObjectives;
    let bestFitness = initialFitness;

    for (let gen = 1; gen <= generations; gen++) {
      this.reportProgress({
        iteration: gen,
        totalIterations: generations,
        gamesCompleted: 0,
        totalGames: lambda,
        bestWinRate: bestFitness,
        objectiveCount: bestObjectives.length,
        message: `Evolution ${gen}/${generations}: Generating ${lambda} offspring...`,
      });

      // Generate offspring
      const genRng = createSeededRandom(`${this.config.seed ?? 'evolution'}-gen-${gen}`);
      const offspring = generateOffspring(parents, lambda, sigma, genRng);

      // Combine parents + offspring
      const population = [...parents, ...offspring];

      this.reportProgress({
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
          timeout: this.config.gameTimeout,
          maxActions: this.config.maxActionsPerGame,
          seed: `${this.config.seed ?? 'evolution'}-gen-${gen}`,
        },
        { workerCount: this.config.workerCount },
        (completed, total) => {
          this.reportProgress({
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

      this.reportProgress({
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
   * Report progress to callback.
   */
  private reportProgress(progress: TrainingProgress): void {
    if (this.config.onProgress) {
      this.config.onProgress(progress);
    }
  }
}
