// @vitest-environment jsdom
/**
 * #567: OBJECT-VALUED GAME-SETUP CHOICES ARE DISTINCT OPTIONS IN THE LOBBY.
 *
 * The lobby keyed each `select` gameOption choice by `String(c.value)`, so every
 * object-valued choice keyed as '[object Object]'. Vue then cannot tell them
 * apart: when the list changes it hands one choice's <option> to another. A
 * choice is keyed the way the engine identifies it (`choiceValueKey` beside
 * `valuesEqual` in `engine/action/choice-matching.ts`), as the Action Panel
 * does (#563).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reactive, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import DevHost from './DevHost.vue';
import type { DevHostConfig } from './config-types.js';

let socket: FakeWebSocket | null = null;

class FakeWebSocket {
  readyState: number = WebSocket.CONNECTING;
  send = vi.fn();
  close = vi.fn();
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};

  constructor(_url: string) {
    socket = this;
  }

  addEventListener(event: string, cb: (ev: unknown) => void) {
    (this.listeners[event] ??= []).push(cb);
  }

  removeEventListener(event: string, cb: (ev: unknown) => void) {
    this.listeners[event] = (this.listeners[event] ?? []).filter((l) => l !== cb);
  }

  open() {
    this.readyState = WebSocket.OPEN;
    this.listeners['open']?.forEach((cb) => cb({}));
  }

  receive(data: Record<string, unknown>) {
    this.listeners['message']?.forEach((cb) => cb({ data: JSON.stringify(data) }));
  }
}

const NORTH = { value: { from: 'harbor', to: 'north' }, label: 'Harbor to north' };
const SOUTH = { value: { from: 'harbor', to: 'south' }, label: 'Harbor to south' };
const EAST = { value: { from: 'market', to: 'east' }, label: 'Market to east' };

function configWith(choices: Array<{ value: unknown; label: string }>): DevHostConfig {
  return reactive({
    displayName: 'Test Game',
    minPlayers: 2,
    maxPlayers: 2,
    playerCount: 2,
    botSeats: [],
    botLevel: '',
    gameOptions: [{ id: 'route', type: 'select', label: 'Route', choices }],
    playerOptions: [],
    presets: [],
    colorPalette: [],
    gameUrl: 'http://localhost:3000/game',
  }) as DevHostConfig;
}

const mounted: VueWrapper[] = [];

async function mountInLobby(config: DevHostConfig): Promise<VueWrapper> {
  const wrapper = mount(DevHost, { props: { config }, attachTo: document.body });
  mounted.push(wrapper);
  await nextTick();
  socket!.open();
  await nextTick();
  socket!.receive({
    type: 'lobby',
    seats: [{ seat: 1, held: false, mine: false, name: '', connected: false }],
  });
  await nextTick();
  return wrapper;
}

function optionFor(wrapper: VueWrapper, label: string): HTMLOptionElement {
  const option = wrapper
    .findAll('[data-testid="lobby-option-route"] option')
    .find((o) => o.text() === label);
  expect(option, `the lobby should offer "${label}"`).toBeTruthy();
  return option!.element as HTMLOptionElement;
}

beforeEach(() => {
  socket = null;
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost', reload: vi.fn() });
  localStorage.clear();
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('object-valued game-setup choices in the DevHost lobby (#567)', () => {
  it('offers each object choice as its own option, and applying sends the chosen object', async () => {
    const wrapper = await mountInLobby(configWith([NORTH, SOUTH]));

    const select = wrapper.find('[data-testid="lobby-option-route"]');
    expect(select.findAll('option').map((o) => o.text())).toEqual(['Harbor to north', 'Harbor to south']);

    optionFor(wrapper, 'Harbor to south').selected = true;
    await select.trigger('change');
    socket!.send.mockClear();
    await wrapper.find('[data-testid="lobby-apply-options"]').trigger('click');

    const frames = socket!.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    expect(frames.find((f) => f.type === 'configure')?.gameOptions).toEqual({ route: SOUTH.value });
  });

  it('keeps each object choice on its own option when the list changes', async () => {
    const config = configWith([NORTH, SOUTH, EAST]);
    const wrapper = await mountInLobby(config);

    const southOption = optionFor(wrapper, 'Harbor to south');
    const eastOption = optionFor(wrapper, 'Market to east');

    // The declared list narrows: north is no longer on offer.
    config.gameOptions[0].choices = [SOUTH, EAST];
    await nextTick();

    expect(optionFor(wrapper, 'Harbor to south')).toBe(southOption);
    expect(optionFor(wrapper, 'Market to east')).toBe(eastOption);
  });
});
