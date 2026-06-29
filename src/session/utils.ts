/**
 * Shared utility functions for game hosting
 */

import { Player, evaluateCondition, canSeatAct, availableActionsForSeat, type FlowState, type Game, type Selection, type ActionDefinition, type ActionTrace } from '../engine/index.js';
import { getActiveTutorialStepView } from '../engine/tutorial/gate.js';
import type { GameRunner } from '../runtime/index.js';
import type { PlayerGameState, ActionMetadata, PickMetadata } from './types.js';

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
 * Build action metadata for auto-UI generation.
 *
 * SIMPLIFIED VERSION: Only includes static metadata.
 * Choices and elements are fetched on-demand via /selection-choices endpoint.
 */
export function buildActionMetadata(
  game: Game,
  player: Player,
  availableActionNames: string[]
): Record<string, ActionMetadata> {
  const metadata: Record<string, ActionMetadata> = {};

  for (const actionName of availableActionNames) {
    // Access registered actions via the game's internal API
    const actions = (game as any)._actions as Map<string, ActionDefinition>;
    const actionDef = actions?.get(actionName);

    if (!actionDef) {
      console.warn(`[buildActionMetadata] Action "${actionName}" not found in game._actions`);
      continue;
    }

    // Re-check condition in case state changed during action execution (mid-action broadcast)
    // This prevents showing stale action metadata when the condition has become false
    if (actionDef.condition) {
      const ctx = { game, player, args: {} };
      try {
        if (!evaluateCondition(actionDef.condition, ctx)) {
          continue; // Skip actions whose condition is now false
        }
      } catch (error) {
        console.error(`[buildActionMetadata] Error checking condition for "${actionName}":`, error);
        continue; // Skip on error
      }
    }

    const pickMetas: PickMetadata[] = [];

    for (const selection of actionDef.selections) {
      const pickMeta = buildPickMetadata(game, player, selection);
      pickMetas.push(pickMeta);
    }

    metadata[actionName] = {
      name: actionName,
      prompt: actionDef.prompt,
      help: actionDef.help,
      selections: pickMetas,
    };
  }

  return metadata;
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
 * Build metadata for a single selection.
 *
 * Only includes static metadata - choices are always fetched on-demand
 * via /selection-choices endpoint.
 *
 * This keeps:
 * - name, type, prompt, optional
 * - dependsOn - client needs to know what args to send
 * - filterBy - client needs to know what args to send
 * - repeat - client needs repeat behavior info
 * - multiSelect - only if static (not function-based)
 * - elementClassName - for CSS targeting
 * - min, max, integer, pattern, etc. - for number/text validation
 *
 * @param knownArgs Optional args for evaluating dynamic prompts (for followUp actions with pre-filled args)
 */
function buildPickMetadata(
  game: Game,
  player: Player,
  selection: Selection,
  knownArgs?: Record<string, unknown>
): PickMetadata {
  // Create context with known args if provided (for followUp actions)
  const ctx = { game, player, args: knownArgs ?? {} };

  // Evaluate prompt - can be static string or function returning string
  const evaluatedPrompt = typeof selection.prompt === 'function'
    ? selection.prompt(ctx)
    : selection.prompt;

  const base: PickMetadata = {
    name: selection.name,
    type: selection.type,
    prompt: evaluatedPrompt,
    optional: selection.optional,
  };

  // onSelect callback flag - client needs this to route through server per-step
  if ((selection as any).onSelect) {
    base.hasOnSelect = true;
  }

  // Type-specific properties (static metadata only)
  switch (selection.type) {
    case 'choice': {
      const choiceSel = selection as any;

      // Include dependsOn info so client knows what args to send when fetching
      if (choiceSel.dependsOn) {
        base.dependsOn = choiceSel.dependsOn;
      }

      // Include filterBy info so client knows about the dependency
      if (choiceSel.filterBy) {
        base.filterBy = choiceSel.filterBy;
      }

      // Include repeat info if present
      if (choiceSel.repeat || choiceSel.repeatUntil !== undefined) {
        base.repeat = {
          hasOnEach: !!choiceSel.repeat?.onEach,
          terminator: choiceSel.repeatUntil,
        };
      }

      // Include multiSelect config only if it's static (not function-based)
      if (choiceSel.multiSelect !== undefined && typeof choiceSel.multiSelect !== 'function') {
        if (typeof choiceSel.multiSelect === 'number') {
          base.multiSelect = { min: 1, max: choiceSel.multiSelect };
        } else {
          base.multiSelect = {
            min: choiceSel.multiSelect.min ?? 1,
            max: choiceSel.multiSelect.max,
          };
        }
      }
      // Note: If multiSelect is a function, it will be evaluated when fetching choices
      break;
    }

    case 'element': {
      const elemSel = selection as any;

      // Include elementClassName for CSS targeting
      if (elemSel.elementClass?.name) {
        base.elementClassName = elemSel.elementClass.name;
      }

      // Include dependsOn info so client knows what args to send when fetching
      if (elemSel.dependsOn) {
        base.dependsOn = elemSel.dependsOn;
      }

      // Include repeat info if present
      if (elemSel.repeat || elemSel.repeatUntil !== undefined) {
        base.repeat = {
          hasOnEach: !!elemSel.repeat?.onEach,
          terminator: elemSel.repeatUntil,
        };
      }
      break;
    }

    case 'elements': {
      const elementsSel = selection as any;

      // Include dependsOn info so client knows what args to send when fetching
      if (elementsSel.dependsOn) {
        base.dependsOn = elementsSel.dependsOn;
      }

      // Include repeat info if present
      if (elementsSel.repeat || elementsSel.repeatUntil !== undefined) {
        base.repeat = {
          hasOnEach: !!elementsSel.repeat?.onEach,
          terminator: elementsSel.repeatUntil,
        };
      }

      // Include multiSelect config only if it's static (not function-based)
      if (elementsSel.multiSelect !== undefined && typeof elementsSel.multiSelect !== 'function') {
        if (typeof elementsSel.multiSelect === 'number') {
          base.multiSelect = { min: 1, max: elementsSel.multiSelect };
        } else {
          base.multiSelect = {
            min: elementsSel.multiSelect.min ?? 1,
            max: elementsSel.multiSelect.max,
          };
        }
      }
      // Note: If multiSelect is a function, it will be evaluated when fetching choices
      break;
    }

    case 'number': {
      const numSel = selection as any;
      base.min = numSel.min;
      base.max = numSel.max;
      base.integer = numSel.integer;
      break;
    }

    case 'text': {
      const textSel = selection as any;
      base.pattern = textSel.pattern?.source;
      base.minLength = textSel.minLength;
      base.maxLength = textSel.maxLength;
      break;
    }
  }

  return base;
}

/**
 * Compute turn start action index and actions this turn for a player.
 *
 * Uses moveCount from FlowState as the authoritative source when available.
 * This correctly handles games with phases where the same player can act at
 * the end of one phase and start of the next (e.g., MERC where Rebel Player
 * acts at end of Day 1 and start of Day 2).
 *
 * Falls back to scanning action history for player changes when moveCount
 * is not available.
 *
 * @param actionHistory - The action history to scan
 * @param currentPlayer - The current player's position
 * @param moveCount - Optional move count from FlowState (actions taken in current action step)
 */
export function computeUndoInfo(
  actionHistory: Array<{ player: number; undoable?: boolean }>,
  currentPlayer: number | undefined,
  moveCount?: number
): { turnStartActionIndex: number; actionsThisTurn: number; hasNonUndoableAction: boolean } {
  if (currentPlayer === undefined || actionHistory.length === 0) {
    return { turnStartActionIndex: 0, actionsThisTurn: 0, hasNonUndoableAction: false };
  }

  // If we have moveCount from FlowState, use it as the authoritative source
  // This correctly handles phase transitions where the same player acts
  // at the end of one phase and start of the next
  if (moveCount !== undefined) {
    // moveCount tells us how many actions were taken in the current action step
    // Only check the last 'moveCount' actions for non-undoable actions
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

  // Fallback: Scan backwards through action history to find where current player's turn started
  // Turn started when we find an action by a DIFFERENT player
  // Note: This heuristic can fail for games with phases where the same player
  // acts at the end of one phase and start of the next
  let actionsThisTurn = 0;
  let hasNonUndoableAction = false;

  for (let i = actionHistory.length - 1; i >= 0; i--) {
    if (actionHistory[i].player === currentPlayer) {
      actionsThisTurn++;
      // Check if this action was non-undoable
      if (actionHistory[i].undoable === false) {
        hasNonUndoableAction = true;
      }
    } else {
      // Found action by different player - turn started after this action
      return { turnStartActionIndex: i + 1, actionsThisTurn, hasNonUndoableAction };
    }
  }

  // All actions in history are by current player - turn started at beginning
  return { turnStartActionIndex: 0, actionsThisTurn, hasNonUndoableAction };
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
  // from the game's player objects via their toJSON methods.
  const allPlayers = runner.game.players;
  const fullPlayerData = allPlayers.map((player: any) => {
    if (typeof player.toJSON === 'function') {
      // toJSON returns ElementJSON which puts custom props in `attributes`.
      // We need to flatten attributes to root level for the UI.
      const json = player.toJSON() as unknown as {
        name: string;
        className: string;
        id: number;
        attributes?: Record<string, unknown>;
        [key: string]: unknown
      };

      // Flatten attributes to root level so UI can access p.color, p.position directly
      const flattened: { name: string; seat: number; [key: string]: unknown } = {
        ...json,
        ...(json.attributes || {}),
        // Ensure seat is set (use player.seat, which is the 1-indexed position)
        seat: player.seat,
      };
      delete flattened.attributes;

      return flattened;
    }
    // Fallback for players without toJSON
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
