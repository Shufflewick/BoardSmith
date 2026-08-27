/**
 * Test game utilities for BoardSmith game development.
 *
 * Provides a convenient wrapper around GameRunner for writing game tests.
 *
 * @module
 */

import {
  Game,
  Player,
  GameElement,
  ElementCollection,
  type GameOptions,
  type FlowState,
  type FlowDebugInfo,
  type PendingActionState,
  type AnnotatedChoice,
} from '../engine/index.js';
import {
  GameRunner,
  type ActionExecutionResult,
  type PlayerStateView,
  type CheckpointPolicy,
} from '../runtime/index.js';
import { ActionBuilder } from './action-builder.js';
import { isElementVisible, getVisibleElements } from './visibility.js';

/**
 * Options for creating a test game.
 */
export interface TestGameOptions {
  /** Number of players */
  playerCount: number;
  /** Player names (optional) */
  playerNames?: string[];
  /** Random seed for deterministic tests */
  seed?: string;
  /** Whether to auto-start the game */
  autoStart?: boolean;
  /**
   * Per-action checkpoint retention policy for this game's runner — the same
   * `checkpoints` block a `GameDefinition` declares.
   *
   * Applied to the RUNNER, not passed to the game constructor. Without it a
   * test always runs under the unbounded default, so a state-size budget test
   * cannot exercise the retention policy the game actually ships (see
   * `docs/state-size.md`).
   */
  checkpoints?: CheckpointPolicy;
  /**
   * Extra game-specific constructor options passed through to the game class.
   *
   * Any fields other than `playerCount`, `playerNames`, `seed`, and `autoStart`
   * are spread into `gameOptions` so game subclasses can receive custom options
   * (e.g. `{ tutorialSetup: true }` for a tutorial-mode board position).
   *
   * @example
   * ```typescript
   * TestGame.create(CheckersGame, { playerCount: 2, tutorialSetup: true });
   * ```
   */
  [key: string]: unknown;
}

/**
 * One selection's choices, including disabled ones with their reasons.
 * See {@link TestGame.getActionSpaceWithChoices}.
 */
export interface SelectionChoicesView {
  /** Selection name (key in action args) */
  name: string;
  /** Every choice for this selection, including disabled ones with `disabled` set to the reason string */
  choices: AnnotatedChoice<unknown>[];
}

/**
 * One action's full choice space for a seat — every selection with every
 * choice (enabled AND disabled, each disabled choice carrying its reason).
 * See {@link TestGame.getActionSpaceWithChoices}.
 */
export interface ActionChoicesView {
  /** Action name */
  name: string;
  /** Action prompt, if defined */
  prompt?: string;
  /** Every selection for this action, each with its full (enabled + disabled) choice list */
  selections: SelectionChoicesView[];
}

/**
 * The full action space for one seat, with disabled choices AND their reasons
 * included inline — one call instead of `getSelectionChoices()` per selection.
 * See {@link TestGame.getActionSpaceWithChoices}.
 */
export interface ActionSpaceWithChoicesView {
  /** Only the actions this seat can legally execute right now */
  actions: ActionChoicesView[];
}

/**
 * Thrown by {@link TestGame.doAction} when the action fails.
 *
 * Carries structured fields (the action name, seat, args, and the wrapped
 * {@link ActionExecutionResult}) so the failure is diagnosable from the
 * error object alone, in addition to the human-readable `message` which
 * includes the `debugActionAvailability` trace.
 */
export class ActionExecutionError extends Error {
  /** Always `'ActionExecutionError'` — safe for `error.name` switch/comparisons. */
  readonly name = 'ActionExecutionError' as const;
  /** The action name that was attempted */
  readonly actionName: string;
  /** The seat that attempted the action (1-indexed) */
  readonly playerSeat: number;
  /** The args passed to the action */
  readonly args: Record<string, unknown>;
  /** The raw (failed) result from the runner */
  readonly result: ActionExecutionResult;

