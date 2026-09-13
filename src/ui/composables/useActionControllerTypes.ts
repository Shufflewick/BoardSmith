/**
 * Type definitions for useActionController composable.
 *
 * These types define the public API for action handling in BoardSmith UIs.
 * They are used by both the action controller and consuming components.
 */

import type { Ref, ComputedRef } from 'vue';
import type { GameElement } from '../types.js';
import type { UseAnimationEventsReturn } from './useAnimationEvents.js';
import type { TutorialStepView } from '../../engine/tutorial/types.js';

// Re-export GameElement as GameViewElement for external use
export type { GameElement as GameViewElement };

// THE PICK SHAPE IS OWNED BY ../../types/protocol.js (#251).
//
// ElementRef, RefWithRole, ChoiceWithRefs, PickMetadata and ActionMetadata were
// all restated here (and again in session/types.ts, and again in ui/types.ts), so
// #249's `orderedList` was three edits with nothing forcing the third and the
// audit reported the leftovers as a 79-line unaccepted clone group. They are
// re-exported rather than redeclared.
//
// The one thing this layer genuinely adds is `ValidElement.element`, expressed
// below as an EXTENSION of the wire type and bound into the pick shape through
// its `TElement` parameter.
// Imported locally (so the shapes are usable as types in this module) AND
// re-exported, keeping the protocol layer as the single source of truth.
import type {
  ElementRef,
  RefWithRole,
  ChoiceWithRefs,
  ValidElement as WireValidElement,
  PickMetadata as WirePickMetadata,
  ActionMetadata as WireActionMetadata,
} from '../../types/protocol.js';
export type { ElementRef, RefWithRole, ChoiceWithRefs };

/**
 * Valid element for element picks, as the UI sees one.
 *
 * The wire shape plus the element's own `gameView` data, which
 * `useGameViewEnrichment` fills in client-side (see docs/element-enrichment.md).
 * That enrichment is the only thing this layer adds, and binding it through
 * `TElement` below is what lets it add it without restating a pick field.
 */
export interface ValidElement extends WireValidElement {
  /** Full element data from gameView (auto-enriched by actionController) */
  element?: GameElement;
}

/**
 * Metadata for a pick (a choice the player must make to complete an action, per
 * nomenclature.md), carrying ENRICHED elements.
 */
export type PickMetadata = WirePickMetadata<ValidElement>;

/** Metadata for an available action, carrying picks over ENRICHED elements. */
export type ActionMetadata = WireActionMetadata<ValidElement>;

/** Follow-up action to chain after an action completes */
export interface FollowUpAction {
  /** Name of the action to chain to */
  action: string;
  /** Args to pre-fill in the follow-up action */
  args?: Record<string, unknown>;
  /** Display strings for args (use instead of { id, name } objects) */
  display?: Record<string, string>;
  /** Metadata for the follow-up action (for actions not in availableActions) */
  metadata?: ActionMetadata;
}

