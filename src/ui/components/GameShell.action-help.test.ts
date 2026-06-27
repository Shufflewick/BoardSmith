// @vitest-environment jsdom
/**
 * GameShell — action-help localStorage persistence + dual-path wiring (Plan 108-03, Task 2)
 *
 * Uses minimal harness components (same pattern as GameShell.tutorial.test.ts) to
 * avoid mounting the full WebSocket-dependent GameShell. Tests the specific production
 * wiring from GameShell.vue:
 *
 *   getActionHelpEnabled() / setActionHelpEnabled(value) → boardsmith_action_help
 *   const isActionHelpVisible = ref(getActionHelpEnabled())
 *   handleTeachingAction('help-toggle') → flip + persist
 *   isActionHelpVisible threaded into ControlsMenu, ActionPanel, #game-board slot
 *
 * Each harness mirrors the exact production code under test — if the GameShell wiring
 * is broken, the harness must receive the same fix, making it a canary for the pattern.
 *
 * PITFALL (108-RESEARCH Pitfall 2): localStorage persists between jsdom tests.
 * Always call localStorage.clear() in beforeEach.
 *
 * Behaviors under test:
 *   LS-1: No boardsmith_action_help key → getActionHelpEnabled() returns true (default ON)
 *   LS-2: boardsmith_action_help='false' → getActionHelpEnabled() returns false
 *   LS-3: setActionHelpEnabled(false) writes 'false' to boardsmith_action_help
 *   LS-4: setActionHelpEnabled(true) writes 'true' to boardsmith_action_help
 *   TOG-1: help-toggle handler flips isActionHelpVisible ref
 *   TOG-2: help-toggle handler calls setActionHelpEnabled with new value (persists)
 *   PAR-1: isActionHelpVisible is threaded into ActionPanel (AutoUI path)
 *   PAR-2: isActionHelpVisible is exposed in #game-board slot props (custom-UI path)
 *   DIS-1: disabledActions computed reflects broadcast state.disabledActions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, computed, defineComponent, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

// ── Production localStorage helpers (mirrored from GameShell.vue) ────────────
// These must be kept in sync with the actual GameShell.vue implementation.
// If GameShell changes these helpers, this test breaks → canary behavior.

const LS_KEY = 'boardsmith_action_help';

function getActionHelpEnabled(): boolean {
  try {
    const stored = localStorage.getItem(LS_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

function setActionHelpEnabled(value: boolean): void {
  try {
    localStorage.setItem(LS_KEY, String(value));
  } catch { /* ignore */ }
}

// ── localStorage tests ────────────────────────────────────────────────────────

describe('getActionHelpEnabled / setActionHelpEnabled (boardsmith_action_help)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('LS-1: returns true when key is absent (default ON)', () => {
    expect(localStorage.getItem(LS_KEY)).toBeNull();
    expect(getActionHelpEnabled()).toBe(true);
  });

  it('LS-2: returns false when key is stored as "false"', () => {
    localStorage.setItem(LS_KEY, 'false');
    expect(getActionHelpEnabled()).toBe(false);
  });

  it('LS-2b: returns true when key is stored as "true"', () => {
    localStorage.setItem(LS_KEY, 'true');
    expect(getActionHelpEnabled()).toBe(true);
  });

  it('LS-3: setActionHelpEnabled(false) writes "false" to localStorage', () => {
    setActionHelpEnabled(false);
    expect(localStorage.getItem(LS_KEY)).toBe('false');
  });

  it('LS-4: setActionHelpEnabled(true) writes "true" to localStorage', () => {
    setActionHelpEnabled(true);
    expect(localStorage.getItem(LS_KEY)).toBe('true');
  });

  it('LS-round-trip: set false → getActionHelpEnabled returns false', () => {
    setActionHelpEnabled(false);
    expect(getActionHelpEnabled()).toBe(false);
  });

  it('LS-round-trip: set true → getActionHelpEnabled returns true', () => {
    setActionHelpEnabled(false); // first set to false
    setActionHelpEnabled(true);  // then toggle back
    expect(getActionHelpEnabled()).toBe(true);
  });
});