  constructor(
    message: string,
    actionName: string,
    playerSeat: number,
    args: Record<string, unknown>,
    result: ActionExecutionResult,
  ) {
    super(message);
    this.actionName = actionName;
    this.playerSeat = playerSeat;
    this.args = args;
    this.result = result;
    // Required for correct instanceof checks when extending built-in classes in TS.
    Object.setPrototypeOf(this, ActionExecutionError.prototype);
  }
}

/**
 * A test game wrapper that provides convenient testing utilities.
 *
 * Wraps a GameRunner and provides methods for performing actions,
 * checking game state, and inspecting players.
 *
 * @typeParam G - The game class type
 *
 * @example
 * ```typescript
 * const testGame = TestGame.create(GoFishGame, {
 *   playerCount: 2,
 *   seed: 'deterministic',
 * });
 *
 * testGame.doAction(1, 'ask', { target: 2, rank: 'K' }); // throws ActionExecutionError on failure
 * expect(testGame.isComplete()).toBe(false);
 * ```
 *
 * `doAction` throws when the action fails — use {@link TestGame.tryAction} for
 * tests that deliberately exercise the failure path.
 */
export class TestGame<G extends Game = Game> {
  /** The underlying GameRunner instance */
  readonly runner: GameRunner<G>;
  /** The game instance */
  readonly game: G;
  /**
   * The resolved seed this game was constructed with — the fixed literal
   * default (`'test-seed'`) when no `seed` option was supplied, or the
   * caller-supplied `seed` otherwise. Deterministic by default: two
   * `TestGame.create()` calls with no `seed` option produce identical
   * shuffles/command history. Include this in bug reports and flaky-test
   * repros for a one-copy-paste deterministic reproduction.
   */
  readonly seed: string;

  private constructor(runner: GameRunner<G>, seed: string) {
    this.runner = runner;
    this.game = runner.game;
    this.seed = seed;
  }

  /**
   * Create a new test game instance.
   *
   * @param GameClass - The game class constructor
   * @param options - Configuration options for the test game
   * @returns A new TestGame instance
   */
  static create<G extends Game>(
    GameClass: new (options: GameOptions) => G,
    options: TestGameOptions
  ): TestGame<G> {
    // Deterministic by default: a fixed literal seed (matching the
    // 'playUntilComplete-default' house style), NEVER Date.now()/Math.random,
    // so two seedless TestGame.create() calls produce identical shuffles /
    // command history. Pass an explicit `seed` option to vary the run.
    const seed = options.seed ?? 'test-seed';
    const playerNames = options.playerNames ??
      Array.from({ length: options.playerCount }, (_, i) => `Player ${i + 1}`);

    // Separate known TestGame fields from extra game-specific options so the
    // extras can be forwarded to the game constructor unchanged.
    const {
      playerCount,
      playerNames: _pn,
      seed: _s,
      autoStart: _a,
      checkpoints,
      ...extraOptions
    } = options;

    const runner = new GameRunner({
      GameClass,
      gameType: GameClass.name.toLowerCase(),
      gameOptions: {
        ...extraOptions,  // game-specific options (e.g. tutorialSetup, variant flags)
        playerCount,
        playerNames,
        seed,
      },
      checkpoints,
    });

    const testGame = new TestGame(runner, seed);

    if (options.autoStart !== false) {
      testGame.start();
    }

    return testGame;
  }

  /**
   * Start the game flow.
   *
   * @returns The initial flow state
   */
  start(): FlowState {
    return this.runner.start();
  }

  /**
   * Get the current flow state.
   *
   * @returns The current flow state, or undefined if not started
   */
  getFlowState(): FlowState | undefined {
    return this.runner.getFlowState();
  }

  /**
   * Get a structured, human- and machine-readable description of the current
   * flow position (phase, step, path, awaiting seat) — the same
   * {@link FlowDebugInfo} the engine itself produces via `Game.getFlowDebugInfo()`.
   *
   * @returns The current flow debug info. Never throws, never returns `undefined` —
   *   when there is no active flow, `describe()` reports that explicitly.
   */
  getFlowDebugInfo(): FlowDebugInfo {
    return this.runner.getFlowDebugInfo();
  }

