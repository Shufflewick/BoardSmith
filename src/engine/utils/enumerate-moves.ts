/**
 * enumerateLegalMoves — public engine utility (INTRO-04).
 *
 * Extracts the pure combinatorics enumeration from MCTSBot into a reusable
 * engine-layer function. The bot delegates to this core and applies its own
 * seeded-RNG sampling + wire serialization on top.
 *
 * INVARIANT: args returned here are in-process element OBJECTS, never numeric
 * IDs. The bot's serializeArgs converts them to IDs for its wire format.
 */

import type { Game, Player, ActionDefinition, Selection } from '../index.js';
import { availableActionsForSeat } from '../index.js';
import { resolveMultiSelect } from './resolve-multiselect.js';
import { devWarn } from '../../utils/dev.js';

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Enumerate every concrete legal move available to `seat` in the current game
 * state.
 *
 * Each move is an `{ action, args }` pair where `args` contains in-process
 * element objects (not serialized IDs). Callers that need wire IDs should
 * convert via `serializeValue` from the engine utilities.
 *
 * @param game - Live game instance (must have a flow state with awaitingInput)
 * @param seat - 1-indexed seat number to enumerate moves for
 * @param options.maxPerAction - When provided, truncates results to this many
 *   moves per action name. Default: unlimited (full enumeration).
 *
 * @returns Array of `{ action, args }` pairs (element args are GameElement
 *   objects, not numeric IDs)
 */
export function enumerateLegalMoves(
  game: Game,
  seat: number,
  options?: { maxPerAction?: number },
): Array<{ action: string; args: Record<string, unknown> }> {
  const flowState = game.getFlowState();
  if (!flowState) return [];

  const actionNames = availableActionsForSeat(flowState, seat);
  const player = game.getPlayer(seat);
  if (!player) return [];

  const result: Array<{ action: string; args: Record<string, unknown> }> = [];

  for (const actionName of actionNames) {
    const actionDef = game.getAction(actionName);
    if (!actionDef) continue;

    const combos = enumerateSelectionsCore(game, actionDef, player);

    // Apply maxPerAction truncation only when caller opts in (D-07: full enumeration default)
    const limited =
      options?.maxPerAction !== undefined
        ? combos.slice(0, options.maxPerAction)
        : combos;

    for (const args of limited) {
      result.push({ action: actionName, args });
    }
  }

  return result;
}

// ─── Shared Core (also used by MCTSBot via import) ───────────────────────────

/**
 * Enumerate all valid argument combinations for a single action.
 *
 * Returns an array of args records where each value is an in-process element
 * object (for element/elements selections) or a plain scalar. No serialization
 * is performed here — the bot wrapper applies serializeArgs on the result.
 *
 * @param game - Live game instance
 * @param actionDef - The action definition to enumerate selections for
 * @param player - The player who will perform the action
 * @returns Array of args records with in-process values (NO serialization)
 */
export function enumerateSelectionsCore(
  game: Game,
  actionDef: ActionDefinition,
  player: Player,
): Record<string, unknown>[] {
  if (actionDef.selections.length === 0) {
    return [{}];
  }
  return _enumerateRecursive(game, actionDef, player, 0, {});
}

// ─── Pure Combinatorics Helpers (exported for bot import + testability) ──────

/**
 * Parse a multiSelect config value into { min, max }.
 */
