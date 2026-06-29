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

/** Wire op names the embedded GameShell sends (snake_case, prod payload shapes). */
export type WireOp =
  | 'action'
  | 'resolve_choices'
  | 'selection_step'
  | 'cancel_action'
  | 'undo'
  | 'start-tutorial'
  // Teaching wire ops — hint/heatmap-toggle request AI suggestions;
  // results flow back via game_state broadcasts (not via the op response).
  | 'hint'
  | 'heatmap-toggle'
  // Debug-panel wire ops (dev only). `debug:restart` / `debug:switch-seat` are
  // host-chrome ops handled in DevHost, not here.
  | 'debug:history'
  | 'debug:state-at'
  | 'debug:state-diff'
  | 'debug:action-traces'
  | 'debug:rewind'
  | 'debug:move-to-top'
  | 'debug:reorder-card'
  | 'debug:transfer-card'
  | 'debug:shuffle-deck';

export interface DevSessionOptions {
  playerCount: number;
  /** AI seats (1-indexed) with optional per-seat difficulty. */
  aiSeats?: Array<{ seat: number; level?: string }>;
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
export function translateOp(
  wireOp: string,
  seat: number,
  payload: Record<string, unknown>,
): Op | undefined {
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
    case 'hint':
      return { type: 'hint', seat: (payload.seat as number) ?? seat };
    case 'heatmap-toggle':
      return { type: 'heatmapToggle', seat: (payload.seat as number) ?? seat, visible: payload.visible as boolean };
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
    default:
      return undefined;
  }
}

/**
 * Shape an OpResult into the response envelope the embedded controller expects
 * for a given wire op (mirrors the DO's per-op `serverX` handlers). Read-only
 * `resolve_choices` returns the full result (choices/validElements/multiSelect).
 */
export function shapeResult(wireOp: string, result: OpResult): Record<string, unknown> {
  switch (wireOp) {
    case 'action':
      return { success: result.success, error: result.error, followUp: result.followUp };
    case 'resolve_choices':
      return result as unknown as Record<string, unknown>;
    case 'selection_step':
      if (!result.success) return { success: false, error: result.error };
      return {
        success: true,
        done: result.done,
        nextChoices: result.nextChoices,
        actionComplete: result.actionComplete,
        followUp: result.followUp,
      };
    case 'cancel_action':
    case 'undo':
    case 'start-tutorial':
    case 'hint':
    case 'heatmap-toggle':
      // Teaching ops: results flow via game_state broadcasts (never via op response).
      // Return only {success, error} — the client reads state.hint/state.heatmap
      // from the broadcast, not from this response (RESEARCH Pitfall 7).
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
    case 'debug:rewind':
    case 'debug:move-to-top':
    case 'debug:reorder-card':
    case 'debug:transfer-card':
    case 'debug:shuffle-deck':
      return { success: result.success, error: result.error };
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
    executeOp: opts.executeOp,
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
    try {
      const result = await host.handleOp(seat, op);
      opts.postServerResponse(seat, requestId, shapeResult(wireOp, result));
    } catch (err) {
      console.error(`[boardsmith dev] server_request '${wireOp}' failed:`, err);
      opts.postServerResponse(seat, requestId, {
        success: false,
        error: 'Operation failed',
      });
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