export interface ActionResult {
  success: boolean;
  error?: string;
  data?: Record<string, unknown>;
  message?: string;
  /** Follow-up action to automatically start after this action completes */
  followUp?: FollowUpAction;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Result from a pick step (repeating picks) */
export interface PickStepResult {
  success: boolean;
  error?: string;
  done?: boolean;
  nextChoices?: unknown[];
  actionComplete?: boolean;
  /**
   * `ActionResult.data` from the action this step completed (BUG-017). Present
   * only on the step where `actionComplete` is true — that is the step on which
   * the server actually ran `execute()`.
   */
  data?: Record<string, unknown>;
  /** `ActionResult.message` from the action this step completed (BUG-012). */
  message?: string;
  followUp?: {
    action: string;
    args?: Record<string, unknown>;
    metadata?: ActionMetadata;
    display?: Record<string, string>;
  };
}

/**
 * An action that has just resolved on the server, with the result verbatim.
 *
 * This is the ONE place a UI reads an action's return value, whichever transport
 * carried it: `execute()`/`executeCurrentAction()` return their `ActionResult`
 * to their caller, but a pick-driven action (an `onSelect` selection, or a
 * repeating one) completes inside `fill()` — often triggered by an ActionPanel
 * click that no board code called at all — so a return value would reach nobody.
 * Watch `lastActionResult` and every path is covered on the same terms.
 *
 * A fresh object is assigned on every resolution, so a `watch` fires even when
 * two consecutive results are value-identical.
 */
export interface ResolvedAction {
  /** Name of the action that resolved. */
  action: string;
  /** Seat that took it. */
  seat: number;
  /** The server's result, verbatim — including `data` (BUG-017) and `message`. */
  result: ActionResult;
}

/** Result from fetching pick choices */
export interface PickChoicesResult {
  success: boolean;
  choices?: Array<{ value: unknown; display: string; refs?: RefWithRole[]; disabled?: string }>;
  validElements?: ValidElement[];
  multiSelect?: { min: number; max?: number };
  /** Ordered-list entry bounds for this step (#249), resolved server-side */
  orderedList?: { min: number; max?: number };
  error?: string;
}

// ============================================
// Action State Snapshot Types (Pit of Success)
// ============================================

/**
 * Snapshot of a pick's available choices.
 * Frozen when fetched, not affected by server broadcasts.
 */
export interface PickSnapshot {
  /** Choices for choice picks */
  choices?: Array<{ value: unknown; display: string; refs?: RefWithRole[]; disabled?: string }>;
  /** Valid elements for element picks */
  validElements?: ValidElement[];
  /** MultiSelect config (evaluated when fetched) */
  multiSelect?: { min: number; max?: number };
  /** Ordered-list entry bounds (#249), evaluated when fetched */
  orderedList?: { min: number; max?: number };
}

/**
 * A collected pick value with its display text.
 * Display is stored at selection time - single source of truth.
 */
export interface CollectedPick {
  /** The selected value(s) */
  value: unknown;
  /** Display text captured at selection time */
  display: string;
  /** Whether this was explicitly skipped */
  skipped: boolean;
}

/**
 * Complete snapshot of an in-progress action.
 * Created when start() is called, not affected by server broadcasts.
 * This is the "pit of success" - client owns action state once started.
 */
export interface ActionStateSnapshot {
  /** Action name */
  actionName: string;
  /** Full action metadata - frozen at start time */
  metadata: ActionMetadata;
  /** Pick snapshots indexed by pick name */
  pickSnapshots: Map<string, PickSnapshot>;
  /** Collected picks with value+display stored together */
  collectedPicks: Map<string, CollectedPick>;
  /** For repeating picks: current state (reuses existing RepeatingState) */
  repeatingState: RepeatingState | null;
  /** Queued fills for future picks - applied when pick becomes active */
  prefills: Map<string, unknown>;
  /**
   * In-flight choice fetches, keyed by selection name. An entry exists only
   * while its request is outstanding, so a second caller joins the same request
   * instead of issuing a duplicate, and anything that needs the choices can
   * await the request rather than racing it.
   */
  choiceFetches: Map<string, Promise<void>>;
}

export interface UseActionControllerOptions {
  /** Function to send action to server */
  sendAction: (actionName: string, args: Record<string, unknown>) => Promise<ActionResult>;
  /** Available actions (from game state). Accepts Ref with potentially undefined value for test compatibility. */
  availableActions: Ref<string[] | undefined> | Ref<string[]>;
  /** Action metadata (from game state) */
  actionMetadata: Ref<Record<string, ActionMetadata> | undefined>;
  /** Is it this player's turn. Accepts Ref with potentially undefined value for test compatibility. */
  isMyTurn: Ref<boolean | undefined> | Ref<boolean>;
  /**
   * The acting seat's OWN `completed` flag for the current simultaneous step
   * (from `flowState.awaitingPlayers[playerSeat].completed`; `false`/`undefined`
   * outside a simultaneous step). This is the SHARED chokepoint for the D27
   * commit-leak gate (T-160-27 / BLOCKER-160): `execute()` and
   * `executeCurrentAction()` both refuse once this is true, so every consumer —
   * ActionPanel AND every custom/drag-drop UI routed through
   * `useBoardActionBridge` — inherits the same guard from one source. A seat
   * that already committed this step can never re-submit through either path,
   * even if `isMyTurn`/`availableActions` are stale (haven't yet reflected the
   * seat's own commit).
   */
  completed?: Ref<boolean | undefined> | ComputedRef<boolean | undefined>;
  /**
   * Action name → why it is disabled, from `PlayerGameState.disabledActions`
   * (the action's `.disabled()` rule, or the active tutorial step's gate).
   *
   * The SHARED chokepoint for disabled actions, on the same principle as
   * `completed` above: `start()` and `execute()` both refuse with the reason,
   * so the auto ActionPanel, a custom board UI calling
   * `actionController.start()` directly, and the drag-drop bridge all inherit
   * one refusal. A disabled action deliberately stays in `availableActions` so
   * the panel can render it greyed out WITH the reason — which means the
   * availability check alone would let it through.
   */
  disabledActions?: Ref<Record<string, string> | undefined> | ComputedRef<Record<string, string> | undefined>;
  /** Game view (for enriching validElements with full element data) */
  gameView?: Ref<GameElement | null | undefined>;
  /** Player seat (needed for fetching choices/repeating features) */
  playerSeat?: Ref<number>;
  /** Enable auto-fill for single-choice selections (default: true). Can be reactive. */
  autoFill?: boolean | Ref<boolean>;
  /** Enable auto-execute when all selections filled (default: true). Can be reactive. */
  autoExecute?: boolean | Ref<boolean>;
  /**
   * Function to fetch pick choices from server.
   * Required for choice/element/elements picks.
   */
  fetchPickChoices?: (
    actionName: string,
    selectionName: string,
    player: number,
    currentArgs: Record<string, unknown>
  ) => Promise<PickChoicesResult>;
  /**
   * Function to process a repeating pick step.
   * Required for picks with `repeat` config.
   */
  pickStep?: (
    player: number,
    selectionName: string,
    value: unknown,
    actionName: string,
    initialArgs?: Record<string, unknown>
  ) => Promise<PickStepResult>;
  /**
   * Called before auto-execute fires (when all selections are filled).
   * Use this to capture element positions for animations before the DOM updates.
   * Return a Promise to delay execution until animation prep is complete.
   *
   * @example
   * ```typescript
   * const controller = useActionController({
   *   // ...
   *   onBeforeAutoExecute: async (actionName, args) => {
   *     if (actionName === 'assignToSquad') {
   *       // Capture element position before DOM updates
   *       const el = document.querySelector(`[data-combatant="${args.combatantName}"]`);
   *       startRect = el?.getBoundingClientRect();
   *     }
   *   },
   * });
   * ```
   */
  onBeforeAutoExecute?: (
    actionName: string,
    args: Record<string, unknown>
  ) => void | Promise<void>;
  /**
   * Function to cancel a pending action on the server.
   * Called when user cancels an action that has been partially submitted via pickStep.
   */
  cancelPendingAction?: (player: number) => Promise<void>;
  /**
   * Animation events instance for animation-gated action panel.
   * When provided, animationsPending and showActionPanel become functional.
   * If not provided, animationsPending is always false and showActionPanel equals isMyTurn.
   */
  animationEvents?: UseAnimationEventsReturn;
  /**
   * Active tutorial step for the current player, sourced from `PlayerGameState.tutorial`.
   *
   * When set and the step has `suppressAutoFill: true`, `tryAutoFillSelection`
   * will NOT auto-fill the single enabled choice for that selection, preserving
   * the teaching click interaction.
   *
   * If `suppressAutoFillFor` is also set on the step, suppression is scoped to
   * that named selection only; other selections still auto-fill normally.
   *
   * Defaults to `undefined` (no tutorial active, default auto-fill behavior).
   */
  tutorialStep?: Ref<TutorialStepView | undefined>;
  /**
   * True while the debug panel is showing a historical (time-traveled) game
   * state (LIBX-04/CR-01). This is the SHARED chokepoint: `fill()`,
   * `toggleMultiSelect()`, `start()`, and the internal auto-execute watch all
   * refuse (or no-op) while this is true, so NO commit path — board click,
   * ActionPanel, or the controller's own auto-execute — can reach the live
   * engine while the UI is displaying historical state. Defaults to `false`
   * (never viewing history) for callers that don't wire time-travel.
   */
  isViewingHistory?: Ref<boolean>;
}

/** State for repeating selections */
export interface RepeatingState {
  selectionName: string;
  /** Accumulated values with their displays (for UI) */
  accumulated: Array<{ value: unknown; display: string }>;
  awaitingServer: boolean;
  currentChoices?: Array<{ value: unknown; display: string }>;
}

export interface UseActionControllerReturn {
  // === State ===
  /** Currently active action name */
  currentAction: Ref<string | null>;
  /** Args collected so far for current action (read-only; use fill/start/clear to change) */
  currentArgs: Readonly<Ref<Readonly<Record<string, unknown>>>>;
  /** Current pick that needs user input (null if all filled or no action) */
  currentPick: ComputedRef<PickMetadata | null>;
  /**
   * Valid elements for the current selection (reactive).
   * Use this in custom UIs instead of getValidElements() for automatic reactivity.
   * Returns empty array if current selection is not an element type or choices haven't loaded.
   */
  validElements: ComputedRef<ValidElement[]>;
  /**
   * Reactive choices for the current pick (re-runs when async-fetched choices arrive).
   * Prefer this over getCurrentChoices() in reactive contexts — the latter does not
   * track the snapshot fetch version, so it can return stale (empty) choices.
   */
  currentChoices: ComputedRef<ChoiceWithRefs[]>;
  /** Whether all selections are filled and action is ready */
  isReady: ComputedRef<boolean>;
  /** Whether an action is currently executing */
  isExecuting: Ref<boolean>;
  /** Last validation error */
  lastError: Ref<string | null>;
  /**
   * Monotonic counter bumped on EVERY failure that sets lastError — including a
   * repeat of the identical error message (fill()-path failures never null-clear
   * lastError between attempts, so a plain watch on lastError would not re-fire
   * for a retried identical failure). Watch this to surface each failure exactly
   * once; read the message from lastError inside the watcher.
   */
  errorTick: Readonly<Ref<number>>;
  /** Whether choices are being fetched from server */
  isLoadingChoices: Ref<boolean>;
  /** Repeating selection state (for repeating selections) */
  repeatingState: Ref<RepeatingState | null>;
  /**
   * Whether a followUp action is pending (scheduled but not yet started).
   * Use this to prevent starting new actions while a followUp is queued.
   * This prevents the race condition where currentAction is null but
   * a followUp is about to start via setTimeout.
   */
  pendingFollowUp: Ref<boolean>;

