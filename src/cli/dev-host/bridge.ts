/**
 * Dev host bridge — the in-process stand-in for ShufflewickPub's GameSession
 * Durable Object. It wires a boardsmith `SnapshotSessionHost` to the iframe
 * postMessage protocol the embedded GameShell speaks, so `boardsmith dev` drives
 * the game through the EXACT production path: game UI in an `<iframe>` (platform
 * mode) talking to a host that owns op execution, snapshot/pendingState
 * threading, broadcast-before-response ordering, and the AI pump.
 *
 * This module is deliberately DOM-free so it can be unit-tested by feeding fake
 * `server_request` messages and asserting the host is driven and the iframe is
 * posted to in production order (`game_state` broadcast THEN `server_response`).
 *
 * It is the single source of truth for the wire→Op translation and the per-op
 * result shaping, mirroring ShufflewickPub `games/src/game-session.ts` so dev and
 * prod stay in lockstep.
 */

import { SnapshotSessionHost, type Op, type OpResult } from '../../session/index.js';
import { record, getEntries, type LogEntry } from './log-capture.js';

/** Wire op names the embedded GameShell sends (snake_case, prod payload shapes). */
export type WireOp =
  | 'action'
  | 'resolve_choices'
  | 'selection_step'
  | 'cancel_action'
  | 'undo'
  | 'start-tutorial'
  | 'exit-tutorial'
  // Teaching wire ops — hint/heatmap-toggle request AI suggestions;
  // results flow back via game_state broadcasts (not via the op response).
  | 'hint'
  | 'heatmap-toggle'
  // Demo lifecycle wire ops — start/stop the AI-vs-AI narrated demo loop.
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
  /** AI seats (1-indexed) with optional per-seat difficulty. */
  aiSeats?: Array<{ seat: number; level?: string }>;
  /**
   * When true, teaching/assist features (hint, heatmap, demo, tutorial) are rejected
   * fail-loud for this session. Mirrors `--lock-teaching` in `boardsmith dev`.
   */
  teachingDisabled?: boolean;
  /**
   * In-process op executor bound to the author's gameDefinition. The host calls
   * this with the authoritative snapshot + the acting seat's pending state; the
   * dev host passes it straight to the pure `executeOp(def, gameOptions, …)`.
   */
  executeOp: (
    snapshot: unknown,
    pendingState: Record<string, unknown> | null,
    op: Op,
  ) => Promise<OpResult>;
  /**
   * Optional persistence adapter (ERR-03/ERR-04). When configured, a failure
   * is captured into the dev-host log-capture ring buffer via an
   * `onPersistenceError` adapter built in `createDevSession` — severity
   * escalates to 'error' once `persistenceHealthy` flips false. Unconfigured
   * by default (the dev host today has no persistence store).
   */
  persist?: (state: { snapshot: unknown; pendingStates: Record<string, Record<string, unknown>> }) => void | Promise<void>;
  /**
   * Post a `game_state` frame for one seat's iframe. Called for every seat on
   * each broadcast; the caller decides which seat's iframe actually exists.
   */
  postGameState: (
    seat: number,
    view: unknown,
    meta: { isComplete: boolean; winners: number[] },
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
  /** Run the opening `start` op (and any opening AI turns). */
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
  meta(): { isComplete: boolean; winners: number[] };
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
      };
    case 'cancel_action':
      return { type: 'cancelAction', player: seat };
    case 'undo':
      return { type: 'undo', player: seat };
    case 'start-tutorial':
      return { type: 'startTutorial', player: seat };
    case 'exit-tutorial':
      return { type: 'exitTutorial', player: seat };
    case 'hint':
      return { type: 'hint', seat: (payload.seat as number) ?? seat };
    case 'heatmap-toggle':
      return { type: 'heatmapToggle', seat: (payload.seat as number) ?? seat, visible: payload.visible as boolean };
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
    case 'debug:state-at':
      return {
        type: 'debugStateAt',
        actionIndex: payload.actionIndex as number,
        player: (payload.player as number) ?? seat,
      };
    case 'debug:state-diff':
      return {
        type: 'debugStateDiff',
        fromIndex: payload.fromIndex as number,
        toIndex: payload.toIndex as number,
        player: (payload.player as number) ?? seat,
      };
    case 'debug:action-traces':
      return { type: 'debugActionTraces', player: (payload.player as number) ?? seat };
    case 'debug:flow-state':
      // Always the connection's own seat — pendingAction data is seat-scoped
      // (T-123-10) and there is no legitimate use for a client-supplied
      // override here, unlike the other debug:* ops above (IN-01).
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

/**
 * Shape an OpResult into the response envelope the embedded controller expects
 * for a given wire op (mirrors the DO's per-op `serverX` handlers). Read-only
 * `resolve_choices` returns the full result (choices/validElements/multiSelect).
 */
