/**
 * The teaching controls, testable at last (#41).
 *
 * This dispatch lived inside GameShell.vue amongst WebSocket bridging,
 * clipboard, localStorage, lobby joining and platform-mode postMessage, so
 * none of it could be exercised without standing up the whole shell — the
 * project's own signal that the design was wrong. Everything it needs is now
 * passed in, so these are ordinary unit tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { useTeachingActions, type TeachingActionsOptions } from './useTeachingActions.js';
import { ErrorCode } from '../../types/protocol.js';

function harness(overrides: Partial<TeachingActionsOptions> = {}) {
  const platformRequest = vi.fn().mockResolvedValue({ success: true });
  const errors: string[] = [];
  const shown: string[] = [];
  const removed: number[] = [];

  const options: TeachingActionsOptions = {
    platformRequest,
    playerSeat: ref(2),
    isDemoRunning: ref(false),
    isHeatmapVisible: () => false,
    heatmapPending: ref(null),
    heatmapToggling: ref(false),
    toast: {
      // The REAL `useToast` shape, now that the option is typed from it:
      // `show` and `error` both answer the new toast's numeric id.
      show: (text) => { shown.push(text); return 1; },
      error: (text) => { errors.push(text); return 2; },
      remove: (id) => { removed.push(id); },
    },
    ...overrides,
  };

  return { ...useTeachingActions(options), options, platformRequest, errors, shown, removed };
}

describe('hint', () => {
  it('asks the host for a hint for the viewing seat', async () => {
    const h = harness();
    await h.handleTeachingAction('hint');
    expect(h.platformRequest).toHaveBeenCalledWith('hint', { seat: 2 });
  });

  it('shows a thinking toast and always clears it', async () => {
    const h = harness();
    await h.handleTeachingAction('hint');
    expect(h.shown[0]).toMatch(/thinking/i);
    expect(h.removed).toEqual([1]);
  });

  it('clears the thinking toast even when the host refuses', async () => {
    const h = harness({ platformRequest: vi.fn().mockResolvedValue({ success: false }) });
    await h.handleTeachingAction('hint');
    expect(h.removed).toEqual([1]);
    expect(h.errors[0]).toMatch(/hint unavailable/i);
  });
});

describe('demo toggle', () => {
  it('starts the demo when none is running', async () => {
    const h = harness({ isDemoRunning: ref(false) });
    await h.handleTeachingAction('demo-toggle');
    expect(h.platformRequest).toHaveBeenCalledWith('demo-start', {});
  });

  it('stops it when one is', async () => {
    const h = harness({ isDemoRunning: ref(true) });
    await h.handleTeachingAction('demo-toggle');
    expect(h.platformRequest).toHaveBeenCalledWith('demo-stop', {});
  });

  it('says which direction failed', async () => {
    const h = harness({
      isDemoRunning: ref(true),
      platformRequest: vi.fn().mockResolvedValue({ success: false }),
    });
    await h.handleTeachingAction('demo-toggle');
    expect(h.errors[0]).toMatch(/stop demo/i);
  });
});

describe('heatmap toggle', () => {
  it('asks for the opposite of what is showing', async () => {
    const h = harness({ isHeatmapVisible: () => false });
    await h.handleTeachingAction('heatmap-toggle');
    expect(h.platformRequest).toHaveBeenCalledWith('heatmap-toggle', { seat: 2, visible: true });
  });

  it('flips the pill optimistically, then hands back to the server state', async () => {
    const heatmapPending = ref<boolean | null>(null);
    let pendingDuringRequest: boolean | null = null;
    const h = harness({
      heatmapPending,
      platformRequest: vi.fn().mockImplementation(async () => {
        pendingDuringRequest = heatmapPending.value;
        return { success: true };
      }),
    });

    await h.handleTeachingAction('heatmap-toggle');
    expect(pendingDuringRequest).toBe(true);
    // Cleared afterwards so the authoritative broadcast wins, with no flicker.
    expect(heatmapPending.value).toBeNull();
  });

  it('ignores a second toggle while one is in flight', async () => {
    const h = harness({ heatmapToggling: ref(true) });
    await h.handleTeachingAction('heatmap-toggle');
    // Rapid clicks used to race on the stale broadcast and land wrong.
    expect(h.platformRequest).not.toHaveBeenCalled();
  });

  it('clears the in-flight flag even when the host refuses', async () => {
    const heatmapToggling = ref(false);
    const heatmapPending = ref<boolean | null>(null);
    const h = harness({
      heatmapToggling,
      heatmapPending,
      platformRequest: vi.fn().mockResolvedValue({ success: false }),
    });
    await h.handleTeachingAction('heatmap-toggle');
    expect(heatmapToggling.value).toBe(false);
    expect(heatmapPending.value).toBeNull();
    expect(h.errors[0]).toMatch(/move quality/i);
  });
});

describe('tutorial', () => {
  it.each([
    ['start-tutorial', 'start-tutorial', /start tutorial/i],
    ['exit-tutorial', 'exit-tutorial', /exit tutorial/i],
  ] as const)('%s asks the host and names its own failure', async (action, op, failure) => {
    const ok = harness();
    await ok.handleTeachingAction(action);
    expect(ok.platformRequest).toHaveBeenCalledWith(op, { seat: 2 });

    const bad = harness({ platformRequest: vi.fn().mockResolvedValue({ success: false }) });
    await bad.handleTeachingAction(action);
    expect(bad.errors[0]).toMatch(failure);
  });
});

describe('every control', () => {
  it.each([
    'hint', 'demo-toggle', 'heatmap-toggle', 'start-tutorial', 'exit-tutorial',
  ] as const)('%s never throws, whatever the host does', async (action) => {
    const h = harness({ platformRequest: vi.fn().mockResolvedValue({ success: false, error: 'The table did not answer in time. Try again.' }) });
    await expect(h.handleTeachingAction(action)).resolves.toBeUndefined();
  });
});

describe('a refusal the host resolves (#859)', () => {
  // The transport never rejects: a refused op RESOLVES `{ success: false, error }`.
  it('shows the host\'s own reason', async () => {
    const h = harness({
      platformRequest: vi.fn().mockResolvedValue({ success: false, error: 'Cannot hint: seat 2 is not awaiting input' }),
    });
    await h.handleTeachingAction('hint');
    expect(h.errors).toEqual(['Cannot hint: seat 2 is not awaiting input']);
    expect(h.removed).toEqual([1]);
  });

  it.each([
    ['hint', 'This table does not support hints.'],
    ['demo-toggle', 'This table does not support the bot demo.'],
    ['heatmap-toggle', 'This table does not support the move quality display.'],
    ['start-tutorial', 'This table does not support tutorials.'],
    ['exit-tutorial', 'This table does not support tutorials.'],
  ] as const)('%s on a host without the op says the table does not support it', async (action, text) => {
    const h = harness({
      platformRequest: vi.fn().mockImplementation(async (op: string) => ({ success: false, error: `Unknown server op: '${op}'`, errorCode: ErrorCode.UNKNOWN_OP })),
    });
    await h.handleTeachingAction(action);
    expect(h.errors).toEqual([text]);
  });

  it('says nothing when the host accepts', async () => {
    const h = harness();
    await h.handleTeachingAction('start-tutorial');
    expect(h.errors).toEqual([]);
  });
});
