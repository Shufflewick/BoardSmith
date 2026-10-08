/**
 * Dev host bridge — the in-process stand-in for ShufflewickPub's GameSession
 * Durable Object. It wires a boardsmith `SnapshotSessionHost` to the iframe
 * postMessage protocol the embedded GameShell speaks, so `boardsmith dev` drives
 * the game through the EXACT production path: game UI in an `<iframe>` (platform
 * mode) talking to a host that owns op execution, snapshot/pendingState
 * threading, broadcast-before-response ordering, and the bot pump.
 *
 * This module is deliberately DOM-free so it can be unit-tested by feeding fake
 * `server_request` messages and asserting the host is driven and the iframe is
 * posted to in production order (`game_state` broadcast THEN `server_response`).
 *
 * It is the single source of truth for the wire→Op translation and the per-op
 * result shaping, mirroring ShufflewickPub `games/src/game-session.ts` so dev and
 * prod stay in lockstep.
 */

import {
  SnapshotSessionHost,
  debuggingOffMessage,
  type ExecuteOpAdapter,
  type Op,
  type OpFailure,
  type OpResult,
  type OpResultFor,
  type SnapshotSessionAdapters,
  type PublishMeta,
  type BotSeat,
} from '../../session/index.js';
import { record, getEntries } from './log-capture.js';
import type { WarningEntry } from '../../types/protocol.js';

/** The structured warnings a successful op carried (a pick or a choices query), or none. */
function warningsOf(result: OpResult): readonly WarningEntry[] {
  return result.success && 'warnings' in result ? (result.warnings ?? []) : [];
}

/** Wire op names the embedded GameShell sends (snake_case, prod payload shapes). */
export type WireOp =
  | 'action'
  | 'resolve_choices'
  | 'selection_step'
  | 'cancel_action'
  | 'undo'
  | 'start-tutorial'
  | 'exit-tutorial'
  // Teaching wire ops — hint/heatmap-toggle request bot suggestions;
  // results flow back via game_state broadcasts (not via the op response).
  | 'hint'
  | 'heatmap-toggle'
  // Demo lifecycle wire ops — start/stop the bot-vs-bot narrated demo loop.
  // Results flow via game_state broadcasts (isDemoRunning, narration);
  // the op response carries only { success, error } (RESEARCH Pitfall 7).
  | 'demo-start'
  | 'demo-stop'
  // Live demo playback controls (pause/play/step/back + speed). Like demo-start/stop,
  // state flows back via game_state broadcasts.
  | 'demo-control'
  // Debug-panel wire ops (dev only). `debug:restart` / `debug:switch-seat` are
  // host-chrome ops handled in DevHost, not here.
  | 'debug:history'
  | 'debug:state-at'
  | 'debug:state-diff'
  | 'debug:action-traces'
  | 'debug:flow-state'
  | 'debug:rewind'
  | 'debug:move-to-top'
  | 'debug:reorder-card'
  | 'debug:transfer-card'
  | 'debug:shuffle-deck'
  // debug:logs (ERR-04): pulls the dev-host's captured server-side
  // errors/warnings ring buffer (log-capture.ts). Host-lifecycle op — like
  // demoStart/demoStop, it is resolved directly by the bridge and MUST NEVER
  // be routed through the pure executeOp (RESEARCH Pitfall 3).
  | 'debug:logs';

export interface DevSessionOptions {
  playerCount: number;
  /** The seats a bot plays when the session starts; change them later with `host.setBotSeats`. */
  botSeats?: BotSeat[];
  /**
   * When true, teaching/assist features (hint, heatmap, demo, tutorial) are rejected
   * fail-loud for this session. Mirrors `--lock-teaching` in `boardsmith dev`.
   */
  teachingDisabled?: boolean;
  /**
   * Whether the debug ops (`debug:*`) run right now (#481). Asked again for
   * every request, because who sits at the table can change mid-game. Off
   * refuses every debug op, `debug:logs` included. The `executeOp` below must
   * pass the same answer to `executeOp`'s `hostOptions.debug`.
   */
  debug: () => boolean;
  /**
   * In-process op executor bound to the author's gameDefinition. The host calls
   * this with the authoritative snapshot + the acting seat's pending state; the
   * dev host passes it straight to the pure `executeOp(def, gameOptions, …)`.
   */
  executeOp: ExecuteOpAdapter;
  /**
   * Optional persistence adapter (ERR-03/ERR-04). When configured, a failure
   * is captured into the dev-host log-capture ring buffer via an
   * `onPersistenceError` adapter built in `createDevSession` — severity
   * escalates to 'error' once `persistenceHealthy` flips false. Unconfigured
   * by default (the dev host today has no persistence store).
   */
  persist?: SnapshotSessionAdapters['persist'];
  /** How the host holds the session's own work during a rules reload (#388). */
  hostWork?: SnapshotSessionAdapters['hostWork'];
  /**
   * Called after every change, whether or not any seat's view changed, with
   * the host's own `meta.turnBoundary`, so the caller can arm a timed step's
   * window (#302).
   */
  observeChange?: (meta: PublishMeta) => void;
  /**
   * Post a `game_state` frame for one seat's iframe. Called only for a seat
   * whose view changed since it was last posted (#487); the caller decides
   * which seat's iframe actually exists.
   */
  postGameState: (
    seat: number,
    view: unknown,
    meta: PublishMeta,
  ) => void;
  /** Post a `server_response` frame to the requesting seat's iframe. */
  postServerResponse: (
    seat: number,
    requestId: string | null,
    result: Record<string, unknown>,
  ) => void;
}

