/**
 * Pure tutorial progress helpers: step-transition, predicate evaluation,
 * auto-advance pump, and fail-loud validation.
 *
 * All functions except `autoAdvanceTutorial` are pure (no game mutation).
 * `autoAdvanceTutorial` is the sole writer — it mutates `game.tutorialProgress`
 * and is bounded by `def.steps.length` to prevent infinite loops (T-106-02).
 *
 * Plans 03 and 04 consume these as the single source of truth for
 * "evaluate predicate → move to next step".
 */

import type { Game } from '../element/game.js';
import type { TutorialDefinition, TutorialProgress, TutorialStep } from './types.js';
import { getActiveStep } from './gate.js';
import { evaluateConditionWithTrace } from '../action/action.js';

// ============================================================
// Step-transition helpers (pure)
// ============================================================

/**
 * Return the initial `TutorialProgress` for the first step of the definition.
 *
 * @throws {Error} if the definition has no steps (fail-loud per MR-03; also
 *   surfaced at validation time via `validateTutorialDefinition`).
 */
export function initialProgress(def: TutorialDefinition): TutorialProgress {
  const first = def.steps[0];
  if (!first) {
    throw new Error(
      'Cannot initialize tutorial progress: the tutorial has no steps. ' +
      'Add at least one step to TutorialDefinition.steps before starting.'
    );
  }
  return { stepId: first.id, status: 'running' };
}

/**
 * Pure forward-advance transition: returns the next `TutorialProgress` after
 * `currentStepId`.
 *
 * - If the current step is the last step, returns `{ stepId: last, status: 'completed' }`.
 * - If `currentStepId` is not found, advances from index 0 (guards against stale state).
 *
 * Does NOT mutate the game. Callers (TutorialController, autoAdvanceTutorial)
 * are responsible for writing the returned progress.
 */
export function nextProgress(def: TutorialDefinition, currentStepId: string | null): TutorialProgress {
  const currentIndex = currentStepId !== null
    ? def.steps.findIndex(s => s.id === currentStepId)
    : -1;

  const resolvedIndex = currentIndex === -1 ? 0 : currentIndex;
  const nextIndex = resolvedIndex + 1;

  if (nextIndex >= def.steps.length) {
    // On or past the last step — complete the tutorial.
    const lastStepId = def.steps[resolvedIndex]?.id ?? currentStepId;
    return { stepId: lastStepId, status: 'completed' };
  }

  return { stepId: def.steps[nextIndex].id, status: 'running' };
}

// ============================================================
// Predicate evaluation
// ============================================================

/**
 * Evaluate the `advanceWhen` predicate for the currently active running step.
 *
 * Returns `{ fired: false, details: [] }` when:
 *   - no tutorial is running for the seat, or
 *   - the active step has no `advanceWhen` condition.
 *
 * Uses the shared `evaluateConditionWithTrace` — same semantics as action
 * conditions (AND over all labeled predicates, catching predicate errors).
 */
export function evaluateAdvanceWhen(
  game: Game,
  seat: number,
): { fired: boolean; details: { label: string; value: unknown; passed: boolean }[] } {
  const step = getActiveStep(game, seat);
  if (!step?.advanceWhen) return { fired: false, details: [] };

  const { passed, details } = evaluateConditionWithTrace(step.advanceWhen, { game, seat });
  return { fired: passed, details };
}

// ============================================================
// Auto-advance pump (bounded, forward-only)
// ============================================================

/**
 * Pump the tutorial forward while the current step's `advanceWhen` fires.
 *
 * Mutates `game.tutorialProgress` directly — this is the engine-owned
 * auto-advance writer used by session (Plan 03) and testing DSL (Plan 04).
 *
 * Properties:
 *   - **Forward-only**: never revisits a prior step.
 *   - **Bounded**: iterates at most `def.steps.length` times, preventing
 *     infinite loops even if a predicate is always true (T-106-02).
 *   - **Terminates on completion**: stops as soon as the tutorial completes.
 *   - **No start-special-casing**: advances based on current game state;
 *     the caller (session post-action hook, Plan 03) decides when to call.
 *
 * @returns `{ advanced, finalStepId }` — `advanced` is true when at least one
 *   step was advanced; `finalStepId` is the step the tutorial rests on after
 *   the pump (null if no tutorial definition or no progress for the seat).
 */