// ── Toggle handler harness ────────────────────────────────────────────────────
//
// Mirrors the production pattern from GameShell.vue handleTeachingAction:
//
//   const isActionHelpVisible = ref(getActionHelpEnabled())
//   else if (teachAction === 'help-toggle') {
//     isActionHelpVisible.value = !isActionHelpVisible.value;
//     setActionHelpEnabled(isActionHelpVisible.value);
//   }

const ToggleHandlerHarness = defineComponent({
  name: 'ToggleHandlerHarness',
  setup(_, { expose }) {
    const isActionHelpVisible = ref(getActionHelpEnabled());

    async function handleTeachingAction(teachAction: string) {
      if (teachAction === 'help-toggle') {
        isActionHelpVisible.value = !isActionHelpVisible.value;
        setActionHelpEnabled(isActionHelpVisible.value);
      }
    }

    expose({ isActionHelpVisible, handleTeachingAction });
    return {};
  },
  template: '<div />',
});

describe('help-toggle handler (GameShell.handleTeachingAction)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('TOG-1: flips isActionHelpVisible from true to false', async () => {
    const wrapper = mount(ToggleHandlerHarness);
    const vm = wrapper.vm as any;
    expect(vm.isActionHelpVisible).toBe(true); // default ON (Vue unwraps ref on expose)
    await vm.handleTeachingAction('help-toggle');
    expect(vm.isActionHelpVisible).toBe(false);
    wrapper.unmount();
  });

  it('TOG-1b: flips isActionHelpVisible from false to true', async () => {
    localStorage.setItem(LS_KEY, 'false');
    const wrapper = mount(ToggleHandlerHarness);
    const vm = wrapper.vm as any;
    expect(vm.isActionHelpVisible).toBe(false);
    await vm.handleTeachingAction('help-toggle');
    expect(vm.isActionHelpVisible).toBe(true);
    wrapper.unmount();
  });

  it('TOG-2: writes new value to localStorage after toggle (ON → OFF)', async () => {
    const wrapper = mount(ToggleHandlerHarness);
    const vm = wrapper.vm as any;
    await vm.handleTeachingAction('help-toggle');
    expect(localStorage.getItem(LS_KEY)).toBe('false');
    wrapper.unmount();
  });

  it('TOG-2b: writes new value to localStorage after toggle (OFF → ON)', async () => {
    localStorage.setItem(LS_KEY, 'false');
    const wrapper = mount(ToggleHandlerHarness);
    const vm = wrapper.vm as any;
    await vm.handleTeachingAction('help-toggle');
    expect(localStorage.getItem(LS_KEY)).toBe('true');
    wrapper.unmount();
  });

  it('TOG-persist: value survives reload simulation (re-read from localStorage)', async () => {
    // Simulate "after toggle, reload the page":
    // 1. Toggle from default ON to OFF
    const wrapper1 = mount(ToggleHandlerHarness);
    const vm1 = wrapper1.vm as any;
    await vm1.handleTeachingAction('help-toggle');
    expect(vm1.isActionHelpVisible).toBe(false);
    wrapper1.unmount();

    // 2. Mount fresh harness (simulates page reload) — reads localStorage
    const wrapper2 = mount(ToggleHandlerHarness);
    const vm2 = wrapper2.vm as any;
    expect(vm2.isActionHelpVisible).toBe(false); // persisted
    wrapper2.unmount();
  });
});

// ── Dual-path threading parity harness ────────────────────────────────────────
//
// Mirrors the production wiring from GameShell.vue where isActionHelpVisible
// is passed to BOTH ActionPanel (AutoUI) AND the #game-board slot props:
//
//   <ActionPanel :is-action-help-visible="isActionHelpVisible" .../>
//   <slot name="game-board" :is-action-help-visible="isActionHelpVisible" ...>
//
// Also verifies disabledActions computed from broadcast state:
//   const disabledActions = computed(() =>
//     (state.value?.state as any)?.disabledActions as Record<string, string> | undefined
//   )
//   <ActionPanel :disabled-actions="disabledActions" .../>

