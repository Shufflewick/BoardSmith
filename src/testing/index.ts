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
 *   assertActionSucceeds(game, 1, 'draw');
 *
 *   assertFlowState(game, {
 *     currentPlayer: 1,
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
  ActionExecutionError,
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
  assertHidden,
  assertVisible,
  type ExpectedFlowState,
  type FlowStateAssertionResult,
} from './assertions.js';

// Hidden-info visibility utilities (VIS-01)
export {
  isElementVisible,
  getVisibleElements,
} from './visibility.js';

// Per-seat view diffing (VIS-02)
export {
  diffPlayerViews,
  type ViewDiffResult,
} from './view-diff.js';

// DOM-leak test utility (VIS-03)
export {
  renderAsSeat,
  assertNoHiddenInfoLeak,
  type HiddenInfoGameView,
  type HiddenInfoLeakAllowPredicate,
  type AssertNoHiddenInfoLeakOptions,
} from './dom-leak.js';

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

// ActionBuilder — multi-step / dependent-selection builder (TEST-05)
export { ActionBuilder } from './action-builder.js';

// Animation test-mode + trace (ANIM-01)
export {
  enableAnimationTestMode,
  disableAnimationTestMode,
  isAnimationTestModeEnabled,
  recordTrace,
  getAnimationTrace,
  clearAnimationTrace,
  type AnimationTrace,
} from '../ui/composables/useAnimationTestMode.js';
