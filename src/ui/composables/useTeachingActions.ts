/**
 * The teaching controls' dispatch — hint, demo, heatmap, help, tutorial (#41).
 *
 * This lived inside `GameShell.vue` as a six-branch `if/else` amongst WebSocket
 * bridging, clipboard, localStorage, lobby joining and platform-mode
 * postMessage. Every branch is the same shape — call a host op, say something
 * useful if it fails — and none of it could be exercised without standing up
 * the whole shell, which is the project's own signal that the design was wrong.
 *
 * Everything it needs is passed in, so a test supplies six functions and reads
 * what came back.
 *
 * @module
 */
import type { Ref } from 'vue';
import type { useToast } from './useToast.js';

/** Which control the player pressed. */
type TeachingAction =
  | 'hint'
  | 'demo-toggle'
  | 'heatmap-toggle'
  | 'help-toggle'
  | 'start-tutorial'
  | 'exit-tutorial';

export interface TeachingActionsOptions {
  /** Issue a host op. Rejects when the host refuses or the request fails. */
  platformRequest: (op: string, payload: Record<string, unknown>) => Promise<unknown>;
  /** The viewing seat. */
  playerSeat: Ref<number>;
  /** Whether the bot-vs-bot demo is running, per the last broadcast. */
  isDemoRunning: Ref<boolean>;
  /** Whether the heatmap is showing, per the last broadcast. */
  isHeatmapVisible: () => boolean;
  /** Optimistic heatmap state, so the pill flips before the round-trip lands. */
  heatmapPending: Ref<boolean | null>;
  /** True while a heatmap toggle is in flight. */
  heatmapToggling: Ref<boolean>;
  /** Whether per-action help is showing. A pure client preference. */
  isActionHelpVisible: Ref<boolean>;
  /** Persist the help preference. */
  setActionHelpEnabled: (enabled: boolean) => void;
  /**
   * Show a message to the player. `duration: 0` means "until removed".
   *
   * TAKEN FROM `useToast` RATHER THAN RESTATED. It was restated once, and the
   * copy drifted: it widened `type` to `string`, made both options required and
   * let `remove` take a string, none of which the real toast accepts. Every
   * game in the catalogue then failed `boardsmith validate`'s TypeScript pass
   * on `GameShell.vue` handing the real thing to this parameter, which meant
   * nothing could be published at all.
   */
  toast: Pick<ReturnType<typeof useToast>, 'show' | 'error' | 'remove'>;
}

interface TeachingActionsReturn {
  /** Run one teaching control. Never throws — a failure becomes a message. */
  handleTeachingAction: (action: TeachingAction) => Promise<void>;
}

/**
 * Wire the teaching controls to their host ops.
 *
 * Each control delegates to a `platformRequest` op so the dev bridge and the
 * production host can implement the server side; `help-toggle` is the one
 * exception, being a pure client display preference with no round-trip.
 */
export function useTeachingActions(options: TeachingActionsOptions): TeachingActionsReturn {
  const {
    platformRequest,
    playerSeat,
    isDemoRunning,
    isHeatmapVisible,
    heatmapPending,
    heatmapToggling,
    isActionHelpVisible,
    setActionHelpEnabled,
    toast,
  } = options;

  /** Call a host op, and say something useful if it refuses. */
  async function request(op: string, payload: Record<string, unknown>, failure: string): Promise<void> {
    try {
      await platformRequest(op, payload);
    } catch {
      toast.error(failure);
    }
  }

  async function hint(): Promise<void> {
    // The MCTS search takes ~1s; show a persistent "thinking" toast so the
    // player gets immediate feedback instead of a dead button. Cleared as soon
    // as the hint resolves (or fails), just before the bubble/ring appears.
    const thinkingId = toast.show('Thinking about the best move…', { type: 'info', duration: 0 });
    try {
      await request('hint', { seat: playerSeat.value }, 'Hint unavailable — the bot could not suggest a move.');
    } finally {
      toast.remove(thinkingId);
    }
  }

  async function demoToggle(): Promise<void> {
    if (isDemoRunning.value) {
      // isDemoRunning updates from the next broadcast — no local mutation needed.
      await request('demo-stop', {}, 'Failed to stop demo.');
    } else {
      await request('demo-start', {}, 'Failed to start demo.');
    }
  }

  async function heatmapToggle(): Promise<void> {
    // Ignore a second toggle while one is still computing — otherwise rapid
    // clicks race on the stale broadcast state and the toggle ends up wrong.
    if (heatmapToggling.value) return;
    const nextVisible = !isHeatmapVisible();
    heatmapPending.value = nextVisible; // optimistic: flip the pill immediately
    heatmapToggling.value = true;
    try {
      await request(
        'heatmap-toggle',
        { seat: playerSeat.value, visible: nextVisible },
        'Failed to toggle move quality display.',
      );
    } finally {
      // The broadcast carrying the new heatmap state is delivered before the op
      // response resolves (WS order), so clearing the optimistic value here hands
      // back to the authoritative server state with no flicker.
      heatmapToggling.value = false;
      heatmapPending.value = null;
    }
  }

  function helpToggle(): void {
    // Pure client display preference — no server round-trip.
    isActionHelpVisible.value = !isActionHelpVisible.value;
    setActionHelpEnabled(isActionHelpVisible.value);
  }

  async function handleTeachingAction(action: TeachingAction): Promise<void> {
    switch (action) {
      case 'hint':
        return hint();
      case 'demo-toggle':
        return demoToggle();
      case 'heatmap-toggle':
        return heatmapToggle();
      case 'help-toggle':
        return helpToggle();
      case 'start-tutorial':
        return request('start-tutorial', { seat: playerSeat.value }, 'Failed to start tutorial.');
      case 'exit-tutorial':
        return request('exit-tutorial', { seat: playerSeat.value }, 'Failed to exit tutorial.');
    }
  }

  return { handleTeachingAction };
}
