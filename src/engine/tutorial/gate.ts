/**
 * Pure tutorial gate-evaluation helpers.
 *
 * This module is cycle-free: it imports `Game` as a TYPE-ONLY import so there
 * is no runtime dependency on `game.ts`. All functions operate against the
 * public `tutorialDefinition` / `tutorialProgress` fields established in Plan
 * 104-01, which are plain public properties readable at runtime from any
 * `Game` instance reference.
 *
 * Two gate granularities:
 *   - **Value-level** (`getGateReasonForValue`): used inside `getChoices` to
 *     disable individual choices/elements that are not in the step's allow-list.
 *     Only applies for allow-list gates where `from`/`to` are defined.
 *   - **Action-level** (`getActionLevelDisabledReasons`): returns a
 *     `Record<actionName, reason>` for available actions that the active step
 *     excludes. This is the "net-new surface" called out in RESEARCH Pitfall 3.
 *
 * Gate is ACTIVE only when `tutorialProgress.get(seat).status === 'running'`.
 * Every evaluator returns the "not gated" value immediately when no tutorial
 * is running for the seat — zero overhead in normal play.
 */

import type { Game } from '../element/game.js';
import type { TutorialStep } from './types.js';

// ============================================================
// Internal helpers
// ============================================================

/**
 * Structural equality check for gate value comparison.
 * Falls back to JSON.stringify for objects (covers most authored gate values).
 */
function gateValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

// ============================================================
// Active-step resolver
// ============================================================

/**
 * Get the active running tutorial step for the given seat, or `null` if no
 * tutorial is active for that seat.
 *
 * "Active" means `tutorialProgress.get(seat).status === 'running'` AND the
 * `stepId` resolves to a step in the `tutorialDefinition.steps` array.
 *
 * Returns `null` when:
 *   - `game.tutorialDefinition` is not set
 *   - no progress entry exists for the seat
 *   - `status` is `'completed'` or `'exited'`
 *   - `stepId` is null or doesn't match any defined step
 */
export function getActiveStep(game: Game, seat: number): TutorialStep | null {
  const { tutorialDefinition, tutorialProgress } = game;
  if (!tutorialDefinition) return null;

  const progress = tutorialProgress.get(seat);
  if (!progress || progress.status !== 'running') return null;
  if (progress.stepId === null) return null;

  return tutorialDefinition.steps.find(s => s.id === progress.stepId) ?? null;
}

// ============================================================
// Value-level gate evaluator
// ============================================================

/**
 * Return a non-empty gate-reason string if `value` is NOT allowed by the
 * active step's gate for the given `actionName`, or `null` if the value is
 * permitted.
 *
 * @param step       - The active tutorial step (from `getActiveStep`).
 * @param actionName - The name of the action whose selection is being evaluated.
 * @param value      - The specific choice/element value to check.
 *
 * Rules:
 *  - **Predicate gate**: the predicate signature `(ctx) => boolean` does not
 *    accept an individual value, so per-value filtering is not possible.
 *    Returns `null` (no value-level gating for predicate gates).
 *    The predicate is still consulted at the action level via
 *    `getActionLevelDisabledReasons`.
 *  - **Allow-list, action mismatch**: if `actionName !== gate.action`, the
 *    action itself is flagged at the action level — individual values of
 *    non-allowed actions do not receive per-value disabled reasons here.
 *    Returns `null`.
 *  - **Allow-list, no `from`/`to`**: all values within the allowed action are
 *    permitted. Returns `null`.
 *  - **Allow-list, with `from`/`to`**: the allowed value set is
 *    `{ gate.from, gate.to }` (whichever are defined). A value NOT in that
 *    set receives a descriptive gate reason.
 */
export function getGateReasonForValue(
  step: TutorialStep,
  actionName: string,
  value: unknown,
): string | null {
  const { gate } = step;

  // Predicate gate: no per-value discrimination possible.
  if (typeof gate === 'function') {
    return null;
  }

  // Allow-list: only restrict values within the explicitly allowed action.
  if (gate.action !== actionName) {
    return null;
  }

  // No from/to constraints: all values of the allowed action are permitted.
  if (gate.from === undefined && gate.to === undefined) {
    return null;
  }

  // Build the allowed set from from/to (whichever are defined).
  const allowedSet: unknown[] = [];
  if (gate.from !== undefined) allowedSet.push(gate.from);
  if (gate.to !== undefined) allowedSet.push(gate.to);

  const isAllowed = allowedSet.some(v => gateValuesEqual(v, value));
  if (isAllowed) return null;

  // Produce an actionable reason string listing the allowed values.
  const allowedStr = allowedSet.map(v => JSON.stringify(v)).join(', ');
  return `Tutorial step requires selecting from: ${allowedStr}`;
}

// ============================================================
// Action-level disabled-reason evaluator
// ============================================================

/**
 * Return a `Record<actionName, reason>` for available actions that the active
 * tutorial step excludes.
 *
 * Used by `Game.getTutorialDisabledActions(seat)` to surface a reason for each
 * out-of-step action to the client — satisfying the "must surface a reason,
 * not silently drop" requirement (success criterion #3).
 *
 * Returns `{}` when no tutorial is running for the seat (zero overhead in
 * normal play).
 *
 * @param game                 - The game instance.
 * @param seat                 - The player seat number (1-indexed).
 * @param availableActionNames - Names of actions currently available for this player.
 */
export function getActionLevelDisabledReasons(
  game: Game,
  seat: number,
  availableActionNames: string[],
): Record<string, string> {
  const step = getActiveStep(game, seat);
  if (!step) return {};

  const { gate } = step;
  const result: Record<string, string> = {};

  if (typeof gate === 'function') {
    // Predicate gate: call once with { game, seat }.
    // true  = permitted (gate does not block)
    // false = blocked  (gate is active)
    // Since the predicate cannot discriminate by action, apply the result uniformly.
    const permitted = gate({ game, seat });
    if (!permitted) {
      for (const actionName of availableActionNames) {
        result[actionName] = 'This action is not part of the current tutorial step';
      }
    }
    return result;
  }

  // Allow-list gate: any available action that is NOT gate.action is blocked.
  for (const actionName of availableActionNames) {
    if (actionName !== gate.action) {
      result[actionName] = `Tutorial step requires using the "${gate.action}" action`;
    }
  }

  return result;
}
