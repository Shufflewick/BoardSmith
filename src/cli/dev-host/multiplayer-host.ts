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
import { dueSeats, type SeatActivityState } from '../../engine/index.js';

/** A fresh random 32-bit seed for a new game. */
function defaultSeed(): string {
  return String(Math.floor(Math.random() * 0xffffffff));
}

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
  | { type: 'server_response'; requestId: string | null; result: Record<string, unknown> }
  | { type: 'follow'; enabled: boolean; seat: number };

/** Messages a client sends to the host. */
export type ClientInbound =
  | { type: 'hello' }
  | { type: 'join'; seat: number; name?: string; color?: string }
  | { type: 'leave' }
  | { type: 'restart' }
  | { type: 'server_request'; requestId: string; op: string; payload: Record<string, unknown> }
  | { type: 'follow'; enabled: boolean };

export interface MultiplayerHostOptions {
  playerCount: number;
  minPlayers: number;
  /** Default AI level for unclaimed (bot) seats when the game starts. */
  aiLevel?: string;
  /**
   * Seats (1-indexed) the `--ai` flag designates as AI. The auto-seated dev
   * avoids these, so they stay open and play as AI; any open seat is AI anyway.
   */
  designatedAiSeats?: number[];
  /** Seat colors offered in the lobby (1-indexed by position). */
  colorPalette?: Array<{ value: string; label: string }>;
  /** Game-level options merged into the `start` op (the author's gameOptions). */
  baseGameOptions?: Record<string, unknown>;
  /**
   * Run one op against a snapshot for the given gameOptions, bound to the
   * author's gameDefinition: `(gameOptions, snapshot, pendingState, op) =>
   * executeOp(def, gameOptions, …)`. The host computes the start gameOptions
   * (seed, per-seat colors, playerIsAI) from lobby state, so it must own them.
   */
  executeOp: (
    gameOptions: { playerCount: number; [key: string]: unknown },
    snapshot: unknown,
    pendingState: Record<string, unknown> | null,
    op: Op,
  ) => Promise<OpResult>;
  /** Deliver a message to one client (the WS layer maps clientId → socket). */
  send: (clientId: string, message: HostOutbound) => void;
  /** Seed source for a fresh game (defaults to a random 32-bit seed). */
  makeSeed?: () => string;
}

export class MultiplayerHost {
  private phase: LobbyPhase = 'lobby';
  private starting = false;
  private readonly seats = new Map<number, SeatInfo>();
  /** clientId → seat it currently holds (survives disconnect for reconnect). */
  private readonly clientSeat = new Map<string, number>();
  private readonly connected = new Set<string>();
  private session: DevSession | null = null;
  /** Live AI-seat list passed to the session; mutated as humans take/leave seats. */
  private aiSeats: Array<{ seat: number; level?: string }> = [];
  /** The client (if any) that follows the active seat — it controls whichever
   *  seat is currently awaiting input, and AI is paused while it is set. */
  private followerClientId: string | null = null;
  /** The active seat last shown to the follower, to re-init only on change. */
  private lastFollowerSeat: number | null = null;

  constructor(private readonly opts: MultiplayerHostOptions) {
    for (let seat = 1; seat <= opts.playerCount; seat++) {
      this.seats.set(seat, { seat, clientId: null, name: `Player ${seat}`, connected: false });
    }
  }

  // ── Connection lifecycle ──────────────────────────────────────────────────

