import type { Game, PlayerOf } from '../element/game.js';
import type { VisibilityState } from '../element/visibility.js';
import { GameElement, hasZoneVisibility, withheldFromSeat, WITHHELD_PILE_BRANCH } from '../element/game-element.js';
import { Player } from '../player/player.js';
import { devWarn, isDevMode } from '../../utils/dev.js';
import { PlayerFacingError, orNoMoveWhenWithheld } from '../errors.js';
import { withDevDetail } from '../action/rules-error.js';
import { changing, flowStateRead } from '../element/state-version.js';
import type { ActionResult, FollowUpAction } from '../action/types.js';
import type { AcceptedArgs } from '../action/action.js';
import type {
  FlowNode,
  FlowContext,
  FlowPosition,
  TurnRun,
  FlowState,
  PublishedFollowUp,
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
import { resolveTimeLimit } from './step-time-limit.js';
import { flowChildCount, resolveFlowChild, SWITCH_DEFAULT_KEY } from './flow-navigation.js';

/**
 * What running one flow node reports: whether the flow now waits for input.
 */
interface StepResult {
  awaitingInput: boolean;
}

/**
 * Maximum iterations for safety (prevent infinite loops)
 */
const DEFAULT_MAX_ITERATIONS = 10000;

/**
 * Marker for an element held in flow state: a flow variable (e.g.
 * `eachPlayer`'s `currentPlayer`, a `forEach` `as` binding), or frame data
 * (`forEach`'s snapshot of its collection, `previousPlayer`). A live element is
 * NOT structured-cloneable, so a flow state carrying one throws
 * `DataCloneError` when broadcast over postMessage or sent across the executor
 * RPC boundary. `encodeFlowValue` writes this marker on the way out (in
 * `getPosition`); `relinkFlowValue` resolves it back to the live element on
 * the way in (in `restore`). Ids, not branches, so a redacted clone can relink
 * through `idRemap`.
 */
interface SerializedFlowElement {
  __flowElementId: number;
  className: string;
  /**
   * WR-01 (163-REVIEW), #726: the id of the element's outermost concealing
   * ancestor at serialize time (see `hiddenContainerIdOf`), present ONLY when
   * it has one. A concealed subtree builds no per-descendant placeholder below
   * its first level and registers nothing in `idRemap` for it (for a
   * `'hidden'` zone, an entry per child would let the map's SIZE leak the
   * exact count) -- so this marker carries the ONE piece of already-disclosed
   * information needed to relink safely on redacted-clone restore: that
   * ancestor, which every viewer sees because nothing above it conceals. This
   * is a single scalar per flow-variable marker, not a structure that scales
   * with hidden-zone child count, so it cannot re-leak the count.
   */
  __hiddenContainerId?: number;
}

/** How flow state written for a seat holds an element in the pile (#655): as
 *  attributes do, without its id or place, and it restores to nothing. */
const WITHHELD_FLOW_ELEMENT = { __elementRef: WITHHELD_PILE_BRANCH } as const;

/** WR-01 (163-REVIEW), #726: the id of `element`'s OUTERMOST ancestor that may
 *  conceal its subtree from some seat (a non-public zone, or an element some
 *  seat cannot see), so a redacted-clone restore degrades to that
 *  (already-disclosed) ancestor, never a per-child structure whose size would
 *  leak a hidden zone's exact child count. Outermost, not nearest: anything
 *  below a concealing ancestor may itself be missing from the view. */
function hiddenContainerIdOf(element: GameElement): number | undefined {
  let found: number | undefined;
  for (let ancestor = element.parent; ancestor; ancestor = ancestor.parent) {
    const zoneVisibility = hasZoneVisibility(ancestor) ? ancestor.getZoneVisibility() : undefined;
    if (!isPublic(ancestor.getEffectiveVisibility()) || (zoneVisibility && !isPublic(zoneVisibility))) {
      found = ancestor.id;
    }
  }
  return found;
}

function isPublic(visibility: VisibilityState): boolean {
  return visibility.mode === 'all' && !visibility.exceptPlayers?.length;
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
function encodeFlowValue(value: unknown): unknown {
  if (value instanceof GameElement) {
    if (withheldFromSeat(value)) return WITHHELD_FLOW_ELEMENT;
    const marker: SerializedFlowElement = { __flowElementId: value.id, className: value.constructor.name };
    const hiddenContainerId = hiddenContainerIdOf(value);
    if (hiddenContainerId !== undefined) {
      marker.__hiddenContainerId = hiddenContainerId;
    }
    return marker;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(encodeFlowValue);
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = encodeFlowValue(entry);
  }
  return result;
}

/**
 * The live element of `game` a flow marker names.
 *
 * @param idRemap - CR-02 (159): the `originalId -> syntheticId` map
 *   `Game.toJSONForPlayer` produces for a per-seat REDACTED clone (e.g. the MCTS
 *   bot's search sandbox), passed exactly when restoring one, even if empty.
 *   A fungible hidden-zone child is anonymized to a synthetic id there, so a
 *   marker holding its ORIGINAL id resolves through the remap to the
 *   (still-redacted) placeholder. Failing that, a marker that recorded its
 *   outermost concealing ancestor (WR-01, #726) resolves to that ancestor,
 *   which every viewer already sees. Without it (a full restore) neither
 *   fallback applies (#947).
 * @param name - The flow slot holding the marker, for the error.
 * @throws When nothing resolves: the element is gone from the game, and handing
 *   the rules a marker object where they expect an element would fail later
 *   and far from the cause.
 */
function resolveFlowElement(
  marker: SerializedFlowElement,
  game: Game,
  idRemap: Map<number, number> | undefined,
  name: string,
): GameElement {
  const live = game.getElementById(marker.__flowElementId);
  if (live && live.constructor.name === marker.className) return live;
  // A full restore holds every element the marker was written against, so a miss there is a real mismatch (#947).
  if (idRemap) {
    const syntheticId = idRemap.get(marker.__flowElementId);
    const resolved =
      (syntheticId !== undefined ? game.getElementById(syntheticId) : undefined) ??
      (marker.__hiddenContainerId !== undefined ? game.getElementById(marker.__hiddenContainerId) : undefined);
    if (resolved) return resolved;
  }
  throw new Error(
    `Flow ${name} references element id ${marker.__flowElementId} (${marker.className}), but it no longer ` +
    `exists in the game: it is neither in the tree nor in game.pile. An element the flow holds must stay in ` +
    `the game; remove() it or move it instead of detaching it, or restore the flow with the state it was saved with.`
  );
}

/** Inverse of `encodeFlowValue`: resolve every marker in `value` to a live
 *  element of `game` (see `resolveFlowElement`). A marker withheld from a seat
 *  becomes `undefined`, as a withheld attribute does. A live element
 *  (in-process, never serialized) is passed through unchanged.
 *
 *  @param kind - What `value` is, for the error: `variable` or `step data`.
 *  @param path - Where in it the recursion is; omitted for the record itself. */
function relinkFlowValue(
  value: unknown,
  game: Game,
  idRemap: Map<number, number> | undefined,
  kind: string,
  path?: string,
): unknown {
  if (value === null || typeof value !== 'object' || value instanceof GameElement) {
    return value;
  }
  if (isSerializedFlowElement(value)) {
    return resolveFlowElement(value, game, idRemap, `${kind} '${path}'`);
  }
  if ((value as { __elementRef?: unknown }).__elementRef === WITHHELD_PILE_BRANCH) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((entry, i) => relinkFlowValue(entry, game, idRemap, kind, `${path}[${i}]`));
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = relinkFlowValue(entry, game, idRemap, kind, path === undefined ? key : `${path}.${key}`);
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
 * FlowEngine is the runtime interpreter for flow definitions: plain objects
 * whose nodes come from the flow builder functions. It handles:
 * - Executing flow nodes (sequences, loops, conditionals, action steps)
 * - Pausing at action steps to wait for player input
 * - Resuming after player actions
 * - Ending the flow once the game says it is finished
 * - Serializing/restoring state for persistence
 *
 * Most game developers don't interact with FlowEngine directly - instead use
 * the flow builder functions to define game flow, and the game session handles
 * engine operations automatically.
 *
 * @example
 * ```typescript
 * // Define the flow
 * const flow: FlowDefinition = {
 *   setup: (ctx) => { ... },
 *   root: loop({
 *     while: (ctx) => !ctx.game.isFinished(),
 *     do: eachPlayer({ do: playerTurn })
 *   }),
 * };
 *
 * // Engine is created internally by GameRunner
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
    super(withDevDetail(
      'Game halted: the flow failed after the action was committed. ' +
      'This is a flow-definition bug, not a retryable player error; the game cannot continue until the flow definition is fixed.',
      cause,
    ));
    this.name = 'FlowHaltedError';
    // The message carries the cause only in dev, so whoever reports the halt logs it from here (#1120).
    this.cause = cause;
  }
}

export class FlowEngine<G extends Game = Game> {
  private game: G;
  private definition: FlowDefinition<G>;
  private stack: ExecutionFrame<G>[] = [];
  private variables: Record<string, unknown> = {};
  private currentPlayer?: PlayerOf<G>;
  private awaitingInput = false;
  private availableActions: string[] = [];
  private complete = false;
  private lastActionResult?: ActionResult;
  /** Error from last action if it failed (cleared on success) */
  private actionError?: string;
  /** See FlowState.actionPartiallyApplied — set alongside actionError. */
  private actionPartiallyApplied = false;
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

  /**
   * The names in `declared` that `player` can take right now: the one answer
   * every step gives to "which of this step's actions does this seat get".
   * Refuses an unregistered name first (see requireRegisteredActions), and
   * checks only the declared actions, so an action the step does not offer never runs.
   */
  private offeredActions(declared: string[], player: Player, stepName: string): string[] {
    this.requireRegisteredActions(declared, stepName);
    const executor = this.game.getActionExecutor();
    return declared.filter((name) => orNoMoveWhenWithheld(
      name, player.seat, () => executor.isActionAvailable(this.game.getAction(name)!, player), () => false,
    ));
  }

  /**
   * Where `player` stands in the open simultaneous step `frame`: excluded by
   * `skipPlayer`, finished by `playerDone`, or still awaited. A seat holding a
   * follow-up is awaited whatever the two callbacks say, because the follow-up
   * is what it has left to take. Entry, refresh and the re-evaluation after a
   * seat acts all ask this, and differ only in what they do with the answer.
   */
  private seatEligibility(
    config: SimultaneousActionStepConfig<G>,
    context: FlowContext<G>,
    player: Player,
    frame: ExecutionFrame<G>,
  ): 'skipped' | 'done' | 'awaited' {
    if (this.heldFollowUp(frame, player.seat) !== undefined) return 'awaited';
    if (config.skipPlayer?.(context, player as never)) return 'skipped';
    if (config.playerDone?.(context, player as never)) return 'done';
    return 'awaited';
  }

  /** The names a sequential action step offers `player`, from its declared list. */
  private offeredSequentialActions(config: ActionStepConfig<G>, context: FlowContext<G>, player: Player): string[] {
    const declared = typeof config.actions === 'function' ? config.actions(context) : config.actions;
    return this.offeredActions(declared, player, config.name ?? 'action-step');
  }

  /** The names a simultaneous step offers `player`, from its declared list. */
  private offeredSimultaneousActions(
    config: SimultaneousActionStepConfig<G>,
    context: FlowContext<G>,
    player: Player,
  ): string[] {
    const declared = typeof config.actions === 'function'
      ? config.actions(context, player as never)
      : config.actions;
    return this.offeredActions(declared, player, config.name ?? 'simultaneous-action-step');
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
  /**
   * Set only inside `restartWithoutOpening`'s run, to the seat the restart
   * hands the turn to: `execute` nodes are passed over, and every round the
   * run enters is joined at this seat's place in it.
   */
  private restartSeat: number | undefined;

  constructor(game: G, definition: FlowDefinition<G>) {
    this.game = game;
    this.definition = definition;
  }

  // ============================================================================
  // SECTION: Public API
  // Purpose: External interface - start, resume, getState, restore, isComplete
  // ============================================================================

  /**
   * Start the flow from the beginning: run the flow's `setup`, then every node
   * from the root until the flow needs input or completes.
   */
  start(): FlowState {
    const context = this.createContext();
    if (this.definition.setup) {
      changing(this.game._ctx, () => this.definition.setup!(context));
    }
    this.resetToRoot(context.variables);
    return this.run();
  }

  /**
   * Put a running flow back at its beginning without running any of its
   * opening game code: the flow's `setup` is not called, and every `execute`
   * node met before the flow next needs input is passed over. The flow's
   * variables are kept as they are, because the setup and executes that set
   * them already ran once in this game.
   * Phase hooks are not skipped: `onEnterPhase` runs again for each phase
   * entered before the first step that needs input, and the phase the game
   * was in when it restarted is abandoned without its `onExitPhase`.
   *
   * The turn goes to `seat`: it is the flow's current seat at the root, and
   * every `eachPlayer` round entered before the first step that needs input
   * is built in its usual order (its own direction, starting player and
   * filter) and joined at `seat`'s place in it, skipping the seats before
   * it, so the round after runs in its usual order. A round whose filter
   * leaves `seat` out is joined at its start instead, and a step that names
   * its own player still prompts that player.
   *
   * Used by a tutorial start (`Game.restartFlowForTutorial`) to hand the turn
   * to the tutorial's learner seat.
   */
  restartWithoutOpening(seat: number): FlowState {
    this.resetToRoot(this.variables);
    this.currentPlayer = this.game.getPlayer(seat) as PlayerOf<G> | undefined;
    this.restartSeat = seat;
    try {
      return this.run();
    } finally {
      this.restartSeat = undefined;
    }
  }

  /** Clear every position field and stand the flow at its root node. */
  private resetToRoot(variables: Record<string, unknown>): void {
    this.stack = [{ node: this.definition.root, index: 0, completed: false }];
    this.variables = { ...variables };
    this.currentPlayer = this.game.firstPlayer;
    this.awaitingInput = false;
    this.availableActions = [];
    this.awaitingPlayers = [];
    this.complete = false;
    this.currentActionConfig = undefined;
    this.moveCount = 0;
    this.turnRun = undefined;
    this.lastActionResult = undefined;
    this.actionError = undefined;
    this.actionPartiallyApplied = false;
    this.currentPhase = undefined;
  }

  /**
   * Resume flow after player action
   * @param actionName The action to perform
   * @param args The action arguments
   * @param playerIndex Optional player index for simultaneous actions (if not provided, uses current player)
   * @param onAccepted Handed the action's args once its checks accept them (`PerformOptions.onAccepted`)
   */
  resume(actionName: string, args: Record<string, unknown>, playerIndex?: number, onAccepted?: AcceptedArgs): FlowState {
    if (!this.awaitingInput) {
      throw new Error('Flow is not awaiting input');
    }

    const currentFrame = this.stack[this.stack.length - 1];

    // Handle simultaneous action step
    if (currentFrame?.node.type === 'simultaneous-action-step') {
      return this.resumeSimultaneousAction(actionName, args, playerIndex, currentFrame, onAccepted);
    }

    const player = this.currentPlayer!;

    // The acting seat's own follow-up, taken as one whole action.
    const followUp = currentFrame && this.heldFollowUp(currentFrame, player.seat);
    if (followUp?.action === actionName) {
      return this.resumeAfterExternalAction(this.performFollowUp(followUp, player, args, onAccepted), player.seat);
    }

    // Enforce flow-level allow-list for regular action steps.
    if (currentFrame?.node.type === 'action-step' && !this.availableActions.includes(actionName)) {
      this.actionError = `Action ${actionName} is not available in the current flow step`;
      return this.getState();
    }

    // Execute the action (regular action step), then settle its result exactly
    // as a result executed elsewhere (a completed pending action) is settled.
    return this.resumeAfterExternalAction(this.game.performAction(actionName, player, args, { onAccepted }), player.seat);
  }

  /**
   * Take a seat's held follow-up as one whole action. Its condition is not
   * checked (the chain offers it, not the condition) and the args it was
   * published with are the ones it runs with: a follow-up is pre-filled.
   * `args` are the client's, and may name only picks (#662).
   */
  private performFollowUp(
    followUp: FollowUpAction,
    player: PlayerOf<G>,
    args: Record<string, unknown>,
    onAccepted: AcceptedArgs | undefined,
  ): ActionResult {
    return this.game.performAction(followUp.action, player, args, { followUp, onAccepted });
  }

  /**
   * Resume flow after an action was executed externally (e.g., via pending action).
   * This is like resume() but skips the action execution since it already happened.
   * @param result The result of the externally-executed action
   * @param seat The seat that took the action: the owner of any follow-up it returned
   */
  resumeAfterExternalAction(result: ActionResult, seat: number): FlowState {
    if (!this.awaitingInput) {
      throw new Error('Flow is not awaiting input');
    }

    // In a simultaneous step the action is settled for its seat alone, exactly
    // as one taken through resume() is: the other seats, and what the step
    // holds for them, are left as they are.
    const frame = this.stack[this.stack.length - 1];
    if (frame?.node.type === 'simultaneous-action-step') return this.settleExternalSimultaneousAction(frame, seat, result);

    if (frame?.node.type === 'action-step' && this.currentPlayer?.seat !== seat) {
      throw new Error(
        `Seat ${seat} took an action, but the open action step is awaiting seat ${this.currentPlayer?.seat}, ` +
          `so it cannot be settled there. Ask GameRunner.refusalToPick(action, seat, pending) before running a pending action.`,
      );
    }

    if (!this.recordActionResult(result, seat)) return this.getState();
    this.awaitingInput = false;
    return this.continueAfterCommittedAction(result);
  }

  /** Settles an action taken outside the flow for `seat` alone, in the open simultaneous step `frame`. */
  private settleExternalSimultaneousAction(frame: ExecutionFrame<G>, seat: number, result: ActionResult): FlowState {
    const playerState = this.awaitingPlayers.find((p) => p.playerIndex === seat && !p.completed);
    const player = this.game.getPlayer(seat);
    if (!playerState || !player) {
      throw new Error(
        `Seat ${seat} is not awaited by the open simultaneous step, so its action cannot be settled there. ` +
          `Ask GameRunner.refusalToPick(action, seat, pending) before running a pending action.`,
      );
    }
    return this.settleSimultaneousAction(frame, playerState, player, result);
  }

  /**
   * A host deadline passed (the step's time limit, or one the host keeps on
   * any step) while `seat` held a follow-up, and the step does not offer that
   * seat the game's idle action. Host deadlines always win (#494): the
   * follow-up is dropped and the seat's part ends, as if it had
   * finished. In an action step that ends the step; in a simultaneous step the
   * seat is marked done and the step ends when its `allDone` says so.
   *
   * The runner records the expiry as an entry of the action history, so the
   * step counts it the way it counts an action: in the undo window (an action
   * step's `actionCount`, a simultaneous step's `moveCount`) and in the run a
   * `turnScope: 'continue'` step carries on from. It is not a move: the chain
   * it ended never completed, so move limits do not see it.
   *
   * Only for a host closing a seat at a deadline: `GameRunner.closeExpiredHeldSeat`
   * checks that the seat holds a follow-up the step's idle action cannot
   * replace before calling this.
   */
  expireHeldSeat(seat: number): FlowState {
    const frame = this.stack[this.stack.length - 1];
    if (!this.awaitingInput || !frame || !this.heldFollowUp(frame, seat)) {
      throw new Error(`Seat ${seat} holds no follow-up in the open step, so there is nothing to expire.`);
    }
    this.holdFollowUp(frame, seat, undefined);
    if (frame.node.type === 'simultaneous-action-step') return this.expireSimultaneousSeat(frame, seat);

    const actionCount = ((frame.data?.actionCount as number) ?? 0) + 1;
    frame.data = { ...frame.data, actionCount };
    this.turnRun = { player: seat, count: (frame.data.moveCount as number) ?? 0, actions: actionCount };
    this.completeActionStep(frame);
    this.awaitingInput = false;
    return this.run();
  }

  /**
   * `expireHeldSeat` in a simultaneous step: the seat is marked done, and the
   * step ends when its `allDone` says so.
   */
  private expireSimultaneousSeat(frame: ExecutionFrame<G>, seat: number): FlowState {
    const config = frame.node.config as SimultaneousActionStepConfig;
    const playerState = this.awaitingPlayers.find((p) => p.playerIndex === seat);
    if (playerState) playerState.completed = true;
    const moveCount = ((frame.data?.moveCount as number) ?? 0) + 1;
    frame.data = { ...frame.data, moveCount };
    this.moveCount = moveCount;
    const allDone = config.allDone
      ? config.allDone(this.createContext())
      : this.awaitingPlayers.every((p) => p.completed);
    if (!allDone) {
      this.warnIfDeadlockedSimultaneousStep(config);
      return this.getState();
    }
    this.awaitingInput = false;
    this.awaitingPlayers = [];
    frame.completed = true;
    return this.run();
  }

  /**
   * Record an action's result. A failure stays in the same state with its error
   * recorded, and leaves every held follow-up as it was; returns whether the
   * action succeeded. A success replaces `seat`'s follow-up with the one the
   * action returned, or drops it when it returned none: taking another action
   * is how a seat declines its follow-up.
   */
  private recordActionResult(result: ActionResult, seat: number): boolean {
    this.lastActionResult = result;
    if (!result.success) {
      this.actionError = result.error;
      // #44/#325: a failure that may have applied part of its changes.
      // Staying put is right for the flow, but the runner still has to roll
      // the game state back, and this is how it learns it must.
      this.actionPartiallyApplied = result.partiallyApplied === true;
      return false;
    }
    this.actionError = undefined;
    this.actionPartiallyApplied = false;
    this.holdFollowUp(this.stack[this.stack.length - 1], seat, result.followUp);
    return true;
  }

  /**
   * The follow-ups a step frame holds, keyed by seat. They live in the frame's
   * own data, so they end with the step and survive every position round trip
   * (checkpoint, snapshot, undo) with nothing else to restore.
   */
  private heldFollowUps(frame: ExecutionFrame<G> | undefined): Record<string, FollowUpAction> {
    return (frame?.data?.followUps as Record<string, FollowUpAction> | undefined) ?? {};
  }

  /** The follow-up `frame` holds for `seat`, if any. */
  private heldFollowUp(frame: ExecutionFrame<G>, seat: number): FollowUpAction | undefined {
    return this.heldFollowUps(frame)[String(seat)];
  }

  /** Set (or, with no follow-up, drop) the follow-up `frame` holds for `seat`. */
  private holdFollowUp(frame: ExecutionFrame<G> | undefined, seat: number, followUp: FollowUpAction | undefined): void {
    if (!frame) return;
    const held = { ...this.heldFollowUps(frame) };
    if (followUp) {
      held[String(seat)] = { ...followUp };
    } else if (held[String(seat)]) {
      delete held[String(seat)];
    } else {
      return;
    }
    const { followUps: _replaced, ...rest } = frame.data ?? {};
    frame.data = Object.keys(held).length > 0 ? { ...rest, followUps: held } : rest;
  }

  /**
   * Development warning: `seat` is held for a follow-up it cannot take, because
   * the follow-up's action has no valid choice for it. Nothing else will move
   * that seat on, so the step stalls.
   */
  private warnIfFollowUpStalls(stepName: string, seat: number, followUp: FollowUpAction): void {
    if (!isDevMode()) return;
    const player = this.game.getPlayer(seat);
    const action = this.game.getAction(followUp.action);
    if (!player || !action) return;
    let stalls: boolean;
    let reason = 'that action has no valid choice for seat ' + seat + ' right now';
    try {
      stalls = !this.game.getActionExecutor().hasFollowUpChoices(action, player, followUp.args ?? {});
    } catch (error) {
      stalls = true;
      reason = `its args could not be read: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (!stalls) return;
    devWarn(
      `follow-up-stall:${stepName}:${followUp.action}`,
      `Step "${stepName}" holds seat ${seat} for its follow-up '${followUp.action}', but ${reason}, ` +
        `so the seat cannot take it and the step will not move on. A follow-up holds its seat until it is ` +
        `taken or the seat takes another action the step offers: list such an action in the step (a 'done' ` +
        `or end action), give the follow-up a choice that is always valid, or return the follow-up only ` +
        `when it can be completed.`,
    );
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

    // Every committed action counts toward how far undo reaches back, each link
    // of a follow-up chain included (#495). Moves, below, count a chain once.
    const actionCount = ((currentFrame.data?.actionCount as number) ?? 0) + 1;
    currentFrame.data = { ...currentFrame.data, actionCount };

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
      this.turnRun = { player: this.currentPlayer.seat, count: newMoveCount, actions: actionCount };
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
      // through encodeFlowValue/relinkFlowValue, so there is no
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
   * The step's `players` filter is re-evaluated and decides which seats NOT
   * already in the awaiting set may be admitted, so a refresh never brings in a
   * seat the filter leaves out (#557). It never removes a seat already in the
   * set: that seat was admitted under the filter and may be partway through the
   * step, so a filter that changes mid-step only governs who joins.
   *
   * Inside an action's own code (its execute, onSelect or onEach) the acting
   * seat is left as it is: settling that action re-checks it by the same rules,
   * on every route the action takes (#973).
   *
   * No-op when no simultaneous step is open: there is no stale list to correct.
   *
   * Called from outside game code, it then ends the step when `allDone` holds,
   * as settling an action does; a seat made done outside an action otherwise
   * left the step open with nobody able to act (#783). Inside game code the
   * running action's settling makes that check, so the flow runs on once.
   *
   * @param seat - Refresh only this seat. Omit to refresh every seat.
   * @returns The flow's state when the refresh ended the step and ran the flow on.
   */
  refreshAwaitingActions(seat?: number): FlowState | undefined {
    // A complete flow prompts no seat, so there is nothing to admit.
    if (this.complete) return;
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

    const admissible = config.players
      ? new Set(config.players(context).map((p) => p.seat))
      : undefined;

    for (const player of players) {
      if (seat !== undefined && player.seat !== seat) continue;

      // The seat whose action is running is settled by that action, by the same rules (#973).
      if (player.seat === this.game._ctx._actingSeat) continue;
      const existing = this.awaitingPlayers.find((p) => p.playerIndex === player.seat);
      // A seat that already committed this step stays committed. Re-deriving
      // its list would be the one change a refresh must never make.
      if (existing?.completed) continue;
      // The players filter decides who joins, never who is removed.
      if (!existing && admissible && !admissible.has(player.seat)) continue;

      if (this.seatEligibility(config, context, player, frame) !== 'awaited') {
        if (existing) this.awaitingPlayers = this.awaitingPlayers.filter((p) => p !== existing);
        continue;
      }

      const available = this.offeredSimultaneousActions(config, context, player);

      if (available.length === 0 && this.heldFollowUp(frame, player.seat) === undefined) {
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

    // Inside game code (an action, a pick's onEach) the action's settling re-checks allDone and runs the flow once.
    if (this.game._ctx._changingDepth > 0) return;
    const allDone = config.allDone
      ? config.allDone(context)
      : this.awaitingPlayers.every((p) => p.completed);
    if (!allDone) {
      this.warnIfDeadlockedSimultaneousStep(config);
      return;
    }
    this.awaitingInput = false;
    this.awaitingPlayers = [];
    frame.completed = true;
    return this.run();
  }

  /**
   * After a seat acts in a simultaneous step: is it done (`playerDone`), and
   * if not, which of its actions are still available? A seat left with none
   * is done, unless it holds a follow-up: then it is not done whatever
   * `playerDone` says, and the follow-up is what it has left to take.
   */
  private reevaluateSimultaneousSeat(
    frame: ExecutionFrame<G>,
    config: SimultaneousActionStepConfig,
    playerState: PlayerAwaitingState,
    player: Player,
    context: FlowContext<G>,
  ): void {
    const eligibility = this.seatEligibility(config, context, player, frame);
    if (eligibility === 'skipped') {
      this.awaitingPlayers = this.awaitingPlayers.filter((p) => p !== playerState);
      return;
    }
    if (eligibility === 'done') {
      playerState.completed = true;
      return;
    }

    playerState.availableActions = this.offeredSimultaneousActions(config, context, player);
    const followUp = this.heldFollowUp(frame, player.seat);
    if (followUp) {
      this.warnIfFollowUpStalls(config.name ?? 'simultaneous-action-step', player.seat, followUp);
    } else if (playerState.availableActions.length === 0) {
      playerState.completed = true;
    }
  }

  private resumeSimultaneousAction(
    actionName: string,
    args: Record<string, unknown>,
    playerIndex: number | undefined,
    frame: ExecutionFrame<G>,
    onAccepted: AcceptedArgs | undefined,
  ): FlowState {
    const config = frame.node.config as SimultaneousActionStepConfig;

    // Determine which player is acting
    let actingPlayerIndex = playerIndex;
    if (actingPlayerIndex === undefined) {
      // If not provided, use the first awaiting player
      const firstAwaiting = this.awaitingPlayers.find(p => !p.completed);
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
    const followUp = this.heldFollowUp(frame, actingPlayerIndex);
    const takesFollowUp = followUp?.action === actionName;
    if (!takesFollowUp && !playerState.availableActions.includes(actionName)) {
      this.actionError = `Action ${actionName} is not available for player ${actingPlayerIndex}`;
      return this.getState();
    }

    // Execute the action (actingPlayerIndex is 1-indexed position)
    const player = this.game.getPlayer(actingPlayerIndex);
    if (!player) {
      throw new Error(`Invalid player position: ${actingPlayerIndex}`);
    }
    const result = takesFollowUp
      ? this.performFollowUp(followUp, player, args, onAccepted)
      : this.game.performAction(actionName, player, args, { onAccepted });
    return this.settleSimultaneousAction(frame, playerState, player, result);
  }

  /**
   * Settle one seat's action in the open simultaneous step, however it was
   * taken (whole, through resume(), or pick by pick as a pending action): count
   * it, re-evaluate that seat, and finish the step when every seat is done.
   */
  private settleSimultaneousAction(
    frame: ExecutionFrame<G>,
    playerState: PlayerAwaitingState,
    player: PlayerOf<G>,
    result: ActionResult,
  ): FlowState {
    const config = frame.node.config as SimultaneousActionStepConfig;
    if (!this.recordActionResult(result, player.seat)) return this.getState();

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
      // The action finished the game, whoever else was still to act. run()
      // ends the flow before anything else is asked or offered (#492).
      if (this.isOver()) return this.run();

      const context = this.createContext();
      this.reevaluateSimultaneousSeat(frame, config, playerState, player, context);

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
   * The player whose turn it is: the seat the flow is running for (an
   * `eachPlayer` seat, an action step's player). None while a simultaneous
   * step is open (from the moment its conditions are first checked), since
   * every seat acts there, and none once the flow is complete.
   */
  getCurrentPlayer(): PlayerOf<G> | undefined {
    flowStateRead(this.game._ctx);
    const top = this.stack[this.stack.length - 1];
    const inSimultaneous = top?.node.type === 'simultaneous-action-step' && !top.completed;
    return inSimultaneous || this.complete ? undefined : this.currentPlayer;
  }

  /**
   * Get the current flow state
   */
  getState(): FlowState {
    flowStateRead(this.game._ctx);
    // `currentPlayer` and `availableActions` describe ONE seat's prompt, so they
    // are published only while an action step is the step awaiting input. The
    // private fields keep the last action step's values after the flow moves
    // on (`currentPlayer` also serves as the flow context's player), and a
    // simultaneous step that published them beside `awaitingPlayers` offered a
    // stale prompt to every reader that checks them first (#321).
    const awaitingActionStep =
      this.awaitingInput && this.stack[this.stack.length - 1]?.node.type === 'action-step';
    const state: FlowState = {
      position: this.getPosition(),
      complete: this.complete,
      awaitingInput: this.awaitingInput,
      currentPlayer: awaitingActionStep ? this.currentPlayer?.seat : undefined,
      availableActions: awaitingActionStep ? this.availableActions : undefined,
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

    this.publishMoveCounts(state);
    this.publishOpenStep(state);
    return state;
  }

  /** Writes the move counts an active action or simultaneous step publishes into `state`. */
  private publishMoveCounts(state: FlowState): void {
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
    if (!this.currentActionConfig && this.awaitingPlayers.length === 0) return;
    // An action step publishes its committed actions (every link of a
    // follow-up chain), not its moves: this is undo's boundary (#495).
    const top = this.stack[this.stack.length - 1];
    state.moveCount = top?.node.type === 'action-step' && typeof top.data?.actionCount === 'number'
      ? top.data.actionCount
      : this.moveCount;
    // Why moveCount is 0 here, when the seat plainly just acted: the step
    // this frame belongs to never said whether re-entering it continues the
    // same turn. Published so the undo refusal can name the cause instead of
    // reporting "No actions to undo" -- see `entryRun`.
    const undeclared = this.stack[this.stack.length - 1]?.data?.turnScopeUndeclared;
    if (typeof undeclared === 'string') {
      state.turnScopeUndeclared = undeclared;
    }
    this.publishMoveLimits(state);
  }

  /** Writes what an action step's `maxMoves` and `minMoves` leave of its moves into `state`. */
  private publishMoveLimits(state: FlowState): void {
    if (this.currentActionConfig?.maxMoves) {
      state.movesRemaining = this.currentActionConfig.maxMoves - this.moveCount;
    }
    if (this.currentActionConfig?.minMoves) {
      state.movesRequired = Math.max(0, this.currentActionConfig.minMoves - this.moveCount);
    }
  }

  /** Writes the open step's window, the last action's error and the held follow-ups into `state`. */
  private publishOpenStep(state: FlowState): void {
    // The open step's window, resolved when it was entered and kept on its
    // frame (see `openStepWindow`), so every restore path that rebuilds the
    // frame from `position.frameData` publishes the same number.
    if (this.awaitingInput) {
      const timeLimitMs = this.stack[this.stack.length - 1]?.data?.timeLimitMs;
      if (typeof timeLimitMs === 'number') {
        state.timeLimitMs = timeLimitMs;
      }
    }

    // Include action error if present
    if (this.actionError) {
      state.actionError = this.actionError;
      if (this.actionPartiallyApplied) state.actionPartiallyApplied = true;
    }

    // The follow-ups the open step holds, one per seat, each with its owner. A
    // complete flow holds none. NOTE: an action's `data`/`message` are
    // deliberately NOT published here — see the note on FlowState (BUG-017);
    // they would fan out to every seat.
    if (this.awaitingInput && !this.complete) {
      const held = this.heldFollowUps(this.stack[this.stack.length - 1]);
      const seats = Object.keys(held).map(Number).sort((a, b) => a - b);
      if (seats.length > 0) {
        state.followUps = seats.map((seat): PublishedFollowUp => ({ ...held[String(seat)], seat }));
      }
    }
  }

  /**
   * Restore flow from a serialized position.
   *
   * @param idRemap - CR-02 (159): set only when restoring into a redacted
   *   (`forSeat`) clone; see `resolveFlowElement`.
   * @throws When an element the position holds no longer resolves, naming the
   *   flow variable or step data that holds it.
   */
  private restore(position: FlowPosition, idRemap?: Map<number, number>): void {
    // Relink serialized element-valued flow variables back to live elements of
    // this game (inverse of getPosition's encodeFlowValue). Doing it here
    // means every restore path — runner.fromSnapshot, MCTS clone, and a rules
    // reload in the dev host — is covered without each caller relinking.
    this.variables = relinkFlowValue({ ...position.variables }, this.game, idRemap, 'variable') as Record<string, unknown>;
    this.stack = [];

    // Rebuild stack from path
    let currentNode = this.definition.root;
    for (let i = 0; i < position.path.length; i++) {
      const index = position.path[i];
      // Inverse of getPosition's encodeFlowValue on frame data: an
      // element-valued entry (a `forEach` item included) comes back as a LIVE
      // element of this game, under whatever field name the engine wrote it to.
      const restoredFrameData = relinkFlowValue(
        { ...(position.frameData?.[`__frame_${i}`] ?? {}) },
        this.game,
        idRemap,
        'step data',
      ) as Record<string, unknown>;

      this.stack.push({
        node: currentNode,
        index,
        completed: false,
        data: restoredFrameData,
      });

      // Navigate to child node for next level
      const child = resolveFlowChild(currentNode, index, restoredFrameData);
      if (child) {
        currentNode = child;
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
   * @param idRemap - See {@link restore}.
   * @returns Success or failure with the last valid path
   */
  private tryRestore(position: FlowPosition, idRemap?: Map<number, number>): { success: true } | { success: false; error: string; validPath: number[] } {
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
    this.restore(position, idRemap);
    return { success: true };
  }

  /**
   * Restore the full flow state including awaiting state.
   * This should be used for HMR where we want to restore exactly where we were.
   */
  restoreFullState(state: FlowState, idRemap?: Map<number, number>): { success: true } | { success: false; error: string; validPath: number[] } {
    // First restore the position (stack structure)
    const result = this.tryRestore(state.position, idRemap);
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

    // Restore action error state
    this.actionError = state.actionError;
    this.actionPartiallyApplied = state.actionPartiallyApplied === true;
    // A restored flow has no last action of its own (see getLastActionResult).
    // The follow-ups the open step holds came back with its frame's data.
    this.lastActionResult = undefined;

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
      const child = resolveFlowChild(currentNode, index, frameData?.[`__frame_${i}`]);
      if (!child) {
        const childCount = flowChildCount(currentNode);
        const nodeName = currentNode.config?.name ?? currentNode.type;
        // A sequence frame's index may equal its child count: it is one past the step in progress.
        if (childCount > 0 && index > childCount) {
          return {
            valid: false,
            error: `Path index ${index} out of bounds at depth ${i} (node "${nodeName}" has ${childCount} children)`,
            validPath,
          };
        }
        if (i < path.length - 1) {
          const branchKey = frameData?.[`__frame_${i}`]?.branchKey;
          const branch = currentNode.type === 'switch' && typeof branchKey === 'string'
            ? (branchKey === SWITCH_DEFAULT_KEY ? 'the default case' : `case ${JSON.stringify(branchKey)}`)
            : 'a branch';
          return {
            valid: false,
            error: `the save is inside ${branch} of ${currentNode.type} "${nodeName}" that the current rules no longer have. ` +
              'Restore it under the rules it was saved with, or start a new game',
            validPath,
          };
        }
      }
      validPath.push(index);
      if (child) {
        currentNode = child;
      }
    }

    return { valid: true };
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
    flowStateRead(this.game._ctx);
    return this.lastActionResult;
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
        // and `executeForEach`'s `forEachItems` do today -- so a hand-written
        // special case per field name is a hole waiting for the fourteenth
        // site. Plain values (`moveCount`, `iteration`,
        // `eligibleSeats: number[]`, `branchIndex`, `branchKey`) pass through untouched, which
        // is what `turnSequence`/`dueSeats` (seat-activity.ts) and
        // `resolveFlowChild` read back out. Do NOT "simplify" this to a
        // spread: that is the asymmetry this replaced.
        const serializedData = encodeFlowValue({ ...frame.data }) as Record<string, unknown>;
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
      // Serialize element-valued flow variables (e.g. a forEach item)
      // so the position is structured-cloneable across the broadcast/RPC boundary.
      variables: encodeFlowValue({ ...this.variables }) as Record<string, unknown>,
      // Plain seat number and count, so it needs no relinking on the way back.
      turnRun: this.turnRun ? { ...this.turnRun } : undefined,
    };
  }

  /**
   * Main execution loop - runs until awaiting input or complete.
   *
   * Uses a stack-based state machine to execute nested flow nodes. Each iteration
   * processes one node, which may push children onto the stack (e.g., sequence steps)
   * or mark itself complete. The loop exits when:
   * - The flow is over (see `isOver`), checked on entry and after every node,
   *   so a game finished by an action or a node runs nothing further and
   *   leaves no step open
   * - A node requires player input (awaitingInput)
   * - The stack empties (all nodes processed)
   *
   * Every path that advances the flow ends here, including one that leaves a
   * step open, so this is the one place completion is decided.
   *
   * Includes iteration safety (DEFAULT_MAX_ITERATIONS) to detect infinite loops
   * from misconfigured while/repeatUntil conditions.
   */
  private run(): FlowState {
    let iterations = 0;

    // Once on entry (a resume can arrive after the action that finished the
    // game), then once after each node that runs.
    if (!this.complete && this.isOver()) this.endFlow();

    while (!this.complete && !this.awaitingInput) {
      if (this.stack.length === 0) {
        this.endFlow();
        break;
      }

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
      } else if (frame.completed) {
        this.stack.pop();
      }

      if (this.isOver()) this.endFlow();
    }

    return this.getState();
  }

  /**
   * Whether the game is over: it was finished (`game.finish(winners)`, or a
   * game's own `isFinished()` override). The game is the one place that
   * declares its end (#503).
   *
   * A finished game ends the flow whatever loop it is in (#492). Only
   * `turnLoop` and `stateAwareLoop` used to stop on `isFinished()`, so a game
   * finished inside `eachPlayer`, `loop`, `sequence` or `repeat` kept waiting
   * on the next seat: hosts reported it incomplete beside its winners and its
   * players could keep acting.
   */
  private isOver(): boolean {
    return this.game.isFinished();
  }

  /**
   * End the flow if the game is finished, as `run()` would, and say whether it
   * ended. A restore puts the flow back without running it, so a position
   * edited to a finished game (an arranged one, #1427) still awaits a seat.
   */
  endIfOver(): boolean {
    if (this.complete || !this.isOver()) return false;
    this.endFlow();
    return true;
  }

  /** Mark the flow complete. A complete flow prompts no seat. */
  private endFlow(): void {
    this.complete = true;
    this.awaitingInput = false;
    this.availableActions = [];
    this.awaitingPlayers = [];
  }

  // ============================================================================
  // SECTION: Node Dispatch
  // Purpose: Node type dispatch and routing
  // ============================================================================

  /**
   * Execute a single flow node
   */
  private executeNode(frame: ExecutionFrame<G>): StepResult {
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
        return { awaitingInput: false };
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
  ): StepResult {
    if (frame.index >= config.steps.length) {
      frame.completed = true;
      return { awaitingInput: false };
    }

    // Push next step onto stack
    const nextStep = config.steps[frame.index];
    this.stack.push({ node: nextStep, index: 0, completed: false });
    frame.index++;

    return { awaitingInput: false };
  }

  private executeLoop(
    frame: ExecutionFrame<G>,
    config: LoopConfig<G>,
    context: FlowContext<G>
  ): StepResult {
    const iteration = (frame.data?.iteration as number) ?? 0;
    const maxIterations = config.maxIterations ?? (config.unbounded ? Infinity : DEFAULT_MAX_ITERATIONS);
    const loopName = config.name ?? 'unnamed';

    // Clean exit: the while condition became false. This is the ONLY correct
    // way for a loop to terminate.
    if (config.while && !config.while(context)) {
      frame.completed = true;
      return { awaitingInput: false };
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

    return { awaitingInput: false };
  }

  private executeRepeat(
    frame: ExecutionFrame<G>,
    config: RepeatNodeConfig<G>,
    context: FlowContext<G>
  ): StepResult {
    const iteration = (frame.data?.iteration as number) ?? 0;
    if (iteration >= config.times) {
      frame.completed = true;
      return { awaitingInput: false };
    }

    this.stack.push({ node: config.do, index: 0, completed: false });
    frame.data = { ...frame.data, iteration: iteration + 1 };
    frame.index++;

    return { awaitingInput: false };
  }

  private executeEachPlayer(
    frame: ExecutionFrame<G>,
    config: EachPlayerConfig<G>,
    context: FlowContext<G>
  ): StepResult {
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

      const eligibleSeats = rotated.map(p => p.seat);
      // A restart joins the round at its seat's place, skipping the seats
      // before it, so the next round runs in its usual order.
      const joinIndex = this.restartSeat === undefined ? -1 : eligibleSeats.indexOf(this.restartSeat);
      frame.data = {
        ...frame.data,
        eligibleSeats,
        nextIndex: Math.max(joinIndex, 0),
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

      this.stack.push({ node: config.do, index: 0, completed: false });
      frame.data = { ...frame.data, nextIndex };
      frame.index++;

      return { awaitingInput: false };
    }

    frame.completed = true;
    return { awaitingInput: false };
  }

  private executeForEach(
    frame: ExecutionFrame<G>,
    config: ForEachConfig<GameElement | string | number | boolean | null, G>,
    context: FlowContext<G>
  ): StepResult {
    // Snapshot the collection exactly once on first entry (mirrors executeEachPlayer's
    // eligibleSeats pattern) so a loop body that mutates the source collection (removes
    // or moves items) still visits every original item. The snapshot is frame data, so
    // `getPosition` writes its elements as flow markers and `restore` relinks them, as it
    // does every element the flow holds.
    if (frame.data?.forEachItems === undefined) {
      const items = typeof config.collection === 'function'
        ? config.collection(context)
        : config.collection;

      for (const item of items) {
        const type = typeof item;
        if (!(item instanceof GameElement) && type !== 'string' && type !== 'number' && type !== 'boolean' && item !== null) {
          throw new Error(
            `forEach() collection item is not a GameElement or JSON primitive (got ${type}). ` +
            `Only GameElement instances and string/number/boolean values are supported, ` +
            `so the loop's per-item snapshot can round-trip through checkpoint/restore.`
          );
        }
      }

      frame.data = {
        ...frame.data,
        forEachItems: [...items],
        itemIndex: 0,
      };
    }

    const items = frame.data.forEachItems as unknown[];
    const itemIndex = (frame.data.itemIndex as number) ?? 0;

    if (itemIndex >= items.length) {
      frame.completed = true;
      return { awaitingInput: false };
    }

    this.variables[config.as] = items[itemIndex];

    this.stack.push({ node: config.do, index: 0, completed: false });
    frame.data = { ...frame.data, itemIndex: itemIndex + 1 };
    frame.index++;

    return { awaitingInput: false };
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
   * The move and action counts a FRESH action-step frame starts at.
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
  private entryRun(config: ActionStepConfig<G>, player: Player, frame: ExecutionFrame<G>): { moves: number; actions: number } {
    const none = { moves: 0, actions: 0 };
    const run = this.turnRun;
    if (!run || run.player !== player.seat || run.actions === 0) return none;

    if (config.turnScope === 'continue') return { moves: run.count, actions: run.actions };

    if (config.turnScope === 'restart') {
      // The run ends here: this entry is the start of a new turn.
      this.turnRun = undefined;
      return none;
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
    return none;
  }

  /**
   * Resolve a step's declared time limit ONCE, as it starts awaiting input, and
   * keep the number on its frame (#300).
   *
   * Once per frame: an action step re-runs this executor after every move while
   * it stays open (`repeatUntil`, `maxMoves`), and a seat's move must not move
   * the window it is acting inside. A fresh frame -- the next round of a loop,
   * the next seat of an `eachPlayer` -- resolves its own. The frame is the
   * durable home because `getPosition`/`restore` round-trip `frame.data`, so a
   * snapshot restore, an undo checkpoint and an MCTS clone all carry the value
   * rather than re-resolving it against later state.
   */
  private openStepWindow(
    frame: ExecutionFrame<G>,
    config: ActionStepConfig<G> | SimultaneousActionStepConfig<G>,
    context: FlowContext<G>,
    stepType: 'action-step' | 'simultaneous-action-step',
  ): void {
    if (config.timeLimitMs === undefined || frame.data?.timeLimitMs !== undefined) return;
    const timeLimitMs = resolveTimeLimit(config.timeLimitMs, context, config.name ?? stepType);
    frame.data = { ...frame.data, timeLimitMs };
  }

  private executeActionStep(
    frame: ExecutionFrame<G>,
    config: ActionStepConfig<G>,
    context: FlowContext<G>
  ): StepResult {
    // A seat holding a follow-up keeps the turn until it takes it, or takes
    // another action this step offers it. Nothing else ends the step.
    const [heldSeat] = Object.keys(this.heldFollowUps(frame)).map(Number);
    if (heldSeat !== undefined) return this.awaitHeldSeat(frame, config, context, heldSeat);

    // skipIf is settled on entry only, so a later move cannot skip past minMoves.
    const entering = frame.data?.moveCount === undefined;
    if (entering && config.skipIf?.(context)) {
      this.currentActionConfig = undefined;
      this.moveCount = 0;
      frame.completed = true;
      return { awaitingInput: false };
    }

    // Initialize move count on first entry. A fresh frame does not always start
    // at 0: `turnScope` decides whether this entry continues the run the same
    // seat is already on, which is what gives undo its reach across the frame
    // boundary a loop iteration or a sibling step creates.
    // The entry's player is used for this pass too, so `player` is asked once per pass.
    let player: PlayerOf<G> | undefined;
    if (entering) {
      player = this.actionStepPlayer(config, context);
      // Resolved BEFORE the assignment: `entryRun` may also mark the
      // frame, and a spread evaluated first would discard that mark.
      const start = this.entryRun(config, player, frame);
      frame.data = { ...frame.data, moveCount: start.moves, actionCount: start.actions };
    }
    const moveCount = (frame.data as { moveCount: number }).moveCount;

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
      return { awaitingInput: false };
    }

    const minMovesMet = !config.minMoves || moveCount >= config.minMoves;

    player ??= this.actionStepPlayer(config, context);

    // Current while its conditions are checked, so `ctx.player.isCurrent()` holds for it.
    this.currentPlayer = player;
    const available = this.offeredSequentialActions(config, context, player);

    // If no available actions and minMoves met, complete
    if (available.length === 0 && minMovesMet) {
      this.restorePlayerFromActionStep(frame);
      this.currentActionConfig = undefined;
      this.moveCount = 0;
      frame.completed = true;
      return { awaitingInput: false };
    }

    // If no available actions but minMoves not met, this is an error state
    if (available.length === 0 && !minMovesMet) {
      throw new Error(`ActionStep requires ${config.minMoves} moves but only ${moveCount} were possible`);
    }

    this.openStepWindow(frame, config, context, 'action-step');

    // Store config for getState() move count tracking
    this.currentActionConfig = config;
    this.moveCount = moveCount;

    // Prompt for input
    this.availableActions = available;

    // Don't mark completed yet - we'll continue after input
    return { awaitingInput: true };
  }

  /** The seat an action step prompts: its `player`, or the flow's current player. */
  private actionStepPlayer(config: ActionStepConfig<G>, context: FlowContext<G>): PlayerOf<G> {
    const player = config.player ? config.player(context) : context.player;
    if (!player) {
      throw new Error('ActionStep requires a player');
    }
    return player;
  }

  /**
   * Re-open an action step for the seat that holds a follow-up in it: the seat
   * is offered the step's actions it can still take (possibly none) beside its
   * follow-up, and the step neither skips nor completes meanwhile.
   */
  private awaitHeldSeat(
    frame: ExecutionFrame<G>,
    config: ActionStepConfig<G>,
    context: FlowContext<G>,
    seat: number,
  ): StepResult {
    const player = this.game.getPlayer(seat) as PlayerOf<G> | undefined;
    if (!player) {
      throw new Error(`Action step holds a follow-up for seat ${seat}, but this game has no seat ${seat}.`);
    }
    this.currentPlayer = player;
    const available = this.offeredSequentialActions(config, context, player);

    this.warnIfFollowUpStalls(config.name ?? 'action-step', seat, this.heldFollowUp(frame, seat)!);
    this.openStepWindow(frame, config, context, 'action-step');
    this.currentActionConfig = config;
    this.moveCount = frame.data?.moveCount as number;
    this.availableActions = available;
    return { awaitingInput: true };
  }

  private executeSimultaneousActionStep(
    frame: ExecutionFrame<G>,
    config: SimultaneousActionStepConfig<G>,
    context: FlowContext<G>
  ): StepResult {
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
      if (this.seatEligibility(config, context, player, frame) !== 'awaited') continue;

      const available = this.offeredSimultaneousActions(config, context, player);

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
      return { awaitingInput: false };
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
        this.openStepWindow(frame, config, context, 'simultaneous-action-step');
        return { awaitingInput: true };
      }
      frame.completed = true;
      return { awaitingInput: false };
    }

    this.openStepWindow(frame, config, context, 'simultaneous-action-step');

    // Don't mark completed - waiting for all players
    return { awaitingInput: true };
  }

  // ============================================================================
  // SECTION: Conditional Executors
  // Purpose: Switch, if, execute, phase execution
  // ============================================================================

  private executeSwitch(
    frame: ExecutionFrame<G>,
    config: SwitchConfig<G>,
    context: FlowContext<G>
  ): StepResult {
    // If we've already pushed a branch, we're done (child has completed)
    if (frame.data?.branchPushed) {
      frame.completed = true;
      return { awaitingInput: false };
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
      branchKey: hasCase ? stringValue : SWITCH_DEFAULT_KEY,
    };

    return { awaitingInput: false };
  }

  private executeIf(
    frame: ExecutionFrame<G>,
    config: IfConfig<G>,
    context: FlowContext<G>
  ): StepResult {
    // If we've already pushed a branch, we're done (child has completed)
    if (frame.data?.branchPushed) {
      frame.completed = true;
      return { awaitingInput: false };
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

    return { awaitingInput: false };
  }

  private executeExecute(
    frame: ExecutionFrame<G>,
    config: ExecuteConfig<G>,
    context: FlowContext<G>
  ): StepResult {
    if (this.restartSeat !== undefined) {
      frame.completed = true;
      return { awaitingInput: false };
    }
    // Run the side effect function
    changing(this.game._ctx, () => config.fn(context));
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
    return { awaitingInput: false };
  }

  private executePhase(
    frame: ExecutionFrame<G>,
    config: PhaseConfig<G>,
    context: FlowContext<G>
  ): StepResult {
    // If we haven't entered this phase yet
    if (!frame.data?.entered) {
      // Set current phase
      const previousPhase = this.currentPhase;
      this.currentPhase = config.name;

      // Call onEnterPhase hook
      if (this.definition.onEnterPhase) {
        changing(this.game._ctx, () => this.definition.onEnterPhase!(config.name, context));
      }

      // Push the phase body and mark as entered
      this.stack.push({ node: config.do, index: 0, completed: false });
      frame.data = { entered: true, previousPhase };

      return { awaitingInput: false };
    }

    // Phase body has completed - call onExitPhase hook
    if (this.definition.onExitPhase) {
      changing(this.game._ctx, () => this.definition.onExitPhase!(config.name, context));
    }

    // Restore previous phase (for nested phases)
    this.currentPhase = frame.data.previousPhase as string | undefined;
    frame.completed = true;

    return { awaitingInput: false };
  }
}