export function parseMultiSelect(multiSelect: unknown): { min: number; max: number } {
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

/**
 * AI-01 / F-08: hard ceiling on how many multiSelect combinations enumeration
 * will ever MATERIALIZE. An unbounded/dynamic multiSelect (e.g.
 * `multiSelect: { min: 1 }`, max defaulting to Infinity) over an N-item choice
 * set is 2^N−1 combinations — N=25 is 33M objects (multi-GB), N=30 hangs/OOMs.
 * The bot samples down to a handful of moves per node ANYWAY, so materializing
 * the full power set first is both a DoS and pointless. Callers that hit the
 * cap get a bounded prefix (and should warn — see `_enumerateRecursive`).
 */
export const MAX_MULTISELECT_COMBINATIONS = 10000;

/**
 * Generate all combinations of `choices` with count in [min, max].
 *
 * `limit` bounds the number of combinations materialized (F-08 combinatorics
 * guard); generation stops as soon as `limit` is reached, returning a bounded
 * prefix rather than exploding on an unbounded multiSelect.
 */
export function generateCombinations(
  choices: unknown[],
  min: number,
  max: number,
  limit: number = MAX_MULTISELECT_COMBINATIONS,
): unknown[][] {
  const results: unknown[][] = [];

  if (min === max) {
    combinationsOfSize(choices, min, [], 0, results, limit);
  } else {
    for (let size = min; size <= Math.min(max, choices.length); size++) {
      if (results.length >= limit) break;
      combinationsOfSize(choices, size, [], 0, results, limit);
    }
  }

  return results;
}

/**
 * Recursive helper: generate all combinations of exactly `size` items from
 * `choices`, stopping once `results` reaches `limit` (F-08).
 */
export function combinationsOfSize(
  choices: unknown[],
  size: number,
  current: unknown[],
  startIndex: number,
  results: unknown[][],
  limit: number = MAX_MULTISELECT_COMBINATIONS,
): void {
  if (results.length >= limit) return;
  if (current.length === size) {
    // Keep element objects as-is — no serialization here
    results.push([...current]);
    return;
  }

  for (let i = startIndex; i < choices.length; i++) {
    if (results.length >= limit) return;
    current.push(choices[i]);
    combinationsOfSize(choices, size, current, i + 1, results, limit);
    current.pop();
  }
}

// ─── Internal recursive engine ────────────────────────────────────────────────

function _enumerateRecursive(
  game: Game,
  actionDef: ActionDefinition,
  player: Player,
  index: number,
  currentArgs: Record<string, unknown>,
): Record<string, unknown>[] {
  if (index >= actionDef.selections.length) {
    // CRITICAL: return plain copy — NO serializeArgs. Callers receive element objects.
    return [{ ...currentArgs }];
  }

  const selection = actionDef.selections[index];
  const choices = _getChoices(game, actionDef.name, selection, player, currentArgs);

  // Text/number inputs cannot be enumerated — skip optional, block required
  if (selection.type === 'text' || selection.type === 'number') {
    if (selection.optional) {
      return _enumerateRecursive(game, actionDef, player, index + 1, currentArgs);
    }
    return [];
  }

  if (choices.length === 0) {
    if (selection.optional) {
      return _enumerateRecursive(game, actionDef, player, index + 1, currentArgs);
    }
    return [];
  }

  const results: Record<string, unknown>[] = [];

  // Resolve static OR function-valued multiSelect through the single shared
  // helper (AI-01 / D9). Concrete config -> real combinations; `undefined`
  // -> single-select below; a thrown error propagates (fail loud, never a
  // silent skip).
  const resolved = resolveMultiSelect(selection, { game, player, args: currentArgs });

  if (resolved) {
    const { min, max } = resolved;
    const combinations = generateCombinations(choices, min, max, MAX_MULTISELECT_COMBINATIONS);

    // F-08: surface the truncation loudly rather than silently searching a
    // partial move set. Hitting the cap means the multiSelect's combinatorics
    // are unbounded/huge relative to the choice set — the game likely wants a
    // tighter `max` so the AI (and UI) enumerate a tractable space.
    if (combinations.length >= MAX_MULTISELECT_COMBINATIONS) {
      devWarn(
        `multiselect-enumeration-capped:${actionDef.name}:${selection.name}`,
        `Enumerating multiSelect "${selection.name}" of action "${actionDef.name}" over ` +
          `${choices.length} choices hit the ${MAX_MULTISELECT_COMBINATIONS}-combination safety cap ` +
          `and was truncated. An unbounded multiSelect (no max, or a very large one) explodes as ` +
          `2^N combinations. Set a tighter multiSelect max so enumeration stays tractable.`,
      );
    }

    for (const combo of combinations) {
      const newArgs = { ...currentArgs, [selection.name]: combo };
      const subResults = _enumerateRecursive(game, actionDef, player, index + 1, newArgs);
      results.push(...subResults);
    }

    return results;
  }

  // Single-select: recurse for each choice
  for (const choice of choices) {
    // Keep element objects in currentArgs so dependent selections receive the
    // real objects (matching the bot's original behavior)
    const newArgs = { ...currentArgs, [selection.name]: choice };
    const subResults = _enumerateRecursive(game, actionDef, player, index + 1, newArgs);
    results.push(...subResults);
  }

  return results;
}

/**
 * Get enabled choices for a selection by calling game.getSelectionChoices.
 * Inlines the bot's former getChoicesForSelection wrapper.
 *
 * A choice whose `value` is `undefined` is DROPPED, loudly. Such a choice is not
 * a usable move: `{...args, [name]: undefined}` serializes to args with the key
 * missing entirely, so the bot emits a move that looks complete, passes every
 * check here, and is then rejected by `performAction` with "Missing required
 * selection: <name>" — an AI seat that stops driving the flow for a reason
 * nothing upstream can see. The usual source is a `choices`/`filter` closure
 * reading state that is REDACTED in the bot's search sandbox (e.g. deriving
 * choices from an opponent's hidden hand), which yields `undefined` fields.
 * Dropping the choice leaves a required selection with none, so the action
 * simply produces no moves — the honest answer — and the warning names the
 * action and selection so the game author can make the choices public-info.
 */
function _getChoices(
  game: Game,
  actionName: string,
  selection: Selection,
  player: Player,
  currentArgs: Record<string, unknown>,
): unknown[] {
  const annotated = game.getSelectionChoices(
    actionName,
    selection.name,
    player as any,
    currentArgs,
  );
  const enabled = annotated.filter(c => c.disabled === false).map(c => c.value);
  const usable = enabled.filter(v => v !== undefined);
  if (usable.length !== enabled.length) {
    devWarn(
      `undefined-choice-value:${actionName}:${selection.name}`,
      `Selection "${selection.name}" of action "${actionName}" offered ` +
        `${enabled.length - usable.length} choice(s) with an undefined value; they were ` +
        `dropped because they cannot form a valid move. This usually means the selection's ` +
        `choices are derived from state the caller cannot see (hidden/redacted information, ` +
        `such as an opponent's hand) — derive them from public information instead.`,
    );
  }
  return usable;
}
