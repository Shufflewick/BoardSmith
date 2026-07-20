/**
 * Shared utility functions for game hosting
 */

import { Player, canSeatAct, availableActionsForSeat, type FlowState, type Game, type ActionDefinition, type ActionTrace, type PendingActionState } from '../engine/index.js';
import { buildActionMetadata, buildPickMetadata } from '../engine/element/action-metadata.js';
import { getActiveTutorialStepView } from '../engine/tutorial/gate.js';
import type { GameRunner } from '../runtime/index.js';
import type { PlayerGameState, ActionMetadata, PickMetadata, SerializedFlowDebugInfo, SerializedPendingActionState } from './types.js';
import type { ElementJSON } from '../engine/index.js';

// Re-export so existing consumers (session barrel, external callers) are unchanged
export { buildActionMetadata, buildPickMetadata } from '../engine/element/action-metadata.js';

/**
 * Recursively locate a node by element id within an already-filtered
 * `ElementJSON` tree (SEC-03 / F8). Used to derive `state.players` from the
 * same per-viewer-filtered `truthView` that backs `state.view`, instead of a
 * parallel unfiltered `player.toJSON()` pass -- see `buildPlayerState` below.
 */
function findElementJSONById(json: ElementJSON, id: number): ElementJSON | undefined {
  if (json.id === id) return json;
  if (!json.children) return undefined;
  for (const child of json.children) {
    const found = findElementJSONById(child, id);
    if (found) return found;
  }
  return undefined;
}

/**
 * Generate a random 8-character game ID
 */
export function generateGameId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * Check if it's a specific player's turn
 */
export function isPlayersTurn(flowState: FlowState | undefined, playerPosition: number): boolean {
  return canSeatAct(flowState, playerPosition);
}

/**
 * Serialize `game.getFlowDebugInfo()` into the shared plain-object shape
 * (`SerializedFlowDebugInfo`) that travels over the wire. Flow position is
 * public game structure (T-123-08) — safe to compute once and reuse across
 * every seat/spectator. `describe()` is a METHOD on the engine's
 * FlowDebugInfo and does NOT survive serialization, so it is captured here
 * into a plain `description` string before anything is sent to a client.
 *
 * Single shared serializer reused by both session hosts (GameSession's live
 * broadcast() and SnapshotSessionHost's stateless op path) plus the
 * debug:flow-state op — one source of truth for the wire shape (Pit of
 * Success: no divergent per-host copies).
 */
export function serializeFlowDebugInfo(game: Game): SerializedFlowDebugInfo {
  const info = game.getFlowDebugInfo();
  return {
    phase: info.phase,
    step: info.step,
    path: info.path,
    awaiting: info.awaiting,
    description: info.describe(),
  };
}

/**
 * Serialize a live `PendingActionState` into its JSON-safe wire shape
 * (`SerializedPendingActionState`) — `onSelectFired`'s `Set<number>` becomes a
 * plain `number[]` (`JSON.stringify(new Set(...))` produces `"{}"`, silently
 * dropping the accumulated indices).
 *
 * Also copies `collectedArgs` and `repeating.accumulated` one level deep, so
 * the returned object is never the live mutable state a caller could
 * continue to observe mutate via subsequent selection steps (CR-01) — the
 * same guarantee `GameRunner.getPendingAction()` (runtime/runner.ts) provides
 * on the testing path.
 *
 * Single shared serializer reused by `GameSession.broadcast()`, `PickHandler`
 * (selection-step responses), and the `debug:flow-state` stateless op — one
 * wire shape for `PendingActionState` everywhere (Pit of Success: no
 * divergent per-host copies, mirroring `serializeFlowDebugInfo()` above).
 */
export function serializePendingActionState(s: PendingActionState): SerializedPendingActionState {
  return {
    ...s,
    collectedArgs: { ...s.collectedArgs },
    repeating: s.repeating ? { ...s.repeating, accumulated: [...s.repeating.accumulated] } : undefined,
    onSelectFired: s.onSelectFired ? Array.from(s.onSelectFired) : undefined,
  };
}

