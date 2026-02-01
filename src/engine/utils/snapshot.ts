import type { Game } from '../element/game.js';
import { Player } from '../player/player.js';
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

  /** Full element tree state (players are now children in the tree) */
  state: {
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

  /** Original constructor options (for full game restoration including custom options like playerConfigs) */
  gameOptions?: Record<string, unknown>;
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
    state: game.toJSON() as GameStateSnapshot['state'],
    flowState: flowState ?? undefined,
    commandHistory: [...game.commandHistory],
    actionHistory: [...actionHistory],
    seed,
    gameOptions: game.getConstructorOptions(),
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
    } : undefined,
    messages: game.getFormattedMessages().map(text => ({ text })),
    phase: game.phase,
    complete: flowState?.complete ?? false,
    winners: flowState?.complete ? game.getWinners().map(p => p.seat) : undefined,
  };
}

/**
 * Create views for all players
 */
export function createAllPlayerViews(game: Game): PlayerStateView[] {
  return (game.all(Player as any) as Player[]).map((p) => createPlayerView(game, p.seat));
}
