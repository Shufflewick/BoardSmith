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

// Asset-reachability build gate (TOOL-02) — additive re-export so games can
// call the build/test gate without hand-rolling a second scanner.
//
// WR-02: this couples `boardsmith/testing`'s public export surface to
// `cli/lib`'s internal file layout. `asset-scan.ts` is otherwise dependency-
// free (only `node:fs`/`node:path`) and was deliberately left in `cli/lib`
// rather than moved into `src/testing/` because it also has a relative-path
// importer OUTSIDE this package's type-checked source graph (the
// `bs-build-chunk` skill's `build/test.md`, which resolves the file by a
// hardcoded relative path — see 162-CONTEXT.md D18/code_context) — moving it
// would silently break that importer with no compiler signal. If `cli/lib`
// ever relocates or renames `asset-scan.ts`, update this import AND
// `src/cli/slash-command/bs/build/test.md`'s reference together.
export { scanAssetReachability, type AssetViolation } from '../cli/lib/asset-scan.js';

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
