// @vitest-environment jsdom
/**
 * DevHost.vue — lobby gameOption/preset selector (D13/DEVHOST-01, Plan 03)
 *
 * Pre-fix: the lobby claim area (`:482-508`) only offers a Name input and (when
 * declared) a color-swatch row — there is NO way for a human to pick a declared
 * `gameOption` or `preset` before the game starts. This test proves that gap
 * (RED), then (post-fix, GREEN) that:
 *
 * 1. A declared `select` gameOption renders a control in the lobby claim area.
 * 2. A declared preset renders a picker in the lobby claim area.
 * 3. Choosing `difficulty=hard` and applying sends
 *    `{ type:'configure', gameOptions:{ difficulty:'hard' } }` on the wire.
 * 4. Choosing the preset fills the option selector with the preset's bundle
 *    (`difficulty` reflects the preset's declared value) and applying sends
 *    `{ type:'configure', preset:'Quick Match' }`.
 *
 * Mirrors the FakeWebSocket + mountAndActivate scaffolding from
 * DevHost.restart.test.ts.
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
  gameOptions: [
    {
      id: 'difficulty',
      type: 'select',
      label: 'Difficulty',
      default: 'easy',
      choices: [
        { value: 'easy', label: 'Easy' },
        { value: 'hard', label: 'Hard' },
      ],
    },
  ],
  playerOptions: [],
  presets: [
    {
      name: 'Quick Match',
      description: 'Fast hard game',
      options: { difficulty: 'hard' },
    },
  ],
  colorPalette: [],
  gameUrl: 'http://localhost:3000/game',
};

const SEAT_LOBBY = {
  type: 'lobby',
  seats: [{ seat: 1, clientId: null, name: '', connected: false }],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function mountInLobby(): Promise<VueWrapper> {
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
  return wrapper;
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

// ── Selector renders declared options/presets ─────────────────────────────────

describe('DevHost — lobby gameOption/preset selector (D13)', () => {
  it('renders a control for the declared gameOption in the lobby claim area', async () => {
    const wrapper = await mountInLobby();
    const claim = wrapper.find('.lobby__claim');
    expect(claim.exists()).toBe(true);

    // A select-type control bound to the declared option id.
    const optionControl = wrapper.find('[data-testid="lobby-option-difficulty"]');
    expect(optionControl.exists()).toBe(true);
  });

  it('renders a picker for the declared preset in the lobby claim area', async () => {
    const wrapper = await mountInLobby();
    const presetControl = wrapper.find('[data-testid="lobby-preset-picker"]');
    expect(presetControl.exists()).toBe(true);
    expect(wrapper.html()).toContain('Quick Match');
  });

  it('choosing difficulty=hard and applying sends {type:configure, gameOptions:{difficulty:"hard"}}', async () => {
    const wrapper = await mountInLobby();
    const ws = mockWsInstance!;
    ws.send.mockClear();

    const select = wrapper.find('[data-testid="lobby-option-difficulty"]');
    expect(select.exists()).toBe(true);
    await select.setValue('hard');

    const applyBtn = wrapper.find('[data-testid="lobby-apply-options"]');
    expect(applyBtn.exists()).toBe(true);
    await applyBtn.trigger('click');
    await wrapper.vm.$nextTick();

    const frames = ws.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    const configureFrame = frames.find((f) => f.type === 'configure');
    expect(configureFrame).toBeDefined();
    expect(configureFrame.gameOptions).toEqual({ difficulty: 'hard' });
  });

  it('selecting the preset fills the option selector with the preset bundle and applying sends the preset name', async () => {
    const wrapper = await mountInLobby();
    const ws = mockWsInstance!;
    ws.send.mockClear();

    const presetPicker = wrapper.find('[data-testid="lobby-preset-picker"]');
    expect(presetPicker.exists()).toBe(true);
    await presetPicker.setValue('Quick Match');
    await wrapper.vm.$nextTick();

    // The option selector should now reflect the preset's bundled value.
    const select = wrapper.find('[data-testid="lobby-option-difficulty"]');
    expect((select.element as HTMLSelectElement).value).toBe('hard');

    const applyBtn = wrapper.find('[data-testid="lobby-apply-options"]');
    await applyBtn.trigger('click');
    await wrapper.vm.$nextTick();

    const frames = ws.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    const configureFrame = frames.find((f) => f.type === 'configure');
    expect(configureFrame).toBeDefined();
    expect(configureFrame.preset).toBe('Quick Match');
  });
});