  /**
   * True while the current action is server-pending — a followUp started via
   * startFollowUp, or an onSelect-routed selection. These actions are never in
   * availableActions by design, so UIs must not treat their absence from
   * availableActions as a reason to cancel the current action.
   */
  pendingOnServer: Readonly<Ref<boolean>>;

  /**
   * Increments each time an action chain fully resolves (end-of-chain). Consumed by the
   * board bridge to auto-advance the next action. Distinct from the DEV-03
   * `boardsmith:action-resolved` event, which fires on every individual action resolution.
   */
  actionCompletedTick: Readonly<Ref<number>>;

  /**
   * The most recently resolved action and its server result — `null` until one
   * resolves. Set at EVERY terminal resolution site (execute, executeCurrentAction,
   * and both pick-driven completion paths), on failure as well as success, so a
   * board reads an action's `data`/`message` the same way no matter which transport
   * ran it. See `ResolvedAction`.
   */
  lastActionResult: ComputedRef<ResolvedAction | null>;

  // === High-level Methods ===
  /**
   * Execute an action with all args at once.
   * - Validates args against action's selections
   * - Auto-fills single-choice selections
   * - Returns actual server result
   */
  execute: (actionName: string, args?: Record<string, unknown>) => Promise<ActionResult>;

  // === Step-by-step Methods (wizard mode) ===
  /**
   * Start an action's selection flow (async - fetches choices from server).
   *
   * @param actionName - The action to start
   * @param options - Optional configuration:
   *   - `args`: Initial args to fill immediately (for first selection)
   *   - `prefill`: Args to auto-fill when their selection becomes active (for later selections)
   *
   * @example
   * ```typescript
   * // Start 'move' action, auto-fill 'destination' when we reach that selection
   * await actionController.start('move', {
   *   prefill: { destination: sectorId }
   * });
   * // User selects squad, then destination auto-fills with sectorId
   * ```
   */
  /**
   * Begin wizard mode for an action. The resolved ActionResult reflects ONLY
   * start()'s synchronous pre-checks (action availability, metadata presence) —
   * `{ success: true }` means wizard mode began, NOT that the action has been
   * executed. The eventual server outcome arrives later via the auto-execute
   * watcher, observable through `lastError`, not through this return value.
   */
  start: (actionName: string, options?: {
    args?: Record<string, unknown>;
    prefill?: Record<string, unknown>;
  }) => Promise<ActionResult>;
  /** Fill a selection with a value (async for repeating selections) */
  fill: (selectionName: string, value: unknown) => Promise<ValidationResult>;
  /** Skip an optional selection */
  skip: (selectionName: string) => void;
  /** Clear a selection's value */
  clear: (selectionName: string) => void;
  /** Cancel the current action */
  cancel: () => void;

