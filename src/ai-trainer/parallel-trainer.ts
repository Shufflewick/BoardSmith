/**
 * Parallel trainer - runs AI training using worker threads for game simulation.
 * Parallel trainer - runs AI training using worker threads for game simulation.
 */
import type { Game } from '../engine/index.js';
import type {
  GameClass,
  GameStructure,
  CandidateFeature,
  TrainingConfig,
  TrainingResult,
  TrainingProgress,
  LearnedObjective,
  LearnedActionPreference,
  FeatureStats,
  ActionStats,
} from './types.js';
import { DEFAULT_TRAINING_CONFIG } from './types.js';
import { introspectGame, createIntrospectionGame } from './introspector.js';
import { generateCandidateFeatures, getFeatureSummary } from './feature-generator.js';
import { runParallelSimulations } from './parallel-simulator.js';
import { serializeGameStructure } from './simulator.js';
import {
  analyzeFeatures,
  analyzeActions,
  selectTopFeatures,
  correlationToWeight,
} from './analyzer.js';
import {
  parseExistingAI,
  parsedToLearned,
  mergeObjectives,
  getCumulativeStats,
  type ParsedAIFile,
} from './ai-parser.js';
import { benchmarkAI } from './benchmark.js';
import { runParallelBenchmarks } from './parallel-benchmark.js';
import {
  createSeededRandom,
  generateOffspring,
  selectBest,
} from './evolution.js';

/**
 * Configuration for ParallelTrainer, extends TrainingConfig with parallel-specific options.
 */
export interface ParallelTrainingConfig extends TrainingConfig {
  /** Number of worker threads (default: os.cpus().length - 1) */
  workerCount?: number;
}

/**
 * Parallel trainer that uses worker threads for game simulation.
 * Combines parallel execution with full training iteration logic including evolution.
 */
export class ParallelTrainer<G extends Game = Game> {
  private GameClass: GameClass<G>;
  private gameType: string;
  private gameModulePath: string;
  private config: ParallelTrainingConfig;
  private structure: GameStructure | null = null;
  private candidateFeatures: CandidateFeature[] = [];
  private existingAI: ParsedAIFile | null = null;
  private existingObjectives: LearnedObjective[] = [];

  /**
   * Create a new ParallelTrainer.
   *
   * @param GameClass - The game class constructor
   * @param gameType - The game type identifier
   * @param gameModulePath - Absolute path to the compiled game module (.js file)
   * @param config - Training configuration
   */
  constructor(
    GameClass: GameClass<G>,
    gameType: string,
    gameModulePath: string,
    config: Partial<ParallelTrainingConfig> = {}
  ) {
    this.GameClass = GameClass;
    this.gameType = gameType;
    this.gameModulePath = gameModulePath;
    this.config = { ...DEFAULT_TRAINING_CONFIG, ...config };

    // Load existing AI if path provided
    if (this.config.existingAIPath) {
      this.existingAI = parseExistingAI(this.config.existingAIPath);
      if (this.existingAI) {
        this.existingObjectives = parsedToLearned(this.existingAI.objectives);
      }
    }
  }