export interface DevSession {
  readonly host: SnapshotSessionHost;
  /** Run the opening `start` op (and any opening bot turns). */
  start(): Promise<void>;
  /**
   * Dispatch a `server_request` from a seat's iframe: translate the wire op to
   * the host Op, run it (which broadcasts state mutations before returning), and
   * post the shaped `server_response` back to that seat.
   */
  handleServerRequest(
    seat: number,
    requestId: string | null,
    wireOp: string,
    payload: Record<string, unknown>,
  ): Promise<void>;
  /** The most recent per-seat view (for replaying state to a (re)loaded iframe). */
  viewForSeat(seat: number): unknown;
  /** Current terminal state for init/replay. */
  meta(): { isComplete: boolean; winners: number[]; isDraw: boolean };
  /**
   * F-12: tear down this session (abort its demo loop, stop all broadcasts) so a
   * restarted-away game cannot keep broadcasting stale frames.
   */
  dispose(): void;
}

/** Translate a wire op + payload into the host's `Op` union (mirrors the DO). */
/**
 * Host-lifecycle marker for `debug:logs` (ERR-04) — deliberately NOT a member
 * of the session layer's `Op` union (session-layer types stay clean; T-126-10).
 * `handleServerRequest` intercepts this marker before it would ever reach
 * `host.handleOp`/`executeOp`.
 */
export interface DebugLogsMarker {
  type: 'debugLogs';
}

/**
 * The boundary key the CLIENT sent, forwarded verbatim.
 *
 * This carries a HUMAN's intent across a wire, so it is never defaulted, never
 * repaired, and never replaced with the host's current key — that would restore
 * the exact defect the token exists to close
 * (docs/simultaneous-and-interrupt-semantics.md §4). A client that sends no key
 * (or a malformed one) forwards a value that cannot equal the current key, and
 * the engine refuses it. Fail-closed, by construction.
 */
function clientBoundaryKey(payload: Record<string, unknown>): string {
  return payload.boundaryKey as string;
}

