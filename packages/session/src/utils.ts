/**
 * Shared utility functions for game hosting
 */

import type { FlowState, Game, Player, Selection, ActionDefinition, ActionTrace } from '@boardsmith/engine';
import type { GameRunner } from '@boardsmith/runtime';
import type { PlayerGameState, ActionMetadata, SelectionMetadata } from './types.js';

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
  if (!flowState?.awaitingInput) return false;

  // Handle simultaneous action flows (awaitingPlayers)
  if (flowState.awaitingPlayers && flowState.awaitingPlayers.length > 0) {
    const playerState = flowState.awaitingPlayers.find(p => p.playerIndex === playerPosition);
    return playerState ? !playerState.completed && playerState.availableActions.length > 0 : false;
  }

  // Handle regular turn-based flows
  return flowState.currentPlayer === playerPosition;
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
        if (!actionDef.condition(ctx)) {
          continue; // Skip actions whose condition is now false
        }
      } catch (error) {
        console.error(`[buildActionMetadata] Error checking condition for "${actionName}":`, error);
        continue; // Skip on error
      }
    }

    const selectionMetas: SelectionMetadata[] = [];

    for (const selection of actionDef.selections) {
      const selMeta = buildSelectionMetadata(game, player, selection);
      selectionMetas.push(selMeta);
    }

    metadata[actionName] = {
      name: actionName,
      prompt: actionDef.prompt,
      selections: selectionMetas,
    };
  }

  return metadata;
}

/**
 * Build metadata for a single action by name.
 * Used for followUp actions that aren't in the current available actions.
 * Does NOT check the action's condition (followUp actions bypass conditions).
 */
export function buildSingleActionMetadata(
  game: Game,
  player: Player,
  actionName: string
): ActionMetadata | undefined {
  const actions = (game as any)._actions as Map<string, ActionDefinition>;
  const actionDef = actions?.get(actionName);

  if (!actionDef) {
    console.warn(`[buildSingleActionMetadata] Action "${actionName}" not found in game._actions`);
    return undefined;
  }

  const selectionMetas: SelectionMetadata[] = [];

  for (const selection of actionDef.selections) {
    const selMeta = buildSelectionMetadata(game, player, selection);
    selectionMetas.push(selMeta);
  }

  return {
    name: actionName,
    prompt: actionDef.prompt,
    selections: selectionMetas,
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
 */
function buildSelectionMetadata(
  game: Game,
  player: Player,
  selection: Selection
): SelectionMetadata {
  // Create context first so we can evaluate dynamic prompts
  const ctx = { game, player, args: {} as Record<string, unknown> };

  // Evaluate prompt - can be static string or function returning string
  const evaluatedPrompt = typeof selection.prompt === 'function'
    ? selection.prompt(ctx)
    : selection.prompt;

  const base: SelectionMetadata = {
    name: selection.name,
    type: selection.type,
    prompt: evaluatedPrompt,
    optional: selection.optional,
  };

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
  const view = runner.getPlayerView(playerPosition);

  // Get available actions - check awaitingPlayers first (for simultaneous actions)
  let availableActions: string[];
  if (flowState?.awaitingPlayers && flowState.awaitingPlayers.length > 0) {
    const playerState = flowState.awaitingPlayers.find(p => p.playerIndex === playerPosition);
    availableActions = playerState?.availableActions ?? [];
  } else {
    availableActions = flowState?.availableActions ?? [];
  }

  const isMyTurn = isPlayersTurn(flowState, playerPosition);

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
  // from the game's player objects via their toJSON methods
  // IMPORTANT: Use spread [...] to convert from PlayerCollection to plain Array,
  // because PlayerCollection extends Array and has its own toJSON that would strip data
  const fullPlayerData = [...runner.game.players.map((player: Player) => {
    if (typeof player.toJSON === 'function') {
      return player.toJSON() as { name: string; position: number; [key: string]: unknown };
    }
    // Fallback for players without toJSON
    return { name: player.name, position: player.position };
  })];

  const state: PlayerGameState = {
    phase: runner.game.phase,
    players: fullPlayerData,
    currentPlayer: flowState?.currentPlayer,
    availableActions,
    isMyTurn,
    view: view.state,
    canUndo,
    actionsThisTurn: isMyTurn ? actionsThisTurn : 0,
    turnStartActionIndex: isMyTurn ? turnStartActionIndex : undefined,
  };

  // Optionally include action metadata for auto-UI
  if (options?.includeActionMetadata && availableActions.length > 0) {
    const player = runner.game.players[playerPosition];
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

  return state;
}

/**
 * Build action traces for debugging.
 * Returns detailed information about why each action is or isn't available.
 */
export function buildActionTraces(
  runner: GameRunner,
  playerPosition: number
): ActionTrace[] {
  const player = runner.game.players[playerPosition];
  if (!player) {
    return [];
  }
  return runner.game.getActionTraces(player);
}
