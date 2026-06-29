/**
 * TutorialController — session-layer tutorial lifecycle manager.
 *
 * Peer to PendingActionManager. Owns the start/advance/skip/exit lifecycle for
 * a tutorial, mutating the serialized `game.tutorialProgress` Map so that undo
 * rewinds the active step for free (progress lives in the engine's state).
 *
 * Design: mirrors the PendingActionManager callbacks pattern (`{ broadcast }`)
 * and the StateHistory runner-getter pattern (`() => runner`). The engine never
 * advances the tutorial — lifecycle is exclusively session-layer.
 */

import type { Game } from '../engine/element/game.js';
import type { TutorialProgress } from '../engine/tutorial/types.js';
import type { GameRunner } from '../runtime/index.js';
import { nextProgress, initialProgress, validateTutorialDefinition } from '../engine/tutorial/progress.js';

// ============================================
// Callbacks
// ============================================

/**
 * Callbacks for TutorialController to interact with GameSession.
 */
export interface TutorialControllerCallbacks {
  /** Broadcast state updates to all clients. Called once per lifecycle mutation. */
  broadcast(): void;
}

// ============================================
// TutorialController
// ============================================

/**
 * Session-layer manager for tutorial lifecycle transitions.
 *
 * Progress is stored in the serialized engine state
 * (`game.tutorialProgress: Map<number, TutorialProgress>`) so that undo
 * rewinds the active step in lockstep with the game state. This controller
 * is the ONLY writer of `tutorialProgress` — client-set of an arbitrary step
 * id or status is not possible (T-104-06).
 *
 * @example
 * ```typescript
 * const tc = new TutorialController(() => this.#runner, {
 *   broadcast: () => this.broadcast(),
 * });
 * tc.start(seat);    // sets running on first step
 * tc.advance(seat);  // moves to next step (or completes)
 * tc.skip(seat);     // same forward move, semantically "skipped"
 * tc.exit(seat);     // status → 'exited'; gating goes inert
 * ```
 */
export class TutorialController<G extends Game = Game> {
  readonly #getRunner: () => GameRunner<G>;
  readonly #callbacks: TutorialControllerCallbacks;

  constructor(getRunner: () => GameRunner<G>, callbacks: TutorialControllerCallbacks) {
    this.#getRunner = getRunner;
    this.#callbacks = callbacks;
  }

  // ============================================
  // Private helpers
  // ============================================

  /**
   * Assert that a tutorial definition is available and return it.
   * Throws an actionable error naming the missing `GameDefinition.tutorial`
   * property so the game author knows exactly what to add.
   */
  #requireDefinition() {
    const def = this.#getRunner().game.tutorialDefinition;
    if (!def) {
      throw new Error(
        'No tutorial definition found on this game. ' +
        'Set the `tutorial` property on your GameDefinition (GameDefinition.tutorial) ' +
        'to define tutorial steps before calling lifecycle methods.'
      );
    }
    return def;
  }

  /**
   * Move to the next step, or complete, for the given seat.
   * Shared by advance() and skip() — both forward-advance the step index.
   * Delegates to engine `nextProgress` — single source of truth for step transitions.
   */
  #forwardAdvance(seat: number): TutorialProgress {
    const def = this.#requireDefinition();
    const game = this.#getRunner().game;
    const current = game.tutorialProgress.get(seat);

    // If no progress yet, treat as if we're on the first step (shouldn't happen in
    // normal usage but guards against calling advance before start).
    const currentStepId = current?.stepId ?? def.steps[0]?.id ?? null;

    const progress = nextProgress(def, currentStepId);
    game.tutorialProgress.set(seat, progress);
    return progress;
  }

  // ============================================
  // Public lifecycle API
  // ============================================

  /**
   * Start the tutorial for the given seat.
   *
   * Sets progress to the first step with status `'running'` and broadcasts.
   * Throws if `game.tutorialDefinition` is absent (names `GameDefinition.tutorial`).
   *
   * @param seat - 1-indexed seat number of the learner.
   */
  start(seat: number): void {
    const def = this.#requireDefinition();
    // MR-03: fail loud on empty steps or non-function predicates at start time.
    validateTutorialDefinition(def);
    const game = this.#getRunner().game;
    // R-01: apply the tutorial's setup callback before setting initial progress so
    // the board is in the deterministic tutorial position before any advanceWhen
    // predicates fire. setup is optional; games without a preset omit it.
    def.setup?.(game);
    // Delegate first-step construction to engine initialProgress — single source of truth.
    const progress = initialProgress(def);
    game.tutorialProgress.set(seat, progress);
    this.#callbacks.broadcast();
  }

  /**
   * Advance the tutorial to the next step for the given seat.
   *
   * If on the last step, marks the tutorial as `'completed'`. Broadcasts once.
   * Throws if `game.tutorialDefinition` is absent.
   *
   * @param seat - 1-indexed seat number of the learner.
   */
  advance(seat: number): void {
    this.#forwardAdvance(seat);
    this.#callbacks.broadcast();
  }

  /**
   * Skip the current step for the given seat, advancing to the next one.
   *
   * Semantically distinct from `advance` (the learner bypassed the teaching
   * beat rather than completing it), but produces the same forward move in
   * progress state. Broadcasts once.
   *
   * @param seat - 1-indexed seat number of the learner.
   */
  skip(seat: number): void {
    this.#forwardAdvance(seat);
    this.#callbacks.broadcast();
  }

  /**
   * Exit the tutorial for the given seat.
   *
   * Sets status to `'exited'`. The engine sees no running step and lifts gate
   * enforcement. Broadcasts once.
   *
   * @param seat - 1-indexed seat number of the learner.
   */
  exit(seat: number): void {
    this.#requireDefinition();
    const game = this.#getRunner().game;
    const current = game.tutorialProgress.get(seat);
    const progress: TutorialProgress = {
      stepId: current?.stepId ?? null,
      status: 'exited',
    };
    game.tutorialProgress.set(seat, progress);
    this.#callbacks.broadcast();
  }
}
