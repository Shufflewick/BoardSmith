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

// Imported from the DEFINING modules, not from `../index.js`.
//
// The package barrel re-exports this file, so importing the barrel from here
// closed a cycle -- and not a harmless one: it was the single edge that all
// THREE of this package's circular-dependency findings routed through
// (`action-metadata -> resolve-multiselect -> enumerate-moves -> index -> ...`
// twice, plus `index -> utils/index -> enumerate-moves -> index`). Breaking it
// here breaks all three, because a barrel import is never load-bearing: every
// name below has exactly one defining module.
import type { Game } from '../element/game.js';
import type { Player } from '../player/player.js';
import type { ActionDefinition, Selection } from '../action/types.js';
import { availableActionsForSeat } from '../flow/seat-activity.js';
import { resolveMultiSelect } from './resolve-multiselect.js';
import { NotSimulableError } from '../errors.js';
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
 * Throws rather than returning `[]` for a bad seat, a non-numeric seat, or a
 * game with no flow state (#26) — an empty enumeration must only ever mean
 * "this seat genuinely has nothing to do", because that is the state a caller
 * acts on by stopping.
 *
 * @param game - Live game instance (must have a flow state with awaitingInput)
 * @param seat - 1-indexed seat NUMBER (`player.seat`), not a `Player` object
 * @param options.maxPerAction - When provided, truncates results to this many
 *   moves per action name. Default: unlimited (full enumeration).
 *
 * @returns Array of `{ action, args }` pairs (element args are GameElement
 *   objects, not numeric IDs)
 */
/**
 * Resolve the seat an enumeration was asked for, or say why it cannot be.
 *
 * Every refusal here is a THROW, never an empty array (#26). "This seat has no
 * legal moves" is the one answer that stops a bot pump and wedges a
 * simultaneous round for every seat at the table, so it must never also be how
 * a bad argument or an unstarted game reports itself. A `Player` object handed
 * in where a seat number belongs used to match nothing and come back as `[]`,
 * indistinguishable from a correctly built game with nothing to do.
 */
function resolveSeat(game: Game, seat: number): { player: Player; flowState: NonNullable<ReturnType<Game['getFlowState']>> } {
  if (typeof seat !== 'number' || !Number.isInteger(seat)) {
    throw new TypeError(
      `enumerateLegalMoves expects a seat number, got ${typeof seat === 'object' ? 'an object' : typeof seat}. ` +
      `Seats are 1-indexed integers — pass player.seat, not the Player itself.`
    );
  }
  if (seat < 1) {
    throw new RangeError(
      `enumerateLegalMoves: seat ${seat} is out of range. Seats are 1-indexed, so the first seat is 1.`
    );
  }

  const flowState = game.getFlowState();
  if (!flowState) {
    throw new Error(
      'enumerateLegalMoves: the game has no flow state, so there is nothing to enumerate. ' +
      'Start the game (GameRunner#start, or game.startFlow()) before asking for legal moves.'
    );
  }

  const player = game.getPlayer(seat);
  if (!player) {
    throw new RangeError(
      `enumerateLegalMoves: there is no seat ${seat} in this game (it has ${game.players.length}). ` +
      `Seats are 1-indexed.`
    );
  }

  return { player, flowState };
}

export function enumerateLegalMoves(
  game: Game,
  seat: number,
  options?: { maxPerAction?: number },
): Array<{ action: string; args: Record<string, unknown> }> {
  const { player, flowState } = resolveSeat(game, seat);

  const actionNames = availableActionsForSeat(flowState, seat);

  const result: Array<{ action: string; args: Record<string, unknown> }> = [];

  for (const actionName of actionNames) {
    const actionDef = game.getAction(actionName);
    if (!actionDef) continue;

    for (const args of enumerateActionMoves(game, actionDef, player, options)) {
      result.push({ action: actionName, args });
    }
  }

  return result;
}

/**
 * Every legal set of args for ONE action, with every gate the game can write
 * already applied.
 *
 * This is the single enumerator. `enumerateLegalMoves` loops it over a seat's
 * available actions; `MCTSBot` loops it over the actions the flow is awaiting
 * and then serializes and samples what comes back. Two loops, one set of
 * rules — a bot must never be able to reach a move that
 * `enumerateLegalMoves` would refuse, which is exactly what happened while the
 * bot had an enumerator of its own (#19).
 *
 * @param options.maxPerAction - Truncate to this many arg sets. Default:
 *   unlimited (full enumeration).
 */
export function enumerateActionMoves(
  game: Game,
  actionDef: ActionDefinition,
  player: Player,
  options?: { maxPerAction?: number },
): Record<string, unknown>[] {
  const executor = game.getActionExecutor();

  try {
    // #19: an action list comes from the flow state's FROZEN `availableActions`,
    // computed once on the authoritative game when the step opened and replayed
    // verbatim — into a bot's redacted sandbox, and into a game whose state has
    // moved on since. Re-check the action's own `condition` against the game as
    // it stands: without this, a `choices` closure the condition was written to
    // guard runs anyway, and the reporting game's threw outright.
    if (actionDef.condition && !executor.isActionAvailable(actionDef, player)) {
      return [];
    }

    const combos = enumerateSelections(game, actionDef, player);

    // #19: an action-level `.validate()` refuses a SUBMISSION, and enumeration
    // never called it — so a bot enumerated moves the engine then rejected, and
    // the pump halted on the rejection with the round never closing for any
    // seat. Every move handed back must be one `performAction` would accept.
    const legal = actionDef.validate
      ? combos.filter((args) => executor.validateAction(actionDef, player, args).valid)
      : combos;

    // Apply maxPerAction truncation only when caller opts in (D-07: full enumeration default)
    return options?.maxPerAction !== undefined ? legal.slice(0, options.maxPerAction) : legal;
  } catch (error) {
    // #19: this game is a REDACTED clone (a bot's search sandbox) and one of
    // the action's gates needed a value the clone was never told. There is no
    // legal move to be had here: the honest answer is that this action cannot
    // be enumerated from what this copy knows, and inventing one would score a
    // world that does not exist. Anything else propagates — a rule that
    // crashes is still a bug and still fails loud.
    if (!(error instanceof NotSimulableError)) throw error;
    devWarn(
      `redacted-enumeration-skip:${actionDef.name}:${player.seat}`,
      `Action "${actionDef.name}" contributed no moves for seat ${player.seat} because a rule it ` +
        `runs read information this copy of the game does not have: ${error.message.split('\n')[0]} ` +
        `This is expected inside a bot's search sandbox for a seat other than its own. If this ` +
        `action should be searchable there, derive its condition, choices, disabled and validate ` +
        `from public information, or check element.isAttributeRedacted(key) before reading.`,
    );
    return [];
  }
}

// ─── Selection combinatorics ─────────────────────────────────────────────────

/**
 * Every combination of selection values for one action, gates aside.
 *
 * Module-private: the combinatorics alone are not a legal move set (they see
 * `choices`/`disabled` but neither `condition` nor `validate`), and a caller
 * that reached them directly is how the bot came to search moves the engine
 * then refused. `enumerateActionMoves` is the way in.
 *
 * Values are in-process element objects (for element/elements selections) or
 * plain scalars — no serialization.
 */
function enumerateSelections(
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
 * bot-01 / F-08: hard ceiling on how many multiSelect combinations enumeration
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
// Module-private. Its docblock used to say "exported for bot import +
// testability"; nothing outside this file has ever imported it (no bot, no
// test, only the barrel re-export), so the export was the stale half of that
// sentence rather than a contract.
function combinationsOfSize(
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
  // helper (bot-01 / D9). Concrete config -> real combinations; `undefined`
  // -> single-select below; a thrown error propagates (fail loud, never a
  // silent skip).
  const resolved = resolveMultiSelect(selection, { game, player, args: currentArgs });

  if (resolved) {
    const { min, max } = resolved;
    const combinations = generateCombinations(choices, min, max, MAX_MULTISELECT_COMBINATIONS);

    // F-08: surface the truncation loudly rather than silently searching a
    // partial move set. Hitting the cap means the multiSelect's combinatorics
    // are unbounded/huge relative to the choice set — the game likely wants a
    // tighter `max` so the bot (and UI) enumerate a tractable space.
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
 * selection: <name>" — a bot seat that stops driving the flow for a reason
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
    player,
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
