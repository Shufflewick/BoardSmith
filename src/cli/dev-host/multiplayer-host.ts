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
import type { Op, OpResult, GamePreset } from '../../session/index.js';
import { dueSeats, type SeatActivityState, type GameStateSnapshot } from '../../engine/index.js';
import { validateGameOptionSelection, type DevOptionDef } from './config-types.js';

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
  | {
      type: 'lobby';
      phase: LobbyPhase;
      seats: SeatInfo[];
      minPlayers: number;
      playerCount: number;
      requestId?: string | null;
    }
  | { type: 'joined'; seat: number }
  | { type: 'error'; message: string; requestId?: string | null }
  | { type: 'init'; seat: number }
  | {
      type: 'game_state';
      view: unknown;
      isComplete: boolean;
      winners: number[];
      /**
       * Explicit draw signal (D10/ENDGAME-01): isComplete && winners.length === 0.
       * Absent/false does NOT mean "not a draw" — it means the field carries no
       * claim either way; the client must not fabricate "Draw" from a bare [].
       */
      isDraw: boolean;
      requestId?: string | null;
    }
  | { type: 'server_response'; requestId: string | null; result: Record<string, unknown> }
  | { type: 'follow'; enabled: boolean; seat: number }
  | { type: 'debugToggle' }
  | { type: 'uiSwitch'; name: string };

