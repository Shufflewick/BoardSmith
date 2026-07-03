/**
 * BoardSmith Client SDK
 *
 * TypeScript client library for connecting to BoardSmith game servers.
 *
 * @example
 * ```typescript
 * import { MeepleClient } from 'boardsmith/client';
 *
 * const client = new MeepleClient({
 *   baseUrl: 'https://game.example.com',
 * });
 *
 * // Find a match
 * const match = await client.findMatch('go-fish', { playerCount: 3 });
 *
 * // Connect to the game
 * const game = client.connect(match.gameId!, { playerSeat: match.playerSeat });
 *
 * // Subscribe to state changes
 * game.onStateChange((state) => {
 *   console.log('Current player:', state.state.currentPlayer);
 *   console.log('Is my turn:', state.state.isMyTurn);
 * });
 *
 * // Perform an action
 * await game.action('ask', { target: 1, rank: '7' });
 *
 * // Disconnect when done
 * game.disconnect();
 * ```
 */

// Main client
export { MeepleClient, MeepleClientError, generatePlayerId } from './client.js';

// Game connection
export { GameConnection } from './game-connection.js';

// Dev-host protocol client (DRIVE-02) — a separate sibling of GameConnection;
// speaks `boardsmith dev`'s own WS protocol, not the production game protocol.
export { createDevHostClient } from './dev-host-client.js';
export type {
  DevHostClient,
  DevHostClientOptions,
  DevHostSeatInfo,
  DevHostLobbyReply,
  DevHostStateReply,
  DevHostInboundMessage,
} from './dev-host-client.js';

// Audio service
export { audioService, type AudioServiceOptions } from './audio.js';

// Types
export type {
  // Configuration
  MeepleClientConfig,
  GameConnectionConfig,

  // Matchmaking
  FindMatchOptions,
  MatchmakingResult,
  MatchmakingStatus,

  // Game State
  FlowState,
  PlayerState,
  GameState,

  // Connection
  ConnectionStatus,
  ActionResult,

  // Events
  StateChangeCallback,
  ErrorCallback,
  ConnectionCallback,

  // HTTP API
  CreateGameRequest,
  CreateGameResponse,
  ApiResponse,

  // Lobby
  LobbyState,
  SlotStatus,
  LobbySlot,
  LobbyInfo,
  ClaimSeatRequest,
  ClaimSeatResponse,
} from './types.js';
