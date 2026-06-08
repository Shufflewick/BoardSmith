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

  /** Static action metadata for the player's available actions (embed/platform
   *  consumers read this; the dev server builds its own via buildPlayerState).
   *  Populated by the executor, not by createPlayerView. */
  actionMetadata?: Record<string, unknown>;
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

  // Resolve this player's turn status and available actions, handling BOTH
  // sequential action steps (flowState.currentPlayer / flowState.availableActions)
  // and simultaneous action steps (flowState.awaitingPlayers[].availableActions).
  // Mirrors buildPlayerState() and GameShell so host-embedded views (which read
  // this PlayerStateView) match the BoardSmith dev server. Without the
  // awaitingPlayers branch, simultaneous steps (e.g. a "choose your landing"
  // phase) report zero available actions and no action buttons render.
  let isMyTurn = false;
  let availableActions: string[] | undefined;
  if (flowState) {
    const awaiting = flowState.awaitingPlayers;
    if (awaiting && awaiting.length > 0) {
      const entry = awaiting.find(
        (p) => p.playerIndex === playerPosition && !p.completed
      );
      isMyTurn = entry !== undefined;
      availableActions = entry?.availableActions;
    } else {
      isMyTurn = flowState.currentPlayer === playerPosition;
      availableActions =
        flowState.awaitingInput && isMyTurn
          ? flowState.availableActions
          : undefined;
    }
  }

  return {
    player: playerPosition,
    state: game.toJSONForPlayer(playerPosition),
    flowState: flowState ? {
      awaitingInput: flowState.awaitingInput,
      isMyTurn,
      availableActions,
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