  /**
   * A client connection identified itself. The game is always live: the FIRST
   * client to connect auto-takes a seat and the game starts immediately (the dev
   * lands straight in — open seats are AI). Later clients land in the seat-picker
   * to take over an AI/open seat; a reconnecting client resumes its seat.
   */
  async hello(clientId: string): Promise<void> {
    this.connected.add(clientId);

    const existing = this.clientSeat.get(clientId);
    if (existing !== undefined) {
      const info = this.seats.get(existing);
      if (info) info.connected = true;
      if (this.phase === 'playing') {
        this.reinitSeat(clientId, existing);
        this.broadcastLobby();
        return;
      }
    }

    // First arrival → auto-seat + start so the dev is immediately in the game.
    // Prefer an open seat NOT designated AI by `--ai` (so `--ai 1` puts the dev
    // in seat 2 and leaves seat 1 to the bot); fall back to any open seat.
    if (this.phase === 'lobby' && !this.starting) {
      const open = [...this.seats.values()].filter((s) => !s.clientId);
      const pick = open.find((s) => !this.opts.designatedAiSeats?.includes(s.seat)) ?? open[0];
      if (pick) this.assignSeat(clientId, pick.seat);
      await this.startGame();
      return;
    }

    // Game already live (or starting): show the seat-picker.
    this.send(clientId, this.lobbyMessage());
  }

  disconnect(clientId: string): void {
    this.connected.delete(clientId);
    const seat = this.clientSeat.get(clientId);
    if (seat !== undefined) {
      const info = this.seats.get(seat);
      if (info) info.connected = false;
      // Keep the seat reserved for reconnect (a page reload mustn't lose it); the
      // game pauses on an away player's turn until they return or explicitly leave.
    }
    if (this.followerClientId === clientId) {
      // The follower drove every seat; resume AI so the game isn't stuck on it.
      this.followerClientId = null;
      this.lastFollowerSeat = null;
      this.rebuildAiSeats();
      void this.session?.host.runAITurns();
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
        return this.handleLeave(clientId);
      case 'restart':
        return this.handleRestart(clientId);
      case 'server_request':
        return this.handleServerRequest(clientId, msg);
      case 'follow':
        return this.handleFollow(clientId, msg);
    }
  }

  private async handleRestart(clientId: string): Promise<void> {
    if (this.phase !== 'playing') {
      this.send(clientId, { type: 'error', message: 'No game in progress to restart.' });
      return;
    }
    // A restart is a clean slate: reset follow-mode (the new game's AI seats are
    // rebuilt by startGame) and untoggle the follower's button.
    if (this.followerClientId !== null) {
      const ex = this.followerClientId;
      this.followerClientId = null;
      this.lastFollowerSeat = null;
      this.send(ex, { type: 'follow', enabled: false, seat: this.clientSeat.get(ex) ?? 0 });
    }
    // Rebuild the session with the same seats and a fresh seed.
    await this.startGame();
  }

  /** Toggle "follow active seat" for a client (must be seated and in a game). */
  private async handleFollow(
    clientId: string,
    msg: Extract<ClientInbound, { type: 'follow' }>,
  ): Promise<void> {
    if (!msg.enabled) {
      // Disable: only the current follower can turn it off.
      if (this.followerClientId !== clientId) return;
      this.followerClientId = null;
      this.lastFollowerSeat = null;
      this.rebuildAiSeats();
      const own = this.clientSeat.get(clientId);
      this.send(clientId, { type: 'follow', enabled: false, seat: own ?? 0 });
      if (own !== undefined && this.phase === 'playing') this.reinitSeat(clientId, own);
      await this.session?.host.runAITurns(); // resume AI for the seats it covered
      return;
    }
    // Enable.
    if (this.phase !== 'playing' || !this.session) {
      this.send(clientId, { type: 'error', message: 'Start a game before enabling follow-active-seat.' });
      return;
    }
    if (!this.clientSeat.has(clientId)) {
      this.send(clientId, { type: 'error', message: 'Take a seat before enabling follow-active-seat.' });
      return;
    }
    this.followerClientId = clientId;
    this.aiSeats.length = 0; // pause AI for every seat the follower now covers
    const active = this.effectiveActiveSeat();
    this.lastFollowerSeat = active;
    this.send(clientId, { type: 'follow', enabled: true, seat: active });
    this.reinitSeat(clientId, active);
  }