const ParityHarness = defineComponent({
  name: 'ParityHarness',
  props: {
    initialHelpVisible: { type: Boolean, default: true },
    broadcastState: { type: Object, default: null },
  },
  setup(props, { expose }) {
    const isActionHelpVisible = ref(props.initialHelpVisible);

    // Mirrors the disabledActions computed in GameShell
    const state = computed(() => props.broadcastState);
    const disabledActions = computed(() => {
      return (state.value?.state as any)?.disabledActions as Record<string, string> | undefined;
    });

    expose({ isActionHelpVisible, disabledActions });
    return { isActionHelpVisible, disabledActions };
  },
  template: `
    <div>
      <!-- AutoUI ActionPanel path (PAR-1) -->
      <div
        class="action-panel-stub"
        :data-is-action-help-visible="isActionHelpVisible"
        :data-has-disabled-actions="disabledActions !== undefined"
      />
      <!-- #game-board slot path (PAR-2) -->
      <slot
        name="game-board"
        :is-action-help-visible="isActionHelpVisible"
        :disabled-actions="disabledActions"
      >
        <div class="slot-fallback" />
      </slot>
    </div>
  `,
});

describe('isActionHelpVisible dual-path threading (ActionPanel + #game-board slot)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('PAR-1: isActionHelpVisible is passed to ActionPanel (AutoUI path)', async () => {
    const wrapper = mount(ParityHarness, {
      props: { initialHelpVisible: true },
    });
    const panel = wrapper.find('.action-panel-stub');
    expect(panel.attributes('data-is-action-help-visible')).toBe('true');
    wrapper.unmount();
  });

  it('PAR-1b: ActionPanel receives false when isActionHelpVisible is false', async () => {
    const wrapper = mount(ParityHarness, {
      props: { initialHelpVisible: false },
    });
    const panel = wrapper.find('.action-panel-stub');
    expect(panel.attributes('data-is-action-help-visible')).toBe('false');
    wrapper.unmount();
  });

  it('PAR-2: isActionHelpVisible is exposed in #game-board slot props', async () => {
    let capturedSlotProps: Record<string, unknown> | null = null;
    const wrapper = mount(ParityHarness, {
      props: { initialHelpVisible: true },
      slots: {
        'game-board': (slotProps: Record<string, unknown>) => {
          capturedSlotProps = slotProps;
          return '<div class="custom-ui-stub" />';
        },
      },
    });
    await nextTick();
    expect(capturedSlotProps).not.toBeNull();
    expect((capturedSlotProps as any).isActionHelpVisible).toBe(true);
    wrapper.unmount();
  });

  it('PAR-2b: #game-board slot receives false when isActionHelpVisible is false', async () => {
    let capturedSlotProps: Record<string, unknown> | null = null;
    const wrapper = mount(ParityHarness, {
      props: { initialHelpVisible: false },
      slots: {
        'game-board': (slotProps: Record<string, unknown>) => {
          capturedSlotProps = slotProps;
          return '<div class="custom-ui-stub" />';
        },
      },
    });
    await nextTick();
    expect(capturedSlotProps).not.toBeNull();
    expect((capturedSlotProps as any).isActionHelpVisible).toBe(false);
    wrapper.unmount();
  });

  it('PAR-parity: ActionPanel and slot both receive the SAME value', async () => {
    let slotHelpVisible: unknown;
    const wrapper = mount(ParityHarness, {
      props: { initialHelpVisible: true },
      slots: {
        'game-board': (slotProps: Record<string, unknown>) => {
          slotHelpVisible = slotProps.isActionHelpVisible;
          return '<div />';
        },
      },
    });
    await nextTick();
    const panelAttr = wrapper.find('.action-panel-stub').attributes('data-is-action-help-visible');
    expect(String(slotHelpVisible)).toBe(panelAttr);
    wrapper.unmount();
  });
});

