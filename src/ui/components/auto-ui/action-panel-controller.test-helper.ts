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
import { mount } from '@vue/test-utils';
import ActionPanel from './ActionPanel.vue';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';

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
    // The ordered-list verbs (#249): the panel reaches for them whenever the
    // current pick carries `orderedList`, and a missing one is invisible until a
    // click throws.
    appendListEntry: vi.fn(async () => {}),
    removeListEntry: vi.fn(),

    ...overrides,
  };
}

/**
 * Mount the panel over a stub controller, with the provide/inject wiring and the
 * Teleport stub every panel test needs.
 *
 * Beside the stub for the same reason the stub is here at all: the ten lines below
 * are the panel's mounting contract, and a copy of them in a test file goes stale
 * silently the next time the component reads its controller from somewhere else.
 */
export function mountPanel(
  controller: ReturnType<typeof stubActionController>,
  props: Record<string, unknown> = { availableActions: [], playerSeat: 1, isMyTurn: true },
) {
  return mount(ActionPanel, {
    global: {
      provide: { [GAME_CONTEXT_KEYS.actionController as symbol]: controller },
      stubs: { Teleport: true },
    },
    props,
  });
}
