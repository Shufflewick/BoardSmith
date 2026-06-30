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
 * Generate all combinations of `choices` with count in [min, max].
 */
export function generateCombinations(
  choices: unknown[],
  min: number,
  max: number,
): unknown[][] {
  const results: unknown[][] = [];

  if (min === max) {
    combinationsOfSize(choices, min, [], 0, results);
  } else {
    for (let size = min; size <= Math.min(max, choices.length); size++) {
      combinationsOfSize(choices, size, [], 0, results);
    }
  }

  return results;
}

/**
 * Recursive helper: generate all combinations of exactly `size` items from `choices`.
 */
export function combinationsOfSize(
  choices: unknown[],
  size: number,
  current: unknown[],
  startIndex: number,
  results: unknown[][],
): void {
  if (current.length === size) {
    // Keep element objects as-is — no serialization here
    results.push([...current]);
    return;
  }

  for (let i = startIndex; i < choices.length; i++) {
    current.push(choices[i]);
    combinationsOfSize(choices, size, current, i + 1, results);
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

  // Dynamic multiSelect (function-based) cannot be statically enumerated.
  // Treat it like an unenumerable selection: skip if optional, block if required.
  // (buildPickMetadata already acknowledges this case for the metadata path.)
  const multiSelect = (selection as any).multiSelect;
  if (typeof multiSelect === 'function') {
    devWarn(
      `enumerate-moves:dynamic-multiselect:${actionDef.name}:${selection.name}`,
      `enumerateLegalMoves: selection "${selection.name}" on action "${actionDef.name}" ` +
      `uses a function-based multiSelect which cannot be statically enumerated. ` +
      `This selection will be skipped during enumeration. ` +
      `Consider using a static multiSelect config, or handle this action via the /selection-choices endpoint.`,
    );
    if (selection.optional) {
      return _enumerateRecursive(game, actionDef, player, index + 1, currentArgs);
    }
    return [];
  }

  if (multiSelect) {
    const { min, max } = parseMultiSelect(multiSelect);
    const combinations = generateCombinations(choices, min, max);

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
  return annotated.filter(c => c.disabled === false).map(c => c.value);
}
