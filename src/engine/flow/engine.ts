import type { Game, PlayerOf } from '../element/game.js';
import { GameElement, hasZoneVisibility } from '../element/game-element.js';
import { Player } from '../player/player.js';
import { devWarn } from '../../utils/dev.js';
import { PlayerFacingError } from '../errors.js';
import type { ActionResult } from '../action/types.js';
import type {
  FlowNode,
  FlowContext,
  FlowPosition,
  TurnRun,
  FlowState,
  FlowStepResult,
  FlowDefinition,
  SequenceConfig,
  LoopConfig,
  RepeatNodeConfig,
  EachPlayerConfig,
  ForEachConfig,
  ActionStepConfig,
  SimultaneousActionStepConfig,
  SwitchConfig,
  IfConfig,
  ExecuteConfig,
  PhaseConfig,
  PlayerAwaitingState,
} from './types.js';

/**
 * Maximum iterations for safety (prevent infinite loops)
 */
const DEFAULT_MAX_ITERATIONS = 10000;

/**
 * Marker for a serialized element-valued flow variable. Flow variables can hold
 * live `GameElement`/`Player` values (e.g. `eachPlayer`'s `currentPlayer`, a
 * `forEach` `as` binding). A live element is NOT structured-cloneable, so a flow
 * state carrying one throws `DataCloneError` when broadcast over postMessage or
 * sent across the executor RPC boundary. `serializeFlowVariables` replaces such
 * values with this marker on the way out (in `getPosition`); `relinkFlowVariables`
 * resolves it back to the live element on the way in (in `restore`).
 */
interface SerializedFlowElement {
  __flowElementId: number;
  className: string;
  /**
   * WR-01 (163-REVIEW): the id of the element's immediate CONTAINER at
   * serialize time, present ONLY when that container is a zone-`'hidden'`
   * Space (D24 true concealment). `'hidden'` mode deliberately builds no
   * per-child placeholder and registers nothing in `idRemap` (an entry per
   * hidden child would let the map's SIZE leak the exact count) -- so this
   * marker carries the ONE piece of already-disclosed information needed to
   * relink safely on redacted-clone restore: the container itself, which is
   * always visible to every viewer (only its children are concealed). This
   * is a single scalar per flow-variable marker, not a structure that scales
   * with hidden-zone child count, so it cannot re-leak the count.
   */
  __hiddenContainerId?: number;
}

/**
 * One entry in `executeForEach`'s snapshot-on-first-entry collection (stored in
 * `frame.data.forEachItems`). Tagging `GameElement` items by `elementId` (rather than
 * storing a bare number) keeps them unambiguous from a JSON-primitive `number` item —
 * the same coercion ambiguity class as ENG-05/resolveArgs — and keeps `frame.data`
 * JSON-plain for checkpoint/restore.
 */
type ForEachSnapshotItem =
  | { elementId: number; hiddenContainerId?: number }
  | { value: string | number | boolean | null };

/** WR-01 (163-REVIEW): the id of `element`'s immediate container, but ONLY
 *  when that container is a zone-`'hidden'` Space (D24 true concealment).
 *  Shared by `serializeFlowVariables` and `executeForEach`'s snapshot so both
 *  relink paths degrade the same way on a redacted-clone restore -- to the
 *  (already-disclosed) container, never a per-child structure whose size
 *  would leak the hidden zone's exact child count. */
function hiddenContainerIdOf(element: GameElement): number | undefined {
  const container = element.parent;
  if (hasZoneVisibility(container)) {
    const zoneVisibility = container.getZoneVisibility();
    if (zoneVisibility?.mode === 'hidden') {
      return container.id;
    }
  }
  return undefined;
}

function isSerializedFlowElement(value: unknown): value is SerializedFlowElement {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SerializedFlowElement).__flowElementId === 'number' &&
    typeof (value as SerializedFlowElement).className === 'string'
  );
}

/** Replace live `GameElement` values (anywhere in the structure) with a
 *  structured-cloneable marker. Non-element values pass through unchanged. */
function serializeFlowVariables(value: unknown): unknown {
  if (value instanceof GameElement) {
    const marker: SerializedFlowElement = { __flowElementId: value.id, className: value.constructor.name };
    // WR-01: record the immediate container's real id when it is a
    // zone-`'hidden'` Space, so a redacted-clone restore can relink this
    // marker to that (already-disclosed) container instead of leaving a
    // dead marker in place.
    const hiddenContainerId = hiddenContainerIdOf(value);
    if (hiddenContainerId !== undefined) {
      marker.__hiddenContainerId = hiddenContainerId;
    }
    return marker satisfies SerializedFlowElement;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(serializeFlowVariables);
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = serializeFlowVariables(entry);
  }
  return result;
}

/** Inverse of `serializeFlowVariables`: resolve element markers back to live
 *  elements of `game` by id. A marker whose id no longer resolves is left as-is
 *  so the staleness surfaces loudly rather than silently becoming null. A live
 *  element (in-process, never serialized) is passed through unchanged.
 *
 *  @param idRemap - CR-02 (159): optional `originalId -> syntheticId` map, produced
 *    by `Game.toJSONForPlayer` when building a per-seat REDACTED clone (e.g. the
 *    MCTS bot's search sandbox). A fungible hidden-zone child is anonymized to a
 *    synthetic negative id in the redacted tree, so a flow variable that points at
 *    it by its ORIGINAL id can no longer resolve via a direct `getElementById`
 *    lookup — that is not staleness, it is the redaction working as designed. When
 *    the direct lookup fails and `idRemap` has an entry for this marker's original
 *    id, resolve via the synthetic id instead: this relinks the variable to the
 *    correct (still-redacted, still-`__hidden`) placeholder element rather than
 *    leaving a dead marker object in the flow state. If `idRemap` is absent or has
 *    no entry, behavior is unchanged (marker left as-is — genuine staleness). */
function relinkFlowVariables(value: unknown, game: Game, idRemap?: Map<number, number>): unknown {
  if (value instanceof GameElement) {
    return value;
  }
  if (isSerializedFlowElement(value)) {
    const live = game.getElementById(value.__flowElementId);
    if (live && live.constructor.name === value.className) {
      return live;
    }
    const syntheticId = idRemap?.get(value.__flowElementId);
    if (syntheticId !== undefined) {
      const redactedPlaceholder = game.getElementById(syntheticId);
      if (redactedPlaceholder) {
        return redactedPlaceholder;
      }
    }
    // WR-01 (163-REVIEW): no idRemap entry (zone-`'hidden'` mode registers
    // none, by design -- see D24). Fall back to the marker's own recorded
    // container id, if any: the container is a live, already-disclosed
    // element (only its children are concealed), so relinking to it reveals
    // no new information and keeps the flow variable resolvable instead of
    // leaving a dead marker in place.
    if (value.__hiddenContainerId !== undefined) {
      const container = game.getElementById(value.__hiddenContainerId);
      if (container) {
        return container;
      }
    }
    return value;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => relinkFlowVariables(entry, game, idRemap));
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = relinkFlowVariables(entry, game, idRemap);
  }
  return result;
}

/**
 * Creates a flow context for execution
 */
function createContext<G extends Game>(
  game: G,
  player?: PlayerOf<G>,
  variables: Record<string, unknown> = {}
): FlowContext<G> {
  return {
    game,
    player,
    variables,
    set: (name: string, value: unknown) => {
      variables[name] = value;
    },
    get: <T = unknown>(name: string): T | undefined => {
      if (!(name in variables)) {
        devWarn(
          `flow-get-unset:${name}`,
          `ctx.get('${name}') read a flow variable that was never set.\n` +
          `  It returns undefined, and an idiomatic '?? default' fallback will silently mask this\n` +
          `  (e.g. a counter that resets every turn) instead of failing loud.\n` +
          `  Fix one of:\n` +
          `    - Spelling: make the key match the one passed to setVar(...) / forEach({ as: ... }).\n` +
          `    - Initialization: setVar('${name}', <initial>) before reading it (e.g. in flow setup).`
        );
      }
      return variables[name] as T | undefined;
    },
  };
}

/**
 * Internal execution state for tracking position in nested flows
 */
interface ExecutionFrame<G extends Game = Game> {
  node: FlowNode<G>;
  index: number; // Current step index for sequences, iteration for loops
  completed: boolean;
  data?: Record<string, unknown>; // Node-specific data
}

/**
 * Executes flow definitions and manages game state progression.
 *
 * FlowEngine is the runtime interpreter for flow definitions created with
 * {@link defineFlow} and flow builder functions. It handles:
 * - Executing flow nodes (sequences, loops, conditionals, action steps)
 * - Pausing at action steps to wait for player input
 * - Resuming after player actions
 * - Tracking game completion and determining winners
 * - Serializing/restoring state for persistence
 *
 * Most game developers don't interact with FlowEngine directly - instead use
 * the flow builder functions to define game flow, and the game session handles
 * engine operations automatically.
 *
 * @example
 * ```typescript
 * // Define the flow
 * const flow = defineFlow({
 *   setup: (ctx) => { ... },
 *   root: loop({
 *     while: (ctx) => !ctx.game.isFinished(),
 *     do: eachPlayer({ do: playerTurn })
 *   }),
 *   isComplete: (ctx) => someoneWon(ctx),
 *   getWinners: (ctx) => [getWinner(ctx)]
 * });
 *
 * // Engine is created internally by GameSession
 * const engine = new FlowEngine(game, flow);
 * const state = engine.start();
 *
 * // When player acts
 * const newState = engine.resume('playCard', { card: 42 });
 * ```
 */
/**
 * Thrown when the flow throws AFTER the triggering action has already
 * committed game state (e.g. a switchOn immediately following an action step
 * whose `on` yields a value with no matching case and no default).
 *
 * Failing loud is correct — the flow definition cannot continue — but callers
 * that maintain an action history (GameRunner) MUST catch this error class
 * and record the committed action, otherwise action history diverges from
 * applied game state and replay/undo/snapshot become inconsistent.
 */
