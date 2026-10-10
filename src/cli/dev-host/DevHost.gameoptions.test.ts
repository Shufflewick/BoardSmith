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
  seats: [{ seat: 1, held: false, mine: false, name: '', connected: false }],
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

// ── Object-valued options (#572) ──────────────────────────────────────────────
//
// An option's choice values may be objects. The default is then a different
// object from the matching choice, so it must be matched structurally (the
// `valuesEqual` rule the engine keys choices by), and an object choice with no
// label must be shown by the same label derivation the Action Panel uses, never
// as "[object Object]".
const OBJECT_CONFIG: DevHostConfig = {
  ...TEST_CONFIG,
  gameOptions: [
    {
      id: 'board',
      type: 'select',
      label: 'Board',
      default: { width: 9, height: 9 },
      choices: [
        { value: { width: 9, height: 9 }, label: 'Small' },
        { value: { width: 19, height: 19 }, label: 'Large' },
      ],
    },
    {
      id: 'terrain',
      type: 'select',
      label: 'Terrain',
      default: { name: 'Forest' },
      choices: [{ value: { name: 'Forest' } }, { value: { size: 3 } }],
    },
  ],
  presets: [],
};

describe('DevHost: object-valued game options (#572)', () => {
  async function mountActive(): Promise<VueWrapper> {
    const wrapper = mount(DevHost, { props: { config: OBJECT_CONFIG }, attachTo: document.body });
    await wrapper.vm.$nextTick();
    const ws = mockWsInstance!;
    ws.simulateOpen();
    await wrapper.vm.$nextTick();
    ws.simulateMessage(SEAT_LOBBY);
    await wrapper.vm.$nextTick();
    return wrapper;
  }

  async function tableSetupDefaults(wrapper: VueWrapper): Promise<string[]> {
    mockWsInstance!.simulateMessage({ type: 'init', seat: 1 });
    await wrapper.vm.$nextTick();
    await wrapper.findAll('[data-testid="table-setup-toggle"]')[0].trigger('click');
    await wrapper.vm.$nextTick();
    return wrapper.findAll('.table-setup__row')
      .filter((row) => ['Board', 'Terrain'].includes(row.find('dt').text()))
      .map((row) => row.find('dd').text());
  }

  it('Table setup names an object-valued default by its choice label', async () => {
    const wrapper = await mountActive();
    expect(await tableSetupDefaults(wrapper)).toEqual(['Small', 'Forest']);
  });

  it('the lobby lists an object choice with no label by its derived label, never [object Object]', async () => {
    const wrapper = await mountActive();
    const options = wrapper.find('[data-testid="lobby-option-terrain"]').findAll('option');
    expect(options.map((o) => o.text())).toEqual(['Forest', '{"size":3}']);
  });
});

// ── The host's applied selection is what the page shows (#541) ────────────────
//
// `boardsmith dev --game-option difficulty=hard` starts the game on 'hard', and
// a `configure` from another page changes it. The page learns either only from
// the lobby message, so the lobby fields and Table setup must show that value,
// never the declared default.
describe('DevHost: shows the game options the host applied (#541)', () => {
  const lobbyApplying = (gameOptions: Record<string, unknown>) => ({ ...SEAT_LOBBY, gameOptions });

  it('the lobby field shows the applied value, and Apply keeps it rather than resetting to the default', async () => {
    const wrapper = await mountInLobby();
    const ws = mockWsInstance!;
    ws.simulateMessage(lobbyApplying({ difficulty: 'hard' }));
    await wrapper.vm.$nextTick();

    const select = wrapper.find('[data-testid="lobby-option-difficulty"]');
    expect((select.element as HTMLSelectElement).value).toBe('hard');

    ws.send.mockClear();
    await wrapper.find('[data-testid="lobby-apply-options"]').trigger('click');
    const frames = ws.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    expect(frames.find((f) => f.type === 'configure')?.gameOptions).toEqual({ difficulty: 'hard' });
  });

  it('Table setup shows the applied value', async () => {
    const wrapper = await mountInLobby();
    const ws = mockWsInstance!;
    ws.simulateMessage(lobbyApplying({ difficulty: 'hard' }));
    ws.simulateMessage({ type: 'init', seat: 1 });
    await wrapper.vm.$nextTick();
    await wrapper.findAll('[data-testid="table-setup-toggle"]')[0].trigger('click');
    await wrapper.vm.$nextTick();
    const row = wrapper.findAll('.table-setup__row').find((r) => r.find('dt').text() === 'Difficulty');
    expect(row?.find('dd').text()).toBe('Hard');
  });

  it('a lobby message that applies nothing new leaves an edit the player has not applied yet', async () => {
    const wrapper = await mountInLobby();
    const ws = mockWsInstance!;
    ws.simulateMessage(lobbyApplying({ difficulty: 'easy' }));
    await wrapper.vm.$nextTick();
    const select = wrapper.find('[data-testid="lobby-option-difficulty"]');
    await select.setValue('hard');

    ws.simulateMessage(lobbyApplying({ difficulty: 'easy' }));
    await wrapper.vm.$nextTick();
    expect((select.element as HTMLSelectElement).value).toBe('hard');
  });
});

describe('DevHost: a change the host applies later replaces what the page shows (#541)', () => {
  const lobbyApplying = (gameOptions: Record<string, unknown>) => ({ ...SEAT_LOBBY, gameOptions });

  // TEST_CONFIG's one option has two choices, so the field reads the old
  // applied value here: anything else would already be the new one.
  it('a later lobby with new values replaces the field, and Table setup follows', async () => {
    const wrapper = await mountInLobby();
    const ws = mockWsInstance!;
    ws.simulateMessage(lobbyApplying({ difficulty: 'easy' }));
    await wrapper.vm.$nextTick();
    const select = wrapper.find('[data-testid="lobby-option-difficulty"]');
    expect((select.element as HTMLSelectElement).value).toBe('easy');

    ws.simulateMessage(lobbyApplying({ difficulty: 'hard' }));
    await wrapper.vm.$nextTick();
    expect((select.element as HTMLSelectElement).value).toBe('hard');

    ws.simulateMessage({ type: 'init', seat: 1 });
    await wrapper.vm.$nextTick();
    await wrapper.findAll('[data-testid="table-setup-toggle"]')[0].trigger('click');
    await wrapper.vm.$nextTick();
    const row = wrapper.findAll('.table-setup__row').find((r) => r.find('dt').text() === 'Difficulty');
    expect(row?.find('dd').text()).toBe('Hard');
  });

  it('a later lobby with new values clears a preset chosen earlier, so the next Apply does not send it', async () => {
    const wrapper = await mountInLobby();
    const ws = mockWsInstance!;
    ws.simulateMessage(lobbyApplying({ difficulty: 'easy' }));
    await wrapper.vm.$nextTick();
    const presetPicker = wrapper.find('[data-testid="lobby-preset-picker"]');
    await presetPicker.setValue('Quick Match');

    ws.simulateMessage(lobbyApplying({ difficulty: 'hard' }));
    await wrapper.vm.$nextTick();
    expect((presetPicker.element as HTMLSelectElement).value).toBe('');

    ws.send.mockClear();
    await wrapper.find('[data-testid="lobby-apply-options"]').trigger('click');
    const frames = ws.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    const configure = frames.find((f) => f.type === 'configure');
    expect(configure?.preset).toBeUndefined();
    expect(configure?.gameOptions).toEqual({ difficulty: 'hard' });
  });
});