  /**
   * Get a read-only snapshot of a seat's in-progress multi-step / repeating-
   * selection action — current selection index, completed selections, and
   * accumulated repeating-selection state.
   *
   * The returned object is always a copy: mutating it never affects
   * subsequent calls or game state.
   *
   * @param seat - The player seat to inspect (1-indexed)
   * @returns The pending action snapshot, or `undefined` if nothing is pending
   *   for that seat (including for an out-of-range seat — no throw).
   */
  getPendingAction(seat: number): PendingActionState | undefined {
    return this.runner.getPendingAction(seat);
  }

  /**
   * Check if the game is complete.
   *
   * @returns True if the game has ended
   */
  isComplete(): boolean {
    return this.runner.isComplete();
  }

  /**
   * Check if the game is awaiting player input.
   *
   * @returns True if the game is waiting for a player to act
   */
  isAwaitingInput(): boolean {
    return this.game.isAwaitingInput();
  }

  /**
   * Get the current player who should act.
   *
   * @returns The current player, or undefined if no player is active
   */
  getCurrentPlayer(): Player | undefined {
    const flowState = this.getFlowState();
    if (flowState?.currentPlayer !== undefined) {
      return this.game.getPlayer(flowState.currentPlayer);
    }
    return undefined;
  }

  /**
   * Get all players in the game.
   *
   * @returns Array of all players
   */
  getPlayers(): Player[] {
    return [...this.game.all(Player)];
  }

  /**
   * Get a player by position.
   *
   * @param position - The player position (1-indexed)
   * @returns The player at the given position
   * @throws Error if player position is invalid
   */
  getPlayer(position: number): Player {
    const player = this.game.getPlayer(position);
    if (!player) {
      throw new Error(`Player ${position} not found`);
    }
    return player;
  }

  /**
   * Perform an action as a player, never throwing — returns the raw
   * {@link ActionExecutionResult} even on failure.
   *
   * Escape hatch for tests that deliberately exercise the failure path
   * (e.g. `assertActionFails`, harness loops that treat failure as a normal
   * control-flow branch). For everything else, prefer {@link TestGame.doAction},
   * which throws loudly on failure with an actionable trace.
   *
   * @param playerSeat - The player seat performing the action (1-indexed)
   * @param actionName - The name of the action to perform
   * @param args - Arguments for the action
   * @returns The result of the action execution — never throws
   *
   * @example
   * ```typescript
   * const result = testGame.tryAction(1, 'playCard', { card: myCard });
   * if (!result.success) {
   *   console.error(result.error);
   * }
   * ```
   */
  tryAction(
    playerSeat: number,
    actionName: string,
    args: Record<string, unknown> = {}
  ): ActionExecutionResult {
    return this.runner.performAction(actionName, playerSeat, args);
  }

