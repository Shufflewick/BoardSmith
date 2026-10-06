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
 * become bot when the game starts. Reconnect is by the client's persistent id.
 */

import { createDevSession, type DevSession } from './bridge.js';
import {
  StatePushGate,
  type ExecutableOp,
  type OpResult,
  type GamePreset,
  type RulesReload,
  type TurnBoundary,
} from '../../session/index.js';
import { createNodeWorldClock, type WorldHostClock } from './node-world-clock.js';
import { runsAtOnce, type HostWorkGate } from '../../session/host-work-gate.js';
import { heldClock, type RulesReloadNotice } from './rules-reload-queue.js';
import { dueSeats, type SeatActivityState, type GameStateSnapshot } from '../../engine/index.js';
import { selectGameOptions, type GameOptionSelection } from '../../session/game-option-selection.js';
import type { GameOptionDefinition } from '../../session/types.js';
import {
  PERSIST_KEY,
  PersistenceStore,
  takePrivateCommit,
  type PrivateChannelCarrier,
  type PersistPlayer,
} from '../../persistence/index.js';
import { mintSeed } from '../../utils/random.js';
import { ErrorCode } from '../../types/protocol.js';

interface SeatInfo {
  seat: number;
  /** The client holding this seat, or null if open. */
  clientId: string | null;
  name: string;
  color?: string;
  connected: boolean;
}

/**
 * One seat as a lobby message shows it to ONE recipient. It never carries the
 * holder's client id: that id is how the host knows who is who (reconnects,
 * the one-person debug rule), so a page that learned another's could connect
 * as them. `mine` says whether the recipient holds the seat.
 */
export interface LobbySeat {
  seat: number;
  /** Someone holds the seat (they may be away); false means open or bot. */
  held: boolean;
  /** The recipient holds this seat. */
  mine: boolean;
  name: string;
  color?: string;
  connected: boolean;
}

export type LobbyPhase = 'lobby' | 'playing';

/**
 * How long a seat whose page went away stays its player's before a bot covers
 * it (#412). A reload closes the old socket before the new page says hello, so
 * for that moment the seat has no connected holder; within this window it is
 * still the player's, and nothing moves for it. The platform never lets a bot
 * act for a disconnected player on a real-time table; the dev host covers a
 * seat whose page is gone for good (BUG-12: a stale auto-opened tab would
 * otherwise stall the game), but only after this window, so a reload never does.
 */
const RECONNECT_GRACE_MS = 10_000;

/** Arm `fire` after `delayMs`; returns what cancels it. */
export type ReconnectTimer = (delayMs: number, fire: () => void) => () => void;

const nodeReconnectTimer: ReconnectTimer = (delayMs, fire) => {
  const timer = setTimeout(fire, delayMs);
  return () => clearTimeout(timer);
};

/** Messages the host sends to a client. */
export type HostOutbound =
  | {
      type: 'lobby';
      /** Whether debugging is on (#481); see `MultiplayerHost.debugOn`. */
      debug: boolean;
      phase: LobbyPhase;
      seats: LobbySeat[];
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
      /**
       * Host clock, epoch ms, when the open step closes, or null when it
       * declared no time window (#301's platform contract, enforced here by
       * #302). The page counts down with `serverNow` and its own `receivedAt`.
       */
      deadlineAt: number | null;
      /** Host clock, epoch ms, when this frame was sent. */
      serverNow: number;
      /**
       * The seed this game was dealt from (#460), which a `restart` naming it
       * deals again. Null for a game restored from a recorded state that names
       * none (`boardsmith dev --seed <file>`).
       */
      seed: string | null;
      requestId?: string | null;
    }
  | { type: 'server_response'; requestId: string | null; result: Record<string, unknown> }
  | { type: 'follow'; enabled: boolean; seat: number }
  | { type: 'debugToggle' }
  | { type: 'uiSwitch'; name: string }
  /** A saved rules edit is reloading, or has settled (#379): see `rules-reload-queue.ts`. */
  | ({ type: 'rules_reload' } & RulesReloadNotice)
  /**
   * The dev-server run this page joined (#416), sent by the connection layer
   * (`connection-handler.ts`) in answer to `hello`. The page names it in its
   * next `hello` when its socket reconnects.
   */
  | { type: 'welcome'; runId: string }
  /**
   * The page's `hello` named an earlier dev-server run (#416): the server
   * restarted since it joined. It is not seated; reloading it joins this run.
   */
  | { type: 'stale_run' };

/** The `game_state` frame, the one message `pushGate` decides on. */
type GameStateFrame = Extract<HostOutbound, { type: 'game_state' }>;

/** Messages a client sends to the host. */
export type ClientInbound =
  | { type: 'hello' }
  | { type: 'join'; seat: number; name?: string; color?: string }
  | { type: 'leave' }
  /** Start a new game, dealt from `seed` when it names one (#460), else from a fresh seed. */
  | { type: 'restart'; seed?: string }
  | { type: 'server_request'; requestId: string; op: string; payload: Record<string, unknown> }
  | { type: 'follow'; enabled: boolean }
  | { type: 'getState'; requestId?: string }
  | { type: 'getLobby'; requestId?: string }
  | { type: 'debugToggle' }
  | { type: 'uiSwitch'; name: string }
  /**
   * The dev bar's "End step" control (#302): close the open timed step now,
   * exactly as its window elapsing would.
   */
  | { type: 'fireDeadline' }
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
  /**
   * DEVHOST-01 / F-18: the game's declared max player count. Used to validate a
   * `configure` preset/gameOptions `playerCount` against the game's real
   * [minPlayers, maxPlayers] range BEFORE resizing/starting — otherwise a
   * 6-player preset on a 2–4 game is accepted and blows up in the engine.
   * Required: a host that does not know the ceiling cannot enforce it, and the
   * check silently degrading to "any positive integer" is the bug this exists
   * to catch.
   */
  maxPlayers: number;
  /** Default bot level for unclaimed (bot) seats when the game starts. */
  botLevel?: string;
  /**
   * Seats (1-indexed) the `--bot` flag designates as bot. The auto-seated dev
   * avoids these, so they stay open and play as bot; any open seat is bot anyway.
   */
  designatedBotSeats?: number[];
  /** Seat colors offered in the lobby (1-indexed by position). */
  colorPalette?: Array<{ value: string; label: string }>;
  /**
   * The game options the first `start` op carries (the declared defaults,
   * overlaid by `--preset` and `--game-option`), already admitted by
   * `selectGameOptions`: only a selection is accepted here, so the start op
   * can never carry `seed`, `elementIdKey` or another host-owned field from
   * the author's flags (#447).
   */
  baseGameOptions?: GameOptionSelection;
  /**
   * The declared game-level option definitions (D13/DEVHOST-01), which an
   * incoming `configure` selection is admitted against: an undeclared key, a
   * host-owned key or a `select` value not among its declared choices is
   * rejected and never reaches the start op.
   */
  declaredGameOptions?: Record<string, GameOptionDefinition>;
  /**
   * Declared presets (D13/DEVHOST-01) — a `configure` message's `preset` name
   * is looked up here; applying a preset sets every option in its bundle and,
   * if it declares `players`, resizes the seat map to that count (see
   * `handleConfigure`).
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
   * Force debugging on for a trusted table (#481), set by `boardsmith dev
   * --debug`. Without it, debugging is on only while one person holds every
   * human seat (see `MultiplayerHost.debugOn`).
   */
  debug?: boolean;
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
   * gameOptions (seed, per-seat colors, playerIsBot) from lobby state, so it
   * must own them. `hostOptions` carries host-level session policy
   * (`teachingDisabled`, `seedSnapshot`) separately from the game's own options.
   */
  executeOp: (
    gameOptions: { playerCount: number; [key: string]: unknown },
    snapshot: unknown,
    pendingState: Record<string, unknown> | null,
    op: ExecutableOp,
    hostOptions?: { teachingDisabled?: boolean; seedSnapshot?: GameStateSnapshot; debug?: boolean },
  ) => Promise<OpResult>;
  /** Deliver a message to one client (the WS layer maps clientId → socket). */
  send: (clientId: string, message: HostOutbound) => void;
  /** Seed source for a fresh game (defaults to `mintSeed`, 128 bits from the secure random source). */
  makeSeed?: () => string;
  /**
   * The cross-session store this host reads at start and commits to at game
   * over (#41 item 2). Unset means the host behaves exactly as it always did:
   * nothing is injected, nothing is committed, and a game that never declared
   * persistence is affected in no way.
   */
  persistence?: DevPersistenceOptions;
  /**
   * boardsmith.json's `idleAction` (#302): what the host submits for every
   * human seat still due when a timed step's window elapses, exactly as the
   * platform does. A game with no timed step never uses it; a timed step in a
   * game without one is reported when its window elapses, because nothing can
   * close it.
   */
  idleAction?: { name: string; args?: Record<string, unknown> };
  /**
   * The clock step windows are measured and armed on. Defaults to the Node
   * clock the world host uses (#197), which serves a long window as a chain of
   * bounded sleeps; a test passes one it drives by hand.
   */
  clock?: WorldHostClock;
  /**
   * How the host runs the work it and its session start themselves: a step's
   * deadline running out (#387), the narrated demo's next move and a chain of
   * bot moves (#388). `boardsmith dev` passes its rules reload queue, so work
   * that comes due while an edited rules file is rebuilding runs on the rules
   * the table runs once the rebuild settles. Without one it runs the moment it
   * comes due.
   */
  hostWork?: HostWorkGate;
  /**
   * Runs the reconnect grace ({@link RECONNECT_GRACE_MS}) for a seat whose page
   * went away. Defaults to Node's timers; a test passes one it drives by hand.
   */
  reconnectTimer?: ReconnectTimer;
}