  // === Multi-select draft (shared in-progress selection) ===
  /**
   * In-progress multiSelect "draft" — the shared source of truth for an accumulating
   * multiSelect selection, observed by both the auto ActionPanel and custom UIs so
   * they stay in parity. SEPARATE from currentArgs: currentArgs[name] stays undefined
   * until confirmMultiSelect() runs the fill() path with the complete array.
   */
  multiSelectDraft: Ref<{ selectionName: string; values: unknown[] } | null>;

  // === Editor draft (shared in-progress typed value) ===
  /**
   * What the player has entered into the current number or text editor and not
   * yet submitted, or `null` when they have entered nothing.
   *
   * Shared for the same reason as {@link multiSelectDraft}: the auto ActionPanel
   * and a custom UI are two representations of one state, and this used to be a
   * ref inside the panel -- so a custom UI could not see what the player was in
   * the middle of writing, and anything that unmounted the panel threw it away
   * (#235: collapsing the action bar unmounts it).
   *
   * SEPARATE from `currentArgs`, which receives the value only when the player
   * submits it. A draft belongs to one action asking one selection in one round
   * of a repeating pick, and reads as `null` outside that -- so a value typed
   * into one field can never open another one prefilled.
   */
  currentPickDraft: ComputedRef<string | number | null>;
  /**
   * Record what the player has entered into the current editor, or `null` to
   * clear it. `string` for a text pick and `number` for a number pick; anything
   * else is refused with a devWarn rather than stored, as is a draft written
   * while no editor is being asked for.
   */
  setPickDraft: (value: string | number | null) => void;

