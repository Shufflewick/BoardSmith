/**
 * GameShell devtools bridge helper (DEV-02).
 *
 * GameShell puts a reader on its own (iframe) window, and the dev host calls it
 * when `window.__BOARDSMITH_DEVTOOLS` is read, so nothing is built per push (#960).
 * The dev host serves the iframe from its own origin, so it can call the reader.
 *
 * SECURITY: these helpers are only called inside an `if (isDevBuild)` block in
 * GameShell.vue, so production builds dead-code-eliminate this entire module.
 */

import type { BoardTarget } from '../composables/useBoardInteraction.js';
import type { SerializedFlowDebugInfo, SerializedPendingActionState } from '../../session/types.js';

// ---------------------------------------------------------------------------
// Snapshot shape
// ---------------------------------------------------------------------------

export interface DevtoolsSnapshot {
  seat: number;
  state: unknown | null;
  availableActions: string[];
  actionMetadata: Record<string, unknown> | undefined;
  boardInteraction: {
    activeAction: string | null;
    currentSelectionStep: number;
    /** IDs of currently-valid, non-disabled elements */
    validElements: number[];
  };
  /** Serialized flow-position snapshot (FLOW-01), sourced from the received broadcast state. */
  flowDebugInfo: SerializedFlowDebugInfo | undefined;
  /** This seat's own pending multi-step action snapshot (FLOW-03), sourced from the received broadcast state. */
  pendingAction: SerializedPendingActionState | undefined;
}

// ---------------------------------------------------------------------------
// Payload builder (pure function — no side-effects)
// ---------------------------------------------------------------------------

export interface DevtoolsParams {
  seat: number;
  state: unknown | null;
  availableActions: string[];
  actionMetadata: Record<string, unknown> | undefined;
  boardInteraction: {
    currentAction: string | null;
    currentPickIndex: number;
    validElements: BoardTarget[];
  };
  /** Serialized flow-position snapshot (FLOW-01), forwarded from the received broadcast state. */
  flowDebugInfo: SerializedFlowDebugInfo | undefined;
  /** This seat's own pending multi-step action snapshot (FLOW-03), forwarded from the received broadcast state. */
  pendingAction: SerializedPendingActionState | undefined;
}

/**
 * Build the devtools snapshot from current reactive state values.
 * validElements are filtered to exclude disabled entries and mapped to id-only
 * numbers, matching the BoardsmithDevtools.getBoardInteractionState() shape.
 */
export function buildDevtoolsPayload(params: DevtoolsParams): DevtoolsSnapshot {
  return {
    seat: params.seat,
    state: params.state,
    availableActions: params.availableActions,
    actionMetadata: params.actionMetadata,
    boardInteraction: {
      activeAction: params.boardInteraction.currentAction,
      currentSelectionStep: params.boardInteraction.currentPickIndex,
      validElements: params.boardInteraction.validElements
        .filter(v => !v.disabled)
        .map(v => v.id),
    },
    flowDebugInfo: params.flowDebugInfo,
    pendingAction: params.pendingAction,
  };
}

// ---------------------------------------------------------------------------
// The reader on the game window, and the dev host's read of it
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    /** Set by a dev-build GameShell in a host; read by the dev host (#960). */
    __boardsmithDevtoolsSnapshot?: () => DevtoolsSnapshot;
  }
}

/** Put the snapshot reader on the game's window. Returns the function that takes it off. */
export function exposeDevtoolsSnapshot(win: Window, read: () => DevtoolsParams): () => void {
  win.__boardsmithDevtoolsSnapshot = () => buildDevtoolsPayload(read());
  return () => { delete win.__boardsmithDevtoolsSnapshot; };
}

/** The current snapshot of the game in `win`, or null when no shell is mounted there. */
export function readDevtoolsSnapshot(win: Window | null | undefined): DevtoolsSnapshot | null {
  return win?.__boardsmithDevtoolsSnapshot?.() ?? null;
}