  /**
   * Run the full training pipeline using parallel simulations.
   */
  async train(): Promise<TrainingResult> {
    // Phase 1: Discover game structure
    this.reportProgress({
      iteration: 0,
      totalIterations: this.config.iterations,
      gamesCompleted: 0,
      totalGames: 0,
      bestWinRate: 0,
      featuresSelected: 0,
      message: 'Discovering game structure...',
    });

    this.structure = this.discoverStructure();
    this.candidateFeatures = generateCandidateFeatures(this.structure);

    const summary = getFeatureSummary(this.candidateFeatures);
    this.reportProgress({
      iteration: 0,
      totalIterations: this.config.iterations,
      gamesCompleted: 0,
      totalGames: 0,
      bestWinRate: 0,
      featuresSelected: this.candidateFeatures.length,
      message: `Generated ${summary.total} candidate features`,
    });

    // Phase 2: Run parallel simulations
    let allFeatureStats: FeatureStats[] = [];
    let allActionStats: ActionStats[] = [];
    let selectedFeatures: FeatureStats[] = [];
    let learnedObjectives: LearnedObjective[] = [...this.existingObjectives];
    let bestWinRate = 0;
    let totalStates = 0;
    let totalGamesPlayed = 0;

    // Report if building on existing
    if (this.existingAI) {
      const prevGames = this.existingAI.metadata?.gamesPlayed ?? 0;
      this.reportProgress({
        iteration: 0,
        totalIterations: this.config.iterations,
        gamesCompleted: 0,
        totalGames: 0,
        bestWinRate: this.existingAI.metadata?.winRate ?? 0,
        featuresSelected: this.existingObjectives.length,
        message: `Building on existing AI (${prevGames} previous games, ${this.existingObjectives.length} objectives)`,
      });
    }

    for (let iteration = 1; iteration <= this.config.iterations; iteration++) {
      this.reportProgress({
        iteration,
        totalIterations: this.config.iterations,
        gamesCompleted: 0,
        totalGames: this.config.gamesPerIteration,
        bestWinRate,
        featuresSelected: selectedFeatures.length,
        message: `Iteration ${iteration}: Running parallel simulations...`,
      });

      // Determine MCTS iterations
      const hasObjectives = learnedObjectives.length > 0;
      const mctsIters = hasObjectives
        ? (this.config.trainedMCTSIterations ?? 10)
        : (this.config.oracleMCTSIterations ?? 50);

      // Run parallel simulations
      const simResults = await runParallelSimulations(
        this.gameModulePath,
        this.gameType,
        {
          gameCount: this.config.gamesPerIteration,
          playerCount: this.structure.playerCount,
          features: this.candidateFeatures,
          timeout: this.config.gameTimeout,
          maxActions: this.config.maxActionsPerGame,
          seed: `${this.config.seed ?? 'train'}-iter-${iteration}`,
          aiConfig: {
            useAI: true,
            iterations: mctsIters,
            objectives: hasObjectives ? learnedObjectives : undefined,
          },
          onProgress: (completed: number, total: number) => {
            this.reportProgress({
              iteration,
              totalIterations: this.config.iterations,
              gamesCompleted: completed,
              totalGames: total,
              bestWinRate,
              featuresSelected: selectedFeatures.length,
              message: `Iteration ${iteration}: Simulating games...`,
            });
          },
        },
        this.structure,
        { workerCount: this.config.workerCount }
      );

      totalStates += simResults.totalStates;
      totalGamesPlayed += simResults.games.length;

      // Phase 3: Analyze results
      this.reportProgress({
        iteration,
        totalIterations: this.config.iterations,
        gamesCompleted: simResults.completedGames,
        totalGames: this.config.gamesPerIteration,
        bestWinRate,
        featuresSelected: selectedFeatures.length,
        message: `Iteration ${iteration}: Analyzing results...`,
      });

      allFeatureStats = analyzeFeatures(simResults.games, this.candidateFeatures);

      if (this.config.learnActions) {
        allActionStats = analyzeActions(simResults.games);
      }

      // Phase 4: Select top features
      selectedFeatures = selectTopFeatures(
        allFeatureStats,
        this.config.maxFeatures,
        this.config.minCorrelation
      );

      // Phase 5: Convert to learned objectives and merge with existing
      const newObjectives = this.createLearnedObjectives(selectedFeatures);

      // Merge with existing objectives
      if (this.existingObjectives.length > 0) {
        learnedObjectives = mergeObjectives(this.existingObjectives, newObjectives, {
          decayFactor: 0.9,
          blendRatio: 0.4,
        });
      } else {
        learnedObjectives = newObjectives;
      }

      this.reportProgress({
        iteration,
        totalIterations: this.config.iterations,
        gamesCompleted: simResults.completedGames,
        totalGames: this.config.gamesPerIteration,
        bestWinRate,
        featuresSelected: selectedFeatures.length,
        message: `Iteration ${iteration}: Selected ${selectedFeatures.length} features`,
      });

      // Run benchmark to measure actual win rate
      this.reportProgress({
        iteration,
        totalIterations: this.config.iterations,
        gamesCompleted: simResults.completedGames,
        totalGames: this.config.gamesPerIteration,
        bestWinRate,
        featuresSelected: selectedFeatures.length,
        message: `Iteration ${iteration}: Benchmarking...`,
      });

      const benchmarkResult = await benchmarkAI(
        this.GameClass,
        this.gameType,
        learnedObjectives,
        {
          gameCount: 20, // Quick benchmark between iterations
          mctsIterations: this.config.benchmarkMCTSIterations ?? 100,
          timeout: this.config.gameTimeout,
          maxActions: this.config.maxActionsPerGame,
          seed: `${this.config.seed ?? 'train'}-bench-${iteration}`,
          features: this.candidateFeatures,
        }
      );

      bestWinRate = benchmarkResult.winRate;

      this.reportProgress({
        iteration,
        totalIterations: this.config.iterations,
        gamesCompleted: simResults.completedGames,
        totalGames: this.config.gamesPerIteration,
        bestWinRate,
        featuresSelected: selectedFeatures.length,
        message: `Iteration ${iteration}: Win rate ${(bestWinRate * 100).toFixed(1)}% (${benchmarkResult.wins}W/${benchmarkResult.losses}L/${benchmarkResult.draws}D)`,
      });
    }

    // Phase 5.5: Evolutionary optimization (if enabled)
    if (this.config.evolve && learnedObjectives.length > 0) {
      this.reportProgress({
        iteration: this.config.iterations,
        totalIterations: this.config.iterations,
        gamesCompleted: 0,
        totalGames: 0,
        bestWinRate,
        featuresSelected: learnedObjectives.length,
        message: `Evolution: Starting optimization with ${learnedObjectives.length} objectives...`,
      });

      const evolutionResult = await this.runEvolution(learnedObjectives, bestWinRate);
      learnedObjectives = evolutionResult.objectives;
      bestWinRate = evolutionResult.bestFitness;

      this.reportProgress({
        iteration: this.config.iterations,
        totalIterations: this.config.iterations,
        gamesCompleted: 0,
        totalGames: 0,
        bestWinRate,
        featuresSelected: learnedObjectives.length,
        message: `Evolution: Complete - best fitness ${(bestWinRate * 100).toFixed(1)}%`,
      });
    }

    // Phase 6: Create action preferences
    const actionPreferences = this.createActionPreferences(allActionStats);

    // Calculate cumulative stats if building on existing
    const cumulativeStats = getCumulativeStats(
      this.existingAI?.metadata,
      { gamesPlayed: totalGamesPlayed, iterations: this.config.iterations }
    );

    return {
      objectives: learnedObjectives,
      actionPreferences,
      featureStats: allFeatureStats,
      actionStats: allActionStats,
      metadata: {
        gamesPlayed: cumulativeStats.gamesPlayed,
        gamesCompleted: cumulativeStats.gamesPlayed,
        totalStates,
        candidateFeaturesGenerated: this.candidateFeatures.length,
        featuresSelected: learnedObjectives.length,
        iterations: cumulativeStats.iterations,
        finalWinRate: bestWinRate,
      },
    };
  }

