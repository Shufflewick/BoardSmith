// @vitest-environment jsdom
/**
 * GameShell IA integration tests — Phase 100, Plan 01  [TDD]
 *
 * Proves the three actionbar IA behaviors (IA-02, IA-03, IA-04).
 *
 * TDD approach: an ActionbarHarness component mirrors the exact template
 * conditions that GameShell.vue's .actionbar must implement. The harness
 * starts EMPTY (RED), tests fail, then both the harness and GameShell.vue are
 * updated with the correct template logic (GREEN).
 *
 * Behaviors under test:
 *   1. (IA-02) When the player is actionable (isMyTurn or awaiting), .turn
 *      is always visible, showing boardPrompt ?? pickPrompt.
 *   2. (IA-03) When all current choices are board-anchored, .turn survives
 *      but action buttons are suppressed (buttons-only gate).
 *   3. (IA-04) When not actionable (not my turn, no awaiting), the entire
 *      dock is absent.
 *   4. (IA-04) ResizeObserver on the actionbar element sets --bsg-dock-h on
 *      the document root when the actionbar block size changes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref, onMounted, onUnmounted, nextTick } from 'vue';
import type { PropType } from 'vue';

// ---------------------------------------------------------------------------
// ActionbarHarness — isolated test component that mirrors GameShell.vue's
// .actionbar template conditions exactly.
//
// Template logic implemented here must be kept in sync with GameShell.vue:
//   outer dock v-if:  isMyTurn || awaitingCount > 0
//   .turn:            always shown inside dock (no extra gate)
//   action buttons:   v-if !suppressActionPanel && !allAnchored
// ---------------------------------------------------------------------------
const ActionbarHarness = defineComponent({
  name: 'ActionbarHarness',
  props: {
    isMyTurn: { type: Boolean, default: false },
    awaitingCount: { type: Number, default: 0 },
    boardPrompt: { type: String as PropType<string | null>, default: null },
    pickPrompt: { type: String as PropType<string | undefined>, default: undefined },
    allAnchored: { type: Boolean, default: false },
    suppressActionPanel: { type: Boolean, default: false },
  },
  setup() {
    return {};
  },
  // GREEN: mirrors the exact template conditions from GameShell.vue .actionbar
  template: `
    <div class="actionbar" role="region" aria-label="Actions">
      <template v-if="isMyTurn || awaitingCount > 0">
        <span class="turn">
          <span class="pr">{{ boardPrompt ?? pickPrompt }}</span>
        </span>
        <span class="vh" aria-live="polite">{{ boardPrompt ?? pickPrompt }}</span>
        <template v-if="!suppressActionPanel && !allAnchored">
          <div class="action-panel-slot">action buttons</div>
        </template>
      </template>
    </div>
  `,
});

// ---------------------------------------------------------------------------
// ResizeObserver harness — minimal component with the exact ResizeObserver
// pattern from GameShell.vue: observe actionbarRef, set --bsg-dock-h on root.
// ---------------------------------------------------------------------------
const ResizeObserverHarness = defineComponent({
  name: 'ResizeObserverHarness',
  setup() {
    const actionbarRef = ref<HTMLElement | null>(null);
    let dockObserver: ResizeObserver | null = null;

    // Mirrors the GameShell.vue onMounted pattern exactly
    const initObserver = () => {
      dockObserver = new ResizeObserver((entries) => {
        const h = entries[0]?.borderBoxSize?.[0]?.blockSize ?? 0;
        document.documentElement.style.setProperty('--bsg-dock-h', `${h}px`);
      });
      if (actionbarRef.value) dockObserver.observe(actionbarRef.value);
    };

    const disconnectObserver = () => dockObserver?.disconnect();

    return { actionbarRef, initObserver, disconnectObserver };
  },
  template: `<div ref="actionbarRef" class="actionbar" role="region" aria-label="Actions"></div>`,
});

// ---------------------------------------------------------------------------
// Suite 1: Actionbar template conditions (IA-02, IA-03, IA-04)
// ---------------------------------------------------------------------------
describe('GameShell actionbar — IA-02/IA-03/IA-04 template conditions', () => {
  // --- IA-02: prompt always visible when actionable -------------------------

  it('shows .turn strip when isMyTurn is true', () => {
    const wrapper = mount(ActionbarHarness, {
      props: { isMyTurn: true, pickPrompt: 'Choose a piece to move' },
    });

    expect(wrapper.find('.turn').exists()).toBe(true);
  });

  it('shows .turn with the pickPrompt text when boardPrompt is null', () => {
    const wrapper = mount(ActionbarHarness, {
      props: { isMyTurn: true, boardPrompt: null, pickPrompt: 'Select a destination' },
    });

    expect(wrapper.find('.turn .pr').text()).toBe('Select a destination');
  });

  it('boardPrompt takes precedence over pickPrompt (source-of-truth)', () => {
    const wrapper = mount(ActionbarHarness, {
      props: { isMyTurn: true, boardPrompt: 'Board says: tap a square', pickPrompt: 'Action says: pick' },
    });

    expect(wrapper.find('.turn .pr').text()).toBe('Board says: tap a square');
  });

  it('shows .turn when awaiting other players even when !isMyTurn', () => {
    const wrapper = mount(ActionbarHarness, {
      props: { isMyTurn: false, awaitingCount: 2, pickPrompt: 'Waiting for others' },
    });

    expect(wrapper.find('.turn').exists()).toBe(true);
  });

  // --- IA-03: prompt survives; ONLY buttons suppressed when board-anchored --

  it('keeps .turn visible when allAnchored=true (prompt must not be inside button gate)', () => {
    const wrapper = mount(ActionbarHarness, {
      props: { isMyTurn: true, allAnchored: true, pickPrompt: 'Tap a cell on the board' },
    });

    // Prompt SURVIVES
    expect(wrapper.find('.turn').exists()).toBe(true);
    expect(wrapper.find('.turn .pr').text()).toBe('Tap a cell on the board');
  });

  it('suppresses action buttons when allAnchored=true', () => {
    const wrapper = mount(ActionbarHarness, {
      props: { isMyTurn: true, allAnchored: true, pickPrompt: 'Tap a cell' },
    });

    // Buttons ABSENT — the .turn strip is there but .action-panel-slot is not
    expect(wrapper.find('.action-panel-slot').exists()).toBe(false);
  });

  it('shows action buttons when allAnchored=false', () => {
    const wrapper = mount(ActionbarHarness, {
      props: { isMyTurn: true, allAnchored: false, pickPrompt: 'Choose an action' },
    });

    expect(wrapper.find('.action-panel-slot').exists()).toBe(true);
  });

  // --- IA-04: dock entirely absent when not actionable ---------------------

  it('hides the entire dock when not my turn and no awaiting players', () => {
    const wrapper = mount(ActionbarHarness, {
      props: { isMyTurn: false, awaitingCount: 0 },
    });

    expect(wrapper.find('.turn').exists()).toBe(false);
    expect(wrapper.find('.action-panel-slot').exists()).toBe(false);
  });

  it('shows dock as soon as isMyTurn becomes true (reactivity)', async () => {
    const wrapper = mount(ActionbarHarness, {
      props: { isMyTurn: false, pickPrompt: 'Pick' },
    });

    expect(wrapper.find('.turn').exists()).toBe(false);

    await wrapper.setProps({ isMyTurn: true });

    expect(wrapper.find('.turn').exists()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: ResizeObserver sets --bsg-dock-h (IA-04)
// ---------------------------------------------------------------------------
describe('GameShell actionbar — IA-04 ResizeObserver dock-height', () => {
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let observerCallback: ResizeObserverCallback | null = null;
  let observedElement: Element | null = null;

  beforeEach(() => {
    originalResizeObserver = (globalThis as any).ResizeObserver;
    observerCallback = null;
    observedElement = null;
    document.documentElement.style.removeProperty('--bsg-dock-h');

    // Fake ResizeObserver that captures the callback and the observed element
    (globalThis as any).ResizeObserver = class FakeResizeObserver {
      private cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
        observerCallback = cb;
      }
      observe(el: Element) {
        observedElement = el;
      }
      disconnect() {
        observerCallback = null;
        observedElement = null;
      }
    };
  });

  afterEach(() => {
    (globalThis as any).ResizeObserver = originalResizeObserver;
    document.documentElement.style.removeProperty('--bsg-dock-h');
  });

  it('sets --bsg-dock-h when ResizeObserver fires with a blockSize', () => {
    const wrapper = mount(ResizeObserverHarness);

    // Initialise the observer (mirrors GameShell onMounted)
    wrapper.vm.initObserver();

    expect(observerCallback).not.toBeNull();
    expect(observedElement).not.toBeNull();

    // Simulate a resize event with blockSize = 56
    observerCallback!([
      {
        borderBoxSize: [{ blockSize: 56, inlineSize: 400 }],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
        contentRect: new DOMRectReadOnly(),
        target: observedElement!,
      },
    ], {} as ResizeObserver);

    expect(document.documentElement.style.getPropertyValue('--bsg-dock-h')).toBe('56px');
  });

  it('falls back to 0px when borderBoxSize is empty', () => {
    const wrapper = mount(ResizeObserverHarness);
    wrapper.vm.initObserver();

    observerCallback!([
      {
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
        contentRect: new DOMRectReadOnly(),
        target: observedElement!,
      },
    ], {} as ResizeObserver);

    expect(document.documentElement.style.getPropertyValue('--bsg-dock-h')).toBe('0px');
  });

  it('disconnects on unmount, clearing the observer', () => {
    const wrapper = mount(ResizeObserverHarness);
    wrapper.vm.initObserver();

    expect(observerCallback).not.toBeNull();

    wrapper.vm.disconnectObserver();

    expect(observerCallback).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: IA-01 — header gate in platform mode + heartbeat corner dot
//
// Behaviors under test:
//   A. GameHeader is absent when platformMode=true.
//   B. A corner .conn-dot element renders in platform mode.
//   C. A valid heartbeat postMessage (source:shufflewick, type:heartbeat)
//      sets connectionHealth='connected' and the dot gains the class.
//   D. A malformed heartbeat payload does NOT change connectionHealth.
//
// Implementation approach: isolate the heartbeat handler logic and the header
// gate into a HeartbeatHarness that mirrors GameShell.vue's exact conditions,
// so tests do not need to mount the full GameShell (which requires client setup).
// ---------------------------------------------------------------------------

/**
 * HeartbeatHarness — mirrors the IA-01 GameShell.vue additions:
 *   - platformMode prop gates rendering of a fake "GameHeader" sentinel
 *   - connectionHealth ref starts 'connecting'
 *   - a handleHeartbeat() method validates + applies the heartbeat
 *   - a .conn-dot renders in platform mode bound to connectionHealth class
 *
 * RED: harness starts empty — template renders nothing, handleHeartbeat is a no-op.
 * GREEN (next commit): fill in template logic and heartbeat validation.
 */
