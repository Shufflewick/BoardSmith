// @vitest-environment jsdom
/**
 * DevHost.vue — two-click restart confirm + broadcast toast (DEV-07)
 *
 * Tests that:
 * 1. A single click on "New game" enters confirm state and does NOT send restart.
 * 2. A second click within the confirm window sends { type:'restart' }.
 * 3. The confirm window auto-cancels via timer without sending restart.
 * 4. Receiving game_state while pendingRestart is set fires toast.info and clears the flag.
 * 5. game_state without pendingRestart does NOT show a toast.
 *
 * We mock the global WebSocket (same pattern as DevHost.seats.test.ts) and use
 * vi.useFakeTimers() to control the 5-second confirm window.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import DevHost from './DevHost.vue';
import type { DevHostConfig } from './config-types.js';
import { useToast } from '../../ui/composables/useToast.js';

// ── Mock WebSocket ────────────────────────────────────────────────────────────

interface MockWS {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  simulateOpen(): void;
  simulateMessage(data: Record<string, unknown>): void;
}

let mockWsInstance: MockWS | null = null;

class FakeWebSocket {
  readyState: number = WebSocket.CONNECTING;
  send = vi.fn();
  close = vi.fn();
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};

  constructor(_url: string) {
    mockWsInstance = this as unknown as MockWS;
    (this as unknown as MockWS).simulateOpen = () => this._simulateOpen();
    (this as unknown as MockWS).simulateMessage = (data) => this._simulateMessage(data);
  }

  addEventListener(event: string, cb: (ev: unknown) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }

  removeEventListener(event: string, cb: (ev: unknown) => void) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((l) => l !== cb);
    }
  }

  private _simulateOpen() {
    this.readyState = WebSocket.OPEN;
    this.listeners['open']?.forEach((cb) => cb({}));
  }

  private _simulateMessage(data: Record<string, unknown>) {
    const ev = { data: JSON.stringify(data) };
    this.listeners['message']?.forEach((cb) => cb(ev));
  }
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const TEST_CONFIG: DevHostConfig = {
  gameType: 'test-game',
  displayName: 'Test Game',
  minPlayers: 2,
  maxPlayers: 2,
  playerCount: 2,
  aiSeats: [],
  aiLevel: '',
  gameOptions: [],
  playerOptions: [],
  colorPalette: [],
  gameUrl: 'http://localhost:3000/game',
};

const SEAT_LOBBY = {
  type: 'lobby',
  seats: [
    { seat: 1, clientId: 'client-a', name: 'Alice', connected: true },
    { seat: 2, clientId: null, name: '', connected: false },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function mountAndActivate(): Promise<VueWrapper> {
  const wrapper = mount(DevHost, {
    props: { config: TEST_CONFIG },
    attachTo: document.body,
  });
  await wrapper.vm.$nextTick();
  const ws = mockWsInstance!;
  ws.simulateOpen();
  await wrapper.vm.$nextTick();
  ws.simulateMessage(SEAT_LOBBY);
  await wrapper.vm.$nextTick();
  ws.simulateMessage({ type: 'init', seat: 1 });
  await wrapper.vm.$nextTick();
  return wrapper;
}

/** Find the first "New game" button variant (normal or confirm state) */
function findNewGameBtn(wrapper: VueWrapper): ReturnType<VueWrapper['find']> {
  // Look for btn--start class (both overflow and wide bar use it)
  const buttons = wrapper.findAll('.btn--start');
  return buttons[0];
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  mockWsInstance = null;
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost', reload: vi.fn() });
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

// ── Two-click confirm ─────────────────────────────────────────────────────────

describe('DevHost — two-click restart confirm', () => {
  it('first click sets confirm state but does NOT send restart WS frame', async () => {
    const wrapper = await mountAndActivate();
    const ws = mockWsInstance!;
    ws.send.mockClear();

    // Verify button starts in "New game" state
    const btn = findNewGameBtn(wrapper);
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toContain('New game');

    await btn.trigger('click');
    await wrapper.vm.$nextTick();

    // No restart frame should have been sent
    const frames = ws.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    expect(frames.find((f) => f.type === 'restart')).toBeUndefined();

    // Button label changes to confirm prompt
    expect(findNewGameBtn(wrapper).text()).toContain('Confirm restart');
  });

  it('second click within confirm window sends restart and resets to normal label', async () => {
    const wrapper = await mountAndActivate();
    const ws = mockWsInstance!;
    ws.send.mockClear();

    // First click — enters confirm state
    await findNewGameBtn(wrapper).trigger('click');
    await wrapper.vm.$nextTick();

    // Second click — should send restart
    await findNewGameBtn(wrapper).trigger('click');
    await wrapper.vm.$nextTick();

    const frames = ws.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    expect(frames.find((f) => f.type === 'restart')).toBeDefined();

    // Label should be back to "New game"
    expect(findNewGameBtn(wrapper).text()).toContain('New game');
  });

  it('confirm window auto-cancels after 5 s without sending restart', async () => {
    const wrapper = await mountAndActivate();
    const ws = mockWsInstance!;
    ws.send.mockClear();

    // First click — enters confirm state
    await findNewGameBtn(wrapper).trigger('click');
    await wrapper.vm.$nextTick();
    expect(findNewGameBtn(wrapper).text()).toContain('Confirm restart');

    // Advance past the 5-second confirm window
    vi.advanceTimersByTime(6000);
    await wrapper.vm.$nextTick();

    // No restart frame should have been sent
    const frames = ws.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    expect(frames.find((f) => f.type === 'restart')).toBeUndefined();

    // Label should be back to "New game"
    expect(findNewGameBtn(wrapper).text()).toContain('New game');
  });
});

// ── Broadcast toast ───────────────────────────────────────────────────────────

describe('DevHost — broadcast toast on restart', () => {
  it('receiving game_state after restart shows an info toast and clears pendingRestart', async () => {
    const wrapper = await mountAndActivate();
    const ws = mockWsInstance!;

    // Perform a two-click restart so pendingRestart becomes true
    await findNewGameBtn(wrapper).trigger('click');
    await wrapper.vm.$nextTick();
    await findNewGameBtn(wrapper).trigger('click');
    await wrapper.vm.$nextTick();

    // Capture current toast count before the game_state arrives
    const { toasts } = useToast();
    const countBefore = toasts.value.length;

    // Simulate the game_state the host broadcasts after restart
    ws.simulateMessage({ type: 'game_state', view: {}, isComplete: false, winners: [] });
    await wrapper.vm.$nextTick();

    // An info toast should have been added
    expect(toasts.value.length).toBe(countBefore + 1);
    const added = toasts.value[toasts.value.length - 1];
    expect(added.type).toBe('info');
    expect(added.message.toLowerCase()).toContain('restart');
  });

  it('game_state without a prior restart does NOT show a toast', async () => {
    const wrapper = await mountAndActivate();
    const ws = mockWsInstance!;

    const { toasts } = useToast();
    const countBefore = toasts.value.length;

    // Simulate game_state with no restart pending
    ws.simulateMessage({ type: 'game_state', view: {}, isComplete: false, winners: [] });
    await wrapper.vm.$nextTick();

    expect(toasts.value.length).toBe(countBefore);
  });
});