  /** Take over a seat (works mid-game: claim an open/AI seat → it stops being AI). */
  private handleJoin(clientId: string, msg: Extract<ClientInbound, { type: 'join' }>): void {
    this.connected.add(clientId);
    const info = this.seats.get(msg.seat);
    if (!info) {
      this.send(clientId, { type: 'error', message: `Seat ${msg.seat} does not exist.` });
      return;
    }
    if (info.clientId && info.clientId !== clientId && info.connected) {
      this.send(clientId, { type: 'error', message: `Seat ${msg.seat} is taken.` });
      return;
    }
    this.assignSeat(clientId, msg.seat, msg.name, msg.color);
    this.send(clientId, { type: 'joined', seat: msg.seat });
    if (this.phase === 'playing') this.reinitSeat(clientId, msg.seat);
    this.broadcastLobby();
  }

  /** Give up a seat mid-game → it reverts to AI so the game continues for others. */
  private async handleLeave(clientId: string): Promise<void> {
    const seat = this.clientSeat.get(clientId);
    this.releaseSeat(clientId);
    if (seat !== undefined && this.phase === 'playing') {
      this.addAiSeat(seat);
      this.broadcastLobby();
      this.send(clientId, this.lobbyMessage());
      await this.session?.host.runAITurns();
      return;
    }
    this.send(clientId, this.lobbyMessage());
    this.broadcastLobby();
  }

  private async handleServerRequest(
    clientId: string,
    msg: Extract<ClientInbound, { type: 'server_request' }>,
  ): Promise<void> {
    if (this.phase !== 'playing' || !this.session) {
      this.send(clientId, { type: 'error', message: 'Game has not started.' });
      return;
    }
    // A follower acts as whichever seat is currently due, not its own seat.
    const seat =
      clientId === this.followerClientId ? this.effectiveActiveSeat() : this.clientSeat.get(clientId);
    if (seat === undefined) {
      this.send(clientId, { type: 'error', message: 'You are not seated in this game.' });
      return;
    }
    await this.session.handleServerRequest(seat, msg.requestId, msg.op, msg.payload);
  }

  // ── Seat helpers ──────────────────────────────────────────────────────────

  private assignSeat(clientId: string, seat: number, name?: string, color?: string): void {
    this.releaseSeat(clientId); // one seat per client
    const info = this.seats.get(seat);
    if (!info) return;
    info.clientId = clientId;
    info.name = name?.trim() || `Player ${seat}`;
    info.color = color ?? this.opts.colorPalette?.[seat - 1]?.value;
    info.connected = true;
    this.clientSeat.set(clientId, seat);
    this.removeAiSeat(seat); // a human now plays this seat
  }

  private removeAiSeat(seat: number): void {
    const i = this.aiSeats.findIndex((s) => s.seat === seat);
    if (i !== -1) this.aiSeats.splice(i, 1);
  }

  private addAiSeat(seat: number): void {
    if (seat >= 1 && seat <= this.opts.playerCount && !this.aiSeats.some((s) => s.seat === seat)) {
      this.aiSeats.push({ seat, level: this.opts.aiLevel });
    }
  }

  /**
   * The seat a follower acts as / sees right now: the first seat awaiting input,
   * falling back to the follower's own seat when nothing is due (execute blocks,
   * game over). The follower steals every active seat unconditionally.
   */
  private effectiveActiveSeat(): number {
    const due = this.session
      ? dueSeats(this.session.host.flowState as SeatActivityState | null)[0]
      : undefined;
    const own =
      this.followerClientId !== null ? this.clientSeat.get(this.followerClientId) : undefined;
    return due ?? own ?? 1;
  }

  /** Rebuild the shared AI-seat list in place from currently open seats. */
  private rebuildAiSeats(): void {
    this.aiSeats.length = 0;
    for (let seat = 1; seat <= this.opts.playerCount; seat++) {
      const info = this.seats.get(seat);
      const heldByConnectedHuman = info?.clientId && info.connected;
      if (!heldByConnectedHuman) this.aiSeats.push({ seat, level: this.opts.aiLevel });
    }
  }

  // ── Game start ────────────────────────────────────────────────────────────