/**
 * THE RULES A TABLE RUNS, AS `boardsmith dev` LOADED THEM (#343).
 *
 * Both halves come out of one bundle of the author's rules, so they run on the
 * engine those rules were built with. A rules edit hands the host a new pair
 * through `MultiplayerHost.reloadRules`.
 */
export interface TableRules {
  /** Runs one op, exactly as `MultiplayerHostOptions.executeOp` does. */
  readonly executeOp: MultiplayerHostOptions['executeOp'];
  /** Re-derives a running game's snapshot under these rules (see `RulesReload`). */
  readonly carry: (
    gameOptions: { playerCount: number },
    snapshot: unknown,
    hostOptions: { teachingDisabled?: boolean },
  ) => Promise<RulesReload>;
}

/**
 * The open step's window: the boundary it belongs to, the session that
 * broadcast it, and when it closes on the host clock (null when the step
 * declared no window). One at a time, replaced whole when the boundary key
 * changes.
 */
interface StepWindow {
  session: DevSession;
  boundary: TurnBoundary;
  deadlineAt: number | null;
}

/**
 * How this dev host reaches its store.
 *
 * `store` is the pure `PersistenceStore` from `boardsmith/persistence` -- the
 * SAME object the platform's own validation core is built around. Saving it to
 * disk between runs is the CLI's job, not this class's: keeping the host
 * transport-free and filesystem-free is what makes every case above testable
 * without a dev server.
 */
interface DevPersistenceOptions {
  store: PersistenceStore;
  /**
   * This session's own id. It is what a game uses to name an APPEND
   * collision-free (`death:${sessionKey}`), so it must be stable for the life
   * of the session and different from the next one's.
   */
  sessionKey: string;
  /**
   * The version stamped onto every row this session writes. `boardsmith dev`
   * has no published version, so the CLI passes a marker that says so rather
   * than inventing a plausible-looking one -- a game migrating on `gameVersion`
   * must be able to tell a dev row from a published one.
   */
  gameVersion: string;
  /** Clock for `writtenAt`/`submittedAt`. Injected so a test can order two
   *  commits without sleeping. */
  now?: () => number;
  /**
   * Called after the store has CHANGED, so the CLI can write it to disk.
   *
   * The host does not save, and deliberately: it is transport-free and
   * filesystem-free, which is what makes every persistence case above testable
   * without a dev server. Saving is the one thing that genuinely belongs to
   * whoever owns the file.
   */
  onChange?: () => void;
}

/**
 * The token a dev seat's sealed rows are named after.
 *
 * Production seals a row to the seated user's account id. `boardsmith dev` has
 * no accounts, so the seat NUMBER is the identity -- stable across restarts,
 * which is exactly what makes the store cross-session, and distinct per seat,
 * which is what makes the seal testable at all. A game reads it out of the
 * start payload's `players` array and never hard-codes it, so nothing a
 * developer writes against this survives into production as a literal.
 */
function devPlayerToken(seat: number): string {
  return `dev-player-${seat}`;
}

/**
 * The failure frame a REFUSED COMMIT returns to `SnapshotSessionHost`.
 *
 * Mirrors production's `game-session.ts:refuseOp` field for field, which in
 * turn mirrors the session layer's own error frame: nulled state, empty views,
 * `isComplete: false`. Those fields are never read -- the host returns the
 * result untouched before `apply()` sees it -- and echoing the pre-action state
 * instead would invent a second convention for the same thing.
 *
 * `category: 'executor'` because the refusal came from the platform's rules,
 * not from the game's own.
 */
function refusedOp(error: string): OpResult {
  return {
    success: false,
    error,
    category: 'executor',
    snapshot: null,
    pendingState: null,
    flowState: null,
    playerViews: [],
    isComplete: false,
    winners: [],
  };
}

function refusedCommit(reason: string): OpResult {
  return refusedOp(
    `This game cannot finish because the record it tried to store was refused: ${reason}.`,
  );
}

/**
 * The STRIP half of the private channel, fail-closed.
 *
 * `persistPrivate` is not an `OpResult` field: the executor re-emits it as a
 * top-level one on the way out, and the session layer's type has no reason to
 * know about a channel it never reads. The carrier type is what names it.
 *
 * The strip THROWS on a divergent per-player secret (the views disagree about
 * the value, so no single commit can carry it). Production's runner surfaces
 * that throw as a failed op; the same fail-closed answer is returned here, so
 * nothing is applied, broadcast or persisted and the acting player reads the
 * same refusal they would read in production.
 */
function stripPrivateChannel(result: OpResult): OpResult & PrivateChannelCarrier {
  try {
    return takePrivateCommit(result as OpResult & PrivateChannelCarrier);
  } catch (error) {
    return refusedOp(error instanceof Error ? error.message : String(error));
  }
}

