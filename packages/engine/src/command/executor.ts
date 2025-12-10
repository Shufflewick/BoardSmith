import type {
  GameCommand,
  CommandResult,
  CreateElementCommand,
  CreateManyCommand,
  MoveCommand,
  RemoveCommand,
  ShuffleCommand,
  SetAttributeCommand,
  SetVisibilityCommand,
  AddVisibleToCommand,
  SetCurrentPlayerCommand,
  MessageCommand,
  StartGameCommand,
  EndGameCommand,
  SetOrderCommand,
  VisibilityConfig,
} from './types.js';
import type { Game } from '../element/game.js';
import type { GameElement } from '../element/game-element.js';
import type { Space } from '../element/space.js';
import type { Piece } from '../element/piece.js';
import type { ElementClass } from '../element/types.js';
import { visibilityFromMode, type VisibilityMode, type VisibilityState } from './visibility.js';

/**
 * Execute a command against a game state
 */
export function executeCommand(game: Game, command: GameCommand): CommandResult {
  try {
    switch (command.type) {
      case 'CREATE':
        return executeCreate(game, command);
      case 'CREATE_MANY':
        return executeCreateMany(game, command);
      case 'MOVE':
        return executeMove(game, command);
      case 'REMOVE':
        return executeRemove(game, command);
      case 'SHUFFLE':
        return executeShuffle(game, command);
      case 'SET_ATTRIBUTE':
        return executeSetAttribute(game, command);
      case 'SET_VISIBILITY':
        return executeSetVisibility(game, command);
      case 'ADD_VISIBLE_TO':
        return executeAddVisibleTo(game, command);
      case 'SET_CURRENT_PLAYER':
        return executeSetCurrentPlayer(game, command);
      case 'MESSAGE':
        return executeMessage(game, command);
      case 'START_GAME':
        return executeStartGame(game, command);
      case 'END_GAME':
        return executeEndGame(game, command);
      case 'SET_ORDER':
        return executeSetOrder(game, command);
      default:
        return { success: false, error: `Unknown command type: ${(command as any).type}` };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function executeCreate(game: Game, command: CreateElementCommand): CommandResult {
  const parent = game.getElementById(command.parentId);
  if (!parent) {
    return { success: false, error: `Parent element not found: ${command.parentId}` };
  }

  const ElementClass = game.getElementClass(command.className);
  if (!ElementClass) {
    return { success: false, error: `Unknown element class: ${command.className}` };
  }

  const element = parent.createInternal(ElementClass, command.name, command.attributes);
  return { success: true, createdIds: [element.id] };
}

function executeCreateMany(game: Game, command: CreateManyCommand): CommandResult {
  const parent = game.getElementById(command.parentId);
  if (!parent) {
    return { success: false, error: `Parent element not found: ${command.parentId}` };
  }

  const ElementClass = game.getElementClass(command.className);
  if (!ElementClass) {
    return { success: false, error: `Unknown element class: ${command.className}` };
  }

  const createdIds: number[] = [];
  for (let i = 0; i < command.count; i++) {
    const attrs = command.attributesList?.[i] ?? {};
    const element = parent.createInternal(ElementClass, command.name, attrs);
    createdIds.push(element.id);
  }

  return { success: true, createdIds };
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

  // Use internal move method
  (element as Piece).moveToInternal(destination, command.position);
  return { success: true };
}

function executeRemove(game: Game, command: RemoveCommand): CommandResult {
  const element = game.getElementById(command.elementId);
  if (!element) {
    return { success: false, error: `Element not found: ${command.elementId}` };
  }

  (element as Piece).moveToInternal(game.pile);
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

function executeSetAttribute(game: Game, command: SetAttributeCommand): CommandResult {
  const element = game.getElementById(command.elementId);
  if (!element) {
    return { success: false, error: `Element not found: ${command.elementId}` };
  }

  (element as any)[command.attribute] = command.value;
  return { success: true };
}

function executeSetVisibility(game: Game, command: SetVisibilityCommand): CommandResult {
  const element = game.getElementById(command.elementId);
  if (!element) {
    return { success: false, error: `Element not found: ${command.elementId}` };
  }

  let visibility: VisibilityState;
  if (typeof command.visibility === 'string') {
    visibility = visibilityFromMode(command.visibility);
  } else {
    visibility = {
      mode: command.visibility.mode,
      addPlayers: command.visibility.addPlayers,
      exceptPlayers: command.visibility.exceptPlayers,
      explicit: true,
    };
  }

  element.setVisibilityInternal(visibility);
  return { success: true };
}

function executeAddVisibleTo(game: Game, command: AddVisibleToCommand): CommandResult {
  const element = game.getElementById(command.elementId);
  if (!element) {
    return { success: false, error: `Element not found: ${command.elementId}` };
  }

  element.addVisibleToInternal(command.players);
  return { success: true };
}

function executeSetCurrentPlayer(game: Game, command: SetCurrentPlayerCommand): CommandResult {
  game.players.setCurrent(command.playerPosition);
  return { success: true };
}

function executeMessage(game: Game, command: MessageCommand): CommandResult {
  game.addMessageInternal(command.text, command.data);
  return { success: true };
}

function executeStartGame(game: Game, command: StartGameCommand): CommandResult {
  if (game.phase !== 'setup') {
    return { success: false, error: 'Game has already started' };
  }
  game.phase = 'started';
  return { success: true };
}

function executeEndGame(game: Game, command: EndGameCommand): CommandResult {
  game.phase = 'finished';
  if (command.winners) {
    game.settings.winners = command.winners;
  }
  return { success: true };
}

function executeSetOrder(game: Game, command: SetOrderCommand): CommandResult {
  const space = game.getElementById(command.spaceId);
  if (!space) {
    return { success: false, error: `Space not found: ${command.spaceId}` };
  }

  space._t.order = command.order;
  return { success: true };
}
