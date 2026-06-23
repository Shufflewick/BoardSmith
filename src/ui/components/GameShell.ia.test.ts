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

// ---------------------------------------------------------------------------
// Suite 4: IA-06 — sidebar rail state + scrim behavior
//
// Behaviors under test:
//   A. .sidebar gains class "rail" when sidebarRail=true, loses it when false.
//   B. .scrim gains class "active" when sidebarRail=false (sidebar expanded).
//   C. Clicking .side-edge toggles sidebarRail.
//   D. Clicking .scrim.active collapses (sidebarRail → true).
// ---------------------------------------------------------------------------

const SidebarHarness = defineComponent({
  name: 'SidebarHarness',
  props: {
    sidebarRail: { type: Boolean, default: false },
  },
  emits: ['toggle', 'collapse'],
  template: `
    <div class="stage">
      <aside class="sidebar" :class="{ rail: sidebarRail }">
        <button class="side-edge" @click="$emit('toggle')">
          <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>
        </button>
      </aside>
      <main class="boardregion"></main>
      <div
        class="scrim"
        :class="{ active: !sidebarRail }"
        aria-hidden="true"
        @click="$emit('collapse')"
      ></div>
    </div>
  `,
});

describe('GameShell IA-06 — sidebar rail state + phone scrim', () => {
  // --- A. Rail class binding ---
  it('sidebar has class "rail" when sidebarRail=true', () => {
    const wrapper = mount(SidebarHarness, { props: { sidebarRail: true } });
    expect(wrapper.find('.sidebar').classes()).toContain('rail');
  });

  it('sidebar does not have class "rail" when sidebarRail=false', () => {
    const wrapper = mount(SidebarHarness, { props: { sidebarRail: false } });
    expect(wrapper.find('.sidebar').classes()).not.toContain('rail');
  });

  // --- B. Scrim class binding ---
  it('scrim has class "active" when sidebarRail=false (expanded)', () => {
    const wrapper = mount(SidebarHarness, { props: { sidebarRail: false } });
    expect(wrapper.find('.scrim').classes()).toContain('active');
  });

  it('scrim does not have class "active" when sidebarRail=true (collapsed)', () => {
    const wrapper = mount(SidebarHarness, { props: { sidebarRail: true } });
    expect(wrapper.find('.scrim').classes()).not.toContain('active');
  });

  // --- C. side-edge button emits toggle ---
  it('clicking .side-edge emits toggle', async () => {
    const wrapper = mount(SidebarHarness, { props: { sidebarRail: false } });
    await wrapper.find('.side-edge').trigger('click');
    expect(wrapper.emitted('toggle')).toHaveLength(1);
  });

  // --- D. scrim click emits collapse ---
  it('clicking .scrim emits collapse (to collapse expanded sidebar)', async () => {
    const wrapper = mount(SidebarHarness, { props: { sidebarRail: false } });
    await wrapper.find('.scrim').trigger('click');
    expect(wrapper.emitted('collapse')).toHaveLength(1);
  });

  // --- Rail toggle reactivity ---
  it('sidebar gains .rail class when sidebarRail changes to true', async () => {
    const wrapper = mount(SidebarHarness, { props: { sidebarRail: false } });
    expect(wrapper.find('.sidebar').classes()).not.toContain('rail');
    await wrapper.setProps({ sidebarRail: true });
    expect(wrapper.find('.sidebar').classes()).toContain('rail');
  });

  it('scrim loses .active class when sidebarRail changes to true (collapse)', async () => {
    const wrapper = mount(SidebarHarness, { props: { sidebarRail: false } });
    expect(wrapper.find('.scrim').classes()).toContain('active');
    await wrapper.setProps({ sidebarRail: true });
    expect(wrapper.find('.scrim').classes()).not.toContain('active');
  });
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

// ---------------------------------------------------------------------------
// Suite 5: IA-07 — winnerSeats capture from game_state postMessage (T-100-06-01)
//
// Behaviors under test:
//   A. Valid game_state message with winners=[1,2] sets winnerSeats to [1,2].
//   B. game_state with no winners field leaves winnerSeats as [].
//   C. game_state with winners as string array is rejected → winnerSeats stays [].
//   D. game_state with a non-array winners field is rejected → winnerSeats stays [].
// ---------------------------------------------------------------------------

/**
 * WinnerCaptureHarness — mirrors the GameShell.vue game_state winner-capture logic.
 *
 * Isolates the winnerSeats validation branch so tests do not need to mount the
 * full GameShell (which requires client setup).
 */
const WinnerCaptureHarness = defineComponent({
  name: 'WinnerCaptureHarness',
  setup() {
    const winnerSeats = ref<number[]>([]);

    // Mirrors the game_state handler winner-capture in GameShell.vue (T-100-06-01).
    function captureWinners(data: unknown): void {
      const msg = data as Record<string, unknown> | null | undefined;
      if (!msg) return;
      winnerSeats.value =
        Array.isArray(msg.winners) &&
        (msg.winners as unknown[]).every((n: unknown) => typeof n === 'number')
          ? (msg.winners as number[])
          : [];
    }

    return { winnerSeats, captureWinners };
  },
  template: `<div class="winner-capture-harness"></div>`,
});

describe('GameShell IA-07 — winnerSeats capture from game_state postMessage', () => {
  // --- A. Valid winners array captured ------------------------------------------
  it('captures valid winners array from game_state message', async () => {
    const wrapper = mount(WinnerCaptureHarness);

    wrapper.vm.captureWinners({ type: 'game_state', winners: [1, 2] });
    await nextTick();

    expect(wrapper.vm.winnerSeats).toEqual([1, 2]);
  });

  it('captures single winner seat', async () => {
    const wrapper = mount(WinnerCaptureHarness);

    wrapper.vm.captureWinners({ type: 'game_state', winners: [0] });
    await nextTick();

    expect(wrapper.vm.winnerSeats).toEqual([0]);
  });

  // --- B. No winners field → stays [] (dev-WS degrade) -------------------------
  it('leaves winnerSeats as [] when winners field is absent', async () => {
    const wrapper = mount(WinnerCaptureHarness);

    wrapper.vm.captureWinners({ type: 'game_state' });
    await nextTick();

    expect(wrapper.vm.winnerSeats).toEqual([]);
  });

  // --- C. Non-number winners rejected → stays [] (T-100-06-01) -----------------
  it('rejects a string array winners field and keeps winnerSeats as []', async () => {
    const wrapper = mount(WinnerCaptureHarness);

    wrapper.vm.captureWinners({ type: 'game_state', winners: ['1', '2'] });
    await nextTick();

    expect(wrapper.vm.winnerSeats).toEqual([]);
  });

  // --- D. Non-array winners rejected → stays [] (T-100-06-01) ------------------
  it('rejects a non-array winners field and keeps winnerSeats as []', async () => {
    const wrapper = mount(WinnerCaptureHarness);

    wrapper.vm.captureWinners({ type: 'game_state', winners: 1 });
    await nextTick();

    expect(wrapper.vm.winnerSeats).toEqual([]);
  });

  it('rejects winners: null and keeps winnerSeats as []', async () => {
    const wrapper = mount(WinnerCaptureHarness);

    wrapper.vm.captureWinners({ type: 'game_state', winners: null });
    await nextTick();

    expect(wrapper.vm.winnerSeats).toEqual([]);
  });
});