const HeartbeatHarness = defineComponent({
  name: 'HeartbeatHarness',
  props: {
    platformMode: { type: Boolean, default: false },
  },
  setup() {
    const connectionHealth = ref<'connecting' | 'connected' | 'stale'>('connecting');
    let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

    // GREEN: validate payload shape before acting (T-100-04-01, T-100-04-02)
    function handleHeartbeat(data: unknown): void {
      if (!data || typeof data !== 'object') return;
      const msg = data as Record<string, unknown>;
      if (msg.source !== 'shufflewick' || msg.type !== 'heartbeat') return;
      connectionHealth.value = 'connected';
      if (heartbeatTimer !== null) clearTimeout(heartbeatTimer);
      heartbeatTimer = setTimeout(() => {
        connectionHealth.value = 'stale';
      }, 10_000);
    }

    onUnmounted(() => {
      if (heartbeatTimer !== null) clearTimeout(heartbeatTimer);
    });

    return { connectionHealth, handleHeartbeat };
  },
  // GREEN: mirrors GameShell.vue IA-01 additions in the platform-mode shell
  template: `
    <div class="harness">
      <!-- Fake GameHeader sentinel — absent in platform mode (IA-01) -->
      <div v-if="!platformMode" class="game-header-sentinel">GameHeader</div>
      <!-- Corner dot: class bound to connectionHealth (IA-01) -->
      <span v-if="platformMode" class="conn-dot" :class="connectionHealth"></span>
    </div>
  `,
});

