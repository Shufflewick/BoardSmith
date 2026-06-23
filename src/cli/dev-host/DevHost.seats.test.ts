// @vitest-environment jsdom
/**
 * DevHost.vue — seat switcher + presence strip tests (DEV-03)
 *
 * Tests the presence strip rendering and the seat-switcher message order.
 * We mock the global WebSocket so wsSend() frames are observable without
 * a real socket connection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import DevHost from './DevHost.vue';
import type { DevHostConfig } from './config-types.js';

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
  readyState = WebSocket.CONNECTING;
  send = vi.fn();
  close = vi.fn();
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};

  constructor(_url: string) {
    mockWsInstance = this as unknown as MockWS;
    // Expose helpers on the instance for tests
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

// ── Test config fixture ───────────────────────────────────────────────────────

const TEST_CONFIG: DevHostConfig = {
  gameType: 'test-game',
  displayName: 'Test Game',
  minPlayers: 2,
  maxPlayers: 4,
  playerCount: 3,
  aiSeats: [2, 3], // seats 2 and 3 are AI
  aiLevel: 'medium',
  gameOptions: [
    { id: 'speed', type: 'choice', label: 'Game Speed', default: 'normal', choices: [{ value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Fast' }] },
  ],
  playerOptions: [],
  colorPalette: [],
  gameUrl: 'http://localhost:3000/game',
};

const SEAT_LOBBY = {
  type: 'lobby',
  seats: [
    { seat: 1, clientId: 'client-a', name: 'Alice', connected: true },
    { seat: 2, clientId: null, name: '', connected: false }, // AI seat
    { seat: 3, clientId: null, name: '', connected: false }, // AI seat
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function mountDevHost(): Promise<VueWrapper> {
  const wrapper = mount(DevHost, {
    props: { config: TEST_CONFIG },
    attachTo: document.body,
  });
  await wrapper.vm.$nextTick();
  return wrapper;
}

/**
 * Bring the component to the "in-game" state: open WS, send lobby + init.
 */
async function activateSeat(wrapper: VueWrapper, seat = 1): Promise<void> {
  const ws = mockWsInstance!;
  ws.simulateOpen();
  await wrapper.vm.$nextTick();
  ws.simulateMessage(SEAT_LOBBY);
  await wrapper.vm.$nextTick();
  ws.simulateMessage({ type: 'init', seat });
  await wrapper.vm.$nextTick();
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockWsInstance = null;
  vi.stubGlobal('WebSocket', FakeWebSocket);
  // Prevent localStorage from leaking between tests
  localStorage.clear();
  // Silence the iframe-load side-effects (no real iframe in jsdom)
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost', reload: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DevHost — presence strip', () => {
  it('renders one pill per seat in the presence strip', async () => {
    const wrapper = await mountDevHost();
    await activateSeat(wrapper);

    const pills = wrapper.findAll('.presence-strip__seat');
    expect(pills).toHaveLength(3);
  });

  it('shows the seat name (or "Seat N" for open seats)', async () => {
    const wrapper = await mountDevHost();
    await activateSeat(wrapper);

    const pills = wrapper.findAll('.presence-strip__seat');
    // Seat 1 is Alice (connected human)
    expect(pills[0].text()).toContain('Alice');
    // Seats 2 and 3 are open/AI → should show "Seat 2", "Seat 3"
    expect(pills[1].text()).toContain('Seat 2');
    expect(pills[2].text()).toContain('Seat 3');
  });

  it('shows AI badge for seats listed in cfg.aiSeats', async () => {
    const wrapper = await mountDevHost();
    await activateSeat(wrapper);

    const pills = wrapper.findAll('.presence-strip__seat');
    // Seat 1 is human — no AI badge
    expect(pills[0].find('.presence-strip__ai').exists()).toBe(false);
    // Seats 2 and 3 are in cfg.aiSeats → AI badge present
    expect(pills[1].find('.presence-strip__ai').exists()).toBe(true);
    expect(pills[2].find('.presence-strip__ai').exists()).toBe(true);
  });

  it('shows connected/away dot per seat', async () => {
    const wrapper = await mountDevHost();
    await activateSeat(wrapper);

    const pills = wrapper.findAll('.presence-strip__seat');
    // Seat 1 Alice is connected
    expect(pills[0].find('.presence-strip__dot.is-online').exists()).toBe(true);
    // Seat 2 is disconnected (no clientId)
    expect(pills[1].find('.presence-strip__dot.is-offline, .presence-strip__dot:not(.is-online)').exists()).toBe(true);
  });
});

describe('DevHost — seat switcher', () => {
  it('has a seat switcher button in-game', async () => {
    const wrapper = await mountDevHost();
    await activateSeat(wrapper);

    expect(wrapper.find('.dev-chrome__seat-switcher').exists()).toBe(true);
  });

  it('switchSeat sends leave then join in order', async () => {
    const wrapper = await mountDevHost();
    await activateSeat(wrapper, 1);

    const ws = mockWsInstance!;
    ws.send.mockClear();

    // Call switchSeat(2) — should leaveSeat() then takeSeat(2)
    await (wrapper.vm as unknown as { switchSeat(n: number): void }).switchSeat(2);
    await wrapper.vm.$nextTick();

    const calls = ws.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0]).toMatchObject({ type: 'leave' });
    expect(calls[1]).toMatchObject({ type: 'join', seat: 2 });
  });

  it('auto-disables follow when manually switching seats', async () => {
    const wrapper = await mountDevHost();
    await activateSeat(wrapper, 1);

    const ws = mockWsInstance!;
    // Simulate follow being active
    ws.simulateMessage({ type: 'follow', enabled: true });
    await wrapper.vm.$nextTick();

    ws.send.mockClear();

    await (wrapper.vm as unknown as { switchSeat(n: number): void }).switchSeat(2);
    await wrapper.vm.$nextTick();

    const calls = ws.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    // The first message should be disabling follow
    expect(calls[0]).toMatchObject({ type: 'follow', enabled: false });
    // Then leave + join
    const leaveIdx = calls.findIndex((c) => c.type === 'leave');
    const joinIdx = calls.findIndex((c) => c.type === 'join');
    expect(leaveIdx).toBeGreaterThanOrEqual(0);
    expect(joinIdx).toBeGreaterThan(leaveIdx);
  });

  it('does not switch to the current seat (no-op)', async () => {
    const wrapper = await mountDevHost();
    await activateSeat(wrapper, 1);

    const ws = mockWsInstance!;
    ws.send.mockClear();

    await (wrapper.vm as unknown as { switchSeat(n: number): void }).switchSeat(1);
    await wrapper.vm.$nextTick();

    const calls = ws.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    const leaveCall = calls.find((c) => c.type === 'leave');
    expect(leaveCall).toBeUndefined(); // no leave if already in that seat
  });
});