  /**
   * Discover game structure
   */
  private discoverStructure(): GameStructure {
    const game = createIntrospectionGame(this.GameClass);
    return introspectGame(game);
  }

  /**
   * Create learned objectives from selected features
   */
  private createLearnedObjectives(
    selectedFeatures: FeatureStats[]
  ): LearnedObjective[] {
    const objectives: LearnedObjective[] = [];

    for (const stat of selectedFeatures) {
      const feature = this.candidateFeatures.find(f => f.id === stat.featureId);
      if (!feature) continue;

      const weight = correlationToWeight(stat.correlation, 10);

      // Skip features with negligible weight (but keep more for evolution)
      if (Math.abs(weight) < 0.1) continue;

      objectives.push({
        featureId: stat.featureId,
        description: feature.description,
        weight: Math.round(weight * 10) / 10,
        checkerCode: this.generateCheckerCode(feature),
        correlation: stat.correlation,
      });
    }

    objectives.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
    return objectives;
  }

  /**
   * Create action preferences from action stats
   */
  private createActionPreferences(
    actionStats: ActionStats[]
  ): LearnedActionPreference[] {
    const preferences: LearnedActionPreference[] = [];

    for (const stat of actionStats) {
      const winRateDiff = stat.winRateWhenTaken - stat.winRateWhenNotTaken;

      if (Math.abs(winRateDiff) < 0.05) continue;

      preferences.push({
        actionName: stat.actionName,
        contextFeatures: [],
        weight: Math.round(winRateDiff * 10 * 10) / 10,
      });
    }

    preferences.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
    return preferences.slice(0, 10);
  }

