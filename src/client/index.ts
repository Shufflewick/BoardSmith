/**
 * BoardSmith Client
 *
 * - `createDevHostClient` drives a running `boardsmith dev` host from Node or a
 *   browser: take a seat, read state, perform actions (see docs/agent-control.md).
 * - `audioService` plays the shell's sounds.
 * - `GameState`, `PlayerState` and `PublicFlowState` are the shape of the state
 *   a host sends one seat.
 *
 * Games do not connect to a server themselves: a host mounts `GameShell` in an
 * iframe and feeds it over postMessage.
 */

// Dev-host protocol client (DRIVE-02): speaks `boardsmith dev`'s own WS protocol.
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
export type { PublicFlowState, PlayerState, GameState } from './types.js';
