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
import { constructGame, type Game, type GameOptions } from '../element/game.js';
import type { Player } from '../player/player.js';
import type { ActionDefinition, FollowUpAction, NumberSelection, PendingActionState, Selection } from '../action/types.js';
import { availableActionsForSeat, followUpForSeat } from '../flow/seat-activity.js';
import { resolveMultiSelect, resolveOrderedList } from './resolve-multiselect.js';
import { elementsAsIds } from './arg-builder.js';
import { isElement } from '../element/game-element.js';
import { numberRangeValues } from '../action/number-labels.js';
import { choiceValueKey } from '../action/choice-matching.js';
import { MoveListTooLargeError, NotSimulableError } from '../errors.js';
import { devWarn } from '../../utils/dev.js';
import type { SeededRandom } from '../../utils/random.js';

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Enumerate every concrete legal move available to `seat` in the current game
 * state.
 *
 * Each move is an `{ action, args }` pair where `args` contains in-process
 * element objects (not serialized IDs). Callers that need JSON-safe args
 * should convert via `buildActionArgs(..., { format: 'wire' })`.
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
 * @throws MoveListTooLargeError when one action has more moves than enumeration
 *   lists (see `ActionWalk`), rather than return a list that is not all of
 *   them (#691). `maxPerAction` truncates a complete list, so it does not
 *   lift that budget. The budget covers every selection, a multiSelect's
 *   combinations and a repeating selection's picks included (#692).
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

  // The seat's held follow-up is one of its moves too, and while the step
  // offers it nothing else, its only one.
  const followUp = followUpForSeat(flowState, seat);
  const followUpDef = followUp && game.getAction(followUp.action);
  if (followUp && followUpDef) {
    for (const args of enumerateActionMoves(game, followUpDef, player, { ...options, followUp })) {
      result.push({ action: followUp.action, args });
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
 * @param options.followUp - The seat's held follow-up naming this action: its
 *   args are bound while the moves are found, and its condition is not checked
 *   (the chain offers it, not the condition). A move carries only picks, as a
 *   seat submits it: the engine binds the follow-up's other args when it runs
 *   (#662).
 * @param options.sampleAboveBudget - For a caller that samples the moves
 *   anyway (the MCTS bot): an action with more moves than enumeration lists
 *   (see {@link ActionWalk}) gives `count` of them drawn with `random` instead
 *   of throwing {@link MoveListTooLargeError}. An action within the budget
 *   still gives every move.
 */
export function enumerateActionMoves(
  game: Game,
  actionDef: ActionDefinition,
  player: Player,
  options: {
    maxPerAction?: number;
    followUp?: FollowUpAction;
    sampleAboveBudget?: { count: number; random: SeededRandom };
  } = {},
): Record<string, unknown>[] {
  const executor = game.getActionExecutor();
  const { followUp, maxPerAction, sampleAboveBudget } = options;
  if (followUp && followUp.action !== actionDef.name) {
    throw new Error(
      `enumerateActionMoves was given follow-up '${followUp.action}' for action '${actionDef.name}'. ` +
        `Pass the follow-up with the action it names.`,
    );
  }
  const bound = followUp?.args ?? {};

  try {
    // #690: an action the game refuses outright (its own `.disabled()` rule or
    // the tutorial gate) stays offered so the panel can grey it out, but
    // performAction refuses it, so it has no moves. A held follow-up too.
    if (game.getActionRefusalReason(actionDef, player)) return [];

    // #19: an action list comes from the flow state's FROZEN `availableActions`,
    // computed once on the authoritative game when the step opened and replayed
    // verbatim — into a bot's redacted sandbox, and into a game whose state has
    // moved on since. Re-check the action's own `condition` against the game as
    // it stands: without this, a `choices` closure the condition was written to
    // guard runs anyway, and the reporting game's threw outright.
    if (!followUp && actionDef.condition && !executor.isActionAvailable(actionDef, player)) {
      return [];
    }

    // #325: a repeating selection's picks change the game (`onEach`) while
    // they are being made, so its moves can only be found by making them.
    const legal = executor.hasRepeatingSelections(actionDef)
      ? enumerateThroughSelectionSteps(game, actionDef, player, bound, sampleAboveBudget)
      : enumerateGatedSelections(game, actionDef, player, bound, followUp, sampleAboveBudget);
    const moves = legal.map((args) => executor.picksOf(actionDef, args));

    // Apply maxPerAction truncation only when caller opts in (D-07: full enumeration default)
    return maxPerAction !== undefined ? moves.slice(0, maxPerAction) : moves;
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

/**
 * Every combination of selection values that also passes the action-level
 * `validate` gate, or, above the budget, `sample.count` of them drawn at random
 * when the caller asked for a sample (#691).
 */
function enumerateGatedSelections(
  game: Game,
  actionDef: ActionDefinition,
  player: Player,
  bound: Record<string, unknown>,
  followUp: FollowUpAction | undefined,
  sample: { count: number; random: SeededRandom } | undefined,
): Record<string, unknown>[] {
  const executor = game.getActionExecutor();
  // Every pre-filled key is an answered pick, a `null` (skipped) one included:
  // resolveArgs drops a null pick (#627), and the runner binds it back when the
  // follow-up runs, so it is laid back under the resolved values here.
  const resolved = executor.resolveArgs(actionDef, bound, player);
  const start = { ...bound, ...resolved };
  // #19: an action-level `.validate()` refuses a SUBMISSION, and enumeration
  // never called it — so a bot enumerated moves the engine then rejected, and
  // the pump halted on the rejection with the round never closing for any
  // seat. Every move handed back must be one `performAction` would accept.
  // A pick's own `validate` refuses a submission the same way (#768).
  const gated = !!actionDef.validate || actionDef.selections.some((s) => s.validate);
  const accepts = (args: Record<string, unknown>) =>
    !gated
    || executor.validateAction(actionDef, player, argsCallbacksSee(actionDef, args), { followUp }).valid;
  try {
    return enumerateSelections(game, actionDef, player, start, { left: MAX_MULTISELECT_COMBINATIONS }).filter(accepts);
  } catch (error) {
    if (!(error instanceof MoveListTooLargeError) || !sample) throw error;
    return sampleSelections(game, actionDef, player, start, sample, accepts);
  }
}

/**
 * `sample.count` moves of an action with more moves than enumeration lists,
 * each found by picking every selection's value with the caller's own random
 * source (#691), so a seeded bot draws the same moves every time. Each pick is
 * uniform over the values that selection offers at that point, which makes the
 * move uniform when the selections are independent; when a later selection's
 * values depend on earlier picks, a move under a narrower branch is likelier.
 * Uniform over every move would need each branch's size, which is the count
 * the budget exists not to take. Two draws can be the same move.
 *
 * A draw follows one path, judging each selection on it once, so it is no
 * product and needs no budget of its own. The sample makes at most 2 draws per
 * move asked for: a rule may refuse half the draws and the sample still fills,
 * and an action whose rules refuse most random paths gets fewer moves (the
 * warning says how many) for the price of `2 * count` paths. That bound is
 * what a bot pays at every expansion and playout step that offers the action,
 * so it is kept to paths rather than to the full walk's budget: redrawing
 * until that budget was spent many times over made a dead-end action cost
 * about 21 full walks each time. A path is as dear as its selections' offers,
 * so an action whose first selection offers 10,000 values still costs that
 * per draw.
 */
function sampleSelections(
  game: Game,
  actionDef: ActionDefinition,
  player: Player,
  start: Record<string, unknown>,
  sample: { count: number; random: SeededRandom },
  accepts: (args: Record<string, unknown>) => boolean,
): Record<string, unknown>[] {
  const walk: ActionWalk = { left: Infinity, random: sample.random };
  const moves: Record<string, unknown>[] = [];
  for (let draw = 0; draw < 2 * sample.count && moves.length < sample.count; draw++) {
    moves.push(...enumerateSelections(game, actionDef, player, start, walk).filter(accepts));
  }
  warnSampled(actionDef, moves.length);
  return moves;
}

/** Says once, in development, that an action's moves are a sample. */
function warnSampled(actionDef: ActionDefinition, count: number): void {
  devWarn(
    `move-list-sampled:${actionDef.name}`,
    `Action "${actionDef.name}" has more moves than enumeration lists (it tries at most ` +
      `${BUDGET_TEXT} values for one action), so only ${count} of them, drawn at random, are offered ` +
      `instead of every one. Narrow the choices or ranges of its selections, or split it ` +
      `into two actions, so every move can be weighed.`,
  );
}

/**
 * The args a rule callback (`choices`, `disabled`, `multiSelect`, `validate`)
 * is shown for a move, as execution shows them: a skipped (`null`) pick is
 * absent (#627, #648, #659). The move itself keeps the `null`, which the runner
 * binds back when a follow-up runs.
 */
function argsCallbacksSee(actionDef: ActionDefinition, args: Record<string, unknown>): Record<string, unknown> {
  const seen = { ...args };
  for (const selection of actionDef.selections) {
    if (seen[selection.name] === null) delete seen[selection.name];
  }
  return seen;
}

// ─── Repeating selections ────────────────────────────────────────────────────

/** One answer on the way to a move, in a form that survives a tree rebuild. */
interface EnumerationStep {
  selection: Selection;
  /** Element objects are held as `{ id, className }`, never as live objects. */
  value: unknown;
}

/**
 * Every legal move of an action that has a repeating selection, found by
 * making its picks on a scratch copy of the game (#325), or, above the budget,
 * `sample.count` of them drawn at random when the caller asked for a sample.
 *
 * A repeat's value is its picks in order, ending with the one that ends it, and
 * what each pick may be depends on what the previous pick's `onEach` did. So
 * the moves are found through the executor's own selection steps
 * (`processSelectionStep`, `processRepeatingStep`), the same ones a whole
 * submission and a player's picks go through, and never on the game that was
 * asked about: its state is untouched. Moves are breadth-first, shortest first.
 *
 * The walk spends the same budget as any other ({@link ActionWalk}): each
 * value a partial move's next selection judges is counted before the partial
 * moves it leads to are built, and each pick a partial move replays to reach
 * where it stands is counted before it is replayed. So the picks made and the
 * values judged together stay within the budget, however deep the repeat: a
 * partial move of 100 picks costs 100. A repeat whose picks rarely end it is
 * an unbounded space, and it throws {@link MoveListTooLargeError} rather than
 * offer only its shortest moves.
 */
function enumerateThroughSelectionSteps(
  game: Game,
  actionDef: ActionDefinition,
  player: Player,
  bound: Record<string, unknown>,
  sample: { count: number; random: SeededRandom } | undefined,
): Record<string, unknown>[] {
  const scratch = scratchCopy(game);
  try {
    return listSelectionSteps(game, scratch, actionDef, player, bound);
  } catch (error) {
    if (!(error instanceof MoveListTooLargeError) || !sample) throw error;
    return sampleThroughSelectionSteps(game, scratch, actionDef, player, bound, sample);
  }
}

/** The breadth-first walk of {@link enumerateThroughSelectionSteps}, on one budget. */
function listSelectionSteps(
  game: Game,
  scratch: ReturnType<typeof scratchCopy>,
  actionDef: ActionDefinition,
  player: Player,
  bound: Record<string, unknown>,
): Record<string, unknown>[] {
  const walk: ActionWalk = { left: MAX_MULTISELECT_COMBINATIONS };
  const moves: Record<string, unknown>[] = [];
  const queue: EnumerationStep[][] = [[]];
  // An index, not shift(): the queue holds up to the budget's partial moves.
  for (let next = 0; next < queue.length; next++) {
    const steps = queue[next];
    if (steps.length > 0) charge(walk, actionDef, steps[steps.length - 1].selection, steps.length);
    // A value the selection offered can still be refused by its own
    // `validate`: that path is simply not a move.
    const at = scratch.replay(actionDef.name, player.seat, steps, bound);
    if (!at) continue;
    const step = nextStep(scratch.game, actionDef, at, walk);
    if ('accepted' in step) {
      if (step.accepted) moves.push({ ...bound, ...liveArgs(game, steps) });
      continue;
    }
    for (const value of step.values) {
      queue.push([...steps, { selection: step.selection, value: holdElements(value) }]);
    }
  }
  return moves;
}

/**
 * `sample.count` moves of an action with a repeating selection and more moves
 * than enumeration lists, each drawn by making one pick at a time, chosen with
 * the caller's own random source, until the move is complete, so a seeded bot
 * draws the same moves every time. As in {@link sampleSelections}, each pick is
 * uniform over what is offered at that point, and the sample makes at most 2
 * draws per move asked for. A draw makes its picks one after another on the
 * scratch copy, never replaying them, so its picks are bounded by the values it
 * judges. A repeat's draw has no fixed length, so the whole sample also spends
 * one budget of values judged, and a sample that spends it keeps the moves
 * drawn so far: none, for a repeat that never ends.
 */
function sampleThroughSelectionSteps(
  game: Game,
  scratch: ReturnType<typeof scratchCopy>,
  actionDef: ActionDefinition,
  player: Player,
  bound: Record<string, unknown>,
  sample: { count: number; random: SeededRandom },
): Record<string, unknown>[] {
  const walk: ActionWalk = { left: MAX_MULTISELECT_COMBINATIONS, random: sample.random };
  const moves: Record<string, unknown>[] = [];
  try {
    for (let draw = 0; draw < 2 * sample.count && moves.length < sample.count; draw++) {
      const steps = drawSelectionSteps(scratch, actionDef, player, bound, walk);
      if (steps) moves.push({ ...bound, ...liveArgs(game, steps) });
    }
  } catch (error) {
    if (!(error instanceof MoveListTooLargeError)) throw error;
  }
  warnSampled(actionDef, moves.length);
  return moves;
}

/** The picks of one move drawn with `walk.random`, or `null` when the rules refuse where the draw led. */
function drawSelectionSteps(
  scratch: ReturnType<typeof scratchCopy>,
  actionDef: ActionDefinition,
  player: Player,
  bound: Record<string, unknown>,
  walk: ActionWalk,
): EnumerationStep[] | null {
  const at = scratch.start(actionDef.name, player.seat, bound);
  const steps: EnumerationStep[] = [];
  for (;;) {
    const step = nextStep(scratch.game, actionDef, at, walk);
    if ('accepted' in step) return step.accepted ? steps : null;
    if (step.values.length === 0) return null;
    const pick = { selection: step.selection, value: holdElements(step.values[0]) };
    if (!scratch.apply(at, pick)) return null;
    steps.push(pick);
  }
}

/**
 * Where a pending action stands: complete, and whether its rules accept the
 * move, or the next selection and the values `walk` tries for it, charged to
 * the walk as {@link spend} charges any selection. An optional selection with
 * nothing to offer is skipped (`null`).
 */
function nextStep(
  game: Game,
  actionDef: ActionDefinition,
  { action, seatPlayer, pending }: PendingAt,
  walk: ActionWalk,
): { accepted: boolean } | { selection: Selection; values: unknown[] } {
  const executor = game.getActionExecutor();
  if (executor.isPendingActionComplete(action, pending)) {
    return { accepted: executor.pendingActionRefusal(action, seatPlayer, pending) === null };
  }
  const selection = action.selections[pending.currentSelectionIndex];
  if (executor.isRepeatingSelection(selection)) {
    const candidates = executor.repeatingPickCandidates(action, seatPlayer, pending);
    return { selection, values: spend(walk, actionDef, selection, { values: candidates, judged: candidates.length }) ?? [] };
  }
  const args = executor.resolveArgs(action, pending.collectedArgs, seatPlayer);
  const offer = selectionValues(game, action, seatPlayer, selection, args, walk.random);
  const tried = spend(walk, actionDef, selection, offer);
  return { selection, values: tried?.length ? tried : selection.optional ? [null] : [] };
}

/**
 * A move's args bound to the LIVE game's own objects: element references are
 * looked up there by id, and a repeating selection's value is its picks as an
 * array. A skipped optional selection is left out, as a player's skip is.
 */
function liveArgs(game: Game, steps: EnumerationStep[]): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const executor = game.getActionExecutor();
  for (const { selection, value } of steps) {
    if (value === null) continue;
    if (executor.isRepeatingSelection(selection)) {
      const picks = (args[selection.name] as unknown[] | undefined) ?? [];
      const isElementPick = selection.type === 'element' || selection.type === 'elements';
      picks.push(isElementPick ? liveElement(game, selection, { id: value as number }) : liveValue(game, selection, value));
      args[selection.name] = picks;
    } else {
      args[selection.name] = liveValue(game, selection, value);
    }
  }
  return args;
}

/** The references {@link holdElements} made, so a plain choice of the same `{ id, className }` shape is never taken for an element (#774). */
const heldElements = new WeakSet<object>();

/** A pick's value with each element held as an `{ id, className }` reference, which survives a tree rebuild. */
function holdElements(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(holdElements);
  if (!isElement(value)) return value;
  const ref = elementsAsIds(value) as object;
  heldElements.add(ref);
  return ref;
}

function liveValue(game: Game, selection: Selection, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => liveValue(game, selection, v));
  if (typeof value === 'object' && value !== null && heldElements.has(value)) {
    return liveElement(game, selection, value as { id: number });
  }
  return value;
}

function liveElement(game: Game, selection: Selection, ref: { id: number }): unknown {
  const element = game.getElementById(ref.id);
  if (!element) {
    throw new Error(
      `Enumerating moves for "${selection.name}" reached element ${ref.id}, which this game does not ` +
        `have: an earlier pick's onEach created it. A move cannot name an element that exists only ` +
        `after part of the move has run. Offer an element that already exists, or split the action ` +
        `in two so the created element is chosen by the second.`,
    );
  }
  return element;
}

/**
 * An independent copy of a game that can be put back, tree and flow, to the
 * moment it was copied, for trying picks whose callbacks change the game. The
 * flow is restored with the tree so it holds that tree's elements (#682).
 */
function scratchCopy(source: Game) {
  const GameClass = source.constructor as new (options: GameOptions) => Game;
  const game = constructGame(GameClass, source.getConstructorOptions() as GameOptions);
  const state = source.toJSON();
  const messageLog = source.serializeMessageLog();
  const sequence = source._ctx.sequence;
  const randomState = source.getRandomState();
  const flowState = source.getFlowState();

  const reset = (): void => {
    game.loadSerializedState(state, { messageLog });
    game._ctx.sequence = sequence;
    game.setRandomState(randomState);
    if (flowState) game.restoreFlowState(flowState);
  };

  /** Put the copy back and open the action for `seat`, with no picks made. */
  const start = (actionName: string, seat: number, bound: Record<string, unknown>): PendingAt => {
    reset();
    const action = game.getAction(actionName)!;
    const pending = game.getActionExecutor().createPendingActionState(actionName, seat);
    // A follow-up's pre-filled args, as a seat's pending follow-up starts.
    Object.assign(pending.collectedArgs, bound);
    while (
      pending.currentSelectionIndex < action.selections.length
      && Object.prototype.hasOwnProperty.call(bound, action.selections[pending.currentSelectionIndex].name)
    ) {
      pending.currentSelectionIndex++;
    }
    return { action, seatPlayer: game.getPlayer(seat)!, pending };
  };

  /** Make one pick as a player would; `false` if it was refused. */
  const apply = ({ action, seatPlayer, pending }: PendingAt, { selection, value }: EnumerationStep): boolean => {
    const executor = game.getActionExecutor();
    if (executor.isRepeatingSelection(selection)) {
      return !executor.processRepeatingStep(action, seatPlayer, pending, value).error;
    }
    return executor.processSelectionStep(action, seatPlayer, pending, selection.name, value).success;
  };

  return {
    game,
    start,
    apply,
    /**
     * Put the copy back, then make `steps` as a player would. Returns where
     * that left the pending action, or `null` if a step was refused.
     */
    replay(actionName: string, seat: number, steps: EnumerationStep[], bound: Record<string, unknown>): PendingAt | null {
      const at = start(actionName, seat, bound);
      return steps.every((step) => apply(at, step)) ? at : null;
    },
  };
}

/** A pending action on a scratch copy, and the seat making it. */
interface PendingAt {
  action: ActionDefinition;
  seatPlayer: Player;
  pending: PendingActionState;
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
  bound: Record<string, unknown>,
  walk: ActionWalk,
): Record<string, unknown>[] {
  if (actionDef.selections.length === 0) {
    return [{ ...bound }];
  }
  return _enumerateRecursive(game, actionDef, player, 0, { ...bound }, walk);
}

/**
 * One walk over an action's selections, and the budget it walks within (#691).
 *
 * Each selection is capped on its own (a multiSelect's combinations, a number
 * input's range), but an action's moves are the PRODUCT of its selections:
 * 13 number inputs of 1 to 7 are 7^13, about 97 billion. So one walk tries at
 * most {@link MAX_MULTISELECT_COMBINATIONS} values: each value of each
 * selection, under every pick before it, counted when the selection's rules
 * judge it, whether they accept it or not. A partial move counts as well as a
 * finished one, and a refused value as well as an offered one, because a
 * selection late in the action can refuse every value (a total the last input
 * must make exact): a walk that counted only finished moves would visit 7^12
 * partial ones to find none. So the rules run at most this many times plus one
 * selection's worth, the count is checked BEFORE a selection's arg sets are
 * built, and going over builds nothing. (An element selection's `filter` over
 * the game's elements runs inside the choices and is not counted; it is
 * bounded by the size of the game, not by the product.) The ceiling is the
 * per-selection one because it already answers the same question: how much
 * one action may cost to list, when a bot samples 20 and greedy scores each.
 *
 * A multiSelect counts each of its combinations, and is refused before any
 * is built when they are more than the budget (#692). An action with a
 * repeating selection is walked through {@link enumerateThroughSelectionSteps}
 * on the same budget, each partial move's next values and replayed picks
 * counted.
 *
 * Going over throws {@link MoveListTooLargeError}, which `enumerateLegalMoves`
 * and greedy pass on rather than cut the list short. A caller that samples
 * anyway (the MCTS bot, random play) walks again with `random` choosing one
 * value per selection (see {@link sampleSelections} and
 * {@link sampleThroughSelectionSteps}).
 */
interface ActionWalk {
  /** Values this walk may still try. */
  left: number;
  /** When present, the walk tries one value per selection, drawn with this. */
  random?: SeededRandom;
}

function tooManyMoves(actionDef: ActionDefinition, selection: Selection): MoveListTooLargeError {
  const { repeat, repeatUntil } = selection as { repeat?: unknown; repeatUntil?: unknown };
  const advice = repeat !== undefined || repeatUntil !== undefined
    ? 'Give its `until` a pick that ends it sooner, or offer fewer choices per pick.'
    : 'Narrow the choices or ranges of its selections, or split it into two actions.';
  return new MoveListTooLargeError(
    `Action "${actionDef.name}" has too many moves to list: its selections multiply past the ` +
      `${BUDGET_TEXT} values enumeration tries for one action (each value of each selection, under every ` +
      `pick before it, refused ones too), and the count crossed it at selection "${selection.name}". ${advice}`,
  );
}

// ─── Pure Combinatorics Helpers (exported for bot import + testability) ──────

/**
 * bot-01 / F-08: hard ceiling on how many multiSelect combinations enumeration
 * will ever MATERIALIZE. An unbounded/dynamic multiSelect (e.g.
 * `multiSelect: { min: 1 }`, max defaulting to Infinity) over an N-item choice
 * set is 2^N−1 combinations — N=25 is 33M objects (multi-GB), N=30 hangs/OOMs.
 * The bot samples down to a handful of moves per node ANYWAY, so materializing
 * the full power set first is both a DoS and pointless. It is also
 * enumeration's budget for one action (see `ActionWalk`): a multiSelect with
 * more combinations than this is refused before any is built (#692). A number
 * input with more values than this is not listed (#689, see
 * `numberInputValues`).
 */
export const MAX_MULTISELECT_COMBINATIONS = 10000;

/** That ceiling as the docs and messages write it. */
const BUDGET_TEXT = MAX_MULTISELECT_COMBINATIONS.toLocaleString('en-US');

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
  const { grouped, keys } = groupEqualChoices(choices);

  if (min === max) {
    combinationsOfSize(grouped, keys, min, [], 0, results, limit);
  } else {
    for (let size = min; size <= Math.min(max, choices.length); size++) {
      if (results.length >= limit) break;
      combinationsOfSize(grouped, keys, size, [], 0, results, limit);
    }
  }

  return results;
}

/**
 * `choices` with equal values side by side, and each one's identity: an
 * element by itself, any other value by `choiceValueKey`. Combinations skip a
 * repeat of the value just tried, so each combination of values is listed once (#776).
 */
function groupEqualChoices(choices: unknown[]): { grouped: unknown[]; keys: unknown[] } {
  const groups = new Map<unknown, unknown[]>();
  for (const choice of choices) {
    const key = isElement(choice) ? choice : choiceValueKey(choice);
    const group = groups.get(key);
    if (group) group.push(choice);
    else groups.set(key, [choice]);
  }
  const entries = [...groups.entries()];
  return {
    grouped: entries.flatMap(([, group]) => group),
    keys: entries.flatMap(([key, group]) => group.map(() => key)),
  };
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
  keys: unknown[],
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
    if (i > startIndex && keys[i] === keys[i - 1]) continue;
    current.push(choices[i]);
    combinationsOfSize(choices, keys, size, current, i + 1, results, limit);
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
  walk: ActionWalk,
): Record<string, unknown>[] {
  if (index >= actionDef.selections.length) {
    // CRITICAL: return plain copy — NO serializeArgs. Callers receive element objects.
    return [{ ...currentArgs }];
  }

  const selection = actionDef.selections[index];
  // Already bound (a follow-up's pre-filled arg): not a question to enumerate.
  if (Object.prototype.hasOwnProperty.call(currentArgs, selection.name)) {
    return _enumerateRecursive(game, actionDef, player, index + 1, currentArgs, walk);
  }
  const seen = argsCallbacksSee(actionDef, currentArgs);
  const tried = spend(walk, actionDef, selection, selectionValues(game, actionDef, player, selection, seen, walk.random));

  // Nothing to offer (no enabled choice, a text input, a number input that
  // cannot be listed, a multiSelect with fewer candidates than its min): skip
  // an optional selection, block a required one.
  if (tried === null || tried.length === 0) {
    if (selection.optional) {
      return _enumerateRecursive(game, actionDef, player, index + 1, currentArgs, walk);
    }
    return [];
  }

  // ONE LOOP, over whatever this selection's shape says its candidate VALUES
  // are: a scalar choice, a multiSelect combination, an ordered list, or a
  // number. They used to be copies of this recursion, which is how another
  // shape would have arrived with its own subtly different one.
  const results: Record<string, unknown>[] = [];
  for (const value of tried) {
    // Element objects stay in currentArgs so dependent selections receive the
    // real objects (matching the bot's original behavior).
    const newArgs = { ...currentArgs, [selection.name]: value };
    results.push(..._enumerateRecursive(game, actionDef, player, index + 1, newArgs, walk));
  }
  return results;
}

/**
 * Charge a walk for what one selection judged, before any arg set is built
 * (#691), and return the values it will try: all it offers, or one drawn
 * with `walk.random`.
 */
function spend(
  walk: ActionWalk,
  actionDef: ActionDefinition,
  selection: Selection,
  offer: SelectionOffer,
): unknown[] | null {
  charge(walk, actionDef, selection, offer.judged);
  if (offer.values === null || !walk.random) return offer.values;
  return offer.values.length > 0 ? [walk.random.pick(offer.values)] : [];
}

/** Take `judged` values from the walk's budget, or throw when it has fewer left. */
function charge(walk: ActionWalk, actionDef: ActionDefinition, selection: Selection, judged: number): void {
  if (judged > walk.left) throw tooManyMoves(actionDef, selection);
  walk.left -= judged;
}

/**
 * What a selection offers a move: its values, or `null` when it offers none,
 * and how many values its rules judged to find them, refused ones included,
 * so never fewer than it offers.
 */
interface SelectionOffer<T = unknown> {
  values: T[] | null;
  judged: number;
}

/**
 * The values both enumeration paths try for one selection, or `null` when it
 * has nothing to offer (an empty list means the same): no enabled choice, a text input, or a number input
 * with no value to offer (see {@link numberInputPicks}). With `random` (a
 * sampling walk), a multiSelect offers one combination drawn with it.
 */
function selectionValues(
  game: Game,
  actionDef: ActionDefinition,
  player: Player,
  selection: Selection,
  seen: Record<string, unknown>,
  random: SeededRandom | undefined,
): SelectionOffer {
  if (selection.type === 'text') return { values: null, judged: 0 };
  if (selection.type === 'number') return numberInputPicks(game, actionDef, player, selection, seen);
  const choices = _getChoices(game, actionDef.name, selection, player, seen);
  if (choices.values.length === 0) return { values: null, judged: choices.judged };
  return _valuesToTry(game, player, selection, choices, seen, random);
}

/**
 * The values a number input offers a move (#689), or `null` when it offers
 * none: it cannot be listed (see {@link numberInputValues}), or its rules and
 * `validate` refuse every value, judged as a submission is. Both enumeration
 * paths use it. A required input that cannot be listed says why, once.
 */
function numberInputPicks(
  game: Game,
  actionDef: ActionDefinition,
  player: Player,
  selection: NumberSelection,
  args: Record<string, unknown>,
): SelectionOffer<number> {
  const listed = numberInputValues(selection);
  if ('unlistable' in listed) {
    if (!selection.optional) {
      devWarn(
        `number-input-unlistable:${actionDef.name}:${selection.name}`,
        `Action "${actionDef.name}" contributed no moves because its number input "${selection.name}" ` +
          `cannot be listed: ${listed.unlistable}`,
      );
    }
    return { values: null, judged: 0 };
  }
  const executor = game.getActionExecutor();
  const accepted = listed.values.filter(
    (value) => executor.validateSelection(selection, value, player, args, actionDef.name).valid,
  );
  return { values: accepted.length > 0 ? accepted : null, judged: listed.values.length };
}

/**
 * The values enumeration lists for a number input (#689): every whole number
 * in its range ({@link numberRangeValues}), when it declares `min`, `max` and
 * `integer: true`. A range with more than {@link MAX_MULTISELECT_COMBINATIONS}
 * values (the same ceiling a multiSelect's combinations have) is not listed at
 * all rather than cut short, since a prefix of it is one corner of the range,
 * not a sample. An input that is not listed comes back with the reason, worded
 * for the game author.
 */
export function numberInputValues(selection: NumberSelection): { values: number[] } | { unlistable: string } {
  const values = numberRangeValues(selection, MAX_MULTISELECT_COMBINATIONS);
  if (values === null) {
    return { unlistable: 'it needs min, max and integer: true to be listed. Give it all three.' };
  }
  if ('tooMany' in values) {
    return {
      unlistable:
        `its range ${selection.min} to ${selection.max} holds ${values.tooMany} values, and at most ` +
        `${MAX_MULTISELECT_COMBINATIONS} may be listed. Narrow the range.`,
    };
  }
  return { values };
}

/**
 * Every value this selection could be given, in enumeration order, and how
 * many values that judged.
 *
 * A single-select yields each choice; a `multiSelect` yields each combination
 * within its bounds, and judges each one; an `orderedList` yields the lists
 * `orderedListsToTry` describes. With `random`, a multiSelect yields one
 * combination drawn with it.
 */
function _valuesToTry(
  game: Game,
  player: Player,
  selection: Selection,
  choices: { values: unknown[]; judged: number },
  currentArgs: Record<string, unknown>,
  random: SeededRandom | undefined,
): SelectionOffer {
  const ctx = { game, player, args: currentArgs };

  // AN ORDERED, REPEATABLE LIST IS ENUMERATED ONE ENTRY AT A TIME (#249) -- see
  // `orderedListsToTry` for why that is the honest answer rather than a
  // truncated walk of an unbounded space.
  const orderedList = resolveOrderedList(selection, ctx);
  if (orderedList) return { values: orderedListsToTry(orderedList, choices.values), judged: choices.judged };

  // Static OR function-valued multiSelect through the single shared helper
  // (bot-01 / D9). Concrete config -> real combinations; `undefined` ->
  // single-select; a thrown error propagates (fail loud, never a silent skip).
  const resolved = resolveMultiSelect(selection, ctx);
  if (!resolved) return choices;
  const max = Math.min(resolved.max ?? Infinity, choices.values.length);

  if (random) {
    const combination = randomCombination(choices.values, resolved.min, max, random);
    return { values: combination ? [combination] : [], judged: choices.judged };
  }
  // More combinations than the budget: `spend` refuses on `judged` alone, so none is built (#692).
  const count = combinationCount(choices.values, resolved.min, max);
  const values = count > MAX_MULTISELECT_COMBINATIONS ? [] : generateCombinations(choices.values, resolved.min, max);
  return { values, judged: Math.max(choices.judged, count) };
}

/**
 * How many distinct combinations of `min` to `max` of `choices` there are,
 * equal values counted once as `generateCombinations` lists them (#967),
 * exactly up to {@link MAX_MULTISELECT_COMBINATIONS}; past it, some larger number.
 */
function combinationCount(choices: unknown[], min: number, max: number): number {
  const cap = MAX_MULTISELECT_COMBINATIONS + 1;
  const groupSizes = new Map<unknown, number>();
  for (const key of groupEqualChoices(choices).keys) groupSizes.set(key, (groupSizes.get(key) ?? 0) + 1);
  // ways[s]: distinct combinations of size s from the groups so far; adding a group never lowers one.
  let ways = [1];
  for (const size of groupSizes.values()) {
    const next = new Array<number>(Math.min(ways.length - 1 + size, max) + 1).fill(0);
    for (let s = 0; s < ways.length; s++) {
      for (let j = 0; j <= size && s + j < next.length; j++) next[s + j] = Math.min(cap, next[s + j] + ways[s]);
    }
    ways = next;
    if (ways.slice(min).reduce((a, b) => a + b, 0) >= cap) return cap;
  }
  return ways.slice(min).reduce((a, b) => a + b, 0);
}

/**
 * One combination of `min` to `max` choices, in choice order, drawn with
 * `random` (#692): each size is equally likely, then each combination of that
 * size. `null` when there is none.
 */
function randomCombination(choices: unknown[], min: number, max: number, random: SeededRandom): unknown[] | null {
  if (max < min) return null;
  const size = min + random.nextInt(max - min + 1);
  const picked = random.shuffle(choices.map((_, i) => i)).slice(0, size).sort((a, b) => a - b);
  return picked.map((i) => choices[i]);
}

/**
 * The lists a bot will try for an `orderedList` selection (#249): the empty one
 * when the rules allow it, then each single-entry list.
 *
 * Deliberately not every legal list, and this is the whole reasoning. With
 * repeats allowed there are choices^max lists of length <= max, so there is no
 * cap under which "all of them" is tractable -- and no honest truncation of it
 * either: a bot handed the first 10,000 would be searching whichever corner the
 * generator happened to walk into. Every list this DOES produce is a real legal
 * move, and a bot reaches a longer sequence by acting again.
 */
function orderedListsToTry(
  bounds: { min: number; max?: number },
  choices: unknown[],
): unknown[][] {
  const lists: unknown[][] = [];
  if (bounds.min <= 0) lists.push([]);
  if (bounds.min <= 1 && (bounds.max === undefined || bounds.max >= 1)) {
    for (const choice of choices) lists.push([choice]);
  }
  return lists;
}

/**
 * Get enabled choices for a selection by calling game.getSelectionChoices,
 * and how many choices it judged, disabled ones included.
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
): { values: unknown[]; judged: number } {
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
  return { values: usable, judged: annotated.length };
}