export class FlowHaltedError extends PlayerFacingError {
  constructor(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(
      `Game halted: the flow failed after the action was committed — ${message}. ` +
      `This is a flow-definition bug, not a retryable player error; the game cannot continue until the flow definition is fixed.`
    );
    this.name = 'FlowHaltedError';
  }
}

export class FlowEngine<G extends Game = Game> {
  private game: G;
  private definition: FlowDefinition<G>;
  private stack: ExecutionFrame<G>[] = [];
  private variables: Record<string, unknown> = {};
  /**
   * CR-02 (159): `originalId -> syntheticId` remap for fungible hidden-zone
   * children anonymized by `Game.toJSONForPlayer` on a redacted (`forSeat`)
   * clone. Set once by `restoreFullState` and held for the FlowEngine
   * instance's lifetime -- not just the top-level flow VARIABLES
   * (`relinkFlowVariables`) need it, but also `executeForEach`'s per-iteration
   * `frame.data.forEachItems` resolution, which re-resolves an element by its
   * ORIGINAL id on every iteration for as long as the loop runs (including
   * iterations that happen well after the initial restore, deep in an MCTS
   * search). `undefined` on the default (un-redacted) restore path — behavior
   * there is unchanged.
   */
  private hiddenIdRemap?: Map<number, number>;
  private currentPlayer?: PlayerOf<G>;
  private awaitingInput = false;
  private availableActions: string[] = [];
  private complete = false;
  private lastActionResult?: ActionResult;
  /** Error from last action if it failed (cleared on success) */
  private actionError?: string;
  /** See FlowState.actionThrew — set alongside actionError. */
  private actionThrew = false;
  /** For simultaneous action steps - tracks which players can act */
  private awaitingPlayers: PlayerAwaitingState[] = [];
  /** Current named phase (for UI display) */
  private currentPhase?: string;
  /** Track warned actions to avoid console spam */
  /**
   * Refuse a flow step that names an action the game never registered.
   *
   * This used to warn once and filter the name out, which turned a typo in a
   * flow definition into a missing button: the step still ran, the action was
   * simply never offered, and if it was the step's only action the step
   * completed or hung with the one console line long gone. The set of
   * registered actions is fixed at construction, so a name that is not in it
   * can never become available later — there is nothing to wait for.
   */
  private requireRegisteredActions(actionNames: string[], stepName: string): void {
    for (const actionName of actionNames) {
      if (this.game.getAction(actionName)) continue;
      const registered = this.game.getActionNames();
      throw new Error(
        `Flow step '${stepName}' references unknown action '${actionName}'.\n` +
        `  Registered actions: ${registered.length ? registered.join(', ') : '(none)'}\n` +
        `  Fix: define it with Action.create('${actionName}') and register it via ` +
        `this.registerActions(...) in your game's constructor, or correct the name in the flow.`
      );
    }
  }
  /** Move count for current action step with move limits */
  private moveCount = 0;
  /**
   * The acting seat's run of committed actions, carried across the frame
   * boundaries a `loop` iteration or a `sequence` of action steps creates.
   *
   * `moveCount` lives on the action-step FRAME, so a step re-entered in a new
   * frame starts at 0 and undo reaches nothing -- even mid-turn. This is what
   * a `turnScope: 'continue'` step seeds its fresh frame from so the reach
   * covers the whole run. Mirrored into `FlowPosition.turnRun` so a restore
   * landing between one frame closing and the next opening carries the same
   * count it would have carried without one.
   */
  private turnRun?: TurnRun;
  /** Current action step config (for move limit tracking) */
  private currentActionConfig?: ActionStepConfig<G>;
  /**
   * Monotonic count of completed IRREVERSIBLE `execute()` flow nodes --
   * those declared `{ irreversible: true }` (UNDO-02, 155-02). An ordinary
   * `execute()` is undo-transparent and does NOT advance this: its effects
   * live in the game state, which a checkpoint restore reproduces exactly.
   *
   * Public so `GameRunner` can read it after every recorded action and detect
   * an advance, but it is NOT itself the durable fence -- a fresh `FlowEngine`
   * (built on every restore) zeroes this back to 0.
   * `GameRunner.executeBarrierIndex` (the persisted action index at which the
   * counter last advanced) is the durable fact; this counter only signals "did
   * a commitment happen since I last checked".
   */
  irreversibleCommitCount = 0;

  constructor(game: G, definition: FlowDefinition<G>) {
    this.game = game;
    this.definition = definition;
  }

  // ============================================================================
  // SECTION: Public API
  // Purpose: External interface - start, resume, getState, restore, isComplete, getWinners
  // ============================================================================

  /**
   * Start the flow from the beginning
   */
  start(): FlowState {
    // Run setup if defined
    const context = this.createContext();
    if (this.definition.setup) {
      this.definition.setup(context);
    }

    // Initialize stack with root node
    this.stack = [{ node: this.definition.root, index: 0, completed: false }];
    this.variables = { ...context.variables };
    this.currentPlayer = this.game.currentPlayer;
    this.awaitingInput = false;
    this.availableActions = [];
    this.awaitingPlayers = [];
    this.complete = false;
    this.currentActionConfig = undefined;
    this.moveCount = 0;
    this.turnRun = undefined;
    this.lastActionResult = undefined;
    this.actionError = undefined;
    this.actionThrew = false;
    this.currentPhase = undefined;

    // Execute until we need input or complete
    return this.run();
  }

  /**
   * Resume flow after player action
   * @param actionName The action to perform
   * @param args The action arguments
   * @param playerIndex Optional player index for simultaneous actions (if not provided, uses current player)
   */
  resume(actionName: string, args: Record<string, unknown>, playerIndex?: number): FlowState {
    if (!this.awaitingInput) {
      throw new Error('Flow is not awaiting input');
    }

    const currentFrame = this.stack[this.stack.length - 1];

    // Handle simultaneous action step
    if (currentFrame?.node.type === 'simultaneous-action-step') {
      return this.resumeSimultaneousAction(actionName, args, playerIndex, currentFrame);
    }

    // Enforce flow-level allow-list for regular action steps.
    if (currentFrame?.node.type === 'action-step' && !this.availableActions.includes(actionName)) {
      this.actionError = `Action ${actionName} is not available in the current flow step`;
      return this.getState();
    }

    // Execute the action (regular action step)
    const result = this.game.performAction(actionName, this.currentPlayer!, args);
    this.lastActionResult = result;

    if (!result.success) {
      // Action failed, stay in same state and record the error
      this.actionError = result.error;
      // #44: a throw out of execute() may have applied part of its changes.
      // Staying put is right for the flow, but the runner still has to roll
      // the game state back, and this is how it learns it must.
      this.actionThrew = result.threw === true;
      return this.getState();
    }

    // Clear error and awaiting state on success
    this.actionError = undefined;
    this.actionThrew = false;
    this.awaitingInput = false;

    return this.continueAfterCommittedAction(result);
  }

  /**
   * Resume flow after an action was executed externally (e.g., via pending action).
   * This is like resume() but skips the action execution since it already happened.
   * @param result The result of the externally-executed action
   */
  resumeAfterExternalAction(result: ActionResult): FlowState {
    if (!this.awaitingInput) {
      throw new Error('Flow is not awaiting input');
    }

    this.lastActionResult = result;

    if (!result.success) {
      // Action failed, stay in same state
      this.actionError = result.error;
      // #44: a throw out of execute() may have applied part of its changes.
      // Staying put is right for the flow, but the runner still has to roll
      // the game state back, and this is how it learns it must.
      this.actionThrew = result.threw === true;
      return this.getState();
    }

    // Clear awaiting state
    this.actionError = undefined;
    this.actionThrew = false;
    this.awaitingInput = false;

    return this.continueAfterCommittedAction(result);
  }

  /**
   * Advance the flow after a SUCCESSFUL (committed) action.
   *
   * Any throw from this point on happens after game state has already been
   * mutated by the action, so it is wrapped in FlowHaltedError: a distinct,
   * clearly non-retryable error that lets callers maintaining an action
   * history (GameRunner) record the committed action before surfacing the
   * failure — keeping actionHistory consistent with applied state (WR-02).
   */
  private continueAfterCommittedAction(result: ActionResult): FlowState {
    try {
      this.handleActionStepCompletion(result);
      return this.run();
    } catch (error) {
      if (error instanceof FlowHaltedError) throw error;
      throw new FlowHaltedError(error);
    }
  }

  // ============================================================================
  // SECTION: Resume Handling
  // Purpose: Private methods for handling different resume scenarios
  // ============================================================================

  /**
   * Handle action step completion after a successful action.
   * Updates move count, checks completion conditions, and marks frame complete if appropriate.
   *
   * @param result - The action result (used to check for followUp)
   * @returns true if the step should run() immediately (followUp case), false otherwise
   */
  private handleActionStepCompletion(result: ActionResult): boolean {
    const currentFrame = this.stack[this.stack.length - 1];
    if (currentFrame?.node.type !== 'action-step') {
      return false;
    }

    const config = currentFrame.node.config as ActionStepConfig;

    // If action returned a followUp, don't complete the step or count the move yet.
    // The followUp chain must complete first. Only when the final action in the chain
    // completes (no followUp) do we count it as a move and check completion.
    // This prevents followUp chains from counting against parent loop's maxIterations.
    if (result.followUp) {
      return true; // Caller should run() immediately
    }

    // Increment move count (only when action chain is complete - no followUp)
    const currentMoveCount = (currentFrame.data?.moveCount as number) ?? 0;
    const newMoveCount = currentMoveCount + 1;
    currentFrame.data = { ...currentFrame.data, moveCount: newMoveCount };

    // The run this seat is on, which a `turnScope: 'continue'` step re-entered
    // in a fresh frame seeds itself from. Recorded per seat so an entry for a
    // DIFFERENT seat never carries -- that is a turn boundary by definition.
    if (this.currentPlayer) {
      this.turnRun = { player: this.currentPlayer.seat, count: newMoveCount };
    }

    // Check completion conditions
    if (config.maxMoves && newMoveCount >= config.maxMoves) {
      this.completeActionStep(currentFrame);
    } else if (config.repeatUntil) {
      const minMovesMet = !config.minMoves || newMoveCount >= config.minMoves;
      if (config.repeatUntil(this.createContext()) && minMovesMet) {
        this.completeActionStep(currentFrame);
      }
    } else if (!config.minMoves && !config.maxMoves) {
      // No repeatUntil and no maxMoves - complete after single action
      this.completeActionStep(currentFrame);
    }
    // Has minMoves but no maxMoves and no repeatUntil - keep going
    // The executeActionStep will check minMoves when re-entered

    return false;
  }

