/**
 * Shared utility functions for game hosting
 */

import type { FlowState, Game, Player, Selection, ActionDefinition, ActionTrace } from '@boardsmith/engine';
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
    // Track available values for each selection (for dependsOn lookups)
    const selectionValues: Map<string, { type: string; values: unknown[] }> = new Map();

    for (const selection of actionDef.selections) {
      const selMeta = buildSelectionMetadata(game, player, selection, selectionValues);
      selectionMetas.push(selMeta);

      // Track available values for this selection (for subsequent dependsOn lookups)
      if (selection.type === 'element' && selMeta.validElements) {
        selectionValues.set(selection.name, {
          type: 'element',
          values: selMeta.validElements.map(ve => ve.id),
        });
      } else if (selection.type === 'choice' && selMeta.choices) {
        selectionValues.set(selection.name, {
          type: 'choice',
          values: selMeta.choices.map(c => c.value),
        });
      }
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
  selectionValues: Map<string, { type: string; values: unknown[] }>
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

  // Type-specific properties
  switch (selection.type) {
    case 'choice': {
      const choiceSel = selection as any;

      // Check if this selection depends on a previous selection
      if (choiceSel.dependsOn && typeof choiceSel.choices === 'function') {
        const dependentInfo = selectionValues.get(choiceSel.dependsOn);

        if (dependentInfo) {
          base.dependsOn = choiceSel.dependsOn;
          base.choicesByDependentValue = {};

          // For each possible value of the dependent selection, compute choices
          for (const depValue of dependentInfo.values) {
            // Build args with the dependent value
            // For element selections, we need to resolve to the actual element
            let argValue: unknown = depValue;
            if (dependentInfo.type === 'element' && typeof depValue === 'number') {
              argValue = game.getElementById(depValue);
            }

            const argsWithDep = { [choiceSel.dependsOn]: argValue };
            const ctxWithDep = { game, player, args: argsWithDep };

            let choices: unknown[];
            try {
              choices = choiceSel.choices(ctxWithDep);
            } catch (error) {
              console.error(`[buildSelectionMetadata] Error getting choices for "${selection.name}" with ${choiceSel.dependsOn}=${depValue}:`, error);
              choices = [];
            }

            // Convert to display format with board refs
            const formattedChoices = choices.map(value => {
              const choice: any = {
                value,
                display: choiceSel.display ? choiceSel.display(value) : defaultChoiceDisplay(value),
              };

              if (choiceSel.boardRefs) {
                try {
                  const refs = choiceSel.boardRefs(value, ctxWithDep);
                  if (refs.sourceRef) choice.sourceRef = refs.sourceRef;
                  if (refs.targetRef) choice.targetRef = refs.targetRef;
                } catch {
                  // Ignore errors
                }
              }

              return choice;
            });

            // Key by the serialized value (element ID, player position, etc.)
            const key = String(depValue);
            base.choicesByDependentValue[key] = formattedChoices;
          }

          // Add repeat info if present (must be before break!)
          if (choiceSel.repeat || choiceSel.repeatUntil !== undefined) {
            base.repeat = {
              hasOnEach: !!choiceSel.repeat?.onEach,
              terminator: choiceSel.repeatUntil,
            };
          }

          // Add multiSelect config per dependent value if present
          // This must be evaluated PER dependent value since multiSelect can vary
          if (choiceSel.multiSelect !== undefined) {
            base.multiSelectByDependentValue = {};

            for (const depValue of dependentInfo.values) {
              // Build args with the dependent value (same as above for choices)
              let argValue: unknown = depValue;
              if (dependentInfo.type === 'element' && typeof depValue === 'number') {
                argValue = game.getElementById(depValue);
              }

              const argsWithDep = { [choiceSel.dependsOn]: argValue };
              const ctxWithDep = { game, player, args: argsWithDep };

              const multiSelectConfig = typeof choiceSel.multiSelect === 'function'
                ? choiceSel.multiSelect(ctxWithDep)
                : choiceSel.multiSelect;

              const key = String(depValue);
              if (multiSelectConfig !== undefined) {
                if (typeof multiSelectConfig === 'number') {
                  base.multiSelectByDependentValue[key] = { min: 1, max: multiSelectConfig };
                } else {
                  base.multiSelectByDependentValue[key] = {
                    min: multiSelectConfig.min ?? 1,
                    max: multiSelectConfig.max,
                  };
                }
              } else {
                // Explicitly store undefined for single-select
                base.multiSelectByDependentValue[key] = undefined;
              }
            }
          }

          // Don't populate base.choices for dependsOn selections - client uses choicesByDependentValue
          break;
        }
      }

      // Regular choice handling (no dependsOn or static choices)
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

      // Add repeat info if present
      if (choiceSel.repeat || choiceSel.repeatUntil !== undefined) {
        base.repeat = {
          hasOnEach: !!choiceSel.repeat?.onEach,
          terminator: choiceSel.repeatUntil,
        };
      }

      // Add multiSelect config if present (evaluate function if needed)
      if (choiceSel.multiSelect !== undefined) {
        const multiSelectConfig = typeof choiceSel.multiSelect === 'function'
          ? choiceSel.multiSelect(ctx)
          : choiceSel.multiSelect;

        if (multiSelectConfig !== undefined) {
          if (typeof multiSelectConfig === 'number') {
            // Shorthand: number means { min: 1, max: N }
            base.multiSelect = { min: 1, max: multiSelectConfig };
          } else {
            // Full config object
            base.multiSelect = {
              min: multiSelectConfig.min ?? 1,
              max: multiSelectConfig.max,
            };
          }
        }
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
