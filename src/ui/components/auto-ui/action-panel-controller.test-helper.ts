/**
 * THE STUB CONTROLLER EVERY ACTION PANEL COMPONENT TEST MOUNTS OVER.
 *
 * `ActionPanel` injects the action controller and reads it during its first
 * render, so a test that mounts the component has to hand it one whether the
 * controller is what it is testing or not. Four test files had each written
 * that object out, and they had drifted into four slightly different answers to
 * the same question.
 *
 * They are one answer now, because the cost of four was measured: #235 added
 * two fields to the controller and every one of the four went red until all
 * four were edited, which is the maintenance trap this repo's own duplication
 * gate exists to report. Every verb is a `vi.fn()` so a test may assert what
 * the panel did or did not call without rebuilding the object, and `overrides`
 * is how a test says the one thing it actually cares about.
 *
 * It is deliberately NOT a real controller: `action-panel-editor.test-helper.ts`
 * mounts over a real one for the tests whose subject is the controller's own
 * behaviour. This is for the tests whose subject is the markup.
 */
import { vi } from 'vitest';
import { ref } from 'vue';

/**
 * A controller-shaped object with every member the panel reads on render.
 *
 * @param overrides - members to replace, e.g. `{ currentAction: ref('move') }`
 */
export function makeStubController(overrides: Record<string, unknown> = {}) {
  return {
    currentAction: ref<string | null>(null),
    isExecuting: ref(false),
    isLoadingChoices: ref(false),
    actionSnapshot: ref(null),
    animationsPending: ref(false),
    showActionPanel: ref(true),
    repeatingState: ref(null),
    currentArgs: ref<Record<string, unknown>>({}),
    currentPick: ref(null),
    currentChoices: ref([]),

    // The in-progress state the panel shares with a custom UI rather than
    // holding itself: the multiSelect draft, the typed editor draft and the open
    // menu level. The last two are here because a collapse unmounts the panel
    // (#235), so a ref inside it could not survive one.
    multiSelectDraft: ref(null),
    currentPickDraft: ref(null),
    setPickDraft: vi.fn(),
    actionMenuPath: ref<readonly string[]>([]),

    getCurrentChoices: vi.fn(() => [] as unknown[]),
    getValidElements: vi.fn(() => [] as unknown[]),
    getCollectedPick: vi.fn(() => null),
    isMultiSelectSelected: vi.fn(() => false),

    start: vi.fn(async () => { }),
    fill: vi.fn(async () => ({ valid: true })),
    skip: vi.fn(),
    cancel: vi.fn(),
    clear: vi.fn(),
    execute: vi.fn(async () => ({ success: true })),
    toggleMultiSelect: vi.fn(async () => { }),
    confirmMultiSelect: vi.fn(async () => { }),

    ...overrides,
  };
}
