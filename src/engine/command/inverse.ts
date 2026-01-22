/**
 * Inverse Command Generation - Create undo commands for state rollback
 *
 * Generates inverse commands that reverse the effect of a given command.
 * Used by MCTS for efficient state rollback without full history replay.
 *
 * @internal
 */

import type { Game } from '../element/game.js';
import type {
  GameCommand,
  MoveCommand,
  SetAttributeCommand,
  CreateElementCommand,
  CreateManyCommand,
  RemoveCommand,
  SetVisibilityCommand,
  AddVisibleToCommand,
  SetCurrentPlayerCommand,
  StartGameCommand,
  EndGameCommand,
  SetOrderCommand,
  ReorderChildCommand,
  TrackAddCommand,
  TrackRemoveLastCommand,
} from './types.js';
import type { TrackOwner } from './executor.js';
import type { VisibilityState } from './visibility.js';

/**
 * Generate an inverse command that undoes the effect of the given command.
 *
 * IMPORTANT: This must be called BEFORE executing the command, as it needs
 * to capture the current state to generate the inverse.
 *
 * @param game - The game instance (current state before command execution)
 * @param command - The command about to be executed
 * @returns The inverse command, or null if the command is not invertible
 *
 * @example
 * ```typescript
 * // Before executing a MOVE command
 * const inverse = createInverseCommand(game, moveCommand);
 * executeCommand(game, moveCommand);
 * // Later, to undo:
 * if (inverse) executeCommand(game, inverse);
 * ```
 */
export function createInverseCommand(game: Game, command: GameCommand): GameCommand | null {
  switch (command.type) {
    case 'MOVE':
      return createMoveInverse(game, command);

    case 'SET_ATTRIBUTE':
      return createSetAttributeInverse(game, command);

    case 'CREATE':
      // Inverse of CREATE is REMOVE - but we don't know the ID yet
      // This needs to be handled specially after execution
      return null;

    case 'CREATE_MANY':
      // Same issue - we don't know IDs until after creation
      return null;

    case 'REMOVE':
      return createRemoveInverse(game, command);

    case 'SHUFFLE':
      // Not invertible - random operation
      return null;

    case 'SET_VISIBILITY':
      return createSetVisibilityInverse(game, command);

    case 'ADD_VISIBLE_TO':
      // Not easily invertible - would need to track previous addPlayers
      return null;

    case 'SET_CURRENT_PLAYER':
      return createSetCurrentPlayerInverse(game, command);

    case 'MESSAGE':
      // Messages don't affect game state meaningfully
      return null;

    case 'START_GAME':
      return createStartGameInverse(game, command);

    case 'END_GAME':
      return createEndGameInverse(game, command);

    case 'SET_ORDER':
      return createSetOrderInverse(game, command);

    case 'REORDER_CHILD':
      return createReorderChildInverse(game, command);

    case 'TRACK_ADD':
      return createTrackAddInverse(game, command);

    case 'TRACK_REMOVE_LAST':
      return createTrackRemoveLastInverse(game, command);

    default:
      return null;
  }
}

/**
 * Create inverse for MOVE command.
 * Captures current parent ID to move back to original location.
 */
function createMoveInverse(game: Game, command: MoveCommand): MoveCommand | null {
  const element = game.getElementById(command.elementId);
  if (!element) return null;

  const currentParent = element._t.parent;
  if (!currentParent) return null;

  // Capture current position in parent for accurate restoration
  const currentIndex = currentParent._t.children.indexOf(element);
  const isFirst = currentIndex === 0;

  return {
    type: 'MOVE',
    elementId: command.elementId,
    destinationId: currentParent.id,
    position: isFirst ? 'first' : 'last',
  };
}

/**
 * Create inverse for SET_ATTRIBUTE command.
 * Captures current attribute value for restoration.
 */
function createSetAttributeInverse(game: Game, command: SetAttributeCommand): SetAttributeCommand | null {
  const element = game.getElementById(command.elementId);
  if (!element) return null;

  // Capture current value
  const currentValue = (element as unknown as Record<string, unknown>)[command.attribute];

  return {
    type: 'SET_ATTRIBUTE',
    elementId: command.elementId,
    attribute: command.attribute,
    value: currentValue,
  };
}

/**
 * Create inverse for REMOVE command.
 * Captures full element state for recreation.
 *
 * Note: This creates a CREATE command, but the removed element goes to pile,
 * so we actually need to MOVE it back to its original parent.
 */