  /**
   * Generate checker code for a feature
   */
  private generateCheckerCode(feature: CandidateFeature): string {
    const id = feature.id;
    const desc = feature.description;

    if (id.includes('-count-advantage')) {
      const elementType = id.split('-count-advantage')[0];
      return `() => {
  const myCount = game.all(${capitalize(elementType)}, { player }).length;
  const theirCount = game.all(${capitalize(elementType)}, { player: opponent }).length;
  return myCount > theirCount;
}`;
    }

    if (id.includes('-lead')) {
      const prop = id.replace('player-', '').replace('-lead', '');
      return `() => player.${prop} > opponent.${prop}`;
    }

    if (id.includes('-gte-')) {
      const parts = id.split('-gte-');
      const threshold = parts[1];
      return `() => /* ${desc} */ true /* threshold: ${threshold} */`;
    }

    return `() => /* ${desc} */ true`;
  }

  /**
   * Report progress
   */
  private reportProgress(progress: TrainingProgress): void {
    if (this.config.onProgress) {
      this.config.onProgress(progress);
    }
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

    // Initialize parent population with slight variations of the initial objectives
    const rng = createSeededRandom(`${this.config.seed ?? 'evolution'}-init`);
    let parents: LearnedObjective[][] = [initialObjectives];

    // Fill initial parent population with mutations
    const initialOffspring = generateOffspring([initialObjectives], mu - 1, sigma * 0.5, rng);
    parents = [...parents, ...initialOffspring];

    // Track best solution
    let bestObjectives = initialObjectives;
    let bestFitness = initialFitness;

    for (let gen = 1; gen <= generations; gen++) {
      this.reportProgress({
        iteration: this.config.iterations,
        totalIterations: this.config.iterations,
        gamesCompleted: 0,
        totalGames: lambda,
        bestWinRate: bestFitness,
        featuresSelected: bestObjectives.length,
        message: `Evolution ${gen}/${generations}: Generating ${lambda} offspring...`,
      });

      // Generate offspring
      const genRng = createSeededRandom(`${this.config.seed ?? 'evolution'}-gen-${gen}`);
      const offspring = generateOffspring(parents, lambda, sigma, genRng);

      // Combine parents + offspring for evaluation
      const population = [...parents, ...offspring];

      this.reportProgress({
        iteration: this.config.iterations,
        totalIterations: this.config.iterations,
        gamesCompleted: 0,
        totalGames: population.length,
        bestWinRate: bestFitness,
        featuresSelected: bestObjectives.length,
        message: `Evolution ${gen}/${generations}: Evaluating ${population.length} candidates in parallel...`,
      });

      // Evaluate fitness for all individuals in parallel
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
            iteration: this.config.iterations,
            totalIterations: this.config.iterations,
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

      // Select best µ individuals as new parents
      parents = selectBest(population, fitnesses, mu);

      // Decay sigma for finer search as we progress
      sigma *= 0.9;

      this.reportProgress({
        iteration: this.config.iterations,
        totalIterations: this.config.iterations,
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
   * Get discovered structure (for inspection)
   */
  getStructure(): GameStructure | null {
    return this.structure;
  }

  /**
   * Get candidate features (for inspection)
   */
  getCandidateFeatures(): CandidateFeature[] {
    return this.candidateFeatures;
  }
}

/**
 * Capitalize first letter
 */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
