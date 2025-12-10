/**
 * BoardSmith Client SDK
 *
 * TypeScript client library for connecting to BoardSmith game servers.
 *
 * @example
 * ```typescript
 * import { MeepleClient } from '@boardsmith/client';
 *
 * const client = new MeepleClient({
 *   baseUrl: 'https://game.example.com',
 * });
 *
 * // Find a match
 * const match = await client.findMatch('go-fish', { playerCount: 3 });
 *
 * // Connect to the game
 * const game = client.connect(match.gameId!, { playerPosition: match.playerPosition });
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
export { MeepleClient } from './client.js';

// Game connection
export { GameConnection } from './game-connection.js';

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
} from './types.js';
