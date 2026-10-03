// @vitest-environment jsdom
/**
 * DevHost.vue — debugToggle/uiSwitch host relay cases (DRIVE-03)
 *
 * Tests that:
 * 1. A host `{type:'debugToggle'}` message drives the EXISTING `toggleDebug()`
 *    function (postMessage `dev-debug-toggle` to the iframe) — no parallel logic.
 * 2. A host `{type:'uiSwitch', name}` message sets `selectedUi` and drives the
 *    EXISTING `onUiSelect()` function (postMessage `dev-ui-select` with the name).
 *
 * Reuses the FakeWebSocket harness from DevHost.restart.test.ts verbatim (do not
 * invent a new harness) and spies on the iframe's `contentWindow.postMessage`
 * exactly as that file's pattern implies (postToGame → win.postMessage).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import DevHost from './DevHost.vue';
import type { DevHostConfig } from './config-types.js';

// ── Mock WebSocket (verbatim from DevHost.restart.test.ts) ───────────────────

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
  botSeats: [],
  botLevel: '',
  gameOptions: [],
  playerOptions: [],
  presets: [],
  colorPalette: [],
  gameUrl: 'http://localhost:3000/game',
};

const SEAT_LOBBY = {
  type: 'lobby',
  debug: true,
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

/** Spy on the mounted iframe's contentWindow.postMessage (postToGame's target). */
function spyOnIframePostMessage(wrapper: VueWrapper): ReturnType<typeof vi.fn> {
  const iframe = wrapper.find('iframe').element as HTMLIFrameElement;
  const spy = vi.fn();
  Object.defineProperty(iframe, 'contentWindow', {
    value: { postMessage: spy },
    configurable: true,
  });
  return spy;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  mockWsInstance = null;
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost', reload: vi.fn() });
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('DevHost — debugToggle relay', () => {
  it('a debugToggle host message produces exactly one dev-debug-toggle postMessage', async () => {
    const wrapper = await mountAndActivate();
    const ws = mockWsInstance!;
    const postSpy = spyOnIframePostMessage(wrapper);

    ws.simulateMessage({ type: 'debugToggle' });
    await wrapper.vm.$nextTick();

    const debugToggleCalls = postSpy.mock.calls.filter(
      (c) => (c[0] as { type?: string }).type === 'dev-debug-toggle',
    );
    expect(debugToggleCalls).toHaveLength(1);
  });
});

describe('DevHost — uiSwitch relay', () => {
  it('a uiSwitch host message with name="custom" produces a dev-ui-select postMessage with that name', async () => {
    const wrapper = await mountAndActivate();
    const ws = mockWsInstance!;
    const postSpy = spyOnIframePostMessage(wrapper);

    ws.simulateMessage({ type: 'uiSwitch', name: 'custom' });
    await wrapper.vm.$nextTick();

    const uiSelectCalls = postSpy.mock.calls.filter(
      (c) => (c[0] as { type?: string }).type === 'dev-ui-select',
    );
    expect(uiSelectCalls.length).toBeGreaterThanOrEqual(1);
    expect(uiSelectCalls[uiSelectCalls.length - 1][0]).toMatchObject({ name: 'custom' });
  });
});

// Review follow-up (157-REVIEW Critical): the D10 draw signal must survive the
// DevHost -> iframe relay. Regression: a host game_state carrying isDraw:true
// must reach the iframe as isDraw:true, or every draw renders "Game Over" in
// `boardsmith dev`.
describe('DevHost — game_state isDraw relay (D10)', () => {
  it('relays isDraw:true from the host game_state through to the iframe', async () => {
    const wrapper = await mountAndActivate();
    const ws = mockWsInstance!;
    const postSpy = spyOnIframePostMessage(wrapper);

    ws.simulateMessage({
      type: 'game_state',
      view: { some: 'state' },
      isComplete: true,
      winners: [],
      isDraw: true,
    });
    await wrapper.vm.$nextTick();

    const gameStateCalls = postSpy.mock.calls.filter(
      (c) => (c[0] as { type?: string }).type === 'game_state',
    );
    expect(gameStateCalls.length).toBeGreaterThanOrEqual(1);
    expect(gameStateCalls[gameStateCalls.length - 1][0]).toMatchObject({ isComplete: true, isDraw: true });
  });

  it('relays isDraw:false for a normal (non-draw) completion', async () => {
    const wrapper = await mountAndActivate();
    const ws = mockWsInstance!;
    const postSpy = spyOnIframePostMessage(wrapper);

    ws.simulateMessage({
      type: 'game_state',
      view: { some: 'state' },
      isComplete: true,
      winners: [1],
      isDraw: false,
    });
    await wrapper.vm.$nextTick();

    const gameStateCalls = postSpy.mock.calls.filter(
      (c) => (c[0] as { type?: string }).type === 'game_state',
    );
    expect(gameStateCalls[gameStateCalls.length - 1][0]).toMatchObject({ isDraw: false });
  });
});

// #302: the dev host is the parent page of the platform contract (#301). It
// relays the host's deadline stamps, adds its own receipt time, and forwards
// all three unchanged on every replay.
describe('DevHost — game_state deadline relay (#302)', () => {
  afterEach(() => vi.restoreAllMocks());
  const lastGameState = (spy: ReturnType<typeof vi.fn>) =>
    spy.mock.calls.map((c) => c[0] as Record<string, unknown>).filter((m) => m.type === 'game_state').at(-1);

  it('relays deadlineAt and serverNow, and stamps receivedAt when the frame comes off the socket', async () => {
    const wrapper = await mountAndActivate();
    const ws = mockWsInstance!;
    const postSpy = spyOnIframePostMessage(wrapper);
    vi.spyOn(Date, 'now').mockReturnValue(5_000);

    ws.simulateMessage({ type: 'game_state', view: {}, isComplete: false, winners: [], isDraw: false, deadlineAt: 9_000, serverNow: 4_000 });
    await wrapper.vm.$nextTick();

    expect(lastGameState(postSpy)).toMatchObject({ deadlineAt: 9_000, serverNow: 4_000, receivedAt: 5_000 });
  });

  it('forwards the original receivedAt when the frame is replayed on request-state', async () => {
    const wrapper = await mountAndActivate();
    const ws = mockWsInstance!;
    const postSpy = spyOnIframePostMessage(wrapper);
    const now = vi.spyOn(Date, 'now').mockReturnValue(5_000);
    ws.simulateMessage({ type: 'game_state', view: {}, isComplete: false, winners: [], isDraw: false, deadlineAt: 9_000, serverNow: 4_000 });
    await wrapper.vm.$nextTick();

    now.mockReturnValue(7_000);
    window.dispatchEvent(new MessageEvent('message', { data: { source: 'shufflewick-game', type: 'request-state' } }));
    await wrapper.vm.$nextTick();

    expect(lastGameState(postSpy)).toMatchObject({ deadlineAt: 9_000, serverNow: 4_000, receivedAt: 5_000 });
  });

  it('offers "End step" only while a deadline is open, and it asks the host to fire it', async () => {
    const wrapper = await mountAndActivate();
    const ws = mockWsInstance!;
    const endStep = () => wrapper.findAll('[data-testid="fire-deadline"]');

    ws.simulateMessage({ type: 'game_state', view: {}, isComplete: false, winners: [], isDraw: false, deadlineAt: null, serverNow: 4_000 });
    await wrapper.vm.$nextTick();
    expect(endStep()).toHaveLength(0);

    ws.simulateMessage({ type: 'game_state', view: {}, isComplete: false, winners: [], isDraw: false, deadlineAt: 9_000, serverNow: 4_000 });
    await wrapper.vm.$nextTick();
    expect(endStep().length).toBeGreaterThan(0);

    ws.send.mockClear();
    await endStep()[0].trigger('click');
    const frames = ws.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    expect(frames).toEqual([{ type: 'fireDeadline' }]);
  });
});

// #481: the host says whether debugging is on (only one person holds the
// seats, or `--debug`), and the page follows it live.
describe('DevHost — debugging availability', () => {
  const availability = (spy: ReturnType<typeof vi.fn>) =>
    spy.mock.calls
      .map((c) => c[0] as { type?: string; available?: boolean })
      .filter((m) => m.type === 'dev-debug-available')
      .map((m) => m.available);

  it('hides the Debug buttons and tells the game when the host turns debugging off, and shows them again when it comes back', async () => {
    const wrapper = await mountAndActivate();
    const ws = mockWsInstance!;
    const postSpy = spyOnIframePostMessage(wrapper);
    expect(wrapper.findAll('[data-testid="debug-toggle"]').length).toBeGreaterThan(0);

    ws.simulateMessage({ ...SEAT_LOBBY, debug: false });
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('[data-testid="debug-toggle"]')).toHaveLength(0);
    expect(availability(postSpy).at(-1)).toBe(false);

    ws.simulateMessage({ ...SEAT_LOBBY, debug: true });
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('[data-testid="debug-toggle"]').length).toBeGreaterThan(0);
    expect(availability(postSpy).at(-1)).toBe(true);
  });

  it('does not open the panel from a debugToggle host message while debugging is off', async () => {
    const wrapper = await mountAndActivate();
    const ws = mockWsInstance!;
    const postSpy = spyOnIframePostMessage(wrapper);
    ws.simulateMessage({ ...SEAT_LOBBY, debug: false });
    await wrapper.vm.$nextTick();

    ws.simulateMessage({ type: 'debugToggle' });
    await wrapper.vm.$nextTick();
    expect(postSpy.mock.calls.filter((c) => (c[0] as { type?: string }).type === 'dev-debug-toggle')).toHaveLength(0);
  });

  it('tells a reloaded game page the current availability', async () => {
    const wrapper = await mountAndActivate();
    const ws = mockWsInstance!;
    ws.simulateMessage({ ...SEAT_LOBBY, debug: false });
    await wrapper.vm.$nextTick();
    const postSpy = spyOnIframePostMessage(wrapper);

    await wrapper.find('iframe').trigger('load');
    expect(availability(postSpy)).toEqual([false]);
  });
});
