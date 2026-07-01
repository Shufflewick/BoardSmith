/**
 * GameShell devtools bridge helper (DEV-02).
 *
 * Extracted from GameShell.vue so the payload-building and guard logic can be
 * unit-tested without mounting the full component.
 *
 * SECURITY: these helpers are only called inside an `if (isDevBuild)` block in
 * GameShell.vue, so production builds dead-code-eliminate this entire module.
 */

import type { ValidElement } from '../composables/useBoardInteraction.js';

// ---------------------------------------------------------------------------
// Message shape
// ---------------------------------------------------------------------------

export interface DevtoolsStateMessage {
  source: 'shufflewick-game';
  type: 'boardsmith:devtools-state-update';
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
    validElements: ValidElement[];
  };
}

/**
 * Build the devtools postMessage payload from current reactive state values.
 * validElements are filtered to exclude disabled entries and mapped to id-only
 * numbers, matching the BoardsmithDevtools.getBoardInteractionState() shape.
 */
export function buildDevtoolsPayload(params: DevtoolsParams): DevtoolsStateMessage {
  return {
    source: 'shufflewick-game',
    type: 'boardsmith:devtools-state-update',
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
  };
}

// ---------------------------------------------------------------------------
// Guard + post (used by GameShell watcher; injectable for testing)
// ---------------------------------------------------------------------------

/**
 * Build and post the devtools state update message to window.parent, if and
 * only if both `isDevBuild` and `platformMode` are true.
 *
 * The `postMessage` parameter defaults to `window.parent.postMessage` and is
 * injectable so tests can spy on calls without touching the real DOM.
 */
export function maybePostDevtoolsUpdate(
  guard: { isDevBuild: boolean; platformMode: boolean },
  params: DevtoolsParams,
  postMessage: (message: unknown, targetOrigin: string) => void = (msg, origin) =>
    window.parent.postMessage(msg, origin),
): void {
  if (!guard.isDevBuild || !guard.platformMode) return;
  postMessage(buildDevtoolsPayload(params), '*');
}
