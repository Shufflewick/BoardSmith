// Test game utilities
export {
  TestGame,
  createTestGame,
  type TestGameOptions,
} from './test-game.js';

// Action simulation
export {
  simulateAction,
  simulateActions,
  assertActionSucceeds,
  assertActionFails,
  type SimulateActionResult,
} from './simulate-action.js';

// Random game simulation
export {
  simulateRandomGames,
  type SimulateRandomGamesOptions,
  type SingleGameResult,
  type SimulationResults,
} from './random-simulation.js';

// Assertion helpers
export {
  assertFlowState,
  assertPlayerHas,
  assertElementCount,
  assertGameFinished,
  assertActionAvailable,
  assertActionNotAvailable,
  type ExpectedFlowState,
  type FlowStateAssertionResult,
} from './assertions.js';

// Fixture and scenario helpers
export {
  ScenarioBuilder,
  scenario,
  quickGame,
  playSequence,
  playUntil,
  createMultiple,
} from './fixtures.js';

// Debug utilities
export {
  toDebugString,
  traceAction,
  visualizeFlow,
  logAvailableActions,
  diffSnapshots,
  type DebugStringOptions,
  type ActionTraceResult,
  type ActionTraceDetail,
} from './debug.js';