  /**
   * Perform an action as a player — THROWS an {@link ActionExecutionError}
   * when the action fails, naming the action and seat and including the
   * `debugActionAvailability` trace so the failure is immediately actionable.
   *
   * A silently-failing setup move should fail loudly at its origin, not
   * surface later as a confusing downstream assertion failure — this is
   * the default for that reason. For tests that deliberately exercise the
   * failure path, use {@link TestGame.tryAction} instead.
   *
   * The thrown message includes `testGame.seed` so a failing run is one
   * copy-paste from a deterministic repro.
   *
   * @param playerSeat - The player seat performing the action (1-indexed)
   * @param actionName - The name of the action to perform
   * @param args - Arguments for the action
   * @throws {ActionExecutionError} When the action fails
   *
   * @example
   * ```typescript
   * testGame.doAction(1, 'playCard', { card: myCard }); // throws on failure
   * ```
   */
  doAction(
    playerSeat: number,
    actionName: string,
    args: Record<string, unknown> = {}
  ): void {
    const result = this.tryAction(playerSeat, actionName, args);
    if (result.success) return;

    let message =
      `Action '${actionName}' failed for seat ${playerSeat}: ${result.error ?? 'unknown error'}\n` +
      `Seed: ${this.seed}`;

    // Build the richer debugActionAvailability trace on the failure path only
    // (no cost on success). Falls back to the plain message above if the seat
    // has no player (getPlayer throws for an out-of-range seat).
    try {
      const player = this.getPlayer(playerSeat);
      const debugInfo = this.game.debugActionAvailability(actionName, player);
      const selLines = debugInfo.details.selections
        .map(s =>
          `  ${s.passed ? '✓' : '✗'} '${s.name}': ${s.choices} choices${s.note ? ` — ${s.note}` : ''}`
        )
        .join('\n');
      message =
        `Action '${actionName}' failed for seat ${playerSeat}.\n` +
        `Error: ${result.error ?? 'unknown error'}${result.errorCode ? ` (${result.errorCode})` : ''}\n` +
        `Why: ${debugInfo.reason}` +
        (selLines ? `\nSelections:\n${selLines}` : '') +
        `\nFlow position: ${this.game.getFlowDebugInfo().describe()}\n` +
        `Seed: ${this.seed}`;
    } catch {
      // Fall back to the plain message built above.
    }

    throw new ActionExecutionError(message, actionName, playerSeat, args, result);
  }

  /**
   * Get the winners of the game.
   *
   * @returns Array of winning players (empty if game not complete)
   */
  getWinners(): Player[] {
    return this.runner.getWinners();
  }

  /**
   * Get the history of all actions performed.
   *
   * @returns Array of action history entries
   */
  getActionHistory() {
    return [...this.runner.actionHistory];
  }

  /**
   * Get a snapshot of the current game state.
   *
   * @returns A serializable snapshot of the game
   */
  getSnapshot() {
    return this.runner.getSnapshot();
  }

  /**
   * Create an {@link ActionBuilder} for driving a multi-step / dependent-selection
   * action ergonomically.
   *
   * The builder exposes only enabled choices via `getChoices()`, accumulates
   * selection values via `select()`, and executes the action via `execute()` —
   * throwing a descriptive error on failure.
   *
   * @param actionName - The registered action to build args for
   * @param seat - The player seat performing the action (1-indexed)
   * @returns A new ActionBuilder bound to this game, the action, and the seat
   *
   * @example
   * ```typescript
   * const choices = testGame.action('categorize', 1).getChoices('category');
   * testGame.action('categorize', 1)
   *   .select('category', choices[0])
   *   .select('item', 10)
   *   .execute();
   * ```
   */
  action(actionName: string, seat: number): ActionBuilder {
    return new ActionBuilder(this, actionName, seat);
  }

  /**
   * Get the perspective-correct observable game state for a player.
   *
   * This is the primary API for reading game state in tests. The returned
   * {@link PlayerStateView} is filtered through the Phase 117 perspective view
   * so hidden information (opponent hands, face-down decks, etc.) is
   * automatically excluded — identical to what the production UI receives.
   *
   * **Two correct read patterns:**
   *
   * **Pattern 1 — observable state (use this for flow/action assertions):**
   * ```typescript
   * const view = testGame.getPlayerView(1);  // PlayerStateView — IDE shows the type
   * view.flowState?.availableActions;         // what actions are available
   * view.complete;                            // has the game ended?
   * view.phase;                               // current game phase name
   * ```
   *
   * **Pattern 2 — typed per-game custom properties (use this for domain state):**
   * ```typescript
   * testGame.game.score;          // typed as your Game subclass property
   * testGame.game.deckSize;       // no JSON parsing, full IDE autocomplete
   * ```
   *
   * **What NOT to do:** Do not parse `view.state` JSON to read game-specific
   * properties — `view.state` is an `ElementJSON` tree intended for the UI
   * renderer, not for domain assertions. Use `testGame.game.<prop>` instead.
   *
   * @param playerSeat - The player whose view to get (1-indexed)
   * @returns The game state as visible to that player, with hidden info excluded
   */
  getPlayerView(playerSeat: number): PlayerStateView {
    return this.runner.getPlayerView(playerSeat);
  }