/**
 * Restore a `PendingActionState` from its JSON-safe wire shape (inverse of
 * `serializePendingActionState()`) — the `number[]` form of `onSelectFired`
 * becomes a `Set<number>` again so engine code (`processSelectionStep` etc.)
 * can use `Set` membership checks.
 */
export function deserializePendingActionState(s: SerializedPendingActionState): PendingActionState {
  return {
    ...s,
    onSelectFired: s.onSelectFired ? new Set(s.onSelectFired) : undefined,
  };
}

/**
 * Build metadata for a single action by name.
 * Used for followUp actions that aren't in the current available actions.
 * Does NOT check the action's condition (followUp actions bypass conditions).
 *
 * @param knownArgs Optional args to use when evaluating dynamic prompts (for followUp actions)
 */
export function buildSingleActionMetadata(
  game: Game,
  player: Player,
  actionName: string,
  knownArgs?: Record<string, unknown>
): ActionMetadata | undefined {
  const actions = (game as any)._actions as Map<string, ActionDefinition>;
  const actionDef = actions?.get(actionName);

  if (!actionDef) {
    console.warn(`[buildSingleActionMetadata] Action "${actionName}" not found in game._actions`);
    return undefined;
  }

  const pickMetas: PickMetadata[] = [];

  for (const selection of actionDef.selections) {
    const pickMeta = buildPickMetadata(game, player, selection, knownArgs);
    pickMetas.push(pickMeta);
  }

  return {
    name: actionName,
    prompt: actionDef.prompt,
    help: actionDef.help,
    selections: pickMetas,
  };
}

/**
 * Compute turn start action index and actions this turn for a player.
 *
 * `moveCount` (from `FlowState`, published for every active action step --
 * `engine.ts` `getState()`) is the SOLE authoritative source (UNDO-03). There
 * is no fallback: a solo game (or any same-player-repeats shape) has no
 * "different player" boundary to scan backward for, so a history-scanning
 * heuristic silently rewinds the ENTIRE game on first undo -- the D5
 * game-erasing defect this function used to contain (deleted, not replaced).
 * `moveCount === undefined` means "not currently in an action step" and is
 * treated as undo-unavailable, per the project's no-backward-compatibility
 * rule -- never as "guess from history."
 *
 * This correctly handles games with phases where the same player can act at
 * the end of one phase and start of the next (e.g., MERC where Rebel Player
 * acts at end of Day 1 and start of Day 2): moveCount resets to 0 for the new
 * action-step frame, so undo is (correctly) bounded to that frame and cannot
 * reach back across the phase boundary into the prior one.
 *
 * @param actionHistory - The action history to scan
 * @param currentPlayer - The current player's position
 * @param moveCount - Move count from FlowState (actions taken in the current
 *   action-step frame). `undefined` means no action step is currently active.
 */
export function computeUndoInfo(
  actionHistory: Array<{ player: number; undoable?: boolean }>,
  currentPlayer: number | undefined,
  moveCount?: number
): { turnStartActionIndex: number; actionsThisTurn: number; hasNonUndoableAction: boolean } {
  if (currentPlayer === undefined || actionHistory.length === 0 || moveCount === undefined) {
    return { turnStartActionIndex: actionHistory.length, actionsThisTurn: 0, hasNonUndoableAction: false };
  }

  // moveCount tells us how many actions were taken in the current action-step
  // frame. Only check the last 'moveCount' actions for non-undoable actions.
  let hasNonUndoableAction = false;
  const turnStartActionIndex = Math.max(0, actionHistory.length - moveCount);

  for (let i = actionHistory.length - 1; i >= turnStartActionIndex; i--) {
    if (actionHistory[i].undoable === false) {
      hasNonUndoableAction = true;
      break;
    }
  }

  return { turnStartActionIndex, actionsThisTurn: moveCount, hasNonUndoableAction };
}