  /**
   * Mark an action step frame as completed and reset tracking state.
   */
  private completeActionStep(frame: ExecutionFrame<G>): void {
    this.restorePlayerFromActionStep(frame);
    frame.completed = true;
    this.currentActionConfig = undefined;
    this.moveCount = 0;
  }

  /**
   * Restore currentPlayer after a player: override completes.
   * Only restores if this frame saved a previous player (i.e., had a player: override).
   */
  private restorePlayerFromActionStep(frame: ExecutionFrame<G>): void {
    if (frame.data?.playerSaved) {
      // Always a live Player (or a deliberate `undefined`, when no player was
      // current at save time): `getPosition`/`restore` round-trip frame data
      // through serializeFlowVariables/relinkFlowVariables, so there is no
      // serialized form to decode here.
      this.currentPlayer = frame.data.previousPlayer as PlayerOf<G> | undefined;
    }
  }

  /**
   * Restore move-limit tracking fields from the current stack frame.
   * Used after state restore so maxMoves/minMoves remain correct.
   */
  private restoreActionStepTracking(): void {
    const currentFrame = this.stack[this.stack.length - 1];
    if (currentFrame?.node.type === 'action-step') {
      this.currentActionConfig = currentFrame.node.config as ActionStepConfig<G>;
      this.moveCount = (currentFrame.data?.moveCount as number) ?? 0;
      return;
    }

    // 160-02 (D4 step-window bound): a simultaneous-action-step frame has no
    // `currentActionConfig` (that field is action-step-only), but it DOES
    // carry its own per-frame `moveCount` (see `executeSimultaneousActionStep`
    // / `resumeSimultaneousAction`) that must be rehydrated the same way, or
    // every checkpoint restore mid-simultaneous-step would silently reset
    // the step-window boundary to 0.
    if (currentFrame?.node.type === 'simultaneous-action-step') {
      this.currentActionConfig = undefined;
      this.moveCount = (currentFrame.data?.moveCount as number) ?? 0;
      return;
    }

    this.currentActionConfig = undefined;
    this.moveCount = 0;
  }

  /**
   * Resume a simultaneous action step after a player's action.
   *
   * Handles multi-player concurrent action scenarios where all players can act
   * independently. Validates the acting player, executes their action, then
   * re-evaluates completion conditions:
   * - playerDone: Per-player completion check (called after each action)
   * - allDone: Global completion check (step completes when true)
   * - Auto-completes players with no remaining available actions
   *
   * Continues awaiting input until all players are done or allDone returns true.
   */
  /**
   * F-06/SIM-03: warn (dev-only, deduped) when a simultaneous step is in the
   * "no eligible actor yet allDone is false" deadlock shape -- every awaiting
   * seat has already individually `completed` (or there are none) AND the
   * step-wide `allDone` gate returned false, so the step will NOT finalize on
   * its own.
   *
   * Option C keeps `allDone` authoritative: the step legitimately stays open
   * because something outside this action pipeline is expected to move it
   * forward (an external `resume()`, or a game-state change that flips
   * `allDone()` to true). But that same state is indistinguishable from a
   * deadlock bug where `allDone()` can NEVER become true -- in which case the
   * step hangs forever with no eligible actor. This is a dev diagnostic ONLY:
   * emitting a production throw or force-complete here would break the
   * legitimate external-gate pattern, so we only warn.
   */
  private warnIfDeadlockedSimultaneousStep(
    config: SimultaneousActionStepConfig<G>
  ): void {
    const noEligibleActor =
      this.awaitingPlayers.length === 0 || this.awaitingPlayers.every(p => p.completed);
    if (!noEligibleActor) return;

    const stepName = config.name ?? 'simultaneous-action-step';
    devWarn(
      `simultaneous-deadlock:${stepName}`,
      `Simultaneous step "${stepName}": every awaiting seat has completed but ` +
        `allDone() returned false, so this step will not finalize on its own. ` +
        `This step is either (a) intentionally held open for an external resume() ` +
        `or a game-state change that flips allDone() to true, or (b) a deadlock bug ` +
        `where allDone() can never become true -- in which case this step hangs forever. ` +
        `Next step: ensure something resumes this step, or that allDone() eventually ` +
        `returns true for the current game state.`
    );
  }

  /**
   * Re-derive the awaiting set of the OPEN simultaneous step, admitting seats
   * that have become eligible since it opened (#28).
   *
   * `simultaneousActionStep` builds each seat's `availableActions` once at step
   * entry and re-derives it for exactly one seat afterwards — the seat that just
   * acted — and every submission is gated on that list. A seat whose legal
   * actions change for any OTHER reason therefore keeps a stale list for the
   * rest of the step. The engine's two documented workarounds do not reach that
   * case: keeping the action available only works when it CAN be legal from the
   * moment the step opens, and re-entering the step only helps at a boundary.
   * A seat that gains its first legal action mid-step was left present but
   * frozen, unable to act until the next entry.
   *
   * The set can now GROW, which is the part that was impossible: a seat absent
   * from it because it had nothing to do is admitted the moment it does. It can
   * also shrink, since re-deriving is re-deriving.
   *
   * `skipPlayer` and `playerDone` are honoured exactly as at entry, and a seat
   * that already completed this step is left alone — a refresh must never
   * un-complete a commitment.
   *
   * No-op when no simultaneous step is open: there is no stale list to correct.
   *
   * @param seat - Refresh only this seat. Omit to refresh every seat.
   */
  refreshAwaitingActions(seat?: number): void {
    const frame = this.stack[this.stack.length - 1];
    if (!frame || frame.node.type !== 'simultaneous-action-step') return;
    const config = frame.node.config as SimultaneousActionStepConfig;

    const context = this.createContext();
    const players = this.game.players as Player[];

    if (seat !== undefined && !players.some((p) => p.seat === seat)) {
      throw new Error(
        `refreshAwaitingActions: there is no seat ${seat} in this game (it has ${players.length}). ` +
          `Seats are 1-indexed.`,
      );
    }

    for (const player of players) {
      if (seat !== undefined && player.seat !== seat) continue;

      const existing = this.awaitingPlayers.find((p) => p.playerIndex === player.seat);
      // A seat that already committed this step stays committed. Re-deriving
      // its list would be the one change a refresh must never make.
      if (existing?.completed) continue;

      if (config.skipPlayer?.(context, player as never) || config.playerDone?.(context, player as never)) {
        if (existing) this.awaitingPlayers = this.awaitingPlayers.filter((p) => p !== existing);
        continue;
      }

      const declared = typeof config.actions === 'function'
        ? config.actions(context, player as never)
        : config.actions;
      this.requireRegisteredActions(declared, config.name ?? 'simultaneous-action-step');

      const available = declared.filter((actionName) =>
        this.game.getAvailableActions(player).some((a) => a.name === actionName),
      );

      if (available.length === 0) {
        if (existing) this.awaitingPlayers = this.awaitingPlayers.filter((p) => p !== existing);
        continue;
      }

      if (existing) {
        existing.availableActions = available;
      } else {
        this.awaitingPlayers.push({
          playerIndex: player.seat,
          availableActions: available,
          completed: false,
        });
      }
    }
  }