  private async startGame(): Promise<void> {
    this.starting = true;
    const { playerCount } = this.opts;
    const humanSeats = new Set(
      [...this.seats.values()].filter((s) => s.clientId).map((s) => s.seat),
    );
    // Seed the live AI-seat list from the current open seats. Mutated later as
    // humans take over seats (removeAiSeat) or give them up (addAiSeat); the
    // session's AI pump reads this same array reference.
    this.aiSeats = [];
    for (let seat = 1; seat <= playerCount; seat++) {
      if (!humanSeats.has(seat)) this.aiSeats.push({ seat, level: this.opts.aiLevel });
    }

    // The start gameOptions are derived from lobby state (mirrors DevHost.buildSession):
    // a fresh seed, each seat's chosen/default color, and which seats are AI.
    const startGameOptions = {
      playerCount,
      seed: (this.opts.makeSeed ?? defaultSeed)(),
      ...this.opts.baseGameOptions,
      playerOptions: this.buildPerSeatOptions(),
      playerIsAI: Array.from({ length: playerCount }, (_, i) => !humanSeats.has(i + 1)),
    };
    const baseOptions = { playerCount };
    const executeOp = (snapshot: unknown, pendingState: Record<string, unknown> | null, op: Op) =>
      this.opts.executeOp(op.type === 'start' ? startGameOptions : baseOptions, snapshot, pendingState, op);

    const session = createDevSession({
      playerCount,
      aiSeats: this.aiSeats,
      executeOp,
      postGameState: (seat, view, meta) => this.deliverGameState(seat, view, meta),
      postServerResponse: (seat, requestId, result) =>
        this.sendToSeat(seat, { type: 'server_response', requestId, result }),
    });

    // Only commit to 'playing' if the game actually starts — otherwise a failed
    // start would strand clients on an empty board. On failure, stay in the lobby
    // and surface the reason.
    try {
      await session.start();
    } catch (err) {
      this.starting = false;
      const message = err instanceof Error ? err.message : 'Failed to start the game.';
      for (const clientId of this.connected) this.send(clientId, { type: 'error', message });
      return;
    }

    this.session = session;
    this.phase = 'playing';
    this.starting = false;

    // The opening seat may belong to a bot (e.g. an AI dictator that acts first);
    // drive any AI turns before handing control to the humans, then send state.
    await session.host.runAITurns();

    this.broadcastLobby();
    for (const seat of humanSeats) {
      const clientId = this.seats.get(seat)?.clientId;
      if (clientId) this.reinitSeat(clientId, seat);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Per-seat playerOptions for the start op: each seat's chosen/default color. */
  private buildPerSeatOptions(): Array<Record<string, unknown>> {
    return Array.from({ length: this.opts.playerCount }, (_, i) => {
      const seat = this.seats.get(i + 1);
      const color = seat?.color ?? this.opts.colorPalette?.[i]?.value;
      const perSeat: Record<string, unknown> = {};
      if (color !== undefined) perSeat.color = color;
      return perSeat;
    });
  }

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

  /**
   * Send a `game_state` frame to the seat's client. For the follower, override
   * the seat with the currently-active seat: re-`init` when it changes, and send
   * that seat's freshly-computed view (so the follower drives whoever is due).
   */
  private deliverGameState(
    seat: number,
    view: unknown,
    meta: { isComplete: boolean; winners: number[] },
  ): void {
    const info = this.seats.get(seat);
    if (!info?.clientId || !info.connected) return;
    if (info.clientId === this.followerClientId) {
      const active = this.effectiveActiveSeat();
      if (active !== this.lastFollowerSeat) {
        this.send(info.clientId, { type: 'init', seat: active });
        this.lastFollowerSeat = active;
      }
      const activeView = this.session?.viewForSeat(active);
      this.send(info.clientId, {
        type: 'game_state',
        view: activeView ?? view,
        isComplete: meta.isComplete,
        winners: meta.winners,
      });
      return;
    }
    this.send(info.clientId, {
      type: 'game_state',
      view,
      isComplete: meta.isComplete,
      winners: meta.winners,
    });
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
