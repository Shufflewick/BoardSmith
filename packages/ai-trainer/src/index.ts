// Main trainer
export { AITrainer, trainAI } from './trainer.js';

// Introspection
export {
  introspectGame,
  createIntrospectionGame,
  printGameStructure,
  estimateComplexity,
  type GameComplexity,
} from './introspector.js';

// Feature generation
export {
  generateCandidateFeatures,
  filterFeaturesByCategory,
  getFeatureSummary,
  printFeatures,
} from './feature-generator.js';

// Feature templates
export { FEATURE_TEMPLATES, type FeatureTemplate } from './feature-templates.js';

// Simulation
export {
  runSimulations,
  simulateSingleGame,
  serializeGameStructure,
  deserializeGameStructure,
  type SimulationOptions,
  type SimulationResults,
} from './simulator.js';

// Analysis
export {
  analyzeFeatures,
  analyzeActions,
  selectTopFeatures,
  correlationToWeight,
  printAnalysisSummary,
} from './analyzer.js';

// Code generation
export {
  generateAICode,
  type CodeGeneratorOptions,
} from './code-generator.js';

// AI file parsing (for incremental training)
export {
  parseExistingAI,
  parsedToLearned,
  mergeObjectives,
  getCumulativeStats,
  type ParsedAIFile,
  type ParsedObjective,
} from './ai-parser.js';

// Types
export type {
  GameClass,
  GameStructure,
  ElementTypeInfo,
  PlayerTypeInfo,
  SpatialInfo,
  CandidateFeature,
  StateSnapshot,
  GameData,
  FeatureStats,
  ActionStats,
  LearnedObjective,
  LearnedActionPreference,
  TrainingResult,
  TrainingConfig,
  TrainingProgress,
  // Serializable types for worker thread communication
  SingleGameOptions,
  SerializableElementTypeInfo,
  SerializableGameStructure,
  SerializableSimulationOptions,
} from './types.js';

export { DEFAULT_TRAINING_CONFIG } from './types.js';