export class MultiplayerHost {
  private phase: LobbyPhase = 'lobby';
  private starting = false;
  private readonly seats = new Map<number, SeatInfo>();
  /** clientId → seat it currently holds (survives disconnect for reconnect). */
  private readonly clientSeat = new Map<string, number>();
  private readonly connected = new Set<string>();
  /**
   * Seats whose page went away and may still come back (#412), each with what
   * cancels its grace. Such a seat is still its player's: nothing covers it.
   */
  private readonly reconnecting = new Map<number, () => void>();
  private session: DevSession | null = null;
  /**
   * The seats a bot plays, changed as humans take and leave seats. The game's
   * host keeps its own copy, which `announceRoster` brings up to date.
   */
  private readonly botSeats: Array<{ seat: number; level?: string }> = [];
  /** The client (if any) that follows the active seat — it controls whichever
   *  seat is currently awaiting input, and bot is paused while it is set. */
  private followerClientId: string | null = null;
  /** The active seat last shown to the follower, to re-init only on change. */
  private lastFollowerSeat: number | null = null;
  /** The seed the running game was dealt from, which every `game_state` frame carries (#460). */
  private dealtFrom: string | null = null;
  /**
   * What the follower was last sent (#487). A seated page is pushed only when
   * its own seat's view changed, which the game's host decides; the follower
   * shows whichever seat is active, so it is held to the frame it last had
   * here instead. Frames that reset it (`reinitSeat`) or answer it
   * (`getState`) are recorded, not asked.
   */
  private readonly followerGate = new StatePushGate<string, GameStateFrame>({
    playerState: (frame) => (frame.view as { state?: unknown } | undefined)?.state,
    perPushFields: ['serverNow'],
  });
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
   * `opts.baseGameOptions` and replaced by each accepted `configure` message.
   * `startGame` spreads THIS (not `opts.baseGameOptions` directly) into the
   * start op, so a selection persists across a subsequent restart instead of
   * reverting to defaults. It is only ever a `GameOptionSelection`, so it
   * holds declared options and nothing the host owns; a preset's player
   * count is applied to the seat map by `resizeSeats` (CR-01) and read by
   * `startGame` from `opts.playerCount`, never carried in here.
   */
  private appliedGameOptions: GameOptionSelection;
  /**
   * The seats this session ACTS FOR, in the shape the store's seal is checked
   * against. Recomputed by `startGame` and read by the commit that ends the
   * session, so a seat taken over mid-game is reflected in what may be sealed
   * only from the next start -- the same freeze production has, where the
   * roster is fixed when the session starts.
   */
  private persistPlayers: PersistPlayer[] = [];
  private readonly clock: WorldHostClock;
  /** The open step's window, or null before the first broadcast of a session. */
  private window: StepWindow | null = null;
  /**
   * The rules every op runs on. Starts as `opts.executeOp` and is replaced by
   * `reloadRules` when the author saves an edit (#343).
   */
  private executeOp: MultiplayerHostOptions['executeOp'];
  /**
   * Set when a rules reload could not carry the running game across: the
   * instruction every move is answered with until a new game starts, so the
   * table never plays on quietly in a state its rules do not fit.
   */
  private stranded: string | null = null;

  constructor(private readonly opts: MultiplayerHostOptions) {
    this.clock = heldClock(opts.clock ?? createNodeWorldClock(), opts.hostWork ?? runsAtOnce);
    this.executeOp = opts.executeOp;
    for (let seat = 1; seat <= opts.playerCount; seat++) {
      this.seats.set(seat, { seat, clientId: null, name: `Player ${seat}`, connected: false });
    }
    this.appliedGameOptions = opts.baseGameOptions ?? selectGameOptions(opts.declaredGameOptions, {});
  }

  // ── Connection lifecycle ──────────────────────────────────────────────────

