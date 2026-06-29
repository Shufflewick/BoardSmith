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
import type { SelectionMatcher, TutorialGate, TutorialGateAllowList, TutorialStep, TutorialStepView } from './types.js';
import { evaluateConditionWithTrace } from '../action/action.js';

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

/**
 * Field-equality match for a single selection value against a SelectionMatcher.
 *
 * ElementRef precedence (mirrors `matchesRef` in useBoardInteraction):
 *   id wins, then notation, then name. When one of these keys is present in
 *   the matcher, only that field is checked.
 *
 * For choice objects (e.g. DestinationChoice): all matcher fields must equal
 * the corresponding fields on the value.
 *
 * **Primitive values (string/number) are not supported by SelectionMatcher.**
 * If a `choice` selection uses primitive values (e.g. `choices: ['heads', 'tails']`),
 * this function returns false for every primitive value, blocking ALL choices rather
 * than just the ones that don't match. Tutorial authors who need to gate a primitive
 * choice selection must use a `TutorialGateCondition` predicate instead.
 * See `SelectionMatcher` JSDoc in types.ts for details.
 */
function selectionMatchesValue(matcher: SelectionMatcher, value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const val = value as Record<string, unknown>;

  // ElementRef precedence: if matcher specifies id, that alone determines match.
  if ('id' in matcher) return val['id'] === matcher['id'];
  if ('notation' in matcher) return val['notation'] === matcher['notation'];
  if ('name' in matcher) return val['name'] === matcher['name'];

  // General field equality for choice objects (DestinationChoice, etc.).
  return Object.entries(matcher).every(([k, v]) => val[k] === v);
}

/**
 * Discriminate between an allow-list gate (has a string `action` field) and a
 * labeled-predicate condition record.
 *
 * TutorialGateAllowList always carries `action: string`.
 * TutorialGateCondition is a plain record of predicate functions.
 */
function isAllowListGate(gate: TutorialGate): gate is TutorialGateAllowList {
  return typeof (gate as TutorialGateAllowList).action === 'string';
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
 * @param step          - The active tutorial step (from `getActiveStep`).
 * @param actionName    - The name of the action whose selection is being evaluated.
 * @param value         - The specific choice/element value to check.
 * @param selectionName - The `selection.name` from `BaseSelection` identifying
 *                        which selection slot produced this value.
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
 *  - **Allow-list, no `selections`**: all values within the allowed action are
 *    permitted. Returns `null`.
 *  - **Allow-list, with `selections`**: if the selection name has an entry, the
 *    value is matched against that entry's `SelectionMatcher`. Non-matching
 *    values receive a descriptive gate reason. Selection names with no entry
 *    permit all their values (back-compatible).
 */
export function getGateReasonForValue(
  step: TutorialStep,
  actionName: string,
  value: unknown,
  selectionName: string,
): string | null {
  const { gate } = step;

  // Labeled-predicate condition gate: no per-value discrimination possible.
  // The condition is consulted at the action level via getActionLevelDisabledReasons.
  if (!isAllowListGate(gate)) {
    return null;
  }

  // Allow-list: only restrict values within the explicitly allowed action.
  if (gate.action !== actionName) {
    return null;
  }

  // Per-selection matching: check only the restriction for this selection name.
  if (gate.selections && selectionName in gate.selections) {
    const matcher = gate.selections[selectionName];
    if (selectionMatchesValue(matcher, value)) return null;
    return `Tutorial step requires a specific ${selectionName}: ${JSON.stringify(matcher)}`;
  }

  // No selections entry for this selection name: all values permitted.
  return null;
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

  if (!isAllowListGate(gate)) {
    // Labeled-predicate condition gate: evaluate via the shared evaluator.
    // All predicates must pass (AND semantics). On failure, surface the first
    // failing label so the author knows exactly which condition blocked progress.
    const { passed, details } = evaluateConditionWithTrace(gate, { game, seat });
    if (!passed) {
      const failingLabel = details.find(d => !d.passed)?.label
        ?? 'tutorial gate condition not met';
      for (const actionName of availableActionNames) {
        result[actionName] = `Tutorial step blocked: "${failingLabel}"`;
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

// ============================================================
// Client projection helper (shared by buildPlayerState + createPlayerView)
// ============================================================

/**
 * Derive the `TutorialStepView` client projection for the given seat, or
 * `undefined` when no tutorial is actively running.
 *
 * This is the SHARED helper used by BOTH `buildPlayerState` (session layer)
 * and `createPlayerView` (engine layer) so the two call sites cannot drift
 * (parity hard-rule, T-104-07). Sourced from `getActiveStep` so the
 * "active = running + stepId resolves" invariant is enforced in one place.
 *
 * Carries only the fields that have authored values (undefined fields are
 * omitted from the projected object to keep the wire shape lean).
 *
 * @param game - Game instance.
 * @param seat - 1-indexed player seat.
 */
export function getActiveTutorialStepView(game: Game, seat: number): TutorialStepView | undefined {
  const step = getActiveStep(game, seat);
  if (!step) return undefined;

  const view: TutorialStepView = { stepId: step.id };
  // Only copy optional fields when they carry a value; omitting them keeps the
  // wire shape identical to `undefined` (clients check "field in obj" correctly).
  if (step.content !== undefined) view.content = step.content;
  if (step.suppressAutoFill !== undefined) view.suppressAutoFill = step.suppressAutoFill;
  if (step.suppressAutoFillFor !== undefined) view.suppressAutoFillFor = step.suppressAutoFillFor;
  return view;
}
