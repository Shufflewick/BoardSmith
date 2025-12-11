/**
 * Matchmaking route handlers - platform-agnostic HTTP request handling
 */

import type {
  ServerResponse,
  GameRegistry,
  MatchmakingStore,
  MatchmakingRequest,
} from '../types.js';

// ============================================
// Response Helpers
// ============================================

function success(body: unknown, status = 200): ServerResponse {
  return { status, body };
}

function error(message: string, status = 400): ServerResponse {
  return { status, body: { success: false, error: message } };
}

// ============================================
// Constants
// ============================================

/** How long a queue entry stays valid (5 minutes) */
const QUEUE_TTL_MS = 5 * 60 * 1000;

/** How long match info stays valid (1 hour) */
const MATCH_TTL_SECONDS = 3600;

/** How long waiting info stays valid (10 minutes) */
const WAITING_TTL_SECONDS = 600;

// ============================================
// Matchmaking Handlers
// ============================================

/**
 * Callback for creating a game when a match is made.
 * Returns the game ID.
 */
export type CreateGameCallback = (
  gameType: string,
  playerCount: number,
  playerNames: string[],
  playerIds: string[]
) => Promise<string>;

/**
 * POST /matchmaking/join - Join a matchmaking queue
 *
 * @param matchmaking - Store for matchmaking state
 * @param registry - Game registry for validation
 * @param request - The matchmaking request
 * @param createGame - Callback to create the game when a match is made
 */
export async function handleMatchmakingJoin(
  matchmaking: MatchmakingStore,
  registry: GameRegistry,
  request: MatchmakingRequest,
  createGame: CreateGameCallback
): Promise<ServerResponse> {
  const { gameType, playerCount, playerId, playerName } = request;

  // Validate game type
  const definition = registry.get(gameType);
  if (!definition) {
    const available = registry.getAll().map((d) => d.gameType).join(', ');
    return error(`Unknown game type: ${gameType}. Available: ${available}`);
  }

  // Validate player count
  if (playerCount < definition.minPlayers || playerCount > definition.maxPlayers) {
    return error(
      `Player count must be between ${definition.minPlayers} and ${definition.maxPlayers}`
    );
  }

  // Get current queue
  const queue = await matchmaking.getQueue(gameType, playerCount);

  // Check if player is already in queue
  const existingIndex = queue.findIndex((e) => e.playerId === playerId);
  if (existingIndex >= 0) {
    // Update timestamp
    queue[existingIndex].timestamp = Date.now();
  } else {
    // Add to queue
    queue.push({
      playerId,
      playerName: playerName ?? `Player ${playerId.slice(0, 6)}`,
      timestamp: Date.now(),
    });
  }

  // Filter out stale entries
  const now = Date.now();
  const activeQueue = queue.filter((e) => now - e.timestamp < QUEUE_TTL_MS);

  // Check if we have enough players for a match
  if (activeQueue.length >= playerCount) {
    // Take the first N players
    const matchedPlayers = activeQueue.splice(0, playerCount);

    // Create the game using the callback
    const gameId = await createGame(
      gameType,
      playerCount,
      matchedPlayers.map((p) => p.playerName),
      matchedPlayers.map((p) => p.playerId)
    );

    // Store match info for each player
    for (let i = 0; i < matchedPlayers.length; i++) {
      const player = matchedPlayers[i];
      await matchmaking.setMatch(
        player.playerId,
        {
          gameId,
          playerPosition: i,
          gameType,
          players: matchedPlayers.map((p) => p.playerName),
          matchedAt: Date.now(),
        },
        MATCH_TTL_SECONDS
      );
    }

    // Update queue (remove matched players)
    await matchmaking.setQueue(gameType, playerCount, activeQueue);

    // Return match result
    return success({
      success: true,
      matched: true,
      gameId,
      playerPosition: matchedPlayers.findIndex((p) => p.playerId === playerId),
      players: matchedPlayers.map((p) => p.playerName),
    });
  }

  // Not enough players yet - save queue and waiting info
  await matchmaking.setQueue(gameType, playerCount, activeQueue);

  const position = activeQueue.findIndex((e) => e.playerId === playerId) + 1;
  await matchmaking.setWaiting(
    playerId,
    {
      gameType,
      playerCount,
      position,
      queueSize: activeQueue.length,
      joinedAt: Date.now(),
    },
    WAITING_TTL_SECONDS
  );

  return success({
    success: true,
    matched: false,
    position,
    queueSize: activeQueue.length,
    playersNeeded: playerCount - activeQueue.length,
  });
}

/**
 * GET /matchmaking/status - Check matchmaking status for a player
 */
export async function handleMatchmakingStatus(
  matchmaking: MatchmakingStore,
  playerId: string
): Promise<ServerResponse> {
  // Check if player has been matched
  const match = await matchmaking.getMatch(playerId);
  if (match) {
    return success({
      success: true,
      status: 'matched',
      ...match,
    });
  }

  // Check if player is waiting
  const waiting = await matchmaking.getWaiting(playerId);
  if (waiting) {
    // Get current queue to update position
    const queue = await matchmaking.getQueue(waiting.gameType, waiting.playerCount);
    const position = queue.findIndex((e) => e.playerId === playerId) + 1;

    return success({
      success: true,
      status: 'waiting',
      gameType: waiting.gameType,
      playerCount: waiting.playerCount,
      position: position || waiting.position,
      queueSize: queue.length,
      playersNeeded: waiting.playerCount - queue.length,
    });
  }

  // Player is not in any queue
  return success({
    success: true,
    status: 'not_in_queue',
  });
}

/**
 * POST /matchmaking/leave - Leave a matchmaking queue
 */
export async function handleMatchmakingLeave(
  matchmaking: MatchmakingStore,
  playerId: string
): Promise<ServerResponse> {
  // Check if player is waiting
  const waiting = await matchmaking.getWaiting(playerId);
  if (!waiting) {
    return success({ success: true, message: 'Not in queue' });
  }

  // Get current queue and remove player
  const queue = await matchmaking.getQueue(waiting.gameType, waiting.playerCount);
  const filtered = queue.filter((e) => e.playerId !== playerId);
  await matchmaking.setQueue(waiting.gameType, waiting.playerCount, filtered);

  // Delete waiting info
  await matchmaking.deleteWaiting(playerId);

  return success({ success: true, message: 'Left queue' });
}
