import type { Game } from '@boardsmith/engine';
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
import { runSimulations, type SimulationOptions } from './simulator.js';
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

/**
 * Main trainer class that orchestrates the entire AI training process
 */
export class AITrainer<G extends Game = Game> {
  private GameClass: GameClass<G>;
  private gameType: string;
  private config: TrainingConfig;
  private structure: GameStructure | null = null;
  private candidateFeatures: CandidateFeature[] = [];
  private existingAI: ParsedAIFile | null = null;
  private existingObjectives: LearnedObjective[] = [];

  constructor(
    GameClass: GameClass<G>,
    gameType: string,
    config: Partial<TrainingConfig> = {}
  ) {
    this.GameClass = GameClass;
    this.gameType = gameType;
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
   * Run the full training pipeline
   */
  async train(): Promise<TrainingResult> {
    const startTime = Date.now();

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

    // Phase 2: Run simulations
    let allFeatureStats: FeatureStats[] = [];
    let allActionStats: ActionStats[] = [];
    let selectedFeatures: FeatureStats[] = [];
    // Start with existing objectives if available
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
        message: `Iteration ${iteration}: Running simulations...`,
      });

      // Determine MCTS iterations:
      // - Oracle games (no objectives): use oracleMCTSIterations for quality training data
      // - Trained games (with objectives): use trainedMCTSIterations since heuristics help
      // - Backwards compat: fall back to mctsIterations if new fields not set
      const hasObjectives = learnedObjectives.length > 0;
      const mctsIters = hasObjectives
        ? (this.config.trainedMCTSIterations ?? this.config.mctsIterations ?? 10)
        : (this.config.oracleMCTSIterations ?? this.config.mctsIterations ?? 50);

      // Run simulations
      const simOptions: SimulationOptions = {
        gameCount: this.config.gamesPerIteration,
        playerCount: this.structure.playerCount,
        features: this.candidateFeatures,
        timeout: this.config.gameTimeout,
        maxActions: this.config.maxActionsPerGame,
        seed: `${this.config.seed ?? 'train'}-iter-${iteration}`,
        // Always use MCTS - it's the only way to generate valid moves with arguments
        // Use existing or learned objectives to guide the search
        aiConfig: {
          useAI: true,
          iterations: mctsIters,
          objectives: hasObjectives ? learnedObjectives : undefined,
        },
        onProgress: (completed, total) => {
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
      };

      const results = await runSimulations(this.GameClass, this.gameType, simOptions);
      totalStates += results.totalStates;
      totalGamesPlayed += results.games.length;

      
      // Phase 3: Analyze results
      this.reportProgress({
        iteration,
        totalIterations: this.config.iterations,
        gamesCompleted: results.completedGames,
        totalGames: this.config.gamesPerIteration,
        bestWinRate,
        featuresSelected: selectedFeatures.length,
        message: `Iteration ${iteration}: Analyzing results...`,
      });

      allFeatureStats = analyzeFeatures(results.games, this.candidateFeatures);

      if (this.config.learnActions) {
        allActionStats = analyzeActions(results.games);
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
          decayFactor: 0.9, // Slightly reduce weight of objectives not re-discovered
          blendRatio: 0.4,  // Favor existing slightly (they have more data)
        });
      } else {
        learnedObjectives = newObjectives;
      }

      this.reportProgress({
        iteration,
        totalIterations: this.config.iterations,
        gamesCompleted: results.completedGames,
        totalGames: this.config.gamesPerIteration,
        bestWinRate,
        featuresSelected: selectedFeatures.length,
        message: `Iteration ${iteration}: Selected ${selectedFeatures.length} features`,
      });

      // Run benchmark to measure actual win rate
      this.reportProgress({
        iteration,
        totalIterations: this.config.iterations,
        gamesCompleted: results.completedGames,
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
        }
      );

      bestWinRate = benchmarkResult.winRate;

      this.reportProgress({
        iteration,
        totalIterations: this.config.iterations,
        gamesCompleted: results.completedGames,
        totalGames: this.config.gamesPerIteration,
        bestWinRate,
        featuresSelected: selectedFeatures.length,
        message: `Iteration ${iteration}: Win rate ${(bestWinRate * 100).toFixed(1)}% (${benchmarkResult.wins}W/${benchmarkResult.losses}L/${benchmarkResult.draws}D)`,
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
        gamesCompleted: cumulativeStats.gamesPlayed, // Approximate
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
      // Find the original feature
      const feature = this.candidateFeatures.find(f => f.id === stat.featureId);
      if (!feature) continue;

      // Calculate weight from correlation
      const weight = correlationToWeight(stat.correlation, 10);

      // Skip features with negligible weight
      if (Math.abs(weight) < 0.5) continue;

      objectives.push({
        featureId: stat.featureId,
        description: feature.description,
        weight: Math.round(weight * 10) / 10, // Round to 1 decimal
        checkerCode: this.generateCheckerCode(feature),
        correlation: stat.correlation,
      });
    }

    // Sort by absolute weight
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

      // Only include actions with significant difference
      if (Math.abs(winRateDiff) < 0.05) continue;

      preferences.push({
        actionName: stat.actionName,
        contextFeatures: [], // Could be enhanced to include contextual features
        weight: Math.round(winRateDiff * 10 * 10) / 10, // Scale and round
      });
    }

    // Sort by absolute weight
    preferences.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

    return preferences.slice(0, 10); // Top 10 action preferences
  }

  /**
   * Generate checker code for a feature
   * This creates a string representation of the checker function
   */
  private generateCheckerCode(feature: CandidateFeature): string {
    // Parse the feature ID to generate appropriate code
    const id = feature.id;
    const desc = feature.description;

    // This is a simplified version - in practice we'd need more sophisticated
    // code generation based on the feature structure
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

    // Default: return a placeholder
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

/**
 * Convenience function to train AI for a game
 */
export async function trainAI<G extends Game>(
  GameClass: GameClass<G>,
  gameType: string,
  config?: Partial<TrainingConfig>
): Promise<TrainingResult> {
  const trainer = new AITrainer(GameClass, gameType, config);
  return trainer.train();
}

// Re-export the default config
export { DEFAULT_TRAINING_CONFIG } from './types.js';