export function autoAdvanceTutorial(
  game: Game,
  seat: number,
): { advanced: boolean; finalStepId: string | null } {
  const def = game.tutorialDefinition;
  if (!def) return { advanced: false, finalStepId: null };

  const initial = game.tutorialProgress.get(seat);
  if (!initial || initial.status !== 'running') {
    return { advanced: false, finalStepId: initial?.stepId ?? null };
  }

  let advanced = false;
  // Hard cap: cannot advance more times than there are steps (forward-only
  // + bounded guarantees no infinite loop even with always-true predicates).
  const maxAdvances = def.steps.length;

  for (let i = 0; i < maxAdvances; i++) {
    const { fired } = evaluateAdvanceWhen(game, seat);
    if (!fired) break;

    const current = game.tutorialProgress.get(seat)!;
    const next = nextProgress(def, current.stepId);
    game.tutorialProgress.set(seat, next);
    advanced = true;

    if (next.status !== 'running') break; // completed or exited
  }

  const final = game.tutorialProgress.get(seat);
  return { advanced, finalStepId: final?.stepId ?? null };
}

// ============================================================
// Fail-loud validation (MR-03 — registration side)
// ============================================================

/**
 * Validate a `TutorialDefinition` and throw an actionable error for any
 * structural problems that would cause silent misbehavior at runtime.
 *
 * Checks:
 *   1. `def.steps` must be non-empty.
 *   2. Each step's `gate` (when in predicate/labeled-condition form) must have
 *      only function values.
 *   3. Each step's `advanceWhen` (when present) must be a record of functions.
 *
 * Call this at game registration time (e.g., in the `tutorial` option handler)
 * so authors get an error at startup, not silently at runtime.
 *
 * @throws {Error} with an actionable message naming the step and field.
 */
export function validateTutorialDefinition(def: TutorialDefinition): void {
  if (def.steps.length === 0) {
    throw new Error(
      'Tutorial definition has no steps. ' +
      'Add at least one TutorialStep to TutorialDefinition.steps. ' +
      'Each step needs an id and a gate.'
    );
  }

  for (const step of def.steps) {
    // Validate gate: if it looks like a labeled-condition record, verify values are functions.
    // Allow-list gate has action: string — skip predicate-function validation for it.
    if (step.gate !== null && typeof step.gate === 'object') {
      const asAllowList = step.gate as { action?: unknown };
      if (typeof asAllowList.action !== 'string') {
        // Labeled-condition gate: all values must be functions.
        for (const [label, value] of Object.entries(step.gate)) {
          if (typeof value !== 'function') {
            throw new Error(
              `Tutorial step '${step.id}' gate['${label}'] must be a function, ` +
              `got ${typeof value}. ` +
              `Each gate label must map to a predicate: (ctx: TutorialGateContext) => boolean.`
            );
          }
        }
      }
    }

    // Validate advanceWhen: must be a record of functions when present.
    if (step.advanceWhen !== undefined) {
      if (typeof step.advanceWhen !== 'object' || step.advanceWhen === null) {
        throw new Error(
          `Tutorial step '${step.id}' advanceWhen must be an object of labeled predicate functions, ` +
          `got ${typeof step.advanceWhen}. ` +
          `Use a labeled record: { 'condition label': (ctx) => boolean }.`
        );
      }
      // It's an object — verify all values are functions.
      for (const [label, value] of Object.entries(step.advanceWhen as Record<string, unknown>)) {
        if (typeof value !== 'function') {
          throw new Error(
            `Tutorial step '${step.id}' advanceWhen['${label}'] must be a function, ` +
            `got ${typeof value}. ` +
            `Each advanceWhen label must map to a predicate: (ctx: TutorialGateContext) => boolean.`
          );
        }
      }
    }
  }
}