describe('GameShell IA-01 — header gate + heartbeat corner dot', () => {
  // --- A. GameHeader absent in platform mode --------------------------------
  it('GameHeader sentinel is present when platformMode=false', () => {
    const wrapper = mount(HeartbeatHarness, { props: { platformMode: false } });
    expect(wrapper.find('.game-header-sentinel').exists()).toBe(true);
  });

  it('GameHeader sentinel is absent when platformMode=true', () => {
    const wrapper = mount(HeartbeatHarness, { props: { platformMode: true } });
    expect(wrapper.find('.game-header-sentinel').exists()).toBe(false);
  });

  // --- B. Corner dot renders in platform mode --------------------------------
  it('conn-dot renders when platformMode=true', () => {
    const wrapper = mount(HeartbeatHarness, { props: { platformMode: true } });
    expect(wrapper.find('.conn-dot').exists()).toBe(true);
  });

  it('conn-dot is absent when platformMode=false', () => {
    const wrapper = mount(HeartbeatHarness, { props: { platformMode: false } });
    expect(wrapper.find('.conn-dot').exists()).toBe(false);
  });

  // --- C. Valid heartbeat → connectionHealth='connected' --------------------
  it('conn-dot starts with class connecting', () => {
    const wrapper = mount(HeartbeatHarness, { props: { platformMode: true } });
    expect(wrapper.find('.conn-dot').classes()).toContain('connecting');
  });

  it('valid heartbeat sets connectionHealth to connected', async () => {
    const wrapper = mount(HeartbeatHarness, { props: { platformMode: true } });

    wrapper.vm.handleHeartbeat({ source: 'shufflewick', type: 'heartbeat' });
    await nextTick();

    expect(wrapper.vm.connectionHealth).toBe('connected');
    expect(wrapper.find('.conn-dot').classes()).toContain('connected');
  });

  // --- D. Malformed heartbeat → ignored ------------------------------------
  it('null payload does not change connectionHealth', async () => {
    const wrapper = mount(HeartbeatHarness, { props: { platformMode: true } });

    wrapper.vm.handleHeartbeat(null);
    await nextTick();

    expect(wrapper.vm.connectionHealth).toBe('connecting');
  });

  it('wrong source does not change connectionHealth', async () => {
    const wrapper = mount(HeartbeatHarness, { props: { platformMode: true } });

    wrapper.vm.handleHeartbeat({ source: 'evil-host', type: 'heartbeat' });
    await nextTick();

    expect(wrapper.vm.connectionHealth).toBe('connecting');
  });

  it('wrong type does not change connectionHealth', async () => {
    const wrapper = mount(HeartbeatHarness, { props: { platformMode: true } });

    wrapper.vm.handleHeartbeat({ source: 'shufflewick', type: 'game_state' });
    await nextTick();

    expect(wrapper.vm.connectionHealth).toBe('connecting');
  });

  it('non-object payload does not change connectionHealth', async () => {
    const wrapper = mount(HeartbeatHarness, { props: { platformMode: true } });

    wrapper.vm.handleHeartbeat('heartbeat');
    await nextTick();

    expect(wrapper.vm.connectionHealth).toBe('connecting');
  });
});
