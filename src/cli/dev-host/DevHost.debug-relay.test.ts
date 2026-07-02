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
