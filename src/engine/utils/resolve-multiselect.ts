/**
 * resolveMultiSelect — single source of truth for resolving a selection's
 * `multiSelect` config (AI-01 / D9, roadmap SC3 fail-loud principle).
 *
 * `multiSelect` on `chooseFrom`/`chooseElements` may be a plain value
 * (`number | MultiSelectConfig`) or a function of the same
 * `{ game, player, args }` context a function-valued CHOICE already receives
 * (`game.getSelectionChoices`). This helper is the ONE place that evaluates
 * that function so enumeration (`enumerate-moves.ts`) and metadata
 * (`buildPickMetadata`, Plan 02) can never disagree about whether a selection
 * is multi-select in the current state.
 *
 * Fail-loud tri-state contract:
 *  - concrete `{min,max}` (static or resolved from a function) -> returned,
 *    normalized via `parseMultiSelect`.
 *  - `undefined` (no multiSelect at all, or the function legitimately
 *    returns `undefined`) -> returned as `undefined`. This is NOT an error —
 *    it means "single-select in this state".
 *  - the function THROWS -> the error propagates unchanged. Never caught,
 *    never swallowed into a silent skip. Callers that need a fail-loud
 *    boundary should let it surface.
 */
import type { ActionContext, Selection } from '../index.js';
import { parseMultiSelect } from './enumerate-moves.js';

export function resolveMultiSelect(
  selection: Selection,
  ctx: ActionContext,
): { min: number; max: number } | undefined {
  const multiSelect = (selection as { multiSelect?: unknown }).multiSelect;

  if (multiSelect === undefined) {
    return undefined;
  }

  // Function form: evaluate against live state. Deliberately NOT wrapped in
  // try/catch — a thrown error must propagate to the caller (fail loud).
  const resolved = typeof multiSelect === 'function' ? multiSelect(ctx) : multiSelect;

  if (resolved === undefined) {
    return undefined;
  }

  return parseMultiSelect(resolved);
}
