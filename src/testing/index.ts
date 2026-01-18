/**
 * @boardsmith/testing - Test utilities for BoardSmith games
 *
 * Provides utilities for testing BoardSmith games including:
 * - Test game creation and management
 * - Action simulation and assertions
 * - Flow state verification
 * - Debug utilities for diagnosing issues
 * - Random game simulation for completeness testing
 *
 * @example
 * ```typescript
 * import {
 *   createTestGame,
 *   simulateAction,
 *   assertFlowState,
 *   assertActionSucceeds,
 * } from '@boardsmith/testing';
 *
 * test('player can draw a card', () => {
 *   const game = createTestGame(MyGame, { playerCount: 2 });
 *
 *   assertActionSucceeds(game, 0, 'draw');
 *
 *   assertFlowState(game, {
 *     currentPlayer: 0,
 *     actions: ['play', 'discard'],
 *   });
 * });
 * ```
 *
 * @packageDocumentation
 */

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
  visualizeFlowWithPosition,
  debugFlowState,
  logAvailableActions,
  diffSnapshots,
  type DebugStringOptions,
  type ActionTraceResult,
  type ActionTraceDetail,
  type FlowStateDebug,
} from './debug.js';
