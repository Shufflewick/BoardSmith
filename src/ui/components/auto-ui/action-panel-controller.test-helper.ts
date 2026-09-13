/**
 * ONE STUB CONTROLLER FOR THE PANEL'S OWN TESTS.
 *
 * `ActionPanel` reads its controller out of provide/inject, so every test that
 * mounts the panel without a real `useActionController` has to hand it an
 * object carrying every ref and verb the component's `<script setup>` touches.
 * Three files each wrote that object out by hand, and the third copy is what
 * `boardsmith audit --dupes-baseline` reported when #228 added it (#232's own
 * gate, on its first real finding).
 *
 * A third copy is worth removing rather than recording, for the reason
 * `action-panel-editor.test-helper.ts` gives about its own two helpers: the
 * list is the panel's private interface, so a copy of it in a test file is a
 * copy that goes stale the next time the panel reads something new, and it goes
 * stale silently because a missing ref renders as undefined rather than
 * throwing.
 *
 * Every verb is a `vi.fn()`, so a test that wants to assert nothing was
 * commanded can, and one that does not care is unaffected. `overrides` is
 * merged last, which is how a test that DOES care what a verb answers says so
 * without restating the other twenty properties.
 */
import { vi } from 'vitest';
import { ref } from 'vue';

/** The stub, with every verb spied. Merge in whatever a test needs to differ. */
export function stubActionController(overrides: Record<string, unknown> = {}) {
  return {
    // Refs the panel reads directly.
    currentAction: ref<string | null>(null),
    isExecuting: ref(false),
    isLoadingChoices: ref(false),
    actionSnapshot: ref(null),

    // Refs the panel wraps in a computed.
    animationsPending: ref(false),
    showActionPanel: ref(true),
    repeatingState: ref(null),
    currentArgs: ref<Record<string, unknown>>({}),
    currentPick: ref(null),
    currentChoices: ref([]),

    // The in-progress state the panel shares with a custom UI rather than
    // holding: the multiSelect draft, the typed editor draft, and the level of
    // the action hierarchy the player is standing in. The last two are shared
    // because a collapse UNMOUNTS the panel (#235), so a ref inside it could not
    // survive one.
    multiSelectDraft: ref(null),
    currentPickDraft: ref(null),
    setPickDraft: vi.fn(),
    actionMenuPath: ref<readonly string[]>([]),
    // The draft's price and the confirmation it is read before (#248), shared for
    // the same reason: the panel renders what the controller holds, and a custom
    // UI reads the same refs rather than a second copy.
    actionQuote: ref<readonly string[] | null>(null),
    quotePending: ref(false),
    quoteError: ref<string | null>(null),
    awaitingConfirmation: ref(false),
    confirmDisabledReason: ref<string | null>(null),
    confirm: vi.fn(async () => ({ success: true })),

    // Called from computed getters and template handlers, so on first render.
    getCurrentChoices: vi.fn(() => [] as unknown[]),
    getValidElements: vi.fn(() => [] as unknown[]),
    getCollectedPick: vi.fn(() => null),
    isMultiSelectSelected: vi.fn(() => false),

    // Reached from event handlers only.
    start: vi.fn(async () => {}),
    fill: vi.fn(async () => ({ valid: true })),
    skip: vi.fn(),
    cancel: vi.fn(),
    clear: vi.fn(),
    execute: vi.fn(async () => ({ success: true })),
    toggleMultiSelect: vi.fn(async () => {}),
    confirmMultiSelect: vi.fn(async () => {}),

    ...overrides,
  };
}
