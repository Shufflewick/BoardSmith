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
  displayName: 'Test Game',
  minPlayers: 2,
  maxPlayers: 4,
  playerCount: 3,
  botSeats: [2, 3], // seats 2 and 3 are bot
  botLevel: 'medium',
  gameOptions: [
    { id: 'speed', type: 'choice', label: 'Game Speed', default: 'normal', choices: [{ value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Fast' }] },
  ],
  playerOptions: [],
  presets: [],
  colorPalette: [],
  gameUrl: 'http://localhost:3000/game',
};

const SEAT_LOBBY = {
  type: 'lobby',
  seats: [
    { seat: 1, held: true, mine: false, name: 'Alice', connected: true },
    { seat: 2, held: false, mine: false, name: '', connected: false }, // bot seat
    { seat: 3, held: false, mine: false, name: '', connected: false }, // bot seat
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
  // The standalone presence strip was removed; per-seat presence (name, bot, online
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

  it('shows bot badge for seats listed in cfg.botSeats', async () => {
    const wrapper = await mountDevHost();
    await activateSeat(wrapper);
    await openMenu(wrapper);

    // Seats 2 and 3 are bot → two bot badges in the menu
    expect(wrapper.findAll('.seat-switcher-menu__ai')).toHaveLength(2);
  });
});

// Every dev-bar menu closes the same way: the seat menu (#610) and the phone
// width … menu (#664).
describe.each([
  { name: 'seat menu', trigger: '[data-testid="seat-switcher"]', menu: '.seat-switcher-menu' },
  { name: '… menu', trigger: '.dev-chrome__overflow-trigger', menu: '.dev-chrome__overflow-menu' },
])('the $name closes the way a menu does', ({ trigger, menu }) => {
  async function openMenu(): Promise<VueWrapper> {
    const wrapper = await mountDevHost();
    await activateSeat(wrapper);
    await wrapper.find(trigger).trigger('click');
    expect(wrapper.find(menu).exists()).toBe(true);
    return wrapper;
  }

  it('closes on Escape', async () => {
    const wrapper = await openMenu();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find(menu).exists()).toBe(false);
    wrapper.unmount();
  });

  it('closes on a click outside it', async () => {
    const wrapper = await openMenu();
    await wrapper.find('.dev-chrome__brand').trigger('click');
    expect(wrapper.find(menu).exists()).toBe(false);
    wrapper.unmount();
  });

  it('closes when focus leaves the page, which is what a click inside the game frame does', async () => {
    const wrapper = await openMenu();
    window.dispatchEvent(new Event('blur'));
    await wrapper.vm.$nextTick();
    expect(wrapper.find(menu).exists()).toBe(false);
    wrapper.unmount();
  });

  it('opens and closes again from its own button', async () => {
    const wrapper = await openMenu();
    await wrapper.find(trigger).trigger('click');
    expect(wrapper.find(menu).exists()).toBe(false);
    wrapper.unmount();
  });

  // #667: a keyboard user who presses Escape lands back where they opened it.
  it('returns focus to its own button on Escape', async () => {
    const wrapper = await openMenu();
    (wrapper.find(`${menu} button`).element as HTMLElement).focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();
    expect(document.activeElement).toBe(wrapper.find(trigger).element);
    wrapper.unmount();
  });

  it('leaves focus where the user put it when closed by a click outside it', async () => {
    const wrapper = await openMenu();
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();
    outside.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.find(menu).exists()).toBe(false);
    expect(document.activeElement).toBe(outside);
    outside.remove();
    wrapper.unmount();
  });

  it('names the list it opens with aria-controls', async () => {
    const wrapper = await openMenu();
    const id = wrapper.find(menu).attributes('id');
    expect(id).toBeTruthy();
    expect(wrapper.find(trigger).attributes('aria-controls')).toBe(id);
    wrapper.unmount();
  });
});

