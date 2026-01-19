/**
 * WeightEvolver - Focused class for evolving AI weights on existing objectives.
 * This is the streamlined replacement for auto-discovery training.
 */
import type { Game } from '../engine/index.js';
import type {
  GameClass,
  GameStructure,
  LearnedObjective,
  TrainingProgress,
} from './types.js';
import { introspectGame, createIntrospectionGame } from './introspector.js';
import { serializeGameStructure } from './simulator.js';
import { runParallelBenchmarks } from './parallel-benchmark.js';
import {
  createSeededRandom,
  generateOffspring,
  selectBest,
} from './evolution.js';

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
  objectives: LearnedObjective[];
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
 * Use /generate-ai to create objectives, then WeightEvolver to tune weights.
 */
export class WeightEvolver<G extends Game = Game> {
  private GameClass: GameClass<G>;
  private gameType: string;
  private gameModulePath: string;
  private config: WeightEvolverConfig;
  private structure: GameStructure | null = null;

  /**
   * Create a new WeightEvolver.
   *
   * @param GameClass - The game class constructor
   * @param gameType - The game type identifier
   * @param gameModulePath - Absolute path to the compiled game module (.js file)
   * @param config - Evolution configuration
   */
  constructor(
    GameClass: GameClass<G>,
    gameType: string,
    gameModulePath: string,
    config: WeightEvolverConfig = {}
  ) {
    this.GameClass = GameClass;
    this.gameType = gameType;
    this.gameModulePath = gameModulePath;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Evolve weights for the given objectives.
   *
   * @param objectives - Existing objectives to evolve weights for
   * @returns Evolution result with optimized objectives and fitness
   */
  async evolve(objectives: LearnedObjective[]): Promise<WeightEvolutionResult> {
    if (objectives.length === 0) {
      throw new Error('No objectives provided for evolution');
    }

    // Discover structure for benchmarking
    this.reportProgress({
      iteration: 0,
      totalIterations: this.config.evolutionGenerations ?? 5,
      gamesCompleted: 0,
      totalGames: 0,
      bestWinRate: 0,
      featuresSelected: objectives.length,
      message: 'Analyzing game structure...',
    });

    this.structure = this.discoverStructure();

    // Benchmark initial objectives to get baseline
    this.reportProgress({
      iteration: 0,
      totalIterations: this.config.evolutionGenerations ?? 5,
      gamesCompleted: 0,
      totalGames: this.config.evolutionBenchmarkGames ?? 50,
      bestWinRate: 0,
      featuresSelected: objectives.length,
      message: 'Benchmarking initial objectives...',
    });

    const initialFitnesses = await runParallelBenchmarks(
      this.gameModulePath,
      this.gameType,
      [objectives],
      serializeGameStructure(this.structure),
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
    initialObjectives: LearnedObjective[],
    initialFitness: number
  ): Promise<{ objectives: LearnedObjective[]; bestFitness: number }> {
    const generations = this.config.evolutionGenerations ?? 5;
    const mu = this.config.evolutionMu ?? 5;
    const lambda = this.config.evolutionLambda ?? 20;
    let sigma = this.config.evolutionSigma ?? 1.0;
    const benchmarkGames = this.config.evolutionBenchmarkGames ?? 50;

    // Initialize parent population with slight variations
    const rng = createSeededRandom(`${this.config.seed ?? 'evolution'}-init`);
    let parents: LearnedObjective[][] = [initialObjectives];

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
        featuresSelected: bestObjectives.length,
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
        featuresSelected: bestObjectives.length,
        message: `Evolution ${gen}/${generations}: Evaluating ${population.length} candidates...`,
      });

      // Evaluate all candidates in parallel
      const fitnesses = await runParallelBenchmarks(
        this.gameModulePath,
        this.gameType,
        population,
        serializeGameStructure(this.structure!),
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
            featuresSelected: bestObjectives.length,
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
        featuresSelected: bestObjectives.length,
        message: `Evolution ${gen}/${generations}: Best fitness ${(bestFitness * 100).toFixed(1)}%`,
      });
    }

    return { objectives: bestObjectives, bestFitness };
  }

  /**
   * Discover game structure.
   */
  private discoverStructure(): GameStructure {
    const game = createIntrospectionGame(this.GameClass);
    return introspectGame(game);
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