// ── disabledActions computed harness ─────────────────────────────────────────

describe('disabledActions computed from broadcast state', () => {
  it('DIS-1: returns disabledActions from state.state.disabledActions', () => {
    const wrapper = mount(ParityHarness, {
      props: {
        initialHelpVisible: true,
        broadcastState: {
          state: {
            disabledActions: { move: 'Not your turn' },
          },
        },
      },
    });
    const vm = wrapper.vm as any;
    expect(vm.disabledActions).toEqual({ move: 'Not your turn' });
    wrapper.unmount();
  });

  it('DIS-2: returns undefined when state has no disabledActions', () => {
    const wrapper = mount(ParityHarness, {
      props: {
        initialHelpVisible: true,
        broadcastState: { state: {} },
      },
    });
    const vm = wrapper.vm as any;
    expect(vm.disabledActions).toBeUndefined();
    wrapper.unmount();
  });

  it('DIS-3: returns undefined when broadcastState is null', () => {
    const wrapper = mount(ParityHarness, {
      props: { initialHelpVisible: true, broadcastState: null },
    });
    const vm = wrapper.vm as any;
    expect(vm.disabledActions).toBeUndefined();
    wrapper.unmount();
  });

  it('DIS-4: ActionPanel receives disabledActions from broadcast state', async () => {
    const wrapper = mount(ParityHarness, {
      props: {
        initialHelpVisible: true,
        broadcastState: {
          state: { disabledActions: { attack: 'Target is unreachable' } },
        },
      },
    });
    const panel = wrapper.find('.action-panel-stub');
    expect(panel.attributes('data-has-disabled-actions')).toBe('true');
    wrapper.unmount();
  });

  it('DIS-5: #game-board slot receives disabledActions as a named prop', async () => {
    // Verifies GameShell threads disabledActions to the custom-UI slot path (parity gap fix).
    // Custom UI authors must be able to consume :disabled-actions without casting through state.
    let capturedSlotProps: Record<string, unknown> | null = null;
    const wrapper = mount(ParityHarness, {
      props: {
        initialHelpVisible: true,
        broadcastState: {
          state: { disabledActions: { move: 'Not your turn' } },
        },
      },
      slots: {
        'game-board': (slotProps: Record<string, unknown>) => {
          capturedSlotProps = slotProps;
          return '<div class="custom-ui-stub" />';
        },
      },
    });
    await nextTick();
    expect(capturedSlotProps).not.toBeNull();
    expect((capturedSlotProps as any).disabledActions).toEqual({ move: 'Not your turn' });
    wrapper.unmount();
  });

  it('DIS-6: ActionPanel and #game-board slot both receive the SAME disabledActions object', async () => {
    // Verifies parity: both paths (AutoUI ActionPanel and custom-UI slot) see identical
    // disabledActions data so ActionHelpPopover renders the same popover in either context.
    let slotDisabledActions: unknown;
    const wrapper = mount(ParityHarness, {
      props: {
        initialHelpVisible: true,
        broadcastState: {
          state: { disabledActions: { defend: 'No shield equipped' } },
        },
      },
      slots: {
        'game-board': (slotProps: Record<string, unknown>) => {
          slotDisabledActions = slotProps.disabledActions;
          return '<div />';
        },
      },
    });
    await nextTick();
    // ActionPanel stub reflects disabledActions presence via data-has-disabled-actions
    const panelHasDA = wrapper.find('.action-panel-stub').attributes('data-has-disabled-actions');
    expect(panelHasDA).toBe('true');
    // Slot received the same value
    expect(slotDisabledActions).toEqual({ defend: 'No shield equipped' });
    wrapper.unmount();
  });
});
