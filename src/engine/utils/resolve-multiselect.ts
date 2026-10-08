/**
 * resolveMultiSelect — single source of truth for resolving a selection's
 * `multiSelect` config (bot-01 / D9, roadmap SC3 fail-loud principle).
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
 *    normalized. An unbounded selection OMITS `max` rather than carrying
 *    `Infinity`: these bounds travel as JSON, where `Infinity` becomes `null`
 *    and the action panel reads `null` as a cap of nothing (ShufflewickPub
 *    #378, BoardSmith #508). Enumeration, the one caller that does arithmetic
 *    with the bound, applies `?? Infinity` itself.
 *  - `undefined` (no multiSelect at all, or the function legitimately
 *    returns `undefined`) -> returned as `undefined`. This is NOT an error —
 *    it means "single-select in this state".
 *  - the function THROWS -> the error propagates unchanged. Never caught,
 *    never swallowed into a silent skip. Callers that need a fail-loud
 *    boundary should let it surface.
 */
import type { ActionContext, Selection } from '../index.js';

/**
 * resolveOrderedList — the same single source of truth for a choice selection's
 * `orderedList` bounds (#249).
 *
 * Lives beside `resolveMultiSelect` because the two answer the same question
 * about the same selection and must never be resolved two different ways. Both
 * omit `max` when unbounded (see the note at the top of this file).
 */
export function resolveOrderedList(
  selection: Selection,
  ctx: ActionContext,
): { min: number; max?: number } | undefined {
  const orderedList = (selection as { orderedList?: unknown }).orderedList;

  if (orderedList === undefined) return undefined;

  // Function form: evaluated against live state, and NOT wrapped in try/catch —
  // a thrown error must propagate to the caller (fail loud).
  const resolved = typeof orderedList === 'function'
    ? (orderedList as (c: ActionContext) => unknown)(ctx)
    : orderedList;

  if (resolved === undefined) return undefined;
  if (typeof resolved === 'number') return { min: 1, max: resolved };

  const config = resolved as { min?: number; max?: number };
  return config.max === undefined
    ? { min: config.min ?? 1 }
    : { min: config.min ?? 1, max: config.max };
}

export function resolveMultiSelect(
  selection: Selection,
  ctx: ActionContext,
): { min: number; max?: number } | undefined {
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

  if (typeof resolved === 'number') return { min: 1, max: resolved };
  const config = (typeof resolved === 'object' && resolved !== null ? resolved : {}) as {
    min?: number;
    max?: number;
  };
  return config.max === undefined
    ? { min: config.min ?? 1 }
    : { min: config.min ?? 1, max: config.max };
}