function createRemoveInverse(game: Game, command: RemoveCommand): MoveCommand | null {
  const element = game.getElementById(command.elementId);
  if (!element) return null;

  const currentParent = element._t.parent;
  if (!currentParent) return null;

  // Capture current position
  const currentIndex = currentParent._t.children.indexOf(element);
  const isFirst = currentIndex === 0;

  // REMOVE moves to pile, so inverse is MOVE back to original parent
  return {
    type: 'MOVE',
    elementId: command.elementId,
    destinationId: currentParent.id,
    position: isFirst ? 'first' : 'last',
  };
}

/**
 * Create inverse for SET_VISIBILITY command.
 * Captures current visibility state.
 */
function createSetVisibilityInverse(game: Game, command: SetVisibilityCommand): SetVisibilityCommand | null {
  const element = game.getElementById(command.elementId);
  if (!element) return null;

  // Get current visibility (might be undefined/inherited)
  const currentVisibility = element.getEffectiveVisibility();

  return {
    type: 'SET_VISIBILITY',
    elementId: command.elementId,
    visibility: currentVisibility.mode,
  };
}

/**
 * Create inverse for SET_CURRENT_PLAYER command.
 * Captures current player position.
 */
function createSetCurrentPlayerInverse(game: Game, _command: SetCurrentPlayerCommand): SetCurrentPlayerCommand | null {
  const currentPlayer = game.currentPlayer;
  if (!currentPlayer) {
    // No current player - can't really invert this
    return null;
  }

  return {
    type: 'SET_CURRENT_PLAYER',
    playerPosition: currentPlayer.seat,
  };
}

/**
 * Create inverse for START_GAME command.
 */
function createStartGameInverse(_game: Game, _command: StartGameCommand): null {
  // Can't really undo starting a game in a meaningful way
  // The game structure may have changed
  return null;
}

/**
 * Create inverse for END_GAME command.
 */
function createEndGameInverse(_game: Game, _command: EndGameCommand): null {
  // Can't undo ending a game - state may have been cleaned up
  return null;
}

/**
 * Create inverse for SET_ORDER command.
 * Captures current order mode.
 */
function createSetOrderInverse(game: Game, command: SetOrderCommand): SetOrderCommand | null {
  const space = game.getElementById(command.spaceId);
  if (!space) return null;

  const currentOrder = space._t.order ?? 'normal';

  return {
    type: 'SET_ORDER',
    spaceId: command.spaceId,
    order: currentOrder,
  };
}

/**
 * Create inverse for REORDER_CHILD command.
 * Captures current index position.
 */
function createReorderChildInverse(game: Game, command: ReorderChildCommand): ReorderChildCommand | null {
  const element = game.getElementById(command.elementId);
  if (!element) return null;

  const parent = element._t.parent;
  if (!parent) return null;

  const currentIndex = parent._t.children.indexOf(element);
  if (currentIndex === -1) return null;

  return {
    type: 'REORDER_CHILD',
    elementId: command.elementId,
    targetIndex: currentIndex,
  };
}

/**
 * Create inverse for TRACK_ADD command.
 * Inverse is TRACK_REMOVE_LAST - removes the entry that was just added.
 */
function createTrackAddInverse(_game: Game, command: TrackAddCommand): TrackRemoveLastCommand {
  // The inverse of adding is removing the last entry
  return {
    type: 'TRACK_REMOVE_LAST',
    ownerId: command.ownerId,
    trackId: command.trackId,
  };
}

/**
 * Create inverse for TRACK_REMOVE_LAST command.
 * Captures the last entry's value before removal for restoration.
 */
function createTrackRemoveLastInverse(game: Game, command: TrackRemoveLastCommand): TrackAddCommand | null {
  const owner = game.getElementById(command.ownerId);
  if (!owner) return null;

  // Check if owner implements TrackOwner interface
  if (!('getTrack' in owner) || typeof (owner as unknown as TrackOwner).getTrack !== 'function') {
    return null;
  }

  const track = (owner as unknown as TrackOwner).getTrack(command.trackId);
  if (!track) return null;

  const lastEntry = track.getLastEntry();
  if (!lastEntry) return null;

  // The inverse of removing is adding the value back
  return {
    type: 'TRACK_ADD',
    ownerId: command.ownerId,
    trackId: command.trackId,
    value: lastEntry.value,
    isSpecial: lastEntry.isSpecial,
  };
}