  private resumeSimultaneousAction(
    actionName: string,
    args: Record<string, unknown>,
    playerIndex: number | undefined,
    frame: ExecutionFrame<G>
  ): FlowState {
    const config = frame.node.config as SimultaneousActionStepConfig;

    // Determine which player is acting
    let actingPlayerIndex = playerIndex;
    if (actingPlayerIndex === undefined) {
      // If not provided, use the first awaiting player
      const firstAwaiting = this.awaitingPlayers.find(p => !p.completed && p.availableActions.length > 0);
      if (firstAwaiting) {
        actingPlayerIndex = firstAwaiting.playerIndex;
      }
    }

    if (actingPlayerIndex === undefined) {
      // D21/SIM-03: no explicit playerIndex was given AND no seat is both
      // incomplete and able to act. If that's because every awaiting seat
      // has already individually completed (or there are no awaiting seats
      // at all), there is nothing left to ever award this resume to -- the
      // step must finalize here rather than throw. This is the SOURCE fix:
      // it closes the gap that produces the crash instead of merely
      // guarding the throw below.
      // W3 (160-REVIEW): this branch force-completes UNCONDITIONALLY --
      // it does NOT consult `config.allDone`, unlike the normal post-action
      // completion path (which checks allDone before finalizing). By the
      // time every awaiting seat is individually `completed`, there is no
      // remaining seat state for `allDone` to usefully evaluate against, so
      // skipping it here is intentional, not an oversight.
      //
      // F-06/SIM-03 (residual inconsistency, deliberately retained): the
      // post-action path (below) treats `allDone` as authoritative and, when a
      // CUSTOM `allDone` returns false with no eligible actor, stays open and
      // dev-warns via `warnIfDeadlockedSimultaneousStep`. This resume path does
      // NOT -- it still force-completes. Unifying the two (making this branch
      // also consult `allDone`) was attempted and reverted: it breaks the D21
      // resume-crash regression tests (`simultaneous-alldone-empty.test.ts`),
      // which encode the documented design position that a stray no-seat resume
      // after every seat is done must complete cleanly rather than hang. That is
      // a deliberate, load-bearing behavior for the resume entrypoint, not the
      // buggy shape F-06 targets, so the paths remain intentionally divergent.
      const noEligibleActor = this.awaitingPlayers.length === 0
        || this.awaitingPlayers.every(p => p.completed);
      if (noEligibleActor) {
        this.awaitingInput = false;
        this.awaitingPlayers = [];
        frame.completed = true;
        return this.run();
      }
      throw new Error('No player specified and no awaiting players found');
    }

    // Validate player can act. These are ordinary player-input races in
    // concurrent play (double-submits, stale clients) — not developer errors —
    // so they mirror resume()'s graceful actionError contract instead of
    // throwing (WR-03): the runner surfaces them as an actionable rejection
    // rather than ENGINE_ERROR.
    const playerState = this.awaitingPlayers.find(p => p.playerIndex === actingPlayerIndex);
    if (!playerState) {
      this.actionError = `Player ${actingPlayerIndex} is not awaiting action`;
      return this.getState();
    }
    if (playerState.completed) {
      this.actionError = `Player ${actingPlayerIndex} has already completed their action`;
      return this.getState();
    }
    if (!playerState.availableActions.includes(actionName)) {
      this.actionError = `Action ${actionName} is not available for player ${actingPlayerIndex}`;
      return this.getState();
    }

    // Execute the action (actingPlayerIndex is 1-indexed position)
    const player = this.game.getPlayer(actingPlayerIndex);
    if (!player) {
      throw new Error(`Invalid player position: ${actingPlayerIndex}`);
    }
    const result = this.game.performAction(actionName, player, args);
    this.lastActionResult = result;

    if (!result.success) {
      // Action failed, stay in same state and record the error
      this.actionError = result.error;
      // #44: a throw out of execute() may have applied part of its changes.
      // Staying put is right for the flow, but the runner still has to roll
      // the game state back, and this is how it learns it must.
      this.actionThrew = result.threw === true;
      return this.getState();
    }

    // Clear error on success (mirrors resume()'s success-path clear).
    this.actionError = undefined;
    this.actionThrew = false;

    // 160-02 (D4 step-window bound): count this action toward the CURRENT
    // simultaneous-step frame's move counter (mirrors
    // `handleActionStepCompletion`'s sequential moveCount increment).
    // `frame.data` is the durable, checkpoint-restorable copy;
    // `this.moveCount` is the live mirror `getState()` publishes.
    const currentFrameMoveCount = (frame.data?.moveCount as number) ?? 0;
    const newFrameMoveCount = currentFrameMoveCount + 1;
    frame.data = { ...frame.data, moveCount: newFrameMoveCount };
    this.moveCount = newFrameMoveCount;

    // Everything below runs AFTER the action committed its state changes.
    // playerDone / actions re-eval / allDone are developer callbacks
    // evaluating live game state — the same failure class as switchOn's on()
    // (WR-02) — so any throw from here on must surface as FlowHaltedError,
    // letting GameRunner record the committed action instead of silently
    // diverging actionHistory from applied game state (WR-06).
    try {
      // Check if this player is done (re-evaluate after action)
      const context = this.createContext();
      if (config.playerDone) {
        playerState.completed = config.playerDone(context, player);
      }

      // Re-evaluate available actions for this player
      if (!playerState.completed) {
        const actions = typeof config.actions === 'function'
          ? config.actions(context, player)
          : config.actions;
        playerState.availableActions = actions.filter((availableActionName) => {
          const action = this.game.getAction(availableActionName);
          if (!action) return false;
          return this.game.getAvailableActions(player).some((a) => a.name === availableActionName);
        });
        // If no available actions left, mark as completed
        if (playerState.availableActions.length === 0) {
          playerState.completed = true;
        }
      }

      // Check if all players are done
      const allDone = config.allDone
        ? config.allDone(context)
        : this.awaitingPlayers.every(p => p.completed);

      if (allDone) {
        // Clear awaiting state and complete the step.
        this.awaitingInput = false;
        this.awaitingPlayers = [];
        frame.completed = true;
        return this.run();
      }

      // F-06/SIM-03: allDone returned false. If NO seat can still act (every
      // awaiting seat has already individually completed, or there are none),
      // this step will not finalize on its own -- Option C keeps allDone
      // authoritative, so it legitimately stays open, but this is exactly the
      // shape of a silent permanent hang. Fail loud in dev so a genuine
      // deadlock is visible instead of hanging forever.
      this.warnIfDeadlockedSimultaneousStep(config);

      // Still awaiting other players
      return this.getState();
    } catch (error) {
      if (error instanceof FlowHaltedError) throw error;
      throw new FlowHaltedError(error);
    }
  }

  /**
   * Get the current flow state
   */
  getState(): FlowState {
    const state: FlowState = {
      position: this.getPosition(),
      complete: this.complete,
      awaitingInput: this.awaitingInput,
      currentPlayer: this.currentPlayer?.seat,
      availableActions: this.awaitingInput ? this.availableActions : undefined,
      // D3/SIM-01: return a deep-copied value, never the live private array.
      // `completed` lives ONLY here (excluded from FlowPosition) and is
      // mutated in place by resumeSimultaneousAction -- every prior caller
      // that captured this array by reference (including every
      // ActionCheckpoint, which stores getState()'s return un-cloned; see
      // snapshot.ts createActionCheckpoint) would otherwise see a LATER
      // seat's completion retroactively rewrite an EARLIER capture. Mirrors
      // the restore-side copy already at restoreFullState (below).
      // W1 (160-REVIEW): also clone the nested `availableActions` array, not
      // just the per-seat object shell -- `{ ...p }` alone still shares that
      // array BY REFERENCE with the private `FlowEngine.awaitingPlayers`
      // entry. Safe today only because every mutation site reassigns rather
      // than `.push()`/`.splice()`s it in place; cloning here means a future
      // in-place mutation can't silently reintroduce the D3 aliasing bug.
      awaitingPlayers: this.awaitingPlayers.length > 0
        ? this.awaitingPlayers.map(p => ({ ...p, availableActions: [...p.availableActions] }))
        : undefined,
      currentPhase: this.currentPhase,
    };

    // Publish move count for ANY active action step, not just ones that
    // declare minMoves/maxMoves (UNDO-03). moveCount is the sole authoritative
    // input to computeUndoInfo's undo-boundary computation (session/utils.ts)
    // now that its backward-scan fallback is gone -- a step that never
    // reports moveCount is a step undo can never be offered for.
    // movesRemaining/movesRequired stay limits-gated below: they're
    // meaningless without minMoves/maxMoves.
    //
    // 160-02 (D4 step-window bound): also publish for an active simultaneous
    // step (`this.awaitingPlayers.length > 0`) -- `currentActionConfig` is
    // never set there (it's action-step-only), but the simultaneous step now
    // tracks its own per-frame moveCount (see `executeSimultaneousActionStep`
    // / `resumeSimultaneousAction`), which is the step-window lower bound
    // `session/utils.ts`'s per-seat simultaneous undo boundary depends on.
    if (this.currentActionConfig || this.awaitingPlayers.length > 0) {
      state.moveCount = this.moveCount;
      // Why moveCount is 0 here, when the seat plainly just acted: the step
      // this frame belongs to never said whether re-entering it continues the
      // same turn. Published so the undo refusal can name the cause instead of
      // reporting "No actions to undo" -- see `entryMoveCount`.
      const undeclared = this.stack[this.stack.length - 1]?.data?.turnScopeUndeclared;
      if (typeof undeclared === 'string') {
        state.turnScopeUndeclared = undeclared;
      }
      if (this.currentActionConfig?.maxMoves) {
        state.movesRemaining = this.currentActionConfig.maxMoves - this.moveCount;
      }
      if (this.currentActionConfig?.minMoves) {
        state.movesRequired = Math.max(0, this.currentActionConfig.minMoves - this.moveCount);
      }
    }

    // Include action error if present
    if (this.actionError) {
      state.actionError = this.actionError;
      if (this.actionThrew) state.actionThrew = true;
    }

    // Include followUp if last action returned one. NOTE: the sibling fields
    // `data`/`message` are deliberately NOT published here — see the note on
    // FlowState (BUG-017); they would fan out to every seat.
    if (this.lastActionResult?.followUp) {
      state.followUp = this.lastActionResult.followUp;
    }

    return state;
  }

  /**
   * Restore flow from a serialized position
   */
  restore(position: FlowPosition): void {
    // Relink serialized element-valued flow variables back to live elements of
    // this game (inverse of getPosition's serializeFlowVariables). Doing it here
    // means every restore path — runner.fromSnapshot, MCTS clone, and the HMR
    // dev-transfer in game-session — is covered without each caller relinking.
    // `this.hiddenIdRemap` (CR-02, 159) is only ever set by a redacted-clone
    // restore (`restoreFullState`); plain position-only restores leave it
    // `undefined`, matching prior behavior exactly.
    this.variables = relinkFlowVariables({ ...position.variables }, this.game, this.hiddenIdRemap) as Record<string, unknown>;
    this.stack = [];

    // Rebuild stack from path
    let currentNode = this.definition.root;
    for (let i = 0; i < position.path.length; i++) {
      const index = position.path[i];
      const iterationKey = `__iter_${i}`;
      // Inverse of getPosition's serializeFlowVariables on frame data: an
      // element-valued entry comes back as a LIVE element of this game, under
      // whatever field name the engine wrote it to.
      const restoredFrameData = relinkFlowVariables(
        { ...(position.frameData?.[`__frame_${i}`] ?? {}) },
        this.game,
        this.hiddenIdRemap,
      ) as Record<string, unknown>;
      if (restoredFrameData.iteration === undefined) {
        restoredFrameData.iteration = position.iterations[iterationKey] ?? 0;
      }

      this.stack.push({
        node: currentNode,
        index,
        completed: false,
        data: restoredFrameData,
      });

      // Navigate to child node for next level
      const navIndex = this.getNavigationIndex(currentNode, index, restoredFrameData);
      const childCount = this.getChildCount(currentNode);
      if (navIndex >= 0 && navIndex < childCount) {
        currentNode = this.getChildNode(currentNode, navIndex);
      }
    }

    // Set player from position (playerIndex is 1-indexed)
    if (position.playerIndex !== undefined) {
      this.currentPlayer = this.game.getPlayer(position.playerIndex);
    }

    this.turnRun = position.turnRun ? { ...position.turnRun } : undefined;

    this.restoreActionStepTracking();
  }

