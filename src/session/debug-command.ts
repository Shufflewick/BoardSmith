/**
 * The edits the debug ops make to a game outside its rules: move a card to
 * another space (`debugTransfer`), shuffle a space (`debugShuffle`), and move a
 * card to an index within its space (`debugReorder`). `stateless-ops.ts` is the
 * only caller; game code moves elements through the element methods.
 */

import type { Game } from '../engine/element/game.js';
import type { Space } from '../engine/element/space.js';

/** Move an element to a new parent. */
interface MoveCommand {
  type: 'MOVE';
  elementId: number;
  destinationId: number;
  position?: 'first' | 'last';
}

/** Shuffle the children of a space. */
interface ShuffleCommand {
  type: 'SHUFFLE';
  spaceId: number;
}

/** Move an element to an index (from 0) within its current parent. */
interface ReorderChildCommand {
  type: 'REORDER_CHILD';
  elementId: number;
  targetIndex: number;
}

export type GameCommand = MoveCommand | ShuffleCommand | ReorderChildCommand;

export interface CommandResult {
  success: boolean;
  /** Why the edit was refused, naming the id that did not resolve. */
  error?: string;
}

/**
 * Apply one debug edit to `game`. A refusal, or an error the engine throws
 * while applying it, comes back as `{ success: false, error }`.
 */
export function executeDebugCommand(game: Game, command: GameCommand): CommandResult {
  try {
    switch (command.type) {
      case 'MOVE':
        return executeMove(game, command);
      case 'SHUFFLE':
        return executeShuffle(game, command);
      case 'REORDER_CHILD':
        return executeReorderChild(game, command);
      default: {
        // `command` is `never` here only while every member of GameCommand has
        // a case above, so a new command without one stops compiling (#52).
        const unhandled: never = command;
        return { success: false, error: `Unknown command type: ${(unhandled as GameCommand).type}` };
      }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function executeMove(game: Game, command: MoveCommand): CommandResult {
  const element = game.getElementById(command.elementId);
  if (!element) {
    return { success: false, error: `Element not found: ${command.elementId}` };
  }
  const destination = game.getElementById(command.destinationId);
  if (!destination) {
    return { success: false, error: `Destination not found: ${command.destinationId}` };
  }
  element.moveToInternal(destination, command.position);
  return { success: true };
}

function executeShuffle(game: Game, command: ShuffleCommand): CommandResult {
  const space = game.getElementById(command.spaceId) as Space | undefined;
  if (!space) {
    return { success: false, error: `Space not found: ${command.spaceId}` };
  }
  space.shuffleInternal();
  return { success: true };
}

function executeReorderChild(game: Game, command: ReorderChildCommand): CommandResult {
  const element = game.getElementById(command.elementId);
  if (!element) {
    return { success: false, error: `Element not found: ${command.elementId}` };
  }
  const parent = element.parent;
  if (!parent) {
    return { success: false, error: `Element has no parent` };
  }
  const children = parent._t.children;
  const currentIndex = children.indexOf(element);
  if (currentIndex === -1) {
    return { success: false, error: `Element not found in parent's children` };
  }
  if (command.targetIndex < 0 || command.targetIndex >= children.length) {
    return { success: false, error: `Invalid target index: ${command.targetIndex}` };
  }
  children.splice(currentIndex, 1);
  children.splice(command.targetIndex, 0, element);
  return { success: true };
}