/**
 * Thrown by {@link assertUndoAllowed} when a server-side undo/rewind fence
 * refuses the operation. Never a silent no-op (D-02 / T-155-04): every
 * refusal carries an actionable message naming why, and the two undo
 * executors (`stateless-ops.ts`) catch it at their own OpResult boundary
 * while the two stateful methods (`state-history.ts`) already have a
 * try/catch that converts any thrown Error into `{ success: false, error }`.
 *
 * Message content is intentionally limited to the action name/index or the
 * phase reason -- no file paths, line numbers, or stack traces (project hard
 * rule; T-155-03).
 */
export class UndoRefusedError extends Error {
  readonly reason: 'non-undoable' | 'finished-phase' | 'execute-barrier';

  constructor(message: string, reason: 'non-undoable' | 'finished-phase' | 'execute-barrier') {
    super(message);
    this.name = 'UndoRefusedError';
    this.reason = reason;
  }
}

/**
 * Single shared server-side undo/rewind guard (D-01/D-09) consumed by ALL
 * FOUR undo/rewind entry points -- `stateless-ops.ts`'s `handleUndo` and
 * `handleDebugRewind`, and `state-history.ts`'s `undoToTurnStart` and
 * `rewindToAction`. This is the fix for UNDO-01 (`.notUndoable()` was never
 * enforced server-side -- only hidden via the client's advisory `canUndo`)
 * and UNDO-02 (the `finished`-phase fence AND the durable execute()-barrier
 * fence).
 *
 * Three independent, composable checks (order does not matter -- Open
 * Question 2, 155-RESEARCH.md -- each is O(1)/O(k) and evaluates against the
 * SAME inputs regardless of what ran before it):
 *  1. Phase fence: refuse up front once `game.isFinished()` (D-04) --
 *     checked before any checkpoint lookup, never by silently rolling the
 *     phase back via a pre-finish checkpoint.
 *  2. Non-undoable fence: scan `actionHistory[turnStartActionIndex..end)`
 *     for an entry recorded with `undoable === false`
 *     (`.notUndoable()` -> `action-builder.ts`) and refuse, naming the
 *     blocking action by name and index.
 *  3. Execute-barrier fence (155-02): refuse when
 *     `turnStartActionIndex < executeBarrierIndex` -- the target would
 *     rewind through a completed `execute()` flow node, silently discarding
 *     the irreversible side effect (scoring, dealing, revealing hidden
 *     info) it committed. `executeBarrierIndex` is `GameRunner`'s durable
 *     replacement for the transient `frame.completed` flag (see
 *     `runner.ts`'s doc comments) -- callers pass `runner.executeBarrierIndex`
 *     directly; there is nothing else to compute.
 *
 * Throws {@link UndoRefusedError}; returns normally (void) when the undo/
 * rewind is allowed. This is the pit-of-success mechanic (D-02): a new call
 * site that forgets to call this guard is the ONLY way to reintroduce the
 * old client-trusted-enforcement bug -- there is no boolean flag a caller
 * could compute and then ignore.
 */
export function assertUndoAllowed(args: {
  game: Game;
  actionHistory: Array<{ player: number; undoable?: boolean; name?: string }>;
  turnStartActionIndex: number;
  executeBarrierIndex: number;
}): void {
  const { game, actionHistory, turnStartActionIndex, executeBarrierIndex } = args;

  if (game.isFinished()) {
    throw new UndoRefusedError('Cannot undo: the game is finished.', 'finished-phase');
  }

  for (let i = turnStartActionIndex; i < actionHistory.length; i++) {
    if (actionHistory[i].undoable === false) {
      const name = actionHistory[i].name ?? 'action';
      throw new UndoRefusedError(
        `Cannot undo: action ${i} (${name}) is marked notUndoable.`,
        'non-undoable',
      );
    }
  }

  if (turnStartActionIndex < executeBarrierIndex) {
    throw new UndoRefusedError(
      `Cannot undo: an execute() step has already committed at action ${executeBarrierIndex}.`,
      'execute-barrier',
    );
  }
}

/**
 * Build a player's view of the game state
 */