  // === The action list's open level ===
  /**
   * The group path the player has navigated to in the action hierarchy (#228),
   * or an empty array at the top level.
   *
   * Held here so it survives the panel being unmounted (#235). It is an opaque
   * list of group labels as far as the controller is concerned: the controller
   * never reads it, and writing it can start nothing, take no turn and change
   * no game state. The panel resolves it against the menu on every read, so a
   * path into a group that has gone away lands on the deepest level that is
   * still there.
   */
  actionMenuPath: Ref<readonly string[]>;
  /**
   * Toggle a value in the in-progress multiSelect draft for a selection.
   * Respects the selection's max; auto-confirms when min === max and the exact count
   * is reached (running fill → auto-execute). No-op (with devWarn) if the selection
   * isn't active or isn't a multiSelect.
   */
  toggleMultiSelect: (selectionName: string, value: unknown) => Promise<void>;
  /**
   * Confirm the in-progress multiSelect draft — the only place currentArgs receives
   * the multiSelect array (via the existing fill() path). Returns the fill result, or
   * void if there is no draft.
   */
  confirmMultiSelect: () => Promise<ValidationResult | void>;
  /** Whether a value is currently in the multiSelect draft for the given selection. */
  isMultiSelectSelected: (selectionName: string, value: unknown) => boolean;

