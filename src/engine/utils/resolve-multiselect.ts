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
 *    normalized via `parseMultiSelect`.
 *  - `undefined` (no multiSelect at all, or the function legitimately
 *    returns `undefined`) -> returned as `undefined`. This is NOT an error —
 *    it means "single-select in this state".
 *  - the function THROWS -> the error propagates unchanged. Never caught,
 *    never swallowed into a silent skip. Callers that need a fail-loud
 *    boundary should let it surface.
 */
import type { ActionContext, Selection } from '../index.js';

/**
 * Parse a multiSelect config value into `{ min, max }`.
 *
 * MOVED HERE from `enumerate-moves.ts`, and the move is the point: this
 * function was that file's only export used by this one, while this file's
 * `resolveMultiSelect` is imported back by `enumerate-moves.ts:227`. That
 * mutual import was a real dependency cycle. `parseMultiSelect` is a pure
 * normalizer with no dependency on enumeration, so it belongs on this side of
 * the pair, and moving it breaks the cycle without a shim module.
 */
function parseMultiSelect(multiSelect: unknown): { min: number; max: number } {
  if (typeof multiSelect === 'number') {
    return { min: 1, max: multiSelect };
  }
  if (typeof multiSelect === 'object' && multiSelect !== null) {
    const config = multiSelect as { min?: number; max?: number };
    return {
      min: config.min ?? 1,
      max: config.max ?? Infinity,
    };
  }
  return { min: 1, max: Infinity };
}


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
