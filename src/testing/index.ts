/**
 * boardsmith/testing - Test utilities for BoardSmith games
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
 * } from 'boardsmith/testing';
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

// Action simulation + playUntilComplete (TEST-02)
export {
  simulateAction,
  simulateActions,
  assertActionSucceeds,
  assertActionFails,
  type SimulateActionResult,
  playUntilComplete,
  GameStuckError,
  type PlayUntilCompleteOptions,
} from './simulate-action.js';

// Random game simulation
export {
  simulateRandomGames,
  replayRandomGame,
  type SimulateRandomGamesOptions,
  type ReplayRandomGameOptions,
  type SingleGameResult,
  type SimulationResults,
} from './random-simulation.js';

// Assertion helpers
export {
  assertFlowState,
  assertGameFinished,
  assertActionAvailable,
  assertActionNotAvailable,
  type ExpectedFlowState,
  type FlowStateAssertionResult,
} from './assertions.js';

// Debug utilities
export {
  toDebugString,
  traceAction,
  logAvailableActions,
  diffSnapshots,
  type DebugStringOptions,
  type ActionTraceResult,
  type ActionTraceDetail,
} from './debug.js';

// Tutorial DSL
export {
  simulateTutorial,
  type TutorialScenarioMove,
  type SimulateTutorialOptions,
  type SimulateTutorialResult,
} from './simulate-tutorial.js';

export {
  assertTutorialStep,
  assertTutorialCompletes,
} from './tutorial-assertions.js';