  /**
   * Get a seat's full action space with disabled choices AND their reasons
   * included — one call instead of `game.getSelectionChoices()` per selection.
   *
   * Reuses the existing engine machinery: {@link Game.getActionSpace} for the
   * legal action/selection set and {@link Game.getSelectionChoices} (which
   * already computes {@link AnnotatedChoice}`.disabled` — v2.8) for each
   * selection's choices. No parallel disabled-choice evaluator is introduced,
   * and the gameplay pick path (`pick-handler.ts`) is untouched — a disabled
   * choice surfaced here still cannot be submitted through gameplay.
   *
   * Note: choices are fetched with no upstream args, so a selection whose
   * choices depend on an earlier selection (`dependsOn`/`filterBy`) reflects
   * the pre-selection (typically empty or unfiltered) choice set. Use
   * {@link ActionBuilder} to inspect choices after an earlier selection is made.
   *
   * @param seat - The player seat to inspect (1-indexed)
   * @returns The action space for the seat, each selection carrying its full
   *   choice list (enabled and disabled, each disabled choice with its reason).
   *   Returns `{ actions: [] }` for an out-of-range seat (no throw).
   */
  getActionSpaceWithChoices(seat: number): ActionSpaceWithChoicesView {
    const player = this.game.getPlayer(seat);
    if (!player) return { actions: [] };

    const actionSpace = this.game.getActionSpace(seat);

    return {
      actions: actionSpace.actions.map((actionSchema): ActionChoicesView => ({
        name: actionSchema.name,
        prompt: actionSchema.prompt,
        selections: actionSchema.selections.map((sel): SelectionChoicesView => ({
          name: sel.name,
          choices: this.game.getSelectionChoices(actionSchema.name, sel.name, player, {}),
        })),
      })),
    };
  }

  /**
   * Is `element` visible to `seat` — judged on the EXACT final per-seat wire
   * output (`game.toJSONForPlayer(seat)`), including any `static playerView`
   * post-transform the game class defines. See {@link isElementVisible}.
   *
   * @param element - The live element to check
   * @param seat - The seat to check visibility for (use 0 for spectator)
   * @returns Whether `element`'s identity is visible to `seat`
   */
  isElementVisible(element: GameElement, seat: number): boolean {
    return isElementVisible(element, seat);
  }

  /**
   * Get the live elements visible to `seat` — derived from the final
   * per-seat serialized tree. See {@link getVisibleElements}.
   *
   * @param seat - The seat to compute visibility for (use 0 for spectator)
   * @returns An ElementCollection of the live elements visible to `seat`
   */
  getVisibleElements(seat: number): ElementCollection<GameElement> {
    return getVisibleElements(this.game, seat);
  }
}

/**
 * Create a test game with the given configuration.
 *
 * Convenience function that wraps {@link TestGame.create}.
 *
 * @param GameClass - The game class constructor
 * @param options - Configuration options for the test game
 * @returns A new TestGame instance
 *
 * @example
 * ```typescript
 * import { createTestGame } from 'boardsmith/testing';
 * import { GoFishGame } from '../games/go-fish';
 *
 * test('player can ask for a card', () => {
 *   const game = createTestGame(GoFishGame, {
 *     playerCount: 2,
 *     seed: 'test-seed',
 *   });
 *
 *   game.doAction(1, 'ask', { target: 2, rank: 'K' }); // throws on failure
 * });
 * ```
 */
export function createTestGame<G extends Game>(
  GameClass: new (options: GameOptions) => G,
  options: TestGameOptions
): TestGame<G> {
  return TestGame.create(GameClass, options);
}
