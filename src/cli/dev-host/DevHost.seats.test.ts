// @vitest-environment jsdom
/**
 * DevHost.vue — seat switcher tests (DEV-03)
 *
 * Tests the seat-switcher menu (presence + Follow) and the switch message order.
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
  readyState: number = WebSocket.CONNECTING;
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

describe('DevHost — seat switcher menu (presence + follow)', () => {
  // The standalone presence strip was removed; per-seat presence (name, AI, online
  // status) and the Follow-active-seat toggle now live inside the seat-switcher menu.
  async function openMenu(wrapper: Awaited<ReturnType<typeof mountDevHost>>) {
    await wrapper.find('.dev-chrome__badge--btn').trigger('click');
    await wrapper.vm.$nextTick();
  }

  it('lists "Follow active seat" as the first menu option', async () => {
    const wrapper = await mountDevHost();
    await activateSeat(wrapper);
    await openMenu(wrapper);

    const items = wrapper.findAll('.seat-switcher-menu__item');
    expect(items.length).toBeGreaterThanOrEqual(4); // follow + 3 seats
    expect(items[0].text()).toContain('Follow active seat');
  });

  it('shows a connection dot and name per seat', async () => {
    const wrapper = await mountDevHost();
    await activateSeat(wrapper);
    await openMenu(wrapper);

    const dots = wrapper.findAll('.seat-switcher-menu__dot');
    expect(dots).toHaveLength(3);
    // Seat 1 (Alice) is a connected human
    expect(dots[0].classes()).toContain('is-online');

    const items = wrapper.findAll('.seat-switcher-menu__item');
    expect(items.some((i) => i.text().includes('Alice'))).toBe(true);
  });

  it('shows AI badge for seats listed in cfg.aiSeats', async () => {
    const wrapper = await mountDevHost();
    await activateSeat(wrapper);
    await openMenu(wrapper);

    // Seats 2 and 3 are AI → two AI badges in the menu
    expect(wrapper.findAll('.seat-switcher-menu__ai')).toHaveLength(2);
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