  /**
   * Try to restore flow from a serialized position with bounds checking.
   * Unlike restore(), this method validates the path and returns failure info
   * instead of throwing or accessing invalid indices.
   *
   * @param position - The flow position to restore
   * @returns Success or failure with the last valid path
   */
  tryRestore(position: FlowPosition): { success: true } | { success: false; error: string; validPath: number[] } {
    // Validate path before attempting restore
    const validationResult = this.validatePath(position.path, position.frameData);

    if (!validationResult.valid) {
      return {
        success: false,
        error: validationResult.error,
        validPath: validationResult.validPath,
      };
    }

    // Path is valid, perform the restore
    this.restore(position);
    return { success: true };
  }

  /**
   * Restore the full flow state including awaiting state.
   * This should be used for HMR where we want to restore exactly where we were.
   */
  restoreFullState(state: FlowState, idRemap?: Map<number, number>): { success: true } | { success: false; error: string; validPath: number[] } {
    // CR-02 (159): stash the remap on the instance BEFORE restoring -- it must
    // outlive this single call so `executeForEach`'s per-iteration element
    // resolution (which can run long after this restore, deep in an MCTS
    // search) can also fall back to it. See the field doc for why this can't
    // just be a one-shot parameter.
    this.hiddenIdRemap = idRemap;

    // First restore the position (stack structure)
    const result = this.tryRestore(state.position);
    if (!result.success) {
      return result;
    }

    // Restore the awaiting state directly (don't run the flow)
    this.awaitingInput = state.awaitingInput;
    this.complete = state.complete;

    if (state.currentPlayer !== undefined) {
      this.currentPlayer = this.game.getPlayer(state.currentPlayer);
    }

    this.availableActions = state.availableActions ? [...state.availableActions] : [];

    // Restore awaiting players for simultaneous actions. W1 (160-REVIEW): clone
    // the nested `availableActions` array too -- mirrors the getState() copy.
    this.awaitingPlayers = state.awaitingPlayers
      ? state.awaitingPlayers.map(p => ({ ...p, availableActions: [...p.availableActions] }))
      : [];

    // Restore phase
    if (state.currentPhase !== undefined) {
      this.currentPhase = state.currentPhase;
    }

    // Restore action error and follow-up state
    this.actionError = state.actionError;
    this.actionThrew = state.actionThrew === true;
    this.lastActionResult = state.followUp ? { success: true, followUp: state.followUp } : undefined;

    // Restore move-limit tracking for action steps
    this.restoreActionStepTracking();

    return { success: true };
  }

  /**
   * Validate that a flow path is still valid with the current flow definition.
   * Returns the longest valid prefix if the path is invalid.
   */
  private validatePath(
    path: number[],
    frameData?: Record<string, Record<string, unknown>>
  ): { valid: true } | { valid: false; error: string; validPath: number[] } {
    if (path.length === 0) {
      return { valid: true };
    }

    let currentNode = this.definition.root;
    const validPath: number[] = [];

    for (let i = 0; i < path.length; i++) {
      const index = path[i];
      const nodeType = currentNode.type;
      const frameDataAtDepth = frameData?.[`__frame_${i}`];

      // For loop/each-player/for-each/phase nodes, index represents iteration count,
      // not child position. These can have any non-negative index value.
      // For leaf nodes (action-step, execute, etc.), they have no children so skip bounds check.
      // For sequences, index represents child position and must be validated.
      const isIteratingNode = nodeType === 'loop' || nodeType === 'repeat' || nodeType === 'each-player' ||
                              nodeType === 'for-each' || nodeType === 'phase';
      const isLeafNode = nodeType === 'action-step' || nodeType === 'simultaneous-action-step' ||
                         nodeType === 'execute';

      if (!isIteratingNode && !isLeafNode) {
        const childCount = this.getChildCount(currentNode);
        // For sequences: index can equal childCount (next step position after pushing child)
        if (index > childCount) {
          const nodeName = currentNode.config?.name ?? currentNode.type;
          return {
            valid: false,
            error: `Path index ${index} out of bounds at depth ${i} (node "${nodeName}" has ${childCount} children)`,
            validPath,
          };
        }
      }

      validPath.push(index);

      // Navigate to the child node for next iteration
      const navIndex = this.getNavigationIndex(currentNode, index, frameDataAtDepth);

      const childCount = this.getChildCount(currentNode);
      if (navIndex >= 0 && navIndex < childCount) {
        try {
          currentNode = this.getChildNode(currentNode, navIndex);
        } catch {
          return {
            valid: false,
            error: `Failed to navigate to child ${navIndex} at depth ${i}`,
            validPath: validPath.slice(0, -1),
          };
        }
      }
    }

    return { valid: true };
  }

  /**
   * Get the number of valid child indices for a flow node.
   */
  private getChildCount(node: FlowNode<G>): number {
    switch (node.type) {
      case 'sequence':
        return node.config.steps.length;
      case 'loop':
      case 'repeat':
      case 'each-player':
      case 'for-each':
      case 'phase':
        // These nodes only have a single 'do' child
        return 1;
      case 'if':
        // 0 = then, 1 = else
        return node.config.else ? 2 : 1;
      case 'switch': {
        const cases = Object.values(node.config.cases);
        return cases.length + (node.config.default ? 1 : 0);
      }
      case 'action-step':
      case 'simultaneous-action-step':
      case 'execute':
        // Leaf nodes - no children
        return 0;
      default:
        return 0;
    }
  }

  /**
   * Check if the game is complete
   */
  isComplete(): boolean {
    return this.complete;
  }

  /**
   * The `ActionResult` the most recent action's `execute()` returned, verbatim.
   *
   * This is the ONLY way `ActionResult.data` — an action's computed return
   * value to the seat that took it (a map recall, a scout report, a peek at a
   * deck) — reaches anything above the flow engine (BUG-017). `FlowState`
   * cannot carry it: that object is fanned out to every seat and the
   * spectator, and `data` is private to the acting seat by construction.
   *
   * Per-action and non-durable: replaced by the next action, cleared by
   * `start()`, and NOT reconstructed by `restoreFullState` (a restored
   * snapshot has no "last action" of its own). Read it immediately after the
   * `continueFlow`/`resume` call that produced it — `GameRunner.performAction`
   * is the one place that does.
   */
  getLastActionResult(): ActionResult | undefined {
    return this.lastActionResult;
  }

  /**
   * Get the winners (if game is complete)
   */
  getWinners(): Player[] {
    if (!this.complete) return [];
    if (this.definition.getWinners) {
      return this.definition.getWinners(this.createContext());
    }
    return [];
  }

  // ============================================================================
  // SECTION: Core Execution Loop
  // Purpose: Context creation, position tracking, main execution loop
  // ============================================================================

  private createContext(): FlowContext<G> {
    const context = createContext(this.game, this.currentPlayer, this.variables);
    context.lastActionResult = this.lastActionResult;
    return context;
  }

  private getPosition(): FlowPosition {
    const path: number[] = [];
    const iterations: Record<string, number> = {};
    const frameData: Record<string, Record<string, unknown>> = {};

    for (let i = 0; i < this.stack.length; i++) {
      const frame = this.stack[i];
      path.push(frame.index);
      if (frame.data) {
        // Serialize element-valued FRAME data by exactly the same general path
        // as `variables` below (BSMITH-04). The engine writes `frame.data` from
        // more than a dozen sites and any of them can put a live
        // `GameElement`/`Player` there -- `executeActionStep`'s `previousPlayer`
        // does today -- so a hand-written special case per field name is a hole
        // waiting for the fourteenth site. Plain values (`moveCount`,
        // `iteration`, `eligibleSeats: number[]`, `branchIndex`, the
        // deliberately pre-tagged `forEachItems`) pass through untouched, which
        // is what `turnSequence`/`dueSeats` (seat-activity.ts) and
        // `getNavigationIndex` read back out. Do NOT "simplify" this to a
        // spread: that is the asymmetry this replaced.
        const serializedData = serializeFlowVariables({ ...frame.data }) as Record<string, unknown>;
        frameData[`__frame_${i}`] = serializedData;
        if (serializedData.iteration !== undefined) {
          iterations[`__iter_${i}`] = serializedData.iteration as number;
        }
      }
    }

    return {
      path,
      iterations,
      frameData: Object.keys(frameData).length > 0 ? frameData : undefined,
      playerIndex: this.currentPlayer?.seat,
      // Serialize element-valued flow variables (e.g. eachPlayer's currentPlayer)
      // so the position is structured-cloneable across the broadcast/RPC boundary.
      variables: serializeFlowVariables({ ...this.variables }) as Record<string, unknown>,
      // Plain seat number and count, so it needs no relinking on the way back.
      turnRun: this.turnRun ? { ...this.turnRun } : undefined,
    };
  }