export function shapeResult(
  wireOp: string,
  result: OpResult & { entries?: readonly LogEntry[] },
): Record<string, unknown> {
  switch (wireOp) {
    case 'action':
      return {
        success: result.success,
        error: result.error,
        errorCode: result.errorCode,
        followUp: result.followUp,
        warnings: result.warnings,
      };
    case 'resolve_choices':
      return result as unknown as Record<string, unknown>;
    case 'selection_step':
      if (!result.success) return { success: false, error: result.error, errorCode: result.errorCode };
      return {
        success: true,
        done: result.done,
        nextChoices: result.nextChoices,
        actionComplete: result.actionComplete,
        followUp: result.followUp,
        warnings: result.warnings,
      };
    case 'cancel_action':
    case 'undo':
    case 'start-tutorial':
    case 'exit-tutorial':
    case 'hint':
    case 'heatmap-toggle':
      // Teaching ops: results flow via game_state broadcasts (never via op response).
      // Return only {success, error} — the client reads state.hint/state.heatmap
      // from the broadcast, not from this response (RESEARCH Pitfall 7).
      return { success: result.success, error: result.error };
    case 'demo-start':
    case 'demo-stop':
    case 'demo-control':
      // Demo lifecycle ops: demo state flows via game_state broadcasts
      // (isDemoRunning, narration, demoPaused/demoDelay/canStepBack). Client never
      // reads playerViews from here. Return only {success, error} (RESEARCH Pitfall 7).
      return { success: result.success, error: result.error };
    case 'debug:history':
      return { success: result.success, error: result.error, actionHistory: result.actionHistory };
    case 'debug:state-at':
      // DebugPanel reads `data.state`; the op carries it as `historicalState`.
      return { success: result.success, error: result.error, state: result.historicalState };
    case 'debug:state-diff':
      return { success: result.success, error: result.error, diff: result.diff };
    case 'debug:action-traces':
      return {
        success: result.success,
        error: result.error,
        traces: result.traces,
        flowContext: result.flowContext,
      };
    case 'debug:flow-state':
      return {
        success: result.success,
        error: result.error,
        flowDebugInfo: result.flowDebugInfo,
        pendingAction: result.pendingAction,
      };
    case 'debug:rewind':
    case 'debug:move-to-top':
    case 'debug:reorder-card':
    case 'debug:transfer-card':
    case 'debug:shuffle-deck':
      return { success: result.success, error: result.error };
    case 'debug:logs':
      return { success: result.success, error: result.error, entries: result.entries };
    default:
      return { success: false, error: `Unknown server op: '${wireOp}'` };
  }
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

  const host = new SnapshotSessionHost({
    playerCount: opts.playerCount,
    aiSeats: opts.aiSeats,
    teachingDisabled: opts.teachingDisabled,
    executeOp: opts.executeOp,
    persist: opts.persist,
    // ERR-04: persistence failures feed the dev-host log-capture ring buffer.
    // Severity escalates to 'error' once persistenceHealthy flips false;
    // otherwise 'warning'. The session layer only ever calls this injected
    // callback — it never imports log-capture.ts itself (T-126-10).
    onPersistenceError: (entry, _consecutiveFailures, healthy) => {
      record(healthy ? 'warning' : 'error', entry.message, 'persistence');
    },
    broadcast: (playerViews, meta) => {
      lastPlayerViews = playerViews;
      isComplete = meta.isComplete;
      winners = meta.winners;
      for (let seat = 1; seat <= opts.playerCount; seat++) {
        opts.postGameState(seat, playerViews[seat - 1], meta);
      }
    },
  });

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
      const logsResult = { success: true, entries: getEntries() } as unknown as OpResult & {
        entries: readonly LogEntry[];
      };
      opts.postServerResponse(seat, requestId, shapeResult(wireOp, logsResult));
      return;
    }
    try {
      const result = await host.handleOp(seat, op);
      // Dual-channel warnings capture (ERR-04): structured OpResult.warnings
      // (Plan 126-03) also feed the debug:logs ring buffer, sourced by wireOp,
      // in addition to riding the op result itself (shapeResult passthrough).
      if (result.warnings?.length) {
        for (const w of result.warnings) record('warning', w.message, wireOp);
      }
      opts.postServerResponse(seat, requestId, shapeResult(wireOp, result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[boardsmith dev] server_request '${wireOp}' failed:`, err);
      record('error', message, wireOp);
      opts.postServerResponse(seat, requestId, { success: false, error: message });
    }
  }

  return {
    host,
    start: () => host.start(),
    handleServerRequest,
    viewForSeat: (seat: number) => lastPlayerViews?.[seat - 1],
    meta: () => ({ isComplete, winners }),
  };
}
