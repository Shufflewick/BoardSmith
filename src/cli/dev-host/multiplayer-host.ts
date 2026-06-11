/**
 * Multiplayer dev host — the Node-side stand-in for ShufflewickPub's game
 * Durable Object. Where `bridge.ts`/`DevHost.vue` run a single-tab in-process
 * host bridged to ONE iframe via postMessage, this runs the SAME
 * `SnapshotSessionHost` (via `createDevSession`) in the `boardsmith dev` CLI
 * process and fans it out to MANY WebSocket clients — so several browsers (or
 * computers on the LAN) can play one local game through the EXACT production
 * path (stateless executor + host-owned snapshot + platform-mode GameShell).
 *
 * It is deliberately transport-free: the WebSocket server (in dev.ts) feeds it
 * `handleMessage(clientId, msg)` / `disconnect(clientId)` and supplies `send`,
 * so the lobby + seat logic is unit-testable without sockets (mirrors bridge.ts).
 *
 * Seats: each client claims a seat in a lobby (the seat-picker). Unclaimed seats
 * become AI when the game starts. Reconnect is by the client's persistent id.
 */

import { createDevSession, type DevSession } from './bridge.js';
import type { Op, OpResult } from '../../session/index.js';

export interface SeatInfo {
  seat: number;
  /** The client holding this seat, or null if open. */
  clientId: string | null;
  name: string;
  color?: string;
  connected: boolean;
}

export type LobbyPhase = 'lobby' | 'playing';

/** Messages the host sends to a client. */
export type HostOutbound =
  | { type: 'lobby'; phase: LobbyPhase; seats: SeatInfo[]; minPlayers: number; playerCount: number }
  | { type: 'joined'; seat: number }
  | { type: 'error'; message: string }
  | { type: 'init'; seat: number }
  | { type: 'game_state'; view: unknown; isComplete: boolean; winners: number[] }
  | { type: 'server_response'; requestId: string | null; result: Record<string, unknown> };

/** Messages a client sends to the host. */
export type ClientInbound =
  | { type: 'hello' }
  | { type: 'join'; seat: number; name?: string; color?: string }
  | { type: 'leave' }
  | { type: 'start' }
  | { type: 'server_request'; requestId: string; op: string; payload: Record<string, unknown> };

export interface MultiplayerHostOptions {
  playerCount: number;
  minPlayers: number;
  /** Default AI level for unclaimed (bot) seats when the game starts. */
  aiLevel?: string;
  /** Seat colors offered in the lobby (1-indexed by position). */
  colorPalette?: Array<{ value: string; label: string }>;
  /** In-process op executor bound to the author's gameDefinition (as in DevHost). */
  executeOp: (snapshot: unknown, pendingState: Record<string, unknown> | null, op: Op) => Promise<OpResult>;
  /** Deliver a message to one client (the WS layer maps clientId → socket). */
  send: (clientId: string, message: HostOutbound) => void;
}

export class MultiplayerHost {
  private phase: LobbyPhase = 'lobby';
  private readonly seats = new Map<number, SeatInfo>();
  /** clientId → seat it currently holds (survives disconnect for reconnect). */
  private readonly clientSeat = new Map<string, number>();
  private readonly connected = new Set<string>();
  private session: DevSession | null = null;

  constructor(private readonly opts: MultiplayerHostOptions) {
    for (let seat = 1; seat <= opts.playerCount; seat++) {
      this.seats.set(seat, { seat, clientId: null, name: `Player ${seat}`, connected: false });
    }
  }

  // ── Connection lifecycle ──────────────────────────────────────────────────

  /** A client connection identified itself (first message after connect). */
  hello(clientId: string): void {
    this.connected.add(clientId);
    const seat = this.clientSeat.get(clientId);
    if (seat !== undefined) {
      // Reconnect: re-mark connected and, if mid-game, replay their view.
      const info = this.seats.get(seat);
      if (info) info.connected = true;
      if (this.phase === 'playing') {
        this.reinitSeat(clientId, seat);
        this.broadcastLobby();
        return;
      }
    }
    this.send(clientId, this.lobbyMessage());
  }

  disconnect(clientId: string): void {
    this.connected.delete(clientId);
    const seat = this.clientSeat.get(clientId);
    if (seat !== undefined) {
      const info = this.seats.get(seat);
      if (info) info.connected = false;
      // In the lobby, a disconnect frees the seat; mid-game we keep it for reconnect.
      if (this.phase === 'lobby') this.releaseSeat(clientId);
    }
    this.broadcastLobby();
  }

  // ── Inbound dispatch ──────────────────────────────────────────────────────

  async handleMessage(clientId: string, msg: ClientInbound): Promise<void> {
    switch (msg.type) {
      case 'hello':
        return this.hello(clientId);
      case 'join':
        return this.handleJoin(clientId, msg);
      case 'leave':
        this.releaseSeat(clientId);
        this.send(clientId, this.lobbyMessage());
        return this.broadcastLobby();
      case 'start':
        return this.handleStart(clientId);
      case 'server_request':
        return this.handleServerRequest(clientId, msg);
    }
  }