  /**
   * A client connection identified itself. The game is always live: the FIRST
   * client to connect auto-takes a seat and the game starts immediately (the dev
   * lands straight in — open seats are bot). Later clients land in the seat-picker
   * to take over a bot/open seat; a reconnecting client resumes its seat.
   */
  async hello(clientId: string): Promise<void> {
    this.connected.add(clientId);

    const existing = this.clientSeat.get(clientId);
    if (existing !== undefined) {
      const info = this.seats.get(existing);
      if (info) info.connected = true;
      this.endGrace(existing);
      // D15/DEVHOST-03: a reconnect always yields the seat back from any
      // bot-cover the post-await reconciliation applied while this client was
      // vanished (a no-op if the seat was never bot-covered — removeBotSeat is
      // safe to call unconditionally). This is what makes the reconciliation
      // reclaimable rather than permanent: the bot only drives the seat while
      // the human is actually gone.
      this.removeBotSeat(existing);
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
      // another open seat, handing its original seat to the bot (the dev ends up
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
    // Prefer an open seat NOT designated bot by `--bot` (so `--bot 1` puts the dev
    // in seat 2 and leaves seat 1 to the bot); fall back to any open seat.
    if (this.phase === 'lobby' && !this.starting) {
      const open = [...this.seats.values()].filter((s) => !s.clientId);
      const pick = open.find((s) => !this.opts.designatedBotSeats?.includes(s.seat)) ?? open[0];
      if (pick) this.assignSeat(clientId, pick.seat);
      await this.startGame();
      return;
    }

    // A 1-seat game has no seat to pick, so the seat-picker can never be the right
    // screen for it: with the one seat already held by a connected client there is
    // nothing takeable, and `DevHost.vue` renders a lobby with no "Take seat"
    // button — no control of any kind, and the board never mounts (issue #150).
    // Every client that reaches a solo dev host IS the player, so hand it seat 1.
    // The seat is not contested: a solo game has no second player to protect, and
    // the dev host already supersedes an older tab at the socket layer (one socket
    // per clientId), so superseding the seat is the same rule one level up.
    if (this.opts.playerCount === 1) {
      this.assignSeat(clientId, 1);
      // When a start is still in flight, `startGame`'s post-await reinit pass
      // covers this client (it is seated and connected by then) — see WR-02.
      if (this.phase === 'playing') this.reinitSeat(clientId, 1);
      this.broadcastLobby();
      return;
    }

    // Game already live (or starting): show the seat-picker.
    this.send(clientId, this.lobbyMessage(clientId));
  }

  disconnect(clientId: string): void {
    this.connected.delete(clientId);
    this.followerGate.forget(clientId);
    const seat = this.clientSeat.get(clientId);
    if (seat !== undefined) {
      const info = this.seats.get(seat);
      if (info) info.connected = false;
      // Keep the seat RESERVED for reconnect (a page reload mustn't lose it). If
      // the page is not back within the reconnect grace (#412), hand the
      // loop-driver duty to the bot (BUG-12): an away seat that nothing drives
      // stalls the whole game the moment the flow needs it — the stale
      // auto-opened tab that stranded `boardsmith dev` in its default
      // configuration. That is a driver-only cover, not a conversion: `hello`'s
      // reconnect branch calls `removeBotSeat` so the bot yields the instant the
      // client returns. While follow-mode is active nothing is covered: it
      // persists across reloads/HMR by design and pauses bot for every seat.
      if (this.followerClientId === null) this.startGrace(seat);
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
    await this.dispatch(clientId, msg);
    this.announceRoster();
  }

  /**
   * Tell the game's host the bot roster (`setBotSeats()`, #537), so the pump
   * plays the right seats and every page learns of a change now, not with the
   * next move. Called after every message and before every bot pump, since the
   * roster is changed in many places. The host publishes only when whether a
   * bot plays here changed, so telling it an unchanged roster costs nothing.
   */
  private announceRoster(): void {
    if (this.phase !== 'playing' || !this.session) return;
    this.session.host.setBotSeats(this.botSeats);
  }

  private async dispatch(clientId: string, msg: ClientInbound): Promise<void> {
    switch (msg.type) {
      case 'hello':
        return this.hello(clientId);
      case 'join':
        return this.handleJoin(clientId, msg);
      case 'leave':
        return this.handleLeave(clientId);
      case 'restart':
        return this.handleRestart(clientId, msg.seed);
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
      case 'fireDeadline':
        return this.handleFireDeadline(clientId);
    }
  }

  private async handleRestart(clientId: string, seed: string | undefined): Promise<void> {
    // Defensive hardening only (T-157-06) — NOT the D11 fix. A FINISHED game
    // already passes here: LobbyPhase has no 'complete' value, so completion
    // never flips `phase` off 'playing'. The `|| !this.session` clause guards
    // the genuinely no-game/mid-setup case (phase somehow 'playing' with no
    // live session), which the bare phase check alone would not catch.
    if (this.phase !== 'playing' || !this.session) {
      this.send(clientId, { type: 'error', message: 'No game in progress to restart.' });
      return;
    }
    const refused = seed === undefined ? undefined : this.dealRefusal(seed);
    if (refused !== undefined) {
      this.send(clientId, { type: 'error', message: refused });
      return;
    }
    // Rebuild the session with the same seats, dealt from the seed named or a
    // fresh one. Follow-mode carries over (#460): the one driver of every seat
    // drives the new game too, and no bot moves in it before the driver can.
    await this.startGame(seed);
  }

  /** Why a game cannot be dealt from `seed`, or undefined when it can. */
  private dealRefusal(seed: string): string | undefined {
    if (this.opts.seedSnapshot !== undefined) {
      return (
        'This `boardsmith dev` starts every game from the recorded state its `--seed <file>` names, so it cannot deal ' +
        'from a seed. Start `boardsmith dev` without `--seed` to deal from one.'
      );
    }
    if (seed.trim() === '') {
      return 'A game is dealt from a seed, any text that is not blank (such as "7" or "opening"). Type one, then deal again.';
    }
    return undefined;
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
  // surfaced only because this file changed.
  // fallow-ignore-next-line complexity
  private async handleConfigure(
    clientId: string,
    msg: Extract<ClientInbound, { type: 'configure' }>,
  ): Promise<void> {
    let bundle: Record<string, unknown> = {};
    let requestedPlayerCount: unknown;
    if (msg.preset !== undefined) {
      const preset = this.opts.presets?.find((p) => p.name === msg.preset);
      if (!preset) {
        const known = (this.opts.presets ?? []).map((p) => p.name).join(', ') || '(none declared)';
        this.send(clientId, { type: 'error', message: `Unknown preset "${msg.preset}" — declared presets are: ${known}.` });
        return;
      }
      bundle = { ...preset.options };
      if (preset.players?.length) requestedPlayerCount = preset.players.length;
    }
    if (msg.gameOptions) {
      // The player count may ride beside the options, as a preset declares
      // it. It is the host's field, applied to the seat map below, and never
      // part of the selection: `selectGameOptions` would refuse it by name.
      const { playerCount, ...options } = msg.gameOptions;
      if (playerCount !== undefined) requestedPlayerCount = playerCount;
      bundle = { ...bundle, ...options };
    }

    // Admitted as one selection with what is already applied, so the result
    // holds declared options only, each of its declared type, and never a
    // host-owned field such as `seed` or `elementIdKey` (#447).
    let selection: GameOptionSelection;
    try {
      selection = selectGameOptions(this.opts.declaredGameOptions, { ...this.appliedGameOptions, ...bundle });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid game option selection.';
      this.send(clientId, { type: 'error', message });
      return;
    }

    // CR-01: a preset's declared player count must not diverge from the seat
    // map / per-seat arrays `startGame` derives from `this.opts.playerCount`.
    // Resize the seat map to match BEFORE applying and (re)starting, so
    // `playerCount` and every playerCount-sized array
    // (`playerOptions`/`playerIsBot`/`playerConfigs`) always agree.
    if (requestedPlayerCount !== undefined) {
      const newPlayerCount = requestedPlayerCount;
      if (typeof newPlayerCount !== 'number' || !Number.isInteger(newPlayerCount) || newPlayerCount < 1) {
        this.send(clientId, {
          type: 'error',
          message: `Preset/configure playerCount must be a positive integer, got ${JSON.stringify(requestedPlayerCount)}.`,
        });
        return;
      }
      // F-18/DEVHOST-01: validate against the game's declared player range so an
      // out-of-range preset (e.g. a 6-player preset on a 2–4 game) is rejected
      // here with an actionable message rather than blowing up in the engine.
      const max = this.opts.maxPlayers;
      if (newPlayerCount < this.opts.minPlayers || newPlayerCount > max) {
        this.send(clientId, {
          type: 'error',
          message: `Preset/configure playerCount ${newPlayerCount} is out of range for this game (must be ${this.opts.minPlayers}–${max}).`,
        });
        return;
      }
      this.resizeSeats(newPlayerCount);
    }

    this.appliedGameOptions = selection;
    await this.startGame();
  }

  /**
   * CR-01 (D13/DEVHOST-01): resize the seat map to `newCount` so it stays
   * consistent with a preset-declared (or otherwise configured) player count
   * applied post-start via `configure`. Growing adds open (unclaimed) seats;
   * shrinking releases and drops any seat beyond the new count (its client
   * falls back to the seat-picker on the next lobby broadcast). Mutates
   * `this.opts.playerCount` — the SAME field `startGame`, `buildPerSeatOptions`,
   * `addBotSeat`, `rebuildBotSeats`, and `lobbyMessage` all already read — so
   * there is exactly one source of truth for the player count after a resize,
   * never two that can drift apart (the CR-01 defect: `playerCount` in the
   * start op diverging from `playerOptions`/`playerIsBot`/`playerConfigs`
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
        const holder = this.seats.get(seat)?.clientId;
        if (holder) this.dropFromTheTable(holder);
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
      this.rebuildBotSeats();
      const own = this.clientSeat.get(clientId);
      this.send(clientId, { type: 'follow', enabled: false, seat: own ?? 0 });
      if (own !== undefined && this.phase === 'playing') this.reinitSeat(clientId, own);
      this.announceRoster();
      await this.session?.host.runBotTurns(); // resume bot for the seats it covered
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
    this.botSeats.length = 0; // pause bot for every seat the follower now covers
    const active = this.effectiveActiveSeat();
    this.lastFollowerSeat = active;
    this.send(clientId, { type: 'follow', enabled: true, seat: active });
    this.reinitSeat(clientId, active);
  }

  /**
   * Release the seat of a client whose seat is going away. A follower among
   * them no longer drives the table: the restart that follows gives the seats
   * left to their bots.
   */
  private dropFromTheTable(clientId: string): void {
    if (clientId === this.followerClientId) this.stopFollowing();
    this.releaseSeat(clientId);
  }

  /** End follow-mode for a follower leaving its seat, and tell it so. */
  private stopFollowing(): void {
    if (this.followerClientId === null) return;
    this.send(this.followerClientId, { type: 'follow', enabled: false, seat: 0 });
    this.followerClientId = null;
    this.lastFollowerSeat = null;
  }

  /** Take over a seat (works mid-game: claim an open/bot seat → it stops being bot). */
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

  /** Give up a seat mid-game → it reverts to bot so the game continues for others. */
  private async handleLeave(clientId: string): Promise<void> {
    // Explicitly leaving ends follow-mode (unlike a transient disconnect/reload).
    if (clientId === this.followerClientId) {
      this.stopFollowing();
      this.rebuildBotSeats();
    }
    const seat = this.clientSeat.get(clientId);
    this.releaseSeat(clientId);
    if (seat !== undefined && this.phase === 'playing') {
      this.addBotSeat(seat);
      this.broadcastLobby();
      this.send(clientId, this.lobbyMessage(clientId));
      this.announceRoster();
      await this.session?.host.runBotTurns();
      return;
    }
    this.send(clientId, this.lobbyMessage(clientId));
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
    if (this.stranded !== null) {
      this.send(clientId, { type: 'error', message: this.stranded, requestId: msg.requestId ?? null });
      return;
    }
    const seat = this.seatOf(clientId, msg.requestId);
    if (seat === undefined) return;
    // Remember who asked so the response routes back to THIS client, even when a
    // follower is acting as a seat it does not occupy.
    if (msg.requestId) this.requestOrigin.set(msg.requestId, clientId);
    await this.session.handleServerRequest(seat, msg.requestId, msg.op, msg.payload);
  }

  /**
   * The seat `clientId` acts as and sees: a follower is whichever seat is
   * currently due, anyone else is their own seat. A client holding no seat is
   * told so, correlated to `requestId`, and gets undefined.
   */
  private seatOf(clientId: string, requestId: string | undefined): number | undefined {
    const seat =
      clientId === this.followerClientId ? this.effectiveActiveSeat() : this.clientSeat.get(clientId);
    if (seat === undefined) {
      this.send(clientId, { type: 'error', message: 'You are not seated in this game.', requestId: requestId ?? null });
    }
    return seat;
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
    const seat = this.seatOf(clientId, msg.requestId);
    if (seat === undefined) return;
    const frame = this.gameStateFrame(this.session.viewForSeat(seat), this.session.meta());
    if (clientId === this.followerClientId) this.followerGate.recordSent(clientId, frame);
    this.send(clientId, { ...frame, requestId: msg.requestId ?? null });
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
    const lobby = this.lobbyMessage(clientId);
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
    // The seat may still be reserved for a DIFFERENT holder — an away client whose
    // seat this one is taking over (`handleJoin`), or the tab this one supersedes
    // in a solo game (`hello`). Drop that reservation too: leaving it in
    // `clientSeat` dangles a mapping to a seat the old client no longer owns, and
    // its next `hello` would take the reconnect branch, flip this seat's
    // `connected` flag under the new owner, and re-init the old client onto it.
    if (info.clientId && info.clientId !== clientId) this.clientSeat.delete(info.clientId);
    this.endGrace(seat);
    info.clientId = clientId;
    info.name = name?.trim() || `Player ${seat}`;
    info.color = color ?? this.opts.colorPalette?.[seat - 1]?.value;
    info.connected = true;
    this.clientSeat.set(clientId, seat);
    this.removeBotSeat(seat); // a human now plays this seat
  }

  private removeBotSeat(seat: number): void {
    const i = this.botSeats.findIndex((s) => s.seat === seat);
    if (i !== -1) this.botSeats.splice(i, 1);
  }

  private addBotSeat(seat: number): void {
    if (seat >= 1 && seat <= this.opts.playerCount && !this.botSeats.some((s) => s.seat === seat)) {
      this.botSeats.push({ seat, level: this.opts.botLevel });
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

  /**
   * The ONE definition of "a human is playing this seat": its holder is
   * connected, or went away within the reconnect grace (#412) and may be
   * reloading. A seat whose holder has been gone longer is NOT: the reservation
   * survives for their reconnect, but nobody is driving the seat, so anything
   * that asks "does this seat need a bot / is this player a bot?" must read
   * false here. Every caller — `rebuildBotSeats`, `startGame`'s
   * `playerIsBot`/`playerConfigs` and its post-start reconciliation — routes
   * through this predicate so they can never drift apart.
   */
  private heldByHuman(seat: number): boolean {
    const info = this.seats.get(seat);
    return Boolean(info?.clientId && (info.connected || this.reconnecting.has(seat)));
  }

  /** Give a seat whose page went away the reconnect grace; a bot covers it after. */
  private startGrace(seat: number): void {
    this.endGrace(seat);
    const timer = this.opts.reconnectTimer ?? nodeReconnectTimer;
    const cancel = timer(RECONNECT_GRACE_MS, () =>
      (this.opts.hostWork ?? runsAtOnce).hold(() => {
        // A reconnect, a takeover or a newer grace withdrew this one.
        if (this.reconnecting.get(seat) !== cancel) return;
        this.reconnecting.delete(seat);
        this.coverAwaySeat(seat);
      }),
    );
    this.reconnecting.set(seat, cancel);
  }

  /** Withdraw a seat's reconnect grace, if it has one. */
  private endGrace(seat: number): void {
    this.reconnecting.get(seat)?.();
    this.reconnecting.delete(seat);
  }

  /** The grace ran out: the bot drives the seat until its player is back. */
  private coverAwaySeat(seat: number): void {
    if (this.followerClientId !== null) return;
    this.addBotSeat(seat);
    this.announceRoster();
    if (this.phase !== 'playing') return;
    void this.session?.host.runBotTurns().catch((err: unknown) => {
      console.error(
        `[boardsmith dev] bot cover for away seat ${seat} failed: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  /** Rebuild the bot-seat list from currently open seats. */
  private rebuildBotSeats(): void {
    this.botSeats.length = 0;
    for (let seat = 1; seat <= this.opts.playerCount; seat++) {
      if (!this.heldByHuman(seat)) this.botSeats.push({ seat, level: this.opts.botLevel });
    }
  }

  // ── Persistence (#41 items 2 and 4) ───────────────────────────────────────

  /**
   * The READ half (#41 item 2): freeze this session's roster, and put the store
   * it may see into the START options.
   *
   * The roster is frozen HERE and the same array decides two things -- what the
   * store hands over now, and what the commit at the end is allowed to seal.
   * One array, so those two can never disagree about who this session acts for.
   *
   * Injected as one more field in a bag the bundle already receives, under the
   * reserved key the validation core owns, which is exactly how production
   * injects it. A game that declared no persistence gets no key at all.
   */
  private injectPersistedStore(
    startGameOptions: Record<string, unknown>,
    humanSeats: Set<number>,
    playerCount: number,
  ): void {
    this.persistPlayers = Array.from({ length: playerCount }, (_, i) => ({
      seat: i + 1,
      // A bot seat owns no sealed row -- the same `null` production uses for a
      // bot or a guest, and for the same reason: a row sealed to an identity
      // that does not outlive the session can never be read or deleted again.
      playerId: humanSeats.has(i + 1) ? devPlayerToken(i + 1) : null,
    }));
    const persistence = this.opts.persistence;
    if (!persistence) return;
    const payload = persistence.store.readForSession(
      persistence.sessionKey,
      this.persistPlayers,
    );
    if (payload !== null) startGameOptions[PERSIST_KEY] = payload;
  }

  /**
   * Both durable channels, on the way OUT of one op.
   *
   * Two things happen here and the ORDER is the whole guarantee, because it is
   * production's order (`games/src/game-session.ts:runOp` ->
   * `stageCompletionCommit`), and this function sits at the same seam: after
   * the op ran, before `SnapshotSessionHost` has applied or broadcast anything.
   *
   *   STRIP  -- `persistPrivate` comes off the spectator view and off every
   *             player view, on EVERY successful op, and is re-emitted as a
   *             top-level field. Unconditional and not gated on completion or
   *             on any opt-in: the attribute name is reserved, and a strip that
   *             depended on a flag would leak for exactly the game that got the
   *             flag wrong.
   *   COMMIT -- on the op that ENDS the game, the store is handed both channels
   *             and may REFUSE. A refused commit refuses the op: the snapshot
   *             does not advance, nobody is told the game is over, and the
   *             acting player is given the reason. Without that a developer
   *             would watch a game finish locally and then watch the identical
   *             move be refused in production.
   */
  private applyPersistenceChannels(result: OpResult): OpResult {
    const stripped = stripPrivateChannel(result);
    const persistence = this.opts.persistence;
    if (!persistence || !stripped.success || !stripped.isComplete) return stripped;

    const outcome = persistence.store.commit({
      players: this.persistPlayers,
      spectatorView: stripped.spectatorView,
      persistPrivate: stripped.persistPrivate,
      gameVersion: persistence.gameVersion,
      now: persistence.now ?? Date.now,
    });
    if (!outcome.ok) return refusedCommit(outcome.reason);
    if (outcome.written > 0) persistence.onChange?.();
    return stripped;
  }

  // ── Game start ────────────────────────────────────────────────────────────

  // extracted into `injectPersistedStore` rather than inlined here.
  // fallow-ignore-next-line complexity
  private async startGame(seed?: string): Promise<void> {
    // ENDGAME-02 / F-12: single-chokepoint concurrency guard. Two near-
    // simultaneous (re)start triggers (restart + configure, or two restarts)
    // would otherwise each build a live session and both broadcast — the loser
    // never stopped. Ignore a racing trigger while a start is already in flight.
    if (this.starting) return;
    this.starting = true;
    // F-12: dispose the outgoing session BEFORE building the new one so its
    // fire-and-forget demo loop and any late `complete`/state broadcasts cannot
    // leak stale frames onto (and resurrect the GameOverCard over) the fresh
    // game. Safe on the first start (no session yet). Its step window goes
    // with it: the new game arms its own from its first broadcast.
    this.disarm();
    this.window = null;
    this.session?.dispose();
    const { playerCount } = this.opts;
    // BUG-12: "covered by a human" is `heldByHuman` — the SAME rule
    // `rebuildBotSeats` uses — never the weaker "has ever been claimed"
    // (`s.clientId` alone). A seat whose holder has gone away (the auto-opened
    // tab that was reloaded, a closed browser) would otherwise be counted as
    // human here: excluded from `botSeats` AND reported as human in
    // `playerIsBot`/`playerConfigs` below, so neither a bot nor a client drives
    // it and the first step needing that seat waits forever with nothing logged.
    const humanSeats = new Set(
      [...this.seats.values()].filter((s) => this.heldByHuman(s.seat)).map((s) => s.seat),
    );
    // Seed the bot-seat list from the current open seats; the session starts
    // with it. Changed later as humans take over seats (removeBotSeat) or give
    // them up (addBotSeat), and announced to the host by `announceRoster`. A
    // follower drives every seat, so while one follows no bot plays (#460).
    if (this.followerClientId === null) this.rebuildBotSeats();
    else this.botSeats.length = 0;

    // The start gameOptions are derived from lobby state (mirrors DevHost.buildSession):
    // a fresh seed, each seat's chosen/default color, and which seats are bot.
    const perSeatOptions = this.buildPerSeatOptions();
    const startGameOptions = {
      // D13/DEVHOST-01: the CURRENTLY APPLIED selection (defaults, overlaid by
      // any accepted `configure` preset/gameOptions), not the frozen
      // opts.baseGameOptions, so a selection persists across a restart. It
      // goes first: it is a `GameOptionSelection`, so it holds no host-owned
      // field, and the host's own fields below win over it regardless (#447).
      ...this.appliedGameOptions,
      // `playerCount` is already the resized value (CR-01: `handleConfigure`
      // calls `resizeSeats`, which mutates `this.opts.playerCount`, BEFORE
      // `startGame` reads it), so `playerOptions`/`playerIsBot`/`playerConfigs`
      // below (all sized off this same `playerCount`) never diverge from it.
      playerCount,
      seed: seed ?? (this.opts.makeSeed ?? mintSeed)(),
      // DEVHOST-04 / F-04: top-level `colors`/`colorLabels` are what the engine
      // reads to set `player.color`. Placed after appliedGameOptions so lobby
      // color selections win, mirroring the production per-seat override.
      ...this.buildColorGameOptions(),
      playerOptions: perSeatOptions,
      playerIsBot: Array.from({ length: playerCount }, (_, i) => !humanSeats.has(i + 1)),
      // Mirror the production lobby's playerConfigs (game-session.ts builds the
      // same shape from lobby slots) so games that read
      // options.playerConfigs[seat-1] — e.g. per-seat isBot to drive in-flow bot —
      // behave identically in dev. Without this a bot seat is invisible to such
      // games: they treat the bot seat as a human, build an interactive turn, and
      // the dev host's MCTS bot then finds "No available moves" and locks up.
      playerConfigs: Array.from({ length: playerCount }, (_, i) => ({
        name: this.seats.get(i + 1)?.name ?? `Player ${i + 1}`,
        isBot: !humanSeats.has(i + 1),
        botLevel: this.opts.botLevel,
        ...perSeatOptions[i],
      })),
    };
    this.injectPersistedStore(startGameOptions, humanSeats, playerCount);

    const baseOptions = { playerCount };
    // teachingDisabled travels in hostOptions, NOT gameOptions (WR-04/D-01):
    // gameOptions is handed to the Game constructor on `start` and persists
    // into snapshot.gameOptions, and a game may legitimately define its own
    // `teachingDisabled` game option that must not collide with this flag.
    // FEAT-01/168-02: seedSnapshot rides here too (never gameOptions) so a
    // `--seed` restart still starts from the seed, not a fresh game.
    const hostOptions = { teachingDisabled: this.opts.teachingDisabled, seedSnapshot: this.opts.seedSnapshot };
    const executeOp = async (
      snapshot: unknown,
      pendingState: Record<string, unknown> | null,
      op: ExecutableOp,
    ) => {
      const raw = await this.executeOp(
        op.type === 'start' ? startGameOptions : baseOptions,
        snapshot,
        pendingState,
        op,
        // #481: whether debug ops (`debug:*`: history, state-at, state-diff,
        // action traces, flow state, rewind, deck edits) run is decided per op
        // by `debugOn()`, the same answer the session gets below.
        { ...hostOptions, debug: this.debugOn() },
      );
      return this.applyPersistenceChannels(raw);
    };

    const session = createDevSession({
      playerCount,
      botSeats: this.botSeats,
      teachingDisabled: this.opts.teachingDisabled,
      debug: () => this.debugOn(),
      executeOp,
      hostWork: this.opts.hostWork ?? runsAtOnce,
      observeChange: (meta) => {
        this.observeBoundary(session, meta.turnBoundary);
        // Before `start` commits the session, the post-start re-init shows the follower its seat.
        if (this.session === session) this.followActiveSeat(meta);
      },
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
    this.stranded = null;
    this.dealtFrom = this.seedOf(startGameOptions.seed);

    // D15/DEVHOST-03: reconcile against `heldByHuman` — a seat captured as
    // human in `humanSeats` (above, BEFORE the await) that stopped being one
    // DURING `await session.start()` (its holder left, or went away and did not
    // come back within the reconnect grace) is not driven by anyone:
    // `playerIsBot` in the start op was computed pre-await from the same stale
    // `humanSeats`, so the game treats it as human. bot-cover it now so
    // `runBotTurns()` (next) has a driver and the flow loop cannot stall on a
    // vanished human. A seat still within its grace is left alone: its player
    // is reloading (#412). The seat's `clientId` reservation is untouched —
    // this is a loop-driver-only cover; `hello`'s reconnect branch removes it
    // from `botSeats` again the moment the client returns.
    for (const seat of humanSeats) {
      if (!this.heldByHuman(seat) && this.followerClientId === null) this.addBotSeat(seat);
    }

    // The opening seat may belong to a bot (e.g. a bot dictator that acts first);
    // drive any bot turns before handing control to the humans, then send state.
    this.announceRoster();
    await session.host.runBotTurns();

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
      if (clientId === this.followerClientId) this.reinitFollower();
      else if (clientId) this.reinitSeat(clientId, seat);
    }
  }

  /**
   * The seed a started game was dealt from: the recorded state's when the host
   * starts every game from one (`--seed <file>`), else the one the start op had.
   */
  private seedOf(dealt: unknown): string | null {
    const recorded = this.opts.seedSnapshot;
    if (recorded === undefined) return typeof dealt === 'string' ? dealt : null;
    const seed = recorded.seed ?? recorded.gameOptions?.seed;
    return typeof seed === 'string' ? seed : null;
  }

  /** Show the follower the seat that is due in the game just started. */
  private reinitFollower(): void {
    if (this.followerClientId === null) return;
    const active = this.effectiveActiveSeat();
    this.lastFollowerSeat = active;
    this.reinitSeat(this.followerClientId, active);
  }

  // ── Rules reload (#343) ───────────────────────────────────────────────────

  /**
   * RUN THE GAME ON EDITED RULES, from where it stands.
   *
   * `boardsmith dev` calls this with the rules it has just loaded again after a
   * save. With no game running the new rules are simply the ones the next start
   * uses, and this answers null.
   *
   * With a game running, the swap happens on the session's op chain: every op
   * before it ran on the old rules and every op after runs on the new ones. The
   * game is carried across by `TableRules.carry` (restored, or replayed when the
   * saved position no longer fits the edited flow). A game carried to the same
   * step keeps that step's window, so a save gives nobody more time and a
   * deadline that ran out while the edit rebuilt closes the step on the edited
   * rules (#387); a game carried to a different step arms that step's window
   * from its first broadcast.
   *
   * When it cannot be carried across, every connected client and the terminal
   * are told, and every move is refused with the same instruction until a new
   * game starts. It never goes on quietly in a state its rules do not fit.
   */
  async reloadRules(rules: TableRules): Promise<RulesReload | null> {
    const session = this.session;
    if (this.phase !== 'playing' || session === null) {
      this.executeOp = rules.executeOp;
      return null;
    }
    const outcome = await session.host.adoptReloadedRules(async (snapshot) => {
      this.executeOp = rules.executeOp;
      const carried = await rules.carry(
        { playerCount: this.opts.playerCount },
        snapshot,
        { teachingDisabled: this.opts.teachingDisabled },
      );
      if (carried.kind === 'failed') return carried;
      const stripped = stripPrivateChannel(carried.result);
      if (!stripped.success) {
        return { kind: 'failed', reason: stripped.error ?? 'its private record could not be separated from the views' };
      }
      return { ...carried, result: stripped };
    });
    if (outcome.kind === 'failed') {
      // A game that cannot go on has no step to close.
      this.disarm();
      this.window = null;
      this.stranded =
        `This game cannot continue on your edited rules: ${outcome.reason}. ` +
        'Press "New game" to start a game on them.';
      console.error(`[boardsmith dev] ${this.stranded}`);
      for (const clientId of this.connected) this.send(clientId, { type: 'error', message: this.stranded });
    } else {
      this.stranded = null;
    }
    return outcome;
  }

  /**
   * Tell every connected page where a saved rules edit stands (#379), so it can
   * say "Reloading rules..." while the host holds its moves.
   */
  // fallow-ignore-next-line unused-class-member
  tellRulesReload(notice: RulesReloadNotice): void {
    for (const clientId of this.connected) this.send(clientId, { type: 'rules_reload', ...notice });
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
      // `init` cleared the page, so it is sent the whole state whatever it last had.
      const frame = this.gameStateFrame(view, this.session.meta());
      if (clientId === this.followerClientId) this.followerGate.recordSent(clientId, frame);
      this.send(clientId, frame);
    }
    // A page seated into a game its rules no longer fit is told so, after the
    // `init` that clears whatever it was showing before.
    if (this.stranded !== null) this.send(clientId, { type: 'error', message: this.stranded });
  }

  private releaseSeat(clientId: string): void {
    const seat = this.clientSeat.get(clientId);
    if (seat === undefined) return;
    this.clientSeat.delete(clientId);
    this.endGrace(seat);
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
   * Send a `game_state` frame to the seat's client, which the game's host
   * calls only when that seat's view changed (#487). The follower is not sent
   * its own seat's view here: it shows the active seat, in `followActiveSeat`.
   */
  private deliverGameState(
    seat: number,
    view: unknown,
    meta: { isComplete: boolean; winners: number[]; isDraw: boolean },
  ): void {
    const info = this.seats.get(seat);
    if (!info?.clientId || !info.connected || info.clientId === this.followerClientId) return;
    this.send(info.clientId, this.gameStateFrame(view, meta));
  }

  /**
   * After every change, show the follower the currently active seat: re-`init`
   * when that seat changes, and otherwise send the seat's view only when it is
   * not the one the follower already has.
   */
  private followActiveSeat(meta: { isComplete: boolean; winners: number[]; isDraw: boolean }): void {
    const clientId = this.followerClientId;
    if (clientId === null || !this.connected.has(clientId)) return;
    const active = this.effectiveActiveSeat();
    const frame = this.gameStateFrame(this.session?.viewForSeat(active), meta);
    if (active !== this.lastFollowerSeat) {
      this.send(clientId, { type: 'init', seat: active });
      this.lastFollowerSeat = active;
      this.followerGate.recordSent(clientId, frame);
      this.send(clientId, frame);
      return;
    }
    if (this.followerGate.shouldPush(clientId, frame)) this.send(clientId, frame);
  }

  /**
   * Every `game_state` frame, in one shape: the view and terminal state, plus
   * the open step's deadline and this host's clock at send time (#302).
   */
  private gameStateFrame(
    view: unknown,
    meta: { isComplete: boolean; winners: number[]; isDraw: boolean },
  ): GameStateFrame {
    return {
      type: 'game_state',
      view,
      isComplete: meta.isComplete,
      winners: meta.winners,
      isDraw: meta.isDraw,
      deadlineAt: this.window?.deadlineAt ?? null,
      serverNow: this.clock.now(),
      seed: this.dealtFrom,
    };
  }

  // ── Step deadlines (#302) ─────────────────────────────────────────────────

  /**
   * Read the turn boundary off a broadcast, and arm the step's window when the
   * boundary is a new one.
   *
   * Called for every seat's frame of every broadcast, BEFORE the frame is sent,
   * so the first frame of a new boundary already carries its deadline. The same
   * key is the same window: a re-broadcast, a seat acting mid-round or a
   * reconnect only refreshes which seats are still due and never re-arms, so
   * the deadline does not slide.
   */
  private observeBoundary(session: DevSession, boundary: TurnBoundary): void {
    const open = this.window;
    const timed = boundary.timeLimitMs !== undefined;
    if (
      open?.session === session &&
      open.boundary.key === boundary.key &&
      timed === (open.deadlineAt !== null)
    ) {
      open.boundary = boundary;
      return;
    }
    const limit = boundary.timeLimitMs;
    const window: StepWindow = {
      session,
      boundary,
      deadlineAt: limit === undefined ? null : this.clock.now() + limit,
    };
    this.window = window;
    if (limit === undefined) this.disarm();
    else this.clock.arm(limit, () => void this.closeWindow(window));
  }

  private disarm(): void {
    this.clock.arm(null, () => {});
  }

  /** The dev bar's "End step": close the open window now. */
  private async handleFireDeadline(clientId: string): Promise<void> {
    const open = this.window;
    if (open === null || open.deadlineAt === null) {
      this.send(clientId, {
        type: 'error',
        message: 'No step deadline is open right now, so there is nothing to fire.',
      });
      return;
    }
    await this.closeWindow(open);
  }

  /**
   * The window elapsed: submit `idleAction` for every seat still due that a
   * human holds, stamped with the key the window was armed under.
   *
   * The ops queue behind any human submission already in flight, so a seat
   * that acted in time closes the round first and the timer's op is refused
   * as stale rather than spent on the next round. That refusal is the ordinary
   * race and is logged at info level. Any other refusal, or a round that did
   * not move, means the game cannot close its own timed step, and is reported
   * in the terminal and to every connected client.
   */
  private async closeWindow(window: StepWindow): Promise<void> {
    if (this.window !== window || window.deadlineAt === null) return;
    this.disarm();
    const idle = this.opts.idleAction;
    if (idle === undefined) {
      this.reportDeadlineFailure(
        'The step\'s time ran out, but boardsmith.json declares no "idleAction", so there is ' +
          'nothing to submit for the seats still due and the step stays open. Add the legal no-op ' +
          'action your rules register, e.g. "idleAction": { "name": "pass" }.',
      );
      return;
    }
    const seats = window.boundary.dueSeats.filter((seat) => !this.botSeats.some((bot) => bot.seat === seat));
    for (const seat of seats) {
      if (this.session !== window.session) return;
      const result = await this.submitIdleAction(window, idle, seat);
      if (!result.success) {
        this.reportIdleRefusal(idle.name, seat, result);
        return;
      }
    }
    if (seats.length > 0) this.assertRoundMoved(window, idle.name, seats);
  }

  /**
   * A refused idle action. Stale means the round closed on its own while the
   * timer's op waited its turn, which is the ordinary race; anything else means
   * the declared idle action cannot close this step.
   */
  private reportIdleRefusal(idleName: string, seat: number, refusal: { error?: string; errorCode?: ErrorCode }): void {
    if (refusal.errorCode === ErrorCode.STALE_SUBMISSION) {
      console.info(
        `[boardsmith dev] The step's time ran out just as the round moved on by itself, so the ` +
          `idle action for seat ${seat} was not needed.`,
      );
      return;
    }
    this.reportDeadlineFailure(
      `The step's time ran out, and the idle action "${idleName}" was refused for seat ${seat}: ` +
        `${refusal.error ?? 'no reason given'}. "idleAction" in boardsmith.json must name an action ` +
        'every seat still due can always take.',
    );
  }

  /**
   * One seat's idle action, composed by the host at the instant the window
   * closed and stamped with the key it was armed under, never the key current
   * when it lands. A throw is answered as a refusal, so it is reported rather
   * than lost in the timer callback.
   */
  private async submitIdleAction(
    window: StepWindow,
    idle: { name: string; args?: Record<string, unknown> },
    seat: number,
  ): Promise<OpResult> {
    try {
      return await window.session.host.handleOp(seat, {
        type: 'expireSeat',
        player: seat,
        idleAction: idle.name,
        args: idle.args ?? {},
        boundaryKey: window.boundary.key,
      });
    } catch (err) {
      return refusedOp(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Every idle action was accepted, so the round must have moved: a new key,
   * or a finished game. The same key means the game cannot close its own
   * timed step.
   */
  private assertRoundMoved(window: StepWindow, idleName: string, seats: number[]): void {
    const now = this.window;
    if (now?.session !== window.session || now.boundary.key !== window.boundary.key) return;
    if (window.session.meta().isComplete) return;
    this.reportDeadlineFailure(
      `The step's time ran out and the idle action "${idleName}" was submitted for seat ` +
        `${seats.join(', ')}, but the round did not move: seat ${now.boundary.dueSeats.join(', ')} ` +
        'still owes a move. "idleAction" must name an action that completes a seat\'s turn in ' +
        'every timed step.',
    );
  }

  /** A timed step the host could not close: say so in the terminal and to every client. */
  private reportDeadlineFailure(message: string): void {
    console.error(`[boardsmith dev] ${message}`);
    for (const clientId of this.connected) this.send(clientId, { type: 'error', message });
  }

  private send(clientId: string, message: HostOutbound): void {
    this.opts.send(clientId, message);
  }

  /**
   * Whether debugging is on right now (#481): the `debug:*` ops (history,
   * state-at, state-diff, action traces, flow state, rewind, deck edits and
   * `debug:logs`) and the page's Debug panel. On when `--debug` forced it, or
   * when at most one person holds the human seats. A person is a client id:
   * the id each browser keeps for itself (`dev-client-id.ts`), so tabs of one
   * browser are one person and two browsers (or a private window) are two. A
   * seat stays held while its player is away, until they leave it or someone
   * takes it over, so stepping out does not turn debugging on for the others. Asked on every op and sent with
   * every lobby message, so it follows people as they take and leave seats.
   */
  private debugOn(): boolean {
    if (this.opts.debug === true) return true;
    const holders = new Set<string>();
    for (const info of this.seats.values()) if (info.clientId) holders.add(info.clientId);
    return holders.size <= 1;
  }

  /** The lobby as `recipient` may see it: seats say who holds them only as `mine`. */
  private lobbyMessage(recipient: string): Extract<HostOutbound, { type: 'lobby' }> {
    return {
      type: 'lobby',
      debug: this.debugOn(),
      phase: this.phase,
      seats: [...this.seats.values()].map(({ clientId, ...seat }) => ({
        ...seat,
        held: clientId !== null,
        mine: clientId === recipient,
      })),
      minPlayers: this.opts.minPlayers,
      playerCount: this.opts.playerCount,
    };
  }

  private broadcastLobby(): void {
    for (const clientId of this.connected) this.send(clientId, this.lobbyMessage(clientId));
  }
}