/** Messages a client sends to the host. */
export type ClientInbound =
  | { type: 'hello' }
  | { type: 'join'; seat: number; name?: string; color?: string }
  | { type: 'leave' }
  | { type: 'restart' }
  | { type: 'server_request'; requestId: string; op: string; payload: Record<string, unknown> }
  | { type: 'follow'; enabled: boolean }
  | { type: 'getState'; requestId?: string }
  | { type: 'getLobby'; requestId?: string }
  | { type: 'debugToggle' }
  | { type: 'uiSwitch'; name: string }
  /**
   * D13/DEVHOST-01: a pre-start (lobby) gameOption/preset selection. Either
   * or both fields may be present; a `preset` applies its whole options
   * bundle (+ player count if declared), then `gameOptions` (if present)
   * overlays on top — a flag/selection beats a preset for the same key.
   * Selected values REPLACE the frozen `.default`-only baseGameOptions in
   * the (re)started `start` op. Every key is validated against the
   * host's declared game options (T-161-02) — an undeclared key or an
   * out-of-choices value is rejected with an `error` reply and never
   * reaches the start op.
   */
  | { type: 'configure'; gameOptions?: Record<string, unknown>; preset?: string };

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
   * The declared game-level option definitions (D13/DEVHOST-01) — used to
   * validate an incoming `configure` selection (T-161-02): an undeclared key,
   * or a `select` value not among its declared choices, is rejected and never
   * reaches the start op.
   */
  declaredGameOptions?: DevOptionDef[];
  /**
   * Declared presets (D13/DEVHOST-01) — a `configure` message's `preset` name
   * is looked up here; applying a preset sets every option in its bundle (and
   * its player count, if declared, via the reserved `playerCount` key in the
   * applied selection — see `applyConfigure`).
   */
  presets?: GamePreset[];
  /**
   * When true, teaching/assist features (hint, heatmap, demo, tutorial) are rejected
   * fail-loud for this session. Set by `boardsmith dev --lock-teaching`.
   * Threaded as executeOp's dedicated `hostOptions` parameter (NOT the
   * gameOptions bag — WR-04/D-01: a game may define its own `teachingDisabled`
   * game option, and gameOptions persists into snapshots via the Game
   * constructor) and into the SnapshotSessionHost adapters so all enforcement
   * guards in Plans 111-01 and 111-02 fire on the real running host.
   */
  teachingDisabled?: boolean;
  /**
   * FEAT-01/168-02: when set, the FIRST started state is this seed's state —
   * threaded through the `start` op's `hostOptions.seedSnapshot` (never
   * `gameOptions`, same WR-04/D-01 rationale as `teachingDisabled`) so
   * `handleStart` returns `runnerFromSnapshot(seedSnapshot, def)`'s envelope
   * instead of a freshly-started game. Set by `boardsmith dev --seed <file>`.
   */
  seedSnapshot?: GameStateSnapshot;
  /**
   * Run one op against a snapshot for the given gameOptions, bound to the
   * author's gameDefinition: `(gameOptions, snapshot, pendingState, op, hostOptions) =>
   * executeOp(def, gameOptions, …, hostOptions)`. The host computes the start
   * gameOptions (seed, per-seat colors, playerIsAI) from lobby state, so it
   * must own them. `hostOptions` carries host-level session policy
   * (`teachingDisabled`, `seedSnapshot`) separately from the game's own options.
   */
  executeOp: (
    gameOptions: { playerCount: number; [key: string]: unknown },
    snapshot: unknown,
    pendingState: Record<string, unknown> | null,
    op: Op,
    hostOptions?: { teachingDisabled?: boolean; seedSnapshot?: GameStateSnapshot },
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
  /**
   * Maps an in-flight requestId to the client that issued it, so the matching
   * `server_response` is routed back to the REQUESTING client — not the acting
   * seat. A follower acts as a seat it does not occupy (the active seat), so
   * routing the response by seat would post it to that seat's (empty) client and
   * silently drop it (e.g. element-pick `resolve_choices`, leaving validElements
   * empty). Keyed by requestId; cleared when the response is delivered.
   */
  private requestOrigin = new Map<string, string>();
  /**
   * D13/DEVHOST-01: the currently applied gameOption selection, seeded from
   * `opts.baseGameOptions` (the `.default`-only computation) and overlaid by
   * each accepted `configure` message. `startGame` spreads THIS (not
   * `opts.baseGameOptions` directly) into the start op, so a selection
   * persists across a subsequent restart instead of reverting to defaults.
   * May carry a reserved `playerCount` key (set when a preset declares
   * `players`) which overrides the start op's `playerCount` field — see
   * `startGameOptions` below. `handleConfigure` calls `resizeSeats` (CR-01)
   * BEFORE merging this key in, so the seat map is already consistent with
   * the new count by the time it's applied — this field itself never
   * triggers seat reconciliation, `resizeSeats` does.
   */
  private appliedGameOptions: Record<string, unknown>;

  constructor(private readonly opts: MultiplayerHostOptions) {
    for (let seat = 1; seat <= opts.playerCount; seat++) {
      this.seats.set(seat, { seat, clientId: null, name: `Player ${seat}`, connected: false });
    }
    this.appliedGameOptions = { ...opts.baseGameOptions };
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
      // D15/DEVHOST-03: a reconnect always yields the seat back from any
      // AI-cover the post-await reconciliation applied while this client was
      // vanished (a no-op if the seat was never AI-covered — removeAiSeat is
      // safe to call unconditionally). This is what makes the reconciliation
      // reclaimable rather than permanent: the bot only drives the seat while
      // the human is actually gone.
      this.removeAiSeat(existing);
      if (this.phase === 'playing') {
        // A reconnecting follower (e.g. after a page reload / HMR) resumes
        // follow-mode: restore its button state and show it the ACTIVE seat,
        // not its own seat.
        if (clientId === this.followerClientId) {
          const active = this.effectiveActiveSeat();
          this.lastFollowerSeat = active;
          this.send(clientId, { type: 'follow', enabled: true, seat: active });
          this.reinitSeat(clientId, active);
        } else {
          this.reinitSeat(clientId, existing);
        }
        this.broadcastLobby();
        return;
      }
      // Holds a seat but the game isn't live yet (reconnected mid-start, or a
      // prior start failed). NEVER fall through to the auto-seat/seat-picker
      // block below: that path RELEASES this seat and reassigns the client to
      // another open seat, handing its original seat to the AI (the dev ends up
      // bumped to seat 2 with seat 1 played by a bot). Keep the seat — if a start
      // is already in flight it will reinit this client when it finishes;
      // otherwise (re)start the game with this client in its existing seat.
      if (this.starting) {
        this.broadcastLobby();
        return;
      }
      await this.startGame();
      return;
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
    // Follow-mode PERSISTS across a disconnect: page reloads / HMR are constant in
    // dev, and dropping follow on every reload makes it unusable. It is restored on
    // the follower's reconnect (see `hello`). While the follower is away the game
    // pauses on its turn — identical to any away player. An explicit `leave`,
    // `restart`, or follow-toggle is the only way to end follow-mode.
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
      case 'getState':
        return this.handleGetState(clientId, msg);
      case 'getLobby':
        return this.handleGetLobby(clientId, msg);
      case 'debugToggle':
        return this.handleDebugToggle();
      case 'uiSwitch':
        return this.handleUiSwitch(msg);
      case 'configure':
        return this.handleConfigure(clientId, msg);
    }
  }

  private async handleRestart(clientId: string): Promise<void> {
    // Defensive hardening only (T-157-06) — NOT the D11 fix. A FINISHED game
    // already passes here: LobbyPhase has no 'complete' value, so completion
    // never flips `phase` off 'playing'. The `|| !this.session` clause guards
    // the genuinely no-game/mid-setup case (phase somehow 'playing' with no
    // live session), which the bare phase check alone would not catch.
    if (this.phase !== 'playing' || !this.session) {
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

  /**
   * D13/DEVHOST-01: apply a pre-start gameOption/preset selection, then
   * (re)start via the existing `startGame()` — modeled on `handleRestart`
   * ("a restart is a clean slate"). A preset applies wholesale (every option
   * in its bundle, and its player count via the reserved `playerCount` key);
   * an explicit `gameOptions` entry overlays on top of (overrides) the
   * preset for the same key. Every selected key is validated (T-161-02)
   * BEFORE anything is applied — an undeclared key or invalid choice value
   * rejects the WHOLE selection with an actionable error and never reaches
   * the start op.
   */
  private async handleConfigure(
    clientId: string,
    msg: Extract<ClientInbound, { type: 'configure' }>,
  ): Promise<void> {
    let bundle: Record<string, unknown> = {};
    if (msg.preset !== undefined) {
      const preset = this.opts.presets?.find((p) => p.name === msg.preset);
      if (!preset) {
        const known = (this.opts.presets ?? []).map((p) => p.name).join(', ') || '(none declared)';
        this.send(clientId, { type: 'error', message: `Unknown preset "${msg.preset}" — declared presets are: ${known}.` });
        return;
      }
      bundle = { ...preset.options };
      if (preset.players?.length) bundle.playerCount = preset.players.length;
    }
    if (msg.gameOptions) bundle = { ...bundle, ...msg.gameOptions };

    try {
      validateGameOptionSelection(this.opts.declaredGameOptions ?? [], bundle);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid game option selection.';
      this.send(clientId, { type: 'error', message });
      return;
    }

    // CR-01: a preset's declared player count (the reserved `playerCount` key
    // set above when `preset.players.length` is present) must not diverge
    // from the seat map / per-seat arrays `startGame` derives from
    // `this.opts.playerCount`. Resize the seat map to match BEFORE applying
    // and (re)starting, so `playerCount` and every playerCount-sized array
    // (`playerOptions`/`playerIsAI`/`playerConfigs`) always agree.
    if (typeof bundle.playerCount === 'number') {
      const newPlayerCount = bundle.playerCount;
      if (!Number.isInteger(newPlayerCount) || newPlayerCount < 1) {
        this.send(clientId, {
          type: 'error',
          message: `Preset/configure playerCount must be a positive integer, got ${JSON.stringify(bundle.playerCount)}.`,
        });
        return;
      }
      this.resizeSeats(newPlayerCount);
    }

    this.appliedGameOptions = { ...this.appliedGameOptions, ...bundle };
    await this.startGame();
  }

  /**
   * CR-01 (D13/DEVHOST-01): resize the seat map to `newCount` so it stays
   * consistent with a preset-declared (or otherwise configured) player count
   * applied post-start via `configure`. Growing adds open (unclaimed) seats;
   * shrinking releases and drops any seat beyond the new count (its client
   * falls back to the seat-picker on the next lobby broadcast). Mutates
   * `this.opts.playerCount` — the SAME field `startGame`, `buildPerSeatOptions`,
   * `addAiSeat`, `rebuildAiSeats`, and `lobbyMessage` all already read — so
   * there is exactly one source of truth for the player count after a resize,
   * never two that can drift apart (the CR-01 defect: `playerCount` in the
   * start op diverging from `playerOptions`/`playerIsAI`/`playerConfigs`
   * length, which were built from the frozen constructor-time count).
   */
  private resizeSeats(newCount: number): void {
    const current = this.seats.size;
    if (newCount === current) return;
    if (newCount > current) {
      for (let seat = current + 1; seat <= newCount; seat++) {
        this.seats.set(seat, { seat, clientId: null, name: `Player ${seat}`, connected: false });
      }
    } else {
      for (let seat = current; seat > newCount; seat--) {
        const info = this.seats.get(seat);
        if (info?.clientId) this.releaseSeat(info.clientId);
        this.seats.delete(seat);
      }
    }
    this.opts.playerCount = newCount;
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
    // Explicitly leaving ends follow-mode (unlike a transient disconnect/reload).
    if (clientId === this.followerClientId) {
      this.followerClientId = null;
      this.lastFollowerSeat = null;
      this.rebuildAiSeats();
      this.send(clientId, { type: 'follow', enabled: false, seat: 0 });
    }
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
      this.send(clientId, { type: 'error', message: 'Game has not started.', requestId: msg.requestId ?? null });
      return;
    }
    // A follower acts as whichever seat is currently due, not its own seat.
    const seat =
      clientId === this.followerClientId ? this.effectiveActiveSeat() : this.clientSeat.get(clientId);
    if (seat === undefined) {
      this.send(clientId, {
        type: 'error',
        message: 'You are not seated in this game.',
        requestId: msg.requestId ?? null,
      });
      return;
    }
    // Remember who asked so the response routes back to THIS client, even when a
    // follower is acting as a seat it does not occupy.
    if (msg.requestId) this.requestOrigin.set(msg.requestId, clientId);
    await this.session.handleServerRequest(seat, msg.requestId, msg.op, msg.payload);
  }

  /**
   * Scriptable query (DRIVE-01): returns the CALLING client's own seat view —
   * same shape as the `game_state` broadcast — correlated by requestId. Copies
   * `handleServerRequest`'s full guard chain verbatim (phase-not-playing →
   * seat-not-found) so a scripted client gets the same actionable errors a
   * browser client would, and NEVER a client-supplied seat's view: the seat is
   * resolved only from server-tracked `followerClientId`/`clientSeat` (there is
   * no `seat` field on the `getState` variant to begin with).
   */
  private handleGetState(
    clientId: string,
    msg: Extract<ClientInbound, { type: 'getState' }>,
  ): void {
    if (this.phase !== 'playing' || !this.session) {
      this.send(clientId, { type: 'error', message: 'Game has not started.', requestId: msg.requestId ?? null });
      return;
    }
    const seat =
      clientId === this.followerClientId ? this.effectiveActiveSeat() : this.clientSeat.get(clientId);
    if (seat === undefined) {
      this.send(clientId, {
        type: 'error',
        message: 'You are not seated in this game.',
        requestId: msg.requestId ?? null,
      });
      return;
    }
    const view = this.session.viewForSeat(seat);
    const meta = this.session.meta();
    this.send(clientId, {
      type: 'game_state',
      view,
      isComplete: meta.isComplete,
      winners: meta.winners,
      isDraw: meta.isDraw,
      requestId: msg.requestId ?? null,
    });
  }

  /**
   * Scriptable query (DRIVE-01): returns the dev host's lobby payload. Works in
   * EVERY phase (including lobby, before any client has joined) — unlike
   * `getState`, this is intentionally NOT gated on `phase === 'playing'`.
   */
  private handleGetLobby(
    clientId: string,
    msg: Extract<ClientInbound, { type: 'getLobby' }>,
  ): void {
    const lobby = this.lobbyMessage() as Extract<HostOutbound, { type: 'lobby' }>;
    this.send(clientId, { ...lobby, requestId: msg.requestId ?? null });
  }

  /**
   * Relay-only (DRIVE-03): fans a debug-panel toggle out to every connected
   * browser tab; `DevHost.vue` reacts by calling its existing `toggleDebug()`.
   * No game-state mutation, no bridge.ts routing. A scripted-only client with
   * no browser tab connected will see no visible effect from this op — that is
   * expected, not a bug (there is no game-state acknowledgment to observe).
   */
  private handleDebugToggle(): void {
    for (const cid of this.connected) this.send(cid, { type: 'debugToggle' });
  }

  /**
   * Relay-only (DRIVE-03): fans a UI-switch request out to every connected
   * browser tab, carrying the requested UI name intact; `DevHost.vue` reacts by
   * driving its existing `onUiSelect()` code path. Same caveat as
   * `handleDebugToggle`: a headless script with no iframe sees no visible effect.
   */
  private handleUiSwitch(msg: Extract<ClientInbound, { type: 'uiSwitch' }>): void {
    for (const cid of this.connected) this.send(cid, { type: 'uiSwitch', name: msg.name });
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
    // ENDGAME-02 / F-12: single-chokepoint concurrency guard. Two near-
    // simultaneous (re)start triggers (restart + configure, or two restarts)
    // would otherwise each build a live session and both broadcast — the loser
    // never stopped. Ignore a racing trigger while a start is already in flight.
    if (this.starting) return;
    this.starting = true;
    // F-12: dispose the outgoing session BEFORE building the new one so its
    // fire-and-forget demo loop and any late `complete`/state broadcasts cannot
    // leak stale frames onto (and resurrect the GameOverCard over) the fresh
    // game. Safe on the first start (no session yet).
    this.session?.dispose();
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
    const perSeatOptions = this.buildPerSeatOptions();
    const startGameOptions = {
      playerCount,
      seed: (this.opts.makeSeed ?? defaultSeed)(),
      // D13/DEVHOST-01: the CURRENTLY APPLIED selection (defaults, overlaid by
      // any accepted `configure` preset/gameOptions), not the frozen
      // opts.baseGameOptions — so a selection persists across a restart. A
      // reserved `playerCount` key here (set when a preset declares
      // `players`) intentionally overrides the top-level `playerCount` field
      // above via spread order; the TOP-LEVEL `playerCount` here is already
      // the resized value (CR-01: `handleConfigure` calls `resizeSeats` —
      // which mutates `this.opts.playerCount` — BEFORE `startGame` reads it),
      // so both sides of the spread agree and `playerOptions`/`playerIsAI`/
      // `playerConfigs` below (all sized off this same `playerCount`) never
      // diverge from the reported count.
      ...this.appliedGameOptions,
      // DEVHOST-04 / F-04: top-level `colors`/`colorLabels` are what the engine
      // reads to set `player.color`. Placed after appliedGameOptions so lobby
      // color selections win, mirroring the production per-seat override.
      ...this.buildColorGameOptions(),
      playerOptions: perSeatOptions,
      playerIsAI: Array.from({ length: playerCount }, (_, i) => !humanSeats.has(i + 1)),
      // Mirror the production lobby's playerConfigs (game-session.ts builds the
      // same shape from lobby slots) so games that read
      // options.playerConfigs[seat-1] — e.g. per-seat isAI to drive in-flow AI —
      // behave identically in dev. Without this an AI seat is invisible to such
      // games: they treat the bot seat as a human, build an interactive turn, and
      // the dev host's MCTS bot then finds "No available moves" and locks up.
      playerConfigs: Array.from({ length: playerCount }, (_, i) => ({
        name: this.seats.get(i + 1)?.name ?? `Player ${i + 1}`,
        isAI: !humanSeats.has(i + 1),
        aiLevel: this.opts.aiLevel,
        ...perSeatOptions[i],
      })),
    };
    const baseOptions = { playerCount };
    // teachingDisabled travels in hostOptions, NOT gameOptions (WR-04/D-01):
    // gameOptions is handed to the Game constructor on `start` and persists
    // into snapshot.gameOptions, and a game may legitimately define its own
    // `teachingDisabled` game option that must not collide with this flag.
    // FEAT-01/168-02: seedSnapshot rides here too (never gameOptions) so a
    // `--seed` restart still starts from the seed, not a fresh game.
    const hostOptions = { teachingDisabled: this.opts.teachingDisabled, seedSnapshot: this.opts.seedSnapshot };
    const executeOp = (snapshot: unknown, pendingState: Record<string, unknown> | null, op: Op) =>
      this.opts.executeOp(op.type === 'start' ? startGameOptions : baseOptions, snapshot, pendingState, op, hostOptions);

    const session = createDevSession({
      playerCount,
      aiSeats: this.aiSeats,
      teachingDisabled: this.opts.teachingDisabled,
      executeOp,
      postGameState: (seat, view, meta) => this.deliverGameState(seat, view, meta),
      postServerResponse: (seat, requestId, result) =>
        this.deliverServerResponse(seat, requestId, result),
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

    // D15/DEVHOST-03: reconcile against `this.connected` — a seat captured as
    // human in `humanSeats` (above, BEFORE the await) whose client disconnected
    // DURING `await session.start()` is not driven by anyone: `playerIsAI` in
    // the start op was computed pre-await from the same stale `humanSeats`, so
    // the game treats it as human, but the client that would act for it is
    // gone. AI-cover it now so `runAITurns()` (next) has a driver and the flow
    // loop cannot stall on a vanished human. The seat's `clientId` reservation
    // is left untouched — this is a loop-driver-only cover, not a permanent
    // conversion; `hello`'s reconnect branch removes it from `aiSeats` again
    // the moment the client returns, so the bot yields (see `hello` below).
    for (const seat of humanSeats) {
      const info = this.seats.get(seat);
      if (info && !info.connected) this.addAiSeat(seat);
    }

    // The opening seat may belong to a bot (e.g. an AI dictator that acts first);
    // drive any AI turns before handing control to the humans, then send state.
    await session.host.runAITurns();

    this.broadcastLobby();
    // WR-02: reinit every CURRENTLY seated + connected client, not just the
    // pre-await `humanSeats` snapshot. A `join` (handleJoin has no `starting`
    // guard — it works mid-await by design, mirroring D15's own reclaim
    // scenario) can land a client on a seat DURING `await session.start()`;
    // that seat isn't in `humanSeats` (captured before the await), so without
    // this it never receives `init`/`game_state` here — `handleJoin`'s own
    // `if (this.phase === 'playing')` reinit check also reads false at join
    // time (phase is still 'lobby' mid-await) — leaving the client seated
    // with no UI content until an unrelated broadcast happens to fire.
    const seatsToReinit = new Set(humanSeats);
    for (const info of this.seats.values()) {
      if (info.clientId && info.connected) seatsToReinit.add(info.seat);
    }
    for (const seat of seatsToReinit) {
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

  /**
   * DEVHOST-04 / F-04: engine game options that actually deliver the palette to
   * `player.color`. The `Game` constructor assigns `player.color = colors[i]`
   * from a TOP-LEVEL `colors` array (and `colorLabel` from `colorLabels`) — it
   * never reads `playerOptions[i].color`. The production `game-session.ts` path
   * threads exactly this. We build `colors` from each seat's chosen/default
   * color so both the palette AND any lobby color choices reach the engine.
   * Returns `{}` (engine keeps its DEFAULT_COLOR_PALETTE) unless EVERY seat has
   * a resolved color — a partial array would misalign seats.
   */
  private buildColorGameOptions(): { colors?: string[]; colorLabels?: Record<string, string> } {
    const colors = Array.from({ length: this.opts.playerCount }, (_, i) => {
      const seat = this.seats.get(i + 1);
      return seat?.color ?? this.opts.colorPalette?.[i]?.value;
    });
    if (colors.some((c) => c === undefined)) return {};

    const result: { colors?: string[]; colorLabels?: Record<string, string> } = {
      colors: colors as string[],
    };
    if (this.opts.colorPalette && this.opts.colorPalette.length > 0) {
      result.colorLabels = Object.fromEntries(
        this.opts.colorPalette.map((c) => [c.value, c.label]),
      );
    }
    return result;
  }

  private reinitSeat(clientId: string, seat: number): void {
    this.send(clientId, { type: 'init', seat });
    const view = this.session?.viewForSeat(seat);
    if (view !== undefined && this.session) {
      const meta = this.session.meta();
      this.send(clientId, { type: 'game_state', view, isComplete: meta.isComplete, winners: meta.winners, isDraw: meta.isDraw });
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
   * Route a `server_response` back to the client that issued the request (looked
   * up by requestId), falling back to the acting seat's client. Without the
   * requestId mapping, a follower's responses would be posted to the seat it is
   * acting as — which it does not occupy — and dropped.
   */
  private deliverServerResponse(
    seat: number,
    requestId: string | null,
    result: Record<string, unknown>,
  ): void {
    const message: HostOutbound = { type: 'server_response', requestId, result };
    const origin = requestId ? this.requestOrigin.get(requestId) : undefined;
    if (requestId) this.requestOrigin.delete(requestId);
    if (origin && this.connected.has(origin)) {
      this.send(origin, message);
      return;
    }
    this.sendToSeat(seat, message);
  }

  /**
   * Send a `game_state` frame to the seat's client. For the follower, override
   * the seat with the currently-active seat: re-`init` when it changes, and send
   * that seat's freshly-computed view (so the follower drives whoever is due).
   */
  private deliverGameState(
    seat: number,
    view: unknown,
    meta: { isComplete: boolean; winners: number[]; isDraw: boolean },
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
        isDraw: meta.isDraw,
      });
      return;
    }
    this.send(info.clientId, {
      type: 'game_state',
      view,
      isComplete: meta.isComplete,
      winners: meta.winners,
      isDraw: meta.isDraw,
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