export function translateOp(
  wireOp: string,
  seat: number,
  payload: Record<string, unknown>,
): Op | DebugLogsMarker | undefined {
  switch (wireOp) {
    case 'action':
      return {
        type: 'action',
        actionName: payload.actionName as string,
        player: seat,
        args: (payload.args as Record<string, unknown>) ?? {},
        boundaryKey: clientBoundaryKey(payload),
      };
    case 'resolve_choices':
      return {
        type: 'resolveChoices',
        actionName: payload.actionName as string,
        player: seat,
        selectionName: payload.selectionName as string,
        args: (payload.args as Record<string, unknown>) ?? {},
      };
    case 'selection_step':
      return {
        type: 'selectionStep',
        player: seat,
        selectionName: payload.selectionName as string,
        value: payload.value,
        actionName: payload.actionName as string | undefined,
        initialArgs: payload.initialArgs as Record<string, unknown> | undefined,
        boundaryKey: clientBoundaryKey(payload),
      };
    case 'cancel_action':
      return { type: 'cancelAction', player: seat };
    case 'undo':
      return { type: 'undo', player: seat };
    case 'start-tutorial':
      return { type: 'startTutorial', player: seat };
    case 'exit-tutorial':
      return { type: 'exitTutorial', player: seat };
    // Hints and the heatmap are for the asking seat: a payload never names
    // the seat, so no seat can ask for another's suggestions.
    case 'hint':
      return { type: 'hint', seat };
    case 'heatmap-toggle':
      return { type: 'heatmapToggle', seat, visible: payload.visible as boolean };
    case 'demo-start':
      return { type: 'demoStart', delay: payload.delay as number | undefined };
    case 'demo-stop':
      return { type: 'demoStop' };
    case 'demo-control':
      return {
        type: 'demoControl',
        control: payload.control as 'pause' | 'play' | 'step' | 'back',
        delay: payload.delay as number | undefined,
      };
    case 'debug:history':
      return { type: 'debugHistory' };
    // The seat-view debug ops always report the connection's own seat (#481):
    // a payload never names the seat, so no seat can ask for another's view.
    case 'debug:state-at':
      return { type: 'debugStateAt', actionIndex: payload.actionIndex as number, player: seat };
    case 'debug:state-diff':
      return {
        type: 'debugStateDiff',
        fromIndex: payload.fromIndex as number,
        toIndex: payload.toIndex as number,
        player: seat,
      };
    case 'debug:action-traces':
      return { type: 'debugActionTraces', player: seat };
    case 'debug:flow-state':
      return { type: 'debugFlowState', player: seat };
    case 'debug:rewind':
      return { type: 'debugRewind', actionIndex: payload.actionIndex as number };
    case 'debug:move-to-top':
      return { type: 'debugReorder', cardId: payload.cardId as number, targetIndex: 0 };
    case 'debug:reorder-card':
      return {
        type: 'debugReorder',
        cardId: payload.cardId as number,
        targetIndex: payload.targetIndex as number,
      };
    case 'debug:transfer-card':
      return {
        type: 'debugTransfer',
        cardId: payload.cardId as number,
        targetDeckId: payload.targetDeckId as number,
        position: (payload.position as 'first' | 'last') ?? 'first',
      };
    case 'debug:shuffle-deck':
      return { type: 'debugShuffle', deckId: payload.deckId as number };
    case 'debug:logs':
      // Host-lifecycle marker (ERR-04) — resolved directly in
      // handleServerRequest by reading the ring buffer; never delegated to
      // host.handleOp/executeOp (RESEARCH Pitfall 3).
      return { type: 'debugLogs' };
    default:
      return undefined;
  }
}

/** A shaped reply: what the one seat that sent the op is told. */
type Reply = Record<string, unknown>;

/** The reply to a refused op: why, and nothing else. */
function refusal(result: OpFailure): Reply {
  return { success: false, error: result.error, errorCode: result.errorCode };
}

/**
 * Ops whose results reach the client through `game_state` broadcasts, never
 * through the reply (teaching, demo and edit ops): the reply says only whether
 * the op ran (RESEARCH Pitfall 7).
 */
function outcomeOnly(result: { success: boolean; error?: string }): Reply {
  return { success: result.success, error: result.error };
}

/**
 * How each op's result becomes the reply the embedded controller expects
 * (mirrors the DO's per-op `serverX` handlers). One entry per op type, each
 * handed that op's own result type, and every entry is an allowlist: the reply
 * goes to the one seat that asked, and a state-changing op's result carries
 * every seat's view and the unredacted snapshot.
 */
const SHAPERS: { [T in Op['type']]: (result: OpResultFor<T>) => Reply } = {
  start: outcomeOnly,
  action: (r) =>
    r.success
      ? {
          success: true,
          followUp: r.followUp,
          // The acting seat's return value from execute() (BUG-017/BUG-012).
          data: r.data,
          message: r.message,
        }
      : refusal(r),
  expireSeat: outcomeOnly,
  // The pick's answer and nothing else (#450).
  resolveChoices: (r) =>
    r.success
      ? {
          success: true,
          choices: r.choices,
          validElements: r.validElements,
          multiSelect: r.multiSelect,
          orderedList: r.orderedList,
          warnings: r.warnings,
        }
      : refusal(r),
  selectionStep: (r) =>
    r.success
      ? {
          success: true,
          done: r.done,
          nextChoices: r.nextChoices,
          actionComplete: r.actionComplete,
          followUp: r.followUp,
          warnings: r.warnings,
          // Present only on the step that completes the action (BUG-017/BUG-012).
          data: r.data,
          message: r.message,
        }
      : refusal(r),
  cancelAction: outcomeOnly,
  undo: outcomeOnly,
  botTurn: outcomeOnly,
  startTutorial: outcomeOnly,
  exitTutorial: outcomeOnly,
  hint: outcomeOnly,
  heatmapToggle: outcomeOnly,
  botSuggest: outcomeOnly,
  demoStart: outcomeOnly,
  demoStop: outcomeOnly,
  demoControl: outcomeOnly,
  convertSeatToBot: outcomeOnly,
  restoreEarlier: outcomeOnly,
  debugHistory: (r) => (r.success ? { success: true, actionHistory: r.actionHistory } : refusal(r)),
  // DebugPanel reads `data.state`; the op carries it as `historicalState`.
  debugStateAt: (r) => (r.success ? { success: true, state: r.historicalState } : refusal(r)),
  debugStateDiff: (r) => (r.success ? { success: true, diff: r.diff } : refusal(r)),
  debugActionTraces: (r) =>
    r.success ? { success: true, traces: r.traces, flowContext: r.flowContext } : refusal(r),
  debugFlowState: (r) =>
    r.success
      ? { success: true, flowDebugInfo: r.flowDebugInfo, pendingAction: r.pendingAction }
      : refusal(r),
  debugRewind: outcomeOnly,
  debugReorder: outcomeOnly,
  debugTransfer: outcomeOnly,
  debugShuffle: outcomeOnly,
};