  // === Ordered, repeatable lists (#249) ===
  /**
   * Append one entry to the in-progress draft for an `orderedList` selection.
   *
   * Deliberately NOT `toggleMultiSelect`: a toggle cannot say "again" -- pressing
   * the same option twice in a set removes it, which is exactly the gesture a
   * list needs to mean a second entry. Appends past the selection's `max` are
   * ignored. No-op (with a devWarn) when the selection is not an ordered list,
   * so a caller reaching for the wrong verb is told rather than silently obeyed.
   *
   * The draft it writes is {@link multiSelectDraft} -- the same shared
   * in-progress list the Action Panel and a custom board both read, which is what
   * keeps the two in parity. Confirm it with {@link confirmMultiSelect}.
   */
  appendListEntry: (selectionName: string, value: unknown) => Promise<void>;
  /**
   * Drop the entry at `index` from the in-progress ordered-list draft.
   *
   * BY INDEX, because with repeats allowed "remove the university" does not name
   * one entry. An index outside the draft is ignored with a devWarn.
   */
  removeListEntry: (selectionName: string, index: number) => void;

  // === Utility ===
  /** Get available choices for a pick (handles filterBy, dependsOn) */
  getChoices: (pick: PickMetadata) => Array<{ value: unknown; display: string; disabled?: string }>;
  /** Get filtered choices for current pick (convenience method) */
  getCurrentChoices: () => Array<{ value: unknown; display: string; disabled?: string }>;
  /** Get valid elements for an element/elements pick from cache */
  getValidElements: (pick: PickMetadata) => ValidElement[];
  /** Get metadata for an action */
  getActionMetadata: (actionName: string) => ActionMetadata | undefined;
  /** Clear all args (preserves reactivity for external args) */
  clearArgs: () => void;
  /** Fetch choices for a pick from server (called automatically by start/fill) */
  fetchChoicesForPick: (selectionName: string) => Promise<void>;

  // === Snapshot API (Pit of Success) ===
  /** Frozen action state - contains metadata for followUp actions not in availableActions */
  actionSnapshot: Ref<ActionStateSnapshot | null>;
  /** Get a collected pick by name (value + display) */
  getCollectedPick: (name: string) => CollectedPick | undefined;
  /** Get all collected picks with their names */
  getCollectedPicks: () => Array<CollectedPick & { name: string }>;

  // === Hook Registration (for GameShell users) ===
  /**
   * Register a hook to be called before auto-execute.
   * Use this when using GameShell (which creates the controller internally)
   * and you need to capture element positions for animations.
   *
   * @example
   * ```typescript
   * // In game-board slot
   * const { flyingElements, onBeforeAutoExecute } = useActionAnimations({
   *   gameView,
   *   animations: [...]
   * });
   *
   * // Register the hook after getting actionController from slot props
   * actionController.setBeforeAutoExecute(onBeforeAutoExecute);
   * ```
   *
   * Registers an additional hook; hooks run in registration order. Call the
   * returned function to unregister this hook.
   *
   * When called inside a component/effect scope (the normal case — a board
   * component registering in setup()), the hook is automatically unregistered
   * when that scope disposes, so remounts (dev UI switcher, HMR) never
   * accumulate stale hooks. Registrations made outside any scope persist
   * until the returned unregister fn is called.
   */
  setBeforeAutoExecute: (
    hook: (actionName: string, args: Record<string, unknown>) => void | Promise<void>
  ) => () => void;

  // === Animation Gating ===
  /**
   * Whether animations are currently pending/playing.
   * True when animationEvents.isAnimating is true.
   * Always false if animationEvents not provided.
   */
  animationsPending: ComputedRef<boolean>;

  /**
   * Whether to show the action panel to the user.
   * True when: isMyTurn && !animationsPending && !pendingFollowUp
   * Use this to gate ActionPanel visibility/interactivity.
   */
  showActionPanel: ComputedRef<boolean>;
}
