import type { Game } from '../element/game.js';
import type { GameCommand } from '../command/types.js';
import type { SerializedAction } from '../action/types.js';
import type { FlowState } from '../flow/types.js';
import type { ElementJSON } from '../element/types.js';

/**
 * Complete game state snapshot for persistence/transmission
 */
export interface GameStateSnapshot {
  /** Version for compatibility checking */
  version: number;

  /** Game class name for reconstruction */
  gameType: string;

  /** Timestamp when snapshot was created */
  timestamp: number;

  /** Full element tree state */
  state: ElementJSON & {
    players: Record<string, unknown>[];
    phase: string;
    messages: Array<{ text: string; data?: Record<string, unknown> }>;
    settings: Record<string, unknown>;
  };

  /** Flow engine state (if flow is active) */
  flowState?: FlowState;

  /** Command history for replay */
  commandHistory: GameCommand[];

  /** Action history for replay */
  actionHistory: SerializedAction[];

  /** Random seed for deterministic replay */
  seed?: string;
}

/**
 * Per-player view of the game state
 */
export interface PlayerStateView {
  /** Player position */
  player: number;

  /** Filtered state (hidden elements obscured) */
  state: ElementJSON;

  /** Flow state relevant to this player */
  flowState?: {
    awaitingInput: boolean;
    isMyTurn: boolean;
    availableActions?: string[];
    prompt?: string;
  };

  /** Messages visible to this player */
  messages: Array<{ text: string; data?: Record<string, unknown> }>;

  /** Game phase */
  phase: string;

  /** Is game complete? */
  complete: boolean;

  /** Winners (if game is complete) */
  winners?: number[];
}

/**
 * Create a complete game state snapshot
 */
export function createSnapshot(
  game: Game,
  gameType: string,
  actionHistory: SerializedAction[] = [],
  seed?: string
): GameStateSnapshot {
  const flowState = game.getFlowState();

  return {
    version: 1,
    gameType,
    timestamp: Date.now(),
    state: game.toJSON() as GameStateSnapshot['state'],
    flowState: flowState ?? undefined,
    commandHistory: [...game.commandHistory],
    actionHistory: [...actionHistory],
    seed,
  };
}

/**
 * Create a player-specific view of the game state
 */
export function createPlayerView(
  game: Game,
  playerPosition: number
): PlayerStateView {
  const flowState = game.getFlowState();
  const currentPlayer = flowState?.currentPlayer;

  return {
    player: playerPosition,
    state: game.toJSONForPlayer(playerPosition),
    flowState: flowState ? {
      awaitingInput: flowState.awaitingInput,
      isMyTurn: currentPlayer === playerPosition,
      availableActions: flowState.awaitingInput && currentPlayer === playerPosition
        ? flowState.availableActions
        : undefined,
      prompt: flowState.awaitingInput && currentPlayer === playerPosition
        ? flowState.prompt
        : undefined,
    } : undefined,
    messages: game.getFormattedMessages().map(text => ({ text })),
    phase: game.phase,
    complete: flowState?.complete ?? false,
    winners: flowState?.complete ? game.getWinners().map(p => p.position) : undefined,
  };
}

/**
 * Create views for all players
 */
export function createAllPlayerViews(game: Game): PlayerStateView[] {
  return game.players.map((_, i) => createPlayerView(game, i));
}

/**
 * Compute the difference between two snapshots (for efficient sync)
 */
export interface StateDiff {
  /** Changed elements (by ID) */
  changed: Map<number, Partial<ElementJSON>>;
  /** Added element IDs */
  added: number[];
  /** Removed element IDs */
  removed: number[];
  /** New commands since last sync */
  newCommands: GameCommand[];
  /** New actions since last sync */
  newActions: SerializedAction[];
  /** Updated flow state */
  flowState?: FlowState;
}

/**
 * Compute diff between two snapshots
 */
export function computeDiff(
  oldSnapshot: GameStateSnapshot,
  newSnapshot: GameStateSnapshot
): StateDiff {
  const diff: StateDiff = {
    changed: new Map(),
    added: [],
    removed: [],
    newCommands: newSnapshot.commandHistory.slice(oldSnapshot.commandHistory.length),
    newActions: newSnapshot.actionHistory.slice(oldSnapshot.actionHistory.length),
    flowState: newSnapshot.flowState,
  };

  // Build maps of elements by ID
  const oldElements = new Map<number, ElementJSON>();
  const newElements = new Map<number, ElementJSON>();

  function collectElements(json: ElementJSON, map: Map<number, ElementJSON>) {
    map.set(json.id, json);
    if (json.children) {
      for (const child of json.children) {
        collectElements(child, map);
      }
    }
  }

  collectElements(oldSnapshot.state, oldElements);
  collectElements(newSnapshot.state, newElements);

  // Find added and removed
  for (const id of newElements.keys()) {
    if (!oldElements.has(id)) {
      diff.added.push(id);
    }
  }

  for (const id of oldElements.keys()) {
    if (!newElements.has(id)) {
      diff.removed.push(id);
    }
  }

  // Find changed (simple comparison for now)
  for (const [id, newEl] of newElements) {
    const oldEl = oldElements.get(id);
    if (oldEl && JSON.stringify(oldEl) !== JSON.stringify(newEl)) {
      diff.changed.set(id, newEl);
    }
  }

  return diff;
}