  private getSwitchBranchIndex(config: SwitchConfig<G>, branchKey: string): number | undefined {
    const caseKeys = Object.keys(config.cases);
    if (branchKey === '__default') {
      return config.default ? caseKeys.length : undefined;
    }
    const index = caseKeys.indexOf(branchKey);
    return index >= 0 ? index : undefined;
  }

  private getNavigationIndex(
    node: FlowNode<G>,
    frameIndex: number,
    frameData?: Record<string, unknown>
  ): number {
    const isIteratingNode =
      node.type === 'loop' ||
      node.type === 'repeat' ||
      node.type === 'each-player' ||
      node.type === 'for-each' ||
      node.type === 'phase';

    if (isIteratingNode) {
      return 0;
    }

    if (node.type === 'if' && typeof frameData?.branchIndex === 'number') {
      return frameData.branchIndex as number;
    }

    if (node.type === 'switch') {
      if (typeof frameData?.branchKey === 'string') {
        const branchIndex = this.getSwitchBranchIndex(node.config, frameData.branchKey);
        if (branchIndex !== undefined) {
          return branchIndex;
        }
      }
      if (typeof frameData?.branchIndex === 'number') {
        return frameData.branchIndex as number;
      }
    }

    // Sequence: reconstruct the child that is currently IN PROGRESS on the stack.
    // executeSequence pushes child `k` and THEN does `frame.index++`, so a live
    // sequence frame's index always points ONE PAST the in-progress child (k+1).
    // Navigating back to that child therefore requires `index - 1` for EVERY
    // position, not only the last one. The previous `=== childCount` special case
    // only corrected the final child; a non-last awaiting child (e.g. a landing
    // phase that is step 0 of a multi-step root sequence) mis-navigated to the
    // NEXT sibling, corrupting the restored flow position. Clamp at 0 so a leaf
    // (childCount 0, index 0 — navIndex is unused there) stays in range.
    if (node.type === 'sequence') {
      return Math.max(0, frameIndex - 1);
    }

    const childCount = this.getChildCount(node);
    return frameIndex === childCount ? frameIndex - 1 : frameIndex;
  }

  private getChildNode(node: FlowNode<G>, index: number): FlowNode<G> {
    switch (node.type) {
      case 'sequence':
        return node.config.steps[index];
      case 'loop':
      case 'repeat':
      case 'each-player':
      case 'for-each':
      case 'phase':
        return node.config.do;
      case 'if':
        return index === 0 ? node.config.then : (node.config.else ?? node.config.then);
      case 'switch': {
        const cases = Object.values(node.config.cases);
        return cases[index] ?? node.config.default ?? cases[0];
      }
      default:
        return node;
    }
  }

  /**
   * Main execution loop - runs until awaiting input or complete.
   *
   * Uses a stack-based state machine to execute nested flow nodes. Each iteration
   * processes one node, which may push children onto the stack (e.g., sequence steps)
   * or mark itself complete. The loop exits when:
   * - A node requires player input (awaitingInput)
   * - The game's isComplete() returns true
   * - The stack empties (all nodes processed)
   *
   * Includes iteration safety (DEFAULT_MAX_ITERATIONS) to detect infinite loops
   * from misconfigured while/repeatUntil conditions.
   */
  private run(): FlowState {
    let iterations = 0;

    while (this.stack.length > 0 && !this.awaitingInput && !this.complete) {
      iterations++;
      if (iterations > DEFAULT_MAX_ITERATIONS) {
        // Build helpful error message with context
        const frame = this.stack[this.stack.length - 1];
        const nodeName = frame?.node?.config?.name ?? frame?.node?.type ?? 'unknown';
        const nodeType = frame?.node?.type ?? 'unknown';
        const stackTrace = this.stack.map((f, i) =>
          `  ${i}: ${f.node.type}${f.node.config?.name ? ` "${f.node.config.name}"` : ''} (index: ${f.index})`
        ).join('\n');

        throw new Error(
          `Flow exceeded ${DEFAULT_MAX_ITERATIONS} iterations - possible infinite loop.\n\n` +
          `Current node: ${nodeType}${nodeName !== nodeType ? ` "${nodeName}"` : ''}\n` +
          `Flow stack:\n${stackTrace}\n\n` +
          `Common causes:\n` +
          `- A while() condition that never becomes false\n` +
          `- Missing state update that should break the loop\n` +
          `- Condition references stale game state\n` +
          `- isFinished() never returns true\n\n` +
          `Fix: Check the while/repeatUntil conditions in the nodes above.`
        );
      }

      const frame = this.stack[this.stack.length - 1];

      // If frame is already completed (e.g., from resume), pop it and continue
      if (frame.completed) {
        this.stack.pop();
        continue;
      }

      const result = this.executeNode(frame);

      if (result.awaitingInput) {
        this.awaitingInput = true;
        break;
      }

      if (frame.completed) {
        this.stack.pop();
      }

      // Check game completion after each node execution
      if (this.definition.isComplete?.(this.createContext())) {
        this.complete = true;
        break;
      }
    }

    // Check completion after stack empty
    if (this.stack.length === 0 || this.definition.isComplete?.(this.createContext())) {
      this.complete = true;
    }

    return this.getState();
  }

  // ============================================================================
  // SECTION: Node Dispatch
  // Purpose: Node type dispatch and routing
  // ============================================================================

  /**
   * Execute a single flow node
   */
  private executeNode(frame: ExecutionFrame<G>): FlowStepResult {
    const context = this.createContext();

    switch (frame.node.type) {
      case 'sequence':
        return this.executeSequence(frame, frame.node.config, context);
      case 'loop':
        return this.executeLoop(frame, frame.node.config, context);
      case 'repeat':
        return this.executeRepeat(frame, frame.node.config, context);
      case 'each-player':
        return this.executeEachPlayer(frame, frame.node.config, context);
      case 'for-each':
        return this.executeForEach(frame, frame.node.config, context);
      case 'action-step':
        return this.executeActionStep(frame, frame.node.config, context);
      case 'simultaneous-action-step':
        return this.executeSimultaneousActionStep(frame, frame.node.config, context);
      case 'switch':
        return this.executeSwitch(frame, frame.node.config, context);
      case 'if':
        return this.executeIf(frame, frame.node.config, context);
      case 'execute':
        return this.executeExecute(frame, frame.node.config, context);
      case 'phase':
        return this.executePhase(frame, frame.node.config, context);
      default:
        frame.completed = true;
        return { continue: true, awaitingInput: false };
    }
  }

  // ============================================================================
  // SECTION: Flow Control Executors
  // Purpose: Sequence, loop, each-player, for-each execution
  // ============================================================================

  private executeSequence(
    frame: ExecutionFrame<G>,
    config: SequenceConfig<G>,
    context: FlowContext<G>
  ): FlowStepResult {
    if (frame.index >= config.steps.length) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    // Push next step onto stack
    const nextStep = config.steps[frame.index];
    this.stack.push({ node: nextStep, index: 0, completed: false });
    frame.index++;

    return { continue: true, awaitingInput: false };
  }

  private executeLoop(
    frame: ExecutionFrame<G>,
    config: LoopConfig<G>,
    context: FlowContext<G>
  ): FlowStepResult {
    const iteration = (frame.data?.iteration as number) ?? 0;
    const maxIterations = config.maxIterations ?? (config.unbounded ? Infinity : DEFAULT_MAX_ITERATIONS);
    const loopName = config.name ?? 'unnamed';

    // Clean exit: the while condition became false. This is the ONLY correct
    // way for a loop to terminate.
    if (config.while && !config.while(context)) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    // Safety assertion: hitting maxIterations means the loop did NOT terminate
    // via its `while` condition. The cap is a tripwire for runaway loops, not a
    // terminator — so fail loud instead of silently completing.
    if (iteration >= maxIterations) {
      throw new Error(
        `Loop ${config.name ? `"${loopName}" ` : ''}hit its maxIterations safety cap ` +
        `(${maxIterations} iterations) without its 'while' condition becoming false.\n\n` +
        `maxIterations is a safety assertion to catch runaway loops, NOT a way to end a loop. ` +
        `A loop should always terminate because its 'while' condition returns false.\n\n` +
        `Common causes:\n` +
        `- The 'while' condition never becomes false (it should eventually return false)\n` +
        `- Using maxIterations as the intended terminator instead of a real condition\n` +
        `- A missing state update that should break the loop\n` +
        `- The condition references stale game state\n\n` +
        `Fix: Ensure the loop's 'while' condition becomes false before ${maxIterations} ` +
        `iterations${config.name ? `, or raise maxIterations on loop "${loopName}" if the cap is genuinely too low` : ''}. ` +
        `If this game is genuinely unbounded, use loop({ unbounded: true, ... }) instead of an ` +
        `arbitrary maxIterations cap — the global whole-flow safety tripwire still applies.`
      );
    }

    // Push loop body and increment iteration
    this.stack.push({ node: config.do, index: 0, completed: false });
    frame.data = { ...frame.data, iteration: iteration + 1 };
    frame.index++;

    return { continue: true, awaitingInput: false };
  }

  private executeRepeat(
    frame: ExecutionFrame<G>,
    config: RepeatNodeConfig<G>,
    context: FlowContext<G>
  ): FlowStepResult {
    const iteration = (frame.data?.iteration as number) ?? 0;
    const times = Math.max(0, config.times);

    if (iteration >= times) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    this.stack.push({ node: config.do, index: 0, completed: false });
    frame.data = { ...frame.data, iteration: iteration + 1 };
    frame.index++;

    return { continue: true, awaitingInput: false };
  }

