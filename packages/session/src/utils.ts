/**
 * Shared utility functions for game hosting
 */

import type { FlowState, Game, Player, Selection, ActionDefinition } from '@boardsmith/engine';
import type { GameRunner } from '@boardsmith/runtime';
import type { PlayerGameState, ActionMetadata, SelectionMetadata } from './types.js';

/**
 * Generate a default display string for a choice value.
 * Handles objects with name property, primitives, etc.
 */
function defaultChoiceDisplay(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }

  // Primitives: use String directly
  if (typeof value !== 'object') {
    return String(value);
  }

  // Objects: prefer 'name' or 'label' property if present
  const obj = value as Record<string, unknown>;
  if (typeof obj.name === 'string') {
    return obj.name;
  }
  if (typeof obj.label === 'string') {
    return obj.label;
  }

  // Fallback to JSON for objects without name/label
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
 * Build action metadata for auto-UI generation
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

    const selectionMetas: SelectionMetadata[] = [];
    const collectedArgs: Record<string, unknown> = {};

    for (const selection of actionDef.selections) {
      const selMeta = buildSelectionMetadata(game, player, selection, collectedArgs);
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
 * Build metadata for a single selection
 */
function buildSelectionMetadata(
  game: Game,
  player: Player,
  selection: Selection,
  args: Record<string, unknown>
): SelectionMetadata {
  const base: SelectionMetadata = {
    name: selection.name,
    type: selection.type,
    prompt: selection.prompt,
    optional: selection.optional,
    skipIfOnlyOne: selection.skipIfOnlyOne,
  };

  const ctx = { game, player, args };

  // Type-specific properties
  switch (selection.type) {
    case 'choice': {
      const choiceSel = selection as any;

      // Get choices (static array or function result)
      let choices: unknown[];
      if (typeof choiceSel.choices === 'function') {
        try {
          choices = choiceSel.choices(ctx);
        } catch (error) {
          console.error(`[buildSelectionMetadata] Error getting choices for selection "${selection.name}":`, error);
          choices = [];
        }
      } else {
        choices = choiceSel.choices || [];
      }

      // Convert to display format with board refs
      base.choices = choices.map(value => {
        const choice: any = {
          value,
          display: choiceSel.display ? choiceSel.display(value) : defaultChoiceDisplay(value),
        };

        // Add board refs if provided
        if (choiceSel.boardRefs) {
          try {
            const refs = choiceSel.boardRefs(value, ctx);
            if (refs.sourceRef) choice.sourceRef = refs.sourceRef;
            if (refs.targetRef) choice.targetRef = refs.targetRef;
          } catch {
            // Ignore errors in boardRefs
          }
        }

        return choice;
      });

      // Add filterBy if present
      if (choiceSel.filterBy) {
        base.filterBy = choiceSel.filterBy;
      }
      break;
    }

    case 'player': {
      const playerSel = selection as any;

      // If boardRefs provided, evaluate them for each player
      if (playerSel.boardRefs) {
        const players = game.players.filter((p: Player) => {
          // Apply filter if provided
          if (playerSel.filter) {
            return playerSel.filter(p, ctx);
          }
          return true;
        });

        // Build player choices with their board refs
        // IMPORTANT: Convert to plain array first, then map to plain objects for proper JSON serialization
        const playerArray = Array.from(players);
        const choices = [];

        for (const p of playerArray) {
          try {
            const refs = playerSel.boardRefs(p, ctx);

            // Create a plain object with all properties
            const choice: any = {
              position: p.position,
              name: p.name,
            };

            if (refs.sourceRef) choice.sourceRef = refs.sourceRef;
            if (refs.targetRef) choice.targetRef = refs.targetRef;

            choices.push(choice);
          } catch (err) {
            choices.push({
              position: p.position,
              name: p.name,
            });
          }
        }

        base.playerChoices = choices;
      }
      break;
    }

    case 'element': {
      const elemSel = selection as any;
      if (elemSel.elementClass?.name) {
        base.elementClassName = elemSel.elementClass.name;
      }

      // Compute valid elements for the UI
      const from = typeof elemSel.from === 'function'
        ? elemSel.from(ctx)
        : elemSel.from ?? game;

      let elements: any[];
      if (elemSel.elementClass) {
        elements = [...from.all(elemSel.elementClass)];
      } else {
        elements = [...from.all()];
      }

      if (elemSel.filter) {
        elements = elements.filter((e: any) => elemSel.filter!(e, ctx));
      }

      // Build validElements list with display and refs
      base.validElements = elements.map((element: any) => {
        const validElem: any = { id: element.id };

        // Add display text if display function provided
        if (elemSel.display) {
          try {
            validElem.display = elemSel.display(element, ctx);
          } catch {
            validElem.display = element.name || String(element.id);
          }
        } else {
          // Default display: use element's name or notation if available
          validElem.display = element.notation || element.name || String(element.id);
        }

        // Add board ref if provided
        if (elemSel.boardRef) {
          try {
            validElem.ref = elemSel.boardRef(element, ctx);
          } catch {
            // Ignore errors
          }
        } else {
          // Default ref: use element ID and notation if available
          validElem.ref = { id: element.id };
          if (element.notation) {
            validElem.ref.notation = element.notation;
          }
        }

        return validElem;
      });
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
 * Scans action history backwards to find when the current player's turn started.
 * Also checks if any non-undoable action was taken this turn (disables undo).
 */
export function computeUndoInfo(
  actionHistory: Array<{ player: number; undoable?: boolean }>,
  currentPlayer: number | undefined
): { turnStartActionIndex: number; actionsThisTurn: number; hasNonUndoableAction: boolean } {
  if (currentPlayer === undefined || actionHistory.length === 0) {
    return { turnStartActionIndex: 0, actionsThisTurn: 0, hasNonUndoableAction: false };
  }

  // Scan backwards through action history to find where current player's turn started
  // Turn started when we find an action by a DIFFERENT player
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
  options?: { includeActionMetadata?: boolean }
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

  // Compute undo info
  const { turnStartActionIndex, actionsThisTurn, hasNonUndoableAction } = computeUndoInfo(
    runner.actionHistory,
    flowState?.currentPlayer
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

  return state;
}