// #664: at phone width the secondary controls live in the … menu, and choosing
// one closes it so it no longer covers the game.
describe('DevHost — choosing from the … menu closes it (#664)', () => {
  const MENU = '.dev-chrome__overflow-menu';

  async function openOverflow(): Promise<VueWrapper> {
    const wrapper = await mountDevHost();
    await activateSeat(wrapper);
    const ws = mockWsInstance!;
    ws.simulateMessage({ ...SEAT_LOBBY, debug: true });
    ws.simulateMessage({ type: 'game_state', view: {}, isComplete: false, winners: [], isDraw: false, deadlineAt: 9_000, serverNow: 4_000 });
    await wrapper.vm.$nextTick();
    await wrapper.find('.dev-chrome__overflow-trigger').trigger('click');
    expect(wrapper.find(MENU).exists()).toBe(true);
    return wrapper;
  }

  it.each(['table-setup-toggle', 'debug-toggle', 'fire-deadline'])('choosing %s closes it', async (testid) => {
    const wrapper = await openOverflow();
    await wrapper.find(`${MENU} [data-testid="${testid}"]`).trigger('click');
    expect(wrapper.find(MENU).exists()).toBe(false);
    wrapper.unmount();
  });

  it('New game stays open to ask for confirmation, then closes once the restart is confirmed', async () => {
    const wrapper = await openOverflow();
    await wrapper.find(`${MENU} [data-testid="new-game"]`).trigger('click');
    expect(wrapper.find(`${MENU} [data-testid="new-game"]`).text()).toContain('Confirm restart?');

    mockWsInstance!.send.mockClear();
    await wrapper.find(`${MENU} [data-testid="new-game"]`).trigger('click');
    expect(wrapper.find(MENU).exists()).toBe(false);
    const frames = mockWsInstance!.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    expect(frames.some((f) => f.type === 'restart')).toBe(true);
    wrapper.unmount();
  });

  // #667: an armed New game must not survive the menu closing, or reopening
  // the menu within 5 s would restart on one click.
  it.each([
    ['Escape', () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
    ['a click outside it', () => document.querySelector<HTMLElement>('.dev-chrome__brand')!.click()],
    ['focus leaving the page', () => window.dispatchEvent(new Event('blur'))],
    ['its own button', () => document.querySelector<HTMLElement>('.dev-chrome__overflow-trigger')!.click()],
    ['choosing Table setup', () => document.querySelector<HTMLElement>(`${MENU} [data-testid="table-setup-toggle"]`)!.click()],
  ])('closing it by %s cancels an armed New game', async (_how, close) => {
    const wrapper = await openOverflow();
    await wrapper.find(`${MENU} [data-testid="new-game"]`).trigger('click');
    close();
    await wrapper.vm.$nextTick();
    expect(wrapper.find(MENU).exists()).toBe(false);

    await wrapper.find('.dev-chrome__overflow-trigger').trigger('click');
    expect(wrapper.find(`${MENU} [data-testid="new-game"]`).text()).toContain('New game');
    expect(wrapper.find(`${MENU} [data-testid="new-game"]`).text()).not.toContain('Confirm restart?');
    wrapper.unmount();
  });

  it('an Escape while the … menu is closed leaves the bar\'s armed New game armed', async () => {
    const wrapper = await mountDevHost();
    await activateSeat(wrapper);
    const barNewGame = '.dev-chrome__bar-wide [data-testid="new-game"]';
    await wrapper.find(barNewGame).trigger('click');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find(barNewGame).text()).toContain('Confirm restart?');
    wrapper.unmount();
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

  it('Back to lobby (data-testid=leave-seat) leaves the seat and returns to the lobby picker (F-18)', async () => {
    // Give the config a preset so the actual `lobby-preset-picker` <select>
    // renders once we are back in the lobby (it is gated on cfg.presets.length).
    const wrapper = mount(DevHost, {
      props: {
        config: {
          ...TEST_CONFIG,
          presets: [{ name: 'Quick', options: { speed: 'fast' } }],
        },
      },
      attachTo: document.body,
    });
    await wrapper.vm.$nextTick();
    await activateSeat(wrapper, 1);

    // In-game: the seat switcher button is shown, the lobby picker is not.
    expect(wrapper.find('.dev-chrome__seat-switcher').exists()).toBe(true);
    expect(wrapper.find('[data-testid="lobby-preset-picker"]').exists()).toBe(false);

    const ws = mockWsInstance!;
    ws.send.mockClear();

    // Open the seat switcher menu and click "Back to lobby".
    await wrapper.find('.dev-chrome__badge--btn').trigger('click');
    await wrapper.vm.$nextTick();
    const leave = wrapper.find('[data-testid="leave-seat"]');
    expect(leave.exists()).toBe(true);
    await leave.trigger('click');
    await wrapper.vm.$nextTick();

    // It reuses leaveSeat(): sends a {type:'leave'} frame...
    const calls = ws.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    expect(calls.some((c) => c.type === 'leave')).toBe(true);
    // ...and clears mySeat so the lobby (with the preset picker) renders again.
    expect((wrapper.vm as unknown as { mySeat: number | null }).mySeat).toBeNull();
    expect(wrapper.find('[data-testid="lobby-preset-picker"]').exists()).toBe(true);
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

// The Debug panel's Controls tab asks for a seat with a `debug:switch-seat`
// server_request (#525). It is a host-chrome op, like `debug:restart`: the host
// has no handler for it, so forwarding it switched nothing.
describe('DevHost — debug:switch-seat from the Debug panel (#525)', () => {
  function postSwitch(seat: number): void {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'shufflewick-game', type: 'server_request', requestId: 'req-s', op: 'debug:switch-seat', payload: { seat } },
      }),
    );
  }

  it('switches to the asked seat the way the seat switcher does', async () => {
    const wrapper = await mountDevHost();
    await activateSeat(wrapper, 1);
    const ws = mockWsInstance!;
    ws.send.mockClear();

    postSwitch(3);
    await wrapper.vm.$nextTick();

    const frames = ws.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    expect(frames[0]).toMatchObject({ type: 'leave' });
    expect(frames[1]).toMatchObject({ type: 'join', seat: 3 });
    expect(frames.find((f) => f.type === 'server_request')).toBeUndefined();
    wrapper.unmount();
  });
});
