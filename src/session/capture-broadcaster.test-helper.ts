/**
 * A broadcast adapter for tests that records each state a session pushes,
 * with the seat it went to. Each entry of `sessions` is one connection, named
 * by its place in the list (#487: a connection is what a session keys its
 * last push on).
 */
import type { BroadcastAdapter, PlayerGameState, SessionInfo } from './types.js';

export type CapturedState = {
  seat: number;
  state: PlayerGameState;
};

export function makeMockBroadcaster(
  sessions: Array<{ playerSeat: number; isSpectator: boolean }>,
  captured: CapturedState[],
): BroadcastAdapter {
  return {
    getSessions: () => sessions.map((s, i) => ({ connectionId: `connection-${i + 1}`, ...s })),
    send: (session: SessionInfo, update: unknown) => {
      captured.push({ seat: session.playerSeat, state: (update as { state: PlayerGameState }).state });
    },
  };
}