  private executeEachPlayer(
    frame: ExecutionFrame<G>,
    config: EachPlayerConfig<G>,
    context: FlowContext<G>
  ): FlowStepResult {
    // Build eligible seat list once so turn order is deterministic, then re-check
    // filter dynamically each iteration so mid-round state changes are respected.
    if (frame.data?.eligibleSeats === undefined) {
      const players: PlayerOf<G>[] = [...this.game.players];

      if (config.direction === 'backward') {
        players.reverse();
      }

      // Rotate to the starting player BEFORE filtering (WR-01): when the
      // starting player is itself filtered out (e.g. LEFT_OF_DEALER combined
      // with SKIP_IF and the player left of dealer has folded), the round
      // must start from the next eligible seat AFTER the starting player —
      // not silently fall back to the first seat of the filtered list.
      let startIndex = 0;
      if (config.startingPlayer) {
        const startPlayer = config.startingPlayer(context);
        const foundIndex = players.findIndex((p) => p.seat === startPlayer.seat);
        startIndex = foundIndex >= 0 ? foundIndex : 0;
      }

      let rotated = [...players.slice(startIndex), ...players.slice(0, startIndex)];

      if (config.filter) {
        rotated = rotated.filter((p) => config.filter!(p, context));
      }

      frame.data = {
        ...frame.data,
        eligibleSeats: rotated.map(p => p.seat),
        nextIndex: 0,
      };
    }

    const eligibleSeats = (frame.data.eligibleSeats as number[]) ?? [];
    let nextIndex = (frame.data.nextIndex as number) ?? 0;

    while (nextIndex < eligibleSeats.length) {
      const seat = eligibleSeats[nextIndex];
      nextIndex++;

      const player = this.game.getPlayer(seat);
      if (!player) {
        continue;
      }

      if (config.filter && !config.filter(player, this.createContext())) {
        continue;
      }

      this.currentPlayer = player;
      this.variables[config.name ?? 'currentPlayer'] = this.currentPlayer;

      this.stack.push({ node: config.do, index: 0, completed: false });
      frame.data = { ...frame.data, nextIndex };
      frame.index++;

      return { continue: true, awaitingInput: false };
    }

    frame.completed = true;
    return { continue: true, awaitingInput: false };
  }

  private executeForEach(
    frame: ExecutionFrame<G>,
    config: ForEachConfig<GameElement | string | number | boolean | null, G>,
    context: FlowContext<G>
  ): FlowStepResult {
    // Snapshot the collection exactly once on first entry (mirrors executeEachPlayer's
    // eligibleSeats pattern) so a loop body that mutates the source collection (removes
    // or moves items) still visits every original item. GameElements are stored tagged
    // by JSON-plain id (re-resolved via getElementById each iteration) so a bare-number
    // primitive item is never mistaken for an element id on re-resolution (the same
    // ambiguity class as ENG-05/resolveArgs); non-element JSON primitives are stored
    // as-is. This also keeps frame.data checkpoint-safe (no object refs).
    if (frame.data?.forEachItems === undefined) {
      const items = typeof config.collection === 'function'
        ? config.collection(context)
        : config.collection;

      const snapshot = items.map((item): ForEachSnapshotItem => {
        if (item instanceof GameElement) {
          const hiddenContainerId = hiddenContainerIdOf(item);
          return hiddenContainerId !== undefined
            ? { elementId: item.id, hiddenContainerId }
            : { elementId: item.id };
        }
        const type = typeof item;
        if (type === 'string' || type === 'number' || type === 'boolean' || item === null) {
          return { value: item as string | number | boolean | null };
        }
        throw new Error(
          `forEach() collection item is not a GameElement or JSON primitive (got ${type}). ` +
          `Only GameElement instances and string/number/boolean values are supported, ` +
          `so the loop's per-item snapshot can round-trip through checkpoint/restore.`
        );
      });

      frame.data = {
        ...frame.data,
        forEachItems: snapshot,
        itemIndex: 0,
      };
    }

    const items = (frame.data.forEachItems as ForEachSnapshotItem[]) ?? [];
    const itemIndex = (frame.data.itemIndex as number) ?? 0;

    if (itemIndex >= items.length) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    const rawItem = items[itemIndex];
    if ('elementId' in rawItem) {
      // CR-02 (159): the forEach snapshot stores the ORIGINAL element id.
      // On a redacted clone, a fungible hidden-zone child was anonymized to a
      // synthetic id by `toJSONForPlayer` -- the direct lookup below won't
      // find it there, so fall back to `hiddenIdRemap` (same remap
      // `relinkFlowVariables` uses) before concluding the element is
      // genuinely gone.
      let element = this.game.getElementById(rawItem.elementId);
      if (!element && this.hiddenIdRemap) {
        const syntheticId = this.hiddenIdRemap.get(rawItem.elementId);
        if (syntheticId !== undefined) {
          element = this.game.getElementById(syntheticId);
        }
      }
      // WR-01 (163-REVIEW): no idRemap entry for a zone-`'hidden'` item
      // (none is ever registered -- see D24/hiddenContainerIdOf). Fall back
      // to the snapshot's own recorded container id: a live, already-
      // disclosed element, so relinking to it reveals nothing new.
      if (!element && rawItem.hiddenContainerId !== undefined) {
        element = this.game.getElementById(rawItem.hiddenContainerId);
      }
      if (!element) {
        throw new Error(
          `forEach() snapshot references element id ${rawItem.elementId}, but it no longer ` +
          `exists in the game tree (it may have been permanently removed, not just moved). ` +
          `A loop body must not delete elements it iterates over; move them instead.`
        );
      }
      this.variables[config.as] = element;
    } else {
      this.variables[config.as] = rawItem.value;
    }

    this.stack.push({ node: config.do, index: 0, completed: false });
    frame.data = { ...frame.data, itemIndex: itemIndex + 1 };
    frame.index++;

    return { continue: true, awaitingInput: false };
  }

  // ============================================================================
  // SECTION: Action Step Executors
  // Purpose: Action step and simultaneous action step execution
  // ============================================================================

  /**
   * Execute an action step - the primary player interaction point.
   *
   * Handles complex move counting logic:
   * - minMoves: Minimum actions required before step can complete
   * - maxMoves: Maximum actions allowed (auto-completes when reached)
   * - repeatUntil: Condition-based completion (only checked after minMoves met)
   *
   * Move counting only increments when a full action chain completes (no followUp),
   * preventing followUp chains from counting against move limits.
   *
   * Filters available actions to those actually valid for the current player,
   * warning once about unknown action names to help catch typos.
   */
  /**
   * The move count a FRESH action-step frame starts at.
   *
   * Zero unless the seat about to be prompted is the same seat that committed
   * the immediately preceding action -- the one case where the frame boundary
   * and the turn boundary can disagree. `moveCount` is the sole input to undo's
   * rewind anchor (`session/utils.ts` `computeUndoInfo`), so starting a
   * continuing turn's second entry at 0 means the seat cannot take back the
   * action it just took.
   *
   * The engine cannot infer which was meant, and the two readings are not
   * distinguishable from the flow's shape: a `sequence` of same-seat action
   * steps is ONE turn in Polyhedral Potions and THREE separate turns in
   * `session/testing/solo-undo-authoritative.test.ts`. So the author declares
   * it with `turnScope`, and an ambiguous entry that declares nothing warns in
   * dev and marks the frame, so the undo it disables says why.
   */
  private entryMoveCount(config: ActionStepConfig<G>, player: Player, frame: ExecutionFrame<G>): number {
    const run = this.turnRun;
    if (!run || run.player !== player.seat || run.count === 0) return 0;

    if (config.turnScope === 'continue') return run.count;

    if (config.turnScope === 'restart') {
      // The run ends here: this entry is the start of a new turn.
      this.turnRun = undefined;
      return 0;
    }

    // Undeclared, and ambiguous. Behave as `'restart'` -- the safe reading,
    // since reaching too far back discards actions the author may consider
    // finished -- but never silently: warn here, and mark the frame so an undo
    // attempted at this point is refused with the reason rather than with the
    // misleading "No actions to undo" that hid this defect for so long.
    //
    // Deliberately NOT a throw. This is only detectable at the moment the flow
    // reaches the shape, so a throw would be exactly the "surprise runtime
    // throw deep into a game session" that `loop`'s construction-time check
    // (builders.ts) exists to avoid, and it would fire in games where undo is
    // never offered and the distinction cannot be observed.
    const stepName = config.name ?? 'action-step';
    const where = config.name
      ? `'${stepName}'`
      : `'${stepName}' at flow path ${this.stack.map((f) => f.index).join('.')}`;
    devWarn(
      // Keyed on the step's IDENTITY (name plus stack depth), never on the
      // path -- a loop's path index moves every iteration, which would re-warn
      // once per move instead of once per step.
      `turn-scope:${stepName}:${this.stack.length}`,
      `Flow step ${where} is about to prompt seat ${player.seat} again, in a new ` +
      `action-step frame, right after that same seat committed an action. Undo reach is ` +
      `measured per action-step frame, so undo is OFF at this point until the step says ` +
      `whether the seat is still taking the same turn:\n` +
      `  turnScope: 'continue'  -- one continuing turn (a multi-jump, an extra turn, the ` +
      `next step of a multi-step turn). Undo reaches back over the whole run.\n` +
      `  turnScope: 'restart'   -- a new turn starts here. Undo does not reach behind it.\n` +
      `Add one of those to actionStep({ name: '${stepName}', ... }).`
    );
    frame.data = { ...frame.data, turnScopeUndeclared: stepName };
    this.turnRun = undefined;
    return 0;
  }