export function buildPlayerState(
  runner: GameRunner,
  playerNames: string[],
  playerPosition: number,
  options?: { includeActionMetadata?: boolean; includeDebugData?: boolean }
): PlayerGameState {
  const flowState = runner.getFlowState();

  // Truth view -- always the current game state
  const playerView = runner.getPlayerView(playerPosition);
  const truthView = playerView.state;

  const isMyTurn = isPlayersTurn(flowState, playerPosition);

  // Get available actions for this seat. Handles both simultaneous steps
  // (awaitingPlayers) and sequential steps (currentPlayer); for sequential
  // flows only the current player sees available actions, which prevents
  // clients from prematurely starting actions during another player's turn.
  const availableActions = availableActionsForSeat(flowState, playerPosition);

  // Compute undo info - pass moveCount from FlowState for accurate turn boundary detection
  // This fixes issues with games where the same player acts at the end of one phase
  // and start of the next (e.g., MERC)
  const { turnStartActionIndex, actionsThisTurn, hasNonUndoableAction } = computeUndoInfo(
    runner.actionHistory,
    flowState?.currentPlayer,
    flowState?.moveCount
  );

  // Can undo if: it's my turn AND I've made at least one action this turn AND no non-undoable action was taken
  const canUndo = isMyTurn && actionsThisTurn > 0 && flowState?.currentPlayer === playerPosition && !hasNonUndoableAction;

  // Get the full player data including custom properties (abilities, score, etc.)
  // for the UI.
  //
  // SEC-03 (F8): this MUST be derived from `truthView` -- the already
  // per-viewer-filtered tree that also backs `state.view` -- rather than a
  // second, unfiltered `player.toJSON()` pass. A raw pass bypasses every
  // visibility mechanism (zone/element hiding AND the SEC-02
  // `visibleAttributes` whitelist), broadcasting every custom Player
  // attribute to every seat and spectator regardless of what the truth view
  // redacted. Routing through `truthView` makes `state.players` inherit all
  // of that filtering for free -- one chokepoint, not two parallel channels.
  const allPlayers = runner.game.players;
  const fullPlayerData = allPlayers.map((player: any) => {
    const node = findElementJSONById(truthView, player.id);
    if (node) {
      // Flatten attributes to root level so UI can access p.color, p.position directly
      const flattened: { name: string; seat: number; [key: string]: unknown } = {
        ...node,
        name: node.name ?? player.name ?? `Player ${player.seat}`,
        ...(node.attributes || {}),
        // Ensure seat is set (use player.seat, which is the 1-indexed position)
        seat: player.seat,
      };
      delete flattened.attributes;
      delete flattened.children;
      delete flattened.childCount;

      return flattened;
    }
    // The Player node itself was filtered out of this viewer's truthView
    // entirely (e.g. individually hidden) -- fall back to the minimal public
    // identity rather than leaking anything from the raw player object.
    return { name: player.name ?? `Player ${player.seat}`, seat: player.seat };
  });

  const state: PlayerGameState = {
    phase: runner.game.phase,
    players: fullPlayerData,
    currentPlayer: flowState?.currentPlayer,
    availableActions,
    isMyTurn,
    view: truthView,
    canUndo,
    actionsThisTurn: isMyTurn ? actionsThisTurn : 0,
    turnStartActionIndex: isMyTurn ? turnStartActionIndex : undefined,
    messages: playerView.messages.length > 0 ? playerView.messages : undefined,
  };

  // Optionally include action metadata for auto-UI
  // Skip for spectators (position 0) - they don't need action metadata and getPlayer(0) is invalid
  if (options?.includeActionMetadata && availableActions.length > 0 && playerPosition > 0) {
    const player = runner.game.getPlayer(playerPosition);
    if (player) {
      state.actionMetadata = buildActionMetadata(runner.game, player, availableActions);
    }
  }

  // Optionally include custom debug data
  if (options?.includeDebugData) {
    const customDebug = runner.game.getCustomDebugData();
    if (Object.keys(customDebug).length > 0) {
      state.customDebug = customDebug;
    }
  }

  // Include colorSelectionEnabled from game settings so clients know to show color swatches
  // (In lobby mode this comes from LobbyInfo, but in non-lobby mode like --ai, this is the only source)
  if (runner.game.settings.colorSelectionEnabled) {
    state.colorSelectionEnabled = true;
  }

  // Include animation events if any are pending
  const animationEvents = runner.game.pendingAnimationEvents;
  if (animationEvents.length > 0) {
    state.animationEvents = animationEvents;
    state.lastAnimationEventId = animationEvents[animationEvents.length - 1].id;
  }

  // Signal whether the game has a tutorial definition (for ControlsMenu gating).
  // No seat guard — the menu item shows for any connected player or spectator.
  if (runner.game.tutorialDefinition) {
    state.hasTutorial = true;
  }

  // Tutorial projection — parity with createPlayerView (T-104-07).
  // Uses the shared getActiveTutorialStepView helper so this call site and
  // createPlayerView cannot diverge. Skip for spectators (position 0).
  if (playerPosition > 0) {
    const tutorial = getActiveTutorialStepView(runner.game, playerPosition);
    if (tutorial !== undefined) {
      state.tutorial = tutorial;
      const disabled = runner.game.getTutorialDisabledActions(playerPosition);
      if (Object.keys(disabled).length > 0) {
        state.disabledActions = disabled;
      }
    }
  }

  return state;
}

