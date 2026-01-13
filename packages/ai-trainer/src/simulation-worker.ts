/**
 * Worker thread script for parallel game simulation.
 * Receives SerializableSimulationOptions, runs a game, and posts GameData back.
 */
import { parentPort, workerData } from 'worker_threads';
import type { Game } from '@boardsmith/engine';
import type {
  SerializableSimulationOptions,
  GameData,
  SingleGameOptions,
  GameClass,
} from './types.js';
import { simulateSingleGame, deserializeGameStructure } from './simulator.js';
import { generateCandidateFeatures } from './feature-generator.js';

if (!parentPort) {
  throw new Error('simulation-worker.ts must be run as a worker thread');
}

/**
 * Message handler for incoming simulation requests.
 */
parentPort.on('message', async (options: SerializableSimulationOptions) => {
  const { seed } = options;

  try {
    // Dynamically import the game module
    const gameModule = await import(options.gameModulePath);

    // Extract the game class from the module's gameDefinition
    const gameDefinition = gameModule.gameDefinition;
    if (!gameDefinition?.gameClass) {
      throw new Error(
        `Game module at ${options.gameModulePath} does not export a valid gameDefinition with gameClass`
      );
    }

    const GameClassRef = gameDefinition.gameClass as GameClass<Game>;

    // Deserialize the game structure and regenerate features
    const structure = deserializeGameStructure(options.structure);
    const features = generateCandidateFeatures(structure);

    // Build SingleGameOptions from the serializable options
    const singleGameOptions: SingleGameOptions = {
      playerCount: options.playerCount,
      features,
      timeout: options.timeout,
      maxActions: options.maxActions,
      seed: options.seed,
      aiConfig: options.aiConfig,
    };

    // Run the simulation
    const gameData = await simulateSingleGame(
      GameClassRef,
      options.gameType,
      singleGameOptions
    );

    // Post result back to parent
    parentPort!.postMessage(gameData);
  } catch (error) {
    // Post error back to parent for tracking
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Worker error for seed ${seed}: ${errorMessage}`);

    parentPort!.postMessage({
      error: errorMessage,
      seed,
    });
  }
});