/** Shape a `type` op's result into the reply its seat is sent. */
export function shapeResult<T extends Op['type']>(type: T, result: OpResultFor<T>): Reply {
  const shape: (result: OpResultFor<T>) => Reply = SHAPERS[type];
  return shape(result);
}

/**
 * Build the in-process dev session: a `SnapshotSessionHost` whose broadcast
 * adapter posts `game_state` to the iframes, plus the `server_request` handler
 * that runs ops and posts shaped `server_response`s. The broadcast adapter fires
 * synchronously inside `host.handleOp` (before it resolves), so the response is
 * always posted AFTER the corresponding `game_state` — matching prod ordering.
 */
export function createDevSession(opts: DevSessionOptions): DevSession {
  let lastPlayerViews: unknown[] | null = null;
  let isComplete = false;
  let winners: number[] = [];
  let isDraw = false;

  const host = new SnapshotSessionHost({
    playerCount: opts.playerCount,
    teachingDisabled: opts.teachingDisabled,
    // A getter, so the host asks on every op (see `DevSessionOptions.debug`).
    get debug() {
      return opts.debug();
    },
    executeOp: opts.executeOp,
    persist: opts.persist,
    hostWork: opts.hostWork,
    // ERR-04: persistence failures feed the dev-host log-capture ring buffer.
    // Severity escalates to 'error' once persistenceHealthy flips false;
    // otherwise 'warning'. The session layer only ever calls this injected
    // callback — it never imports log-capture.ts itself (T-126-10).
    onPersistenceError: (entry, _consecutiveFailures, healthy) => {
      record(healthy ? 'warning' : 'error', entry.message, 'persistence');
    },
    record: (views, meta) => {
      lastPlayerViews = views.players;
      isComplete = meta.isComplete;
      winners = meta.winners;
      isDraw = meta.isDraw;
      opts.observeChange?.(meta);
    },
    push: (changed, meta) => {
      // The dev host has no spectators: seat 0 has no iframe to post to.
      for (const { seat, view } of changed) if (seat > 0) opts.postGameState(seat, view, meta);
    },
  });

  host.setBotSeats(opts.botSeats ?? []);

  async function handleServerRequest(
    seat: number,
    requestId: string | null,
    wireOp: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const op = translateOp(wireOp, seat, payload);
    if (!op) {
      opts.postServerResponse(seat, requestId, {
        success: false,
        error: `Unknown server op: '${wireOp}'`,
      });
      return;
    }
    // debug:logs (ERR-04): host-lifecycle op resolved directly here, reading
    // the ring buffer — never delegated to host.handleOp/executeOp.
    if (op.type === 'debugLogs') {
      if (!opts.debug()) {
        opts.postServerResponse(seat, requestId, { success: false, error: debuggingOffMessage(wireOp) });
        return;
      }
      opts.postServerResponse(seat, requestId, { success: true, entries: getEntries() });
      return;
    }
    try {
      const result = await host.handleOp(seat, op);
      // Dual-channel warnings capture (ERR-04): a pick's structured warnings
      // (Plan 126-03) also feed the debug:logs ring buffer, sourced by wireOp,
      // in addition to riding the reply itself.
      for (const w of warningsOf(result)) record('warning', w.message, wireOp);
      opts.postServerResponse(seat, requestId, shapeResult(op.type, result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The message, which is already extracted above for the ring buffer and
      // the response: the error object printed its stack too (#240).
      console.error(`[boardsmith dev] server_request '${wireOp}' failed:`, message);
      record('error', message, wireOp);
      opts.postServerResponse(seat, requestId, { success: false, error: message });
    }
  }

  return {
    host,
    start: () => host.start(),
    handleServerRequest,
    viewForSeat: (seat: number) => lastPlayerViews?.[seat - 1],
    meta: () => ({ isComplete, winners, isDraw }),
    dispose: () => host.dispose(),
  };
}