  private executeActionStep(
    frame: ExecutionFrame<G>,
    config: ActionStepConfig<G>,
    context: FlowContext<G>
  ): FlowStepResult {
    // Check skip condition
    if (config.skipIf?.(context)) {
      this.currentActionConfig = undefined;
      this.moveCount = 0;
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    // Initialize move count on first entry. A fresh frame does not always start
    // at 0: `turnScope` decides whether this entry continues the run the same
    // seat is already on, which is what gives undo its reach across the frame
    // boundary a loop iteration or a sibling step creates.
    if (frame.data?.moveCount === undefined) {
      const entryPlayer = config.player ? config.player(context) : context.player;
      if (!entryPlayer) {
        throw new Error('ActionStep requires a player');
      }
      // Resolved BEFORE the assignment: `entryMoveCount` may also mark the
      // frame, and a spread evaluated first would discard that mark.
      const startingMoveCount = this.entryMoveCount(config, entryPlayer, frame);
      frame.data = { ...frame.data, moveCount: startingMoveCount };
    }
    const moveCount = frame.data.moveCount as number;

    // Save previous player on first entry so we can restore after a player: override completes.
    // This prevents a player override from leaking into subsequent sibling steps.
    if (config.player && !frame.data?.playerSaved) {
      frame.data = { ...frame.data, playerSaved: true, previousPlayer: this.currentPlayer };
    }

    // Check if maxMoves reached
    if (config.maxMoves && moveCount >= config.maxMoves) {
      this.restorePlayerFromActionStep(frame);
      this.currentActionConfig = undefined;
      this.moveCount = 0;
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    const minMovesMet = !config.minMoves || moveCount >= config.minMoves;

    // Determine player
    const player = config.player ? config.player(context) : context.player;
    if (!player) {
      throw new Error('ActionStep requires a player');
    }

    // Get available actions
    const actions = typeof config.actions === 'function'
      ? config.actions(context)
      : config.actions;

    // A name with no registered action is a structural authoring error, not a
    // condition that happens to be false — see requireRegisteredActions.
    this.requireRegisteredActions(actions, config.name ?? 'action-step');

    const allAvailable = this.game.getAvailableActions(player);
    const available = actions.filter((actionName) =>
      allAvailable.some((a) => a.name === actionName)
    );

    // If no available actions and minMoves met, complete
    if (available.length === 0 && minMovesMet) {
      this.restorePlayerFromActionStep(frame);
      this.currentActionConfig = undefined;
      this.moveCount = 0;
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    // If no available actions but minMoves not met, this is an error state
    if (available.length === 0 && !minMovesMet) {
      throw new Error(`ActionStep requires ${config.minMoves} moves but only ${moveCount} were possible`);
    }

    // Store config for getState() move count tracking
    this.currentActionConfig = config;
    this.moveCount = moveCount;

    // Prompt for input
    this.currentPlayer = player;
    this.availableActions = available;

    // Don't mark completed yet - we'll continue after input
    return {
      continue: false,
      awaitingInput: true,
      availableActions: available,
      currentPlayer: player,
    };
  }

  private executeSimultaneousActionStep(
    frame: ExecutionFrame<G>,
    config: SimultaneousActionStepConfig<G>,
    context: FlowContext<G>
  ): FlowStepResult {
    // Get players who should participate
    const players: PlayerOf<G>[] = config.players
      ? config.players(context)
      : [...this.game.players];

    // Build awaiting state for each player
    this.awaitingPlayers = [];

    // 160-02 (D4 step-window bound): reset the per-step move counter on
    // fresh entry into THIS simultaneous-action-step frame -- the
    // simultaneous analogue of `executeActionStep`'s per-frame `moveCount`.
    // Without a step-scoped counter, `session/utils.ts`'s per-seat undo
    // boundary has no way to distinguish "this seat acted earlier in the
    // CURRENT step" from "this seat also acted in a PRIOR step/phase" when
    // no other seat's action happens to fall between the two -- the
    // simultaneous-step cross-phase trap. Stored in `frame.data` (not just
    // the private field) so it survives the position round-trip exactly
    // like `executeActionStep`'s moveCount (`getPosition`/`restore`).
    frame.data = { ...frame.data, moveCount: 0 };
    this.moveCount = 0;
    // A simultaneous step is a turn boundary in its own right: its undo
    // boundary comes from `simultaneousUndoBoundary` (session/utils.ts), not
    // from a sequential run, so no run survives across it.
    this.turnRun = undefined;

    for (const player of players) {
      // Check if player should be skipped
      if (config.skipPlayer?.(context, player)) {
        continue;
      }

      // Check if player is already done
      if (config.playerDone?.(context, player)) {
        continue;
      }

      // Get available actions for this player
      const actions = typeof config.actions === 'function'
        ? config.actions(context, player)
        : config.actions;

      this.requireRegisteredActions(actions, config.name ?? 'simultaneous-action-step');

      const available = actions.filter((actionName) =>
        this.game.getAvailableActions(player).some((a) => a.name === actionName)
      );

      // Only add player if they have available actions
      if (available.length > 0) {
        this.awaitingPlayers.push({
          playerIndex: player.seat,
          availableActions: available,
          completed: false,
        });
      }
    }

    // D21/SIM-03: consult allDone BEFORE the empty-guard so an empty
    // awaiting set is decided through the SAME allDone-aware path as every
    // other completion, rather than short-circuiting past it.
    if (config.allDone?.(context)) {
      this.awaitingPlayers = [];
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    // If no players need to act, the step is over -- but only when the game has
    // not declared its own completion condition. A custom `allDone` was
    // consulted just above and returned false, which makes it authoritative:
    // completing here anyway would advance the flow into a state the game
    // explicitly says has not been reached. That is BUG 7's failure -- a seat
    // is absent from `awaitingPlayers` merely because it cannot currently form
    // a legal action (a depleted hand), not because it is done, so the next
    // node reads the half-built state the step was supposed to guard. Staying
    // awaiting with an empty set is an honest stall the game can resolve (refill
    // the hand, reach a terminator); force-advancing is not recoverable.
    if (this.awaitingPlayers.length === 0) {
      if (config.allDone) {
        this.warnIfDeadlockedSimultaneousStep(config);
        return { continue: false, awaitingInput: true };
      }
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    // Don't mark completed - waiting for all players
    return {
      continue: false,
      awaitingInput: true,
    };
  }

  // ============================================================================
  // SECTION: Conditional Executors
  // Purpose: Switch, if, execute, phase execution
  // ============================================================================

  private executeSwitch(
    frame: ExecutionFrame<G>,
    config: SwitchConfig<G>,
    context: FlowContext<G>
  ): FlowStepResult {
    // If we've already pushed a branch, we're done (child has completed)
    if (frame.data?.branchPushed) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    const value = config.on(context);
    const stringValue = String(value);

    const hasCase = Object.prototype.hasOwnProperty.call(config.cases, stringValue);
    const branch = hasCase ? config.cases[stringValue] : config.default;
    if (!branch) {
      const availableCases = Object.keys(config.cases).join(', ');
      const namePrefix = config.name ? `switchOn "${config.name}"` : 'switchOn';
      throw new Error(
        `${namePrefix} got ${JSON.stringify(stringValue)} — no matching case (${availableCases}) and no default. ` +
        `Add a case for this value or a default branch: the on() callback must be handled for every value it can yield.`
      );
    }

    this.stack.push({ node: branch, index: 0, completed: false });
    frame.data = {
      ...frame.data,
      branchPushed: true,
      branchKey: hasCase ? stringValue : '__default',
      branchIndex: hasCase ? Object.keys(config.cases).indexOf(stringValue) : Object.keys(config.cases).length,
    };

    return { continue: true, awaitingInput: false };
  }

  private executeIf(
    frame: ExecutionFrame<G>,
    config: IfConfig<G>,
    context: FlowContext<G>
  ): FlowStepResult {
    // If we've already pushed a branch, we're done (child has completed)
    if (frame.data?.branchPushed) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    const condition = config.condition(context);

    if (condition) {
      this.stack.push({ node: config.then, index: 0, completed: false });
      frame.data = { ...frame.data, branchPushed: true, branchIndex: 0 };
    } else if (config.else) {
      this.stack.push({ node: config.else, index: 0, completed: false });
      frame.data = { ...frame.data, branchPushed: true, branchIndex: 1 };
    } else {
      // No branch to execute, complete immediately
      frame.completed = true;
    }

    return { continue: true, awaitingInput: false };
  }

  private executeExecute(
    frame: ExecutionFrame<G>,
    config: ExecuteConfig<G>,
    context: FlowContext<G>
  ): FlowStepResult {
    // Run the side effect function
    config.fn(context);
    // Update variables in engine from context
    this.variables = { ...context.variables };
    frame.completed = true;
    // UNDO-02: signal a COMMITMENT the author declared irreversible, so
    // `GameRunner` can set/advance its durable `executeBarrierIndex` (it reads
    // this after every recorded action). An ordinary bookkeeping `execute()`
    // deliberately does not fence undo -- see `ExecuteConfig.irreversible`.
    // `frame.completed` above does NOT survive checkpoint restore (a fresh
    // FlowEngine is built with a fresh stack), so it cannot be the fence on its
    // own -- this counter exists only to be observed by the runner before that
    // engine is discarded.
    if (config.irreversible) this.irreversibleCommitCount++;
    return { continue: true, awaitingInput: false };
  }

  private executePhase(
    frame: ExecutionFrame<G>,
    config: PhaseConfig<G>,
    context: FlowContext<G>
  ): FlowStepResult {
    // If we haven't entered this phase yet
    if (!frame.data?.entered) {
      // Set current phase
      const previousPhase = this.currentPhase;
      this.currentPhase = config.name;

      // Call onEnterPhase hook
      if (this.definition.onEnterPhase) {
        this.definition.onEnterPhase(config.name, context);
      }

      // Push the phase body and mark as entered
      this.stack.push({ node: config.do, index: 0, completed: false });
      frame.data = { entered: true, previousPhase };

      return { continue: true, awaitingInput: false };
    }

    // Phase body has completed - call onExitPhase hook
    if (this.definition.onExitPhase) {
      this.definition.onExitPhase(config.name, context);
    }

    // Restore previous phase (for nested phases)
    this.currentPhase = frame.data.previousPhase as string | undefined;
    frame.completed = true;

    return { continue: true, awaitingInput: false };
  }
}