// ============================================
// Element diffing (time-travel debugging)
// ============================================

/**
 * The added/removed/changed element IDs between two state views.
 */
export interface ElementDiff {
  added: number[];
  removed: number[];
  changed: number[];
}

interface ComparableElement {
  parentId: number | null;
  attrs: string;
}

/**
 * Serialize the game-state attributes of a view node for comparison.
 * Excludes player objects and internal metadata so that diffs reflect
 * actual game state changes only.
 */
function comparableAttrs(node: Record<string, unknown>): string {
  const attrs = node.attributes as Record<string, unknown> | undefined;
  if (!attrs) return '';
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    // Skip player objects and internal metadata
    if (key === 'player' || key === 'game' || key.startsWith('_')) continue;
    filtered[key] = value;
  }
  return JSON.stringify(filtered);
}

/**
 * Walk a view tree, collecting every id-bearing element keyed by id, along
 * with its parent id and comparable attributes. Nodes without an id are
 * transparent: recursion continues with the same parent.
 */
function collectElements(
  node: unknown,
  map: Map<number, ComparableElement>,
  parentId: number | null = null,
): void {
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (typeof obj.id === 'number') {
    map.set(obj.id, { parentId, attrs: comparableAttrs(obj) });
    if (Array.isArray(obj.children)) {
      for (const child of obj.children) collectElements(child, map, obj.id);
    }
  } else if (Array.isArray(obj.children)) {
    for (const child of obj.children) collectElements(child, map, parentId);
  }
}

/**
 * Compute the element-level diff between two player-state view trees.
 *
 * An element is:
 * - `added` if its id appears only in `toView`,
 * - `removed` if its id appears only in `fromView`,
 * - `changed` if it moved to a different parent OR its comparable
 *   attributes changed.
 *
 * This is the single source of truth shared by GameSession's state-history
 * diff and the stateless executor's debug state diff.
 */
export function computeElementDiff(fromView: unknown, toView: unknown): ElementDiff {
  const fromElements = new Map<number, ComparableElement>();
  const toElements = new Map<number, ComparableElement>();
  collectElements(fromView, fromElements);
  collectElements(toView, toElements);

  const added: number[] = [];
  const removed: number[] = [];
  const changed: number[] = [];

  for (const [id, to] of toElements.entries()) {
    const from = fromElements.get(id);
    if (!from) {
      added.push(id);
    } else if (from.parentId !== to.parentId || from.attrs !== to.attrs) {
      // Element moved to a different parent OR its attributes changed
      changed.push(id);
    }
  }

  for (const id of fromElements.keys()) {
    if (!toElements.has(id)) removed.push(id);
  }

  return { added, removed, changed };
}

/**
 * Build action traces for debugging.
 * Returns detailed information about why each action is or isn't available.
 */
export function buildActionTraces(
  runner: GameRunner,
  playerPosition: number
): ActionTrace[] {
  // playerPosition is 1-indexed
  const player = runner.game.getPlayer(playerPosition);
  if (!player) {
    return [];
  }
  return runner.game.getActionTraces(player);
}