  private handleJoin(clientId: string, msg: Extract<ClientInbound, { type: 'join' }>): void {
    this.connected.add(clientId);
    if (this.phase !== 'lobby') {
      this.send(clientId, { type: 'error', message: 'Game already started.' });
      return;
    }
    const info = this.seats.get(msg.seat);
    if (!info) {
      this.send(clientId, { type: 'error', message: `Seat ${msg.seat} does not exist.` });
      return;
    }
    if (info.clientId && info.clientId !== clientId && info.connected) {
      this.send(clientId, { type: 'error', message: `Seat ${msg.seat} is taken.` });
      return;
    }
    // One seat per client: drop any seat this client already held.
    this.releaseSeat(clientId);
    info.clientId = clientId;
    info.name = msg.name?.trim() || `Player ${msg.seat}`;
    info.color = msg.color ?? this.opts.colorPalette?.[msg.seat - 1]?.value;
    info.connected = true;
    this.clientSeat.set(clientId, msg.seat);
    this.send(clientId, { type: 'joined', seat: msg.seat });
    this.broadcastLobby();
  }

  private async handleStart(clientId: string): Promise<void> {
    if (this.phase !== 'lobby') {
      this.send(clientId, { type: 'error', message: 'Game already started.' });
      return;
    }
    const seatedHumans = [...this.seats.values()].filter((s) => s.clientId && s.connected);
    if (seatedHumans.length < this.opts.minPlayers) {
      this.send(clientId, {
        type: 'error',
        message: `Need at least ${this.opts.minPlayers} player(s) to start (have ${seatedHumans.length}).`,
      });
      return;
    }
    await this.startGame();
  }

  private async handleServerRequest(
    clientId: string,
    msg: Extract<ClientInbound, { type: 'server_request' }>,
  ): Promise<void> {
    if (this.phase !== 'playing' || !this.session) {
      this.send(clientId, { type: 'error', message: 'Game has not started.' });
      return;
    }
    const seat = this.clientSeat.get(clientId);
    if (seat === undefined) {
      this.send(clientId, { type: 'error', message: 'You are not seated in this game.' });
      return;
    }
    await this.session.handleServerRequest(seat, msg.requestId, msg.op, msg.payload);
  }

  // ── Game start ────────────────────────────────────────────────────────────

  private async startGame(): Promise<void> {
    this.phase = 'playing';
    const humanSeats = new Set(
      [...this.seats.values()].filter((s) => s.clientId).map((s) => s.seat),
    );
    const aiSeats: Array<{ seat: number; level?: string }> = [];
    for (let seat = 1; seat <= this.opts.playerCount; seat++) {
      if (!humanSeats.has(seat)) aiSeats.push({ seat, level: this.opts.aiLevel });
    }

    this.session = createDevSession({
      playerCount: this.opts.playerCount,
      aiSeats,
      executeOp: this.opts.executeOp,
      postGameState: (seat, view, meta) =>
        this.sendToSeat(seat, {
          type: 'game_state',
          view,
          isComplete: meta.isComplete,
          winners: meta.winners,
        }),
      postServerResponse: (seat, requestId, result) =>
        this.sendToSeat(seat, { type: 'server_response', requestId, result }),
    });

    this.broadcastLobby(); // phase is now 'playing'
    await this.session.start();

    for (const seat of humanSeats) {
      const clientId = this.seats.get(seat)?.clientId;
      if (clientId) this.reinitSeat(clientId, seat);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private reinitSeat(clientId: string, seat: number): void {
    this.send(clientId, { type: 'init', seat });
    const view = this.session?.viewForSeat(seat);
    if (view !== undefined && this.session) {
      const meta = this.session.meta();
      this.send(clientId, { type: 'game_state', view, isComplete: meta.isComplete, winners: meta.winners });
    }
  }

  private releaseSeat(clientId: string): void {
    const seat = this.clientSeat.get(clientId);
    if (seat === undefined) return;
    this.clientSeat.delete(clientId);
    const info = this.seats.get(seat);
    if (info) {
      info.clientId = null;
      info.name = `Player ${seat}`;
      info.color = undefined;
      info.connected = false;
    }
  }

  private sendToSeat(seat: number, message: HostOutbound): void {
    const info = this.seats.get(seat);
    if (info?.clientId && info.connected) this.send(info.clientId, message);
  }

  private send(clientId: string, message: HostOutbound): void {
    this.opts.send(clientId, message);
  }

  private lobbyMessage(): HostOutbound {
    return {
      type: 'lobby',
      phase: this.phase,
      seats: [...this.seats.values()].map((s) => ({ ...s })),
      minPlayers: this.opts.minPlayers,
      playerCount: this.opts.playerCount,
    };
  }

  private broadcastLobby(): void {
    const message = this.lobbyMessage();
    for (const clientId of this.connected) this.send(clientId, message);
  }
}
