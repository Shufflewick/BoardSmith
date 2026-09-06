// @vitest-environment jsdom
/**
 * #167: THE THREE CONTROLS THAT ONLY EXIST BECAUSE A PERSON IS WATCHING.
 *
 * `world-host.test.ts` proves the world behaves; this proves the chrome can
 * reach it. They are separate because the failures are: a host that drives a
 * world perfectly and a bar whose button sends nothing is a feature that is
 * fully built and dead in the field, which is the exact shape of failure this
 * repo has hit before.
 *
 * The socket is mocked, so what is asserted is the FRAME the bar sends and what
 * it does with the frames it gets back -- which is the whole of the outer
 * page's job. Nothing visual is proven here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import WorldDevHost from './WorldDevHost.vue';
import type { WorldDevConfig } from './world-config-types.js';
import { WORLD_HOST_SOURCE, WORLD_UI_SOURCE } from '../../ui/world/worldProtocol.js';

// ── A socket that records rather than connects ──────────────────────────────

interface MockWs {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  open(): void;
  deliver(message: Record<string, unknown>): void;
  drop(): void;
}

let socket: MockWs | null = null;

class FakeWebSocket {
  static readonly OPEN = 1;
  readyState = 0;
  send = vi.fn();
  close = vi.fn();
  private listeners: Record<string, Array<(event: unknown) => void>> = {};

  constructor(_url: string) {
    socket = this as unknown as MockWs;
  }
  addEventListener(event: string, callback: (event: unknown) => void): void {
    (this.listeners[event] ??= []).push(callback);
  }
  removeEventListener(): void {}
  open(): void {
    this.readyState = 1;
    this.listeners['open']?.forEach((cb) => cb({}));
  }
  deliver(message: Record<string, unknown>): void {
    this.listeners['message']?.forEach((cb) => cb({ data: JSON.stringify(message) }));
  }
  drop(): void {
    this.readyState = 3;
    this.listeners['close']?.forEach((cb) => cb({}));
  }
}

const CONFIG: WorldDevConfig = {
  displayName: 'Example MUD',
  seatCount: 4,
  worldUrl: '/__boardsmith-world',
  ownWorldUi: false,
  storePath: '/p/.boardsmith-dev-world/world.db',
};

/** What the bar sent, decoded. */
function sent(): Array<Record<string, unknown>> {
  return socket!.send.mock.calls.map((call) => JSON.parse(call[0] as string) as Record<string, unknown>);
}

function frames(type: string): Array<Record<string, unknown>> {
  return sent().filter((frame) => frame.type === type);
}

async function open(config: WorldDevConfig = CONFIG): Promise<VueWrapper> {
  const wrapper = mount(WorldDevHost, { props: { config }, attachTo: document.body });
  await wrapper.vm.$nextTick();
  socket!.open();
  await wrapper.vm.$nextTick();
  return wrapper;
}

/** One state frame, as the host pushes it. */
function stateFrame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'world_state',
    phase: 'watching',
    view: { here: 'hall' },
    seat: 1,
    actions: [{ name: 'look', prompt: 'Look around', selections: [] }],
    notice: null,
    worldName: 'The Dusk Hall',
    presence: [1],
    ...overrides,
  };
}

function statusFrame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'world_status',
    seatCount: 4,
    seats: [{ player: 'seat-1', seat: 1 }],
    presence: [1],
    resident: ['room:hall'],
    dirty: [],
    pending: [],
    nextDue: null,
    worldNow: 1_000_000,
    clockSkewMs: 0,
    storePath: '/p/world.db',
    completed: false,
    ...overrides,
  };
}

let originalWebSocket: unknown;
beforeEach(() => {
  socket = null;
  originalWebSocket = globalThis.WebSocket;
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  localStorage.clear();
});
afterEach(() => {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
});

describe('#167: the world chrome identifies itself and asks for state', () => {
  it('says hello with a persisted client id, so a reload is a reconnect', async () => {
    const wrapper = await open();
    const hello = frames('hello')[0];
    expect(hello).toBeDefined();
    // Persisted, not minted per connection: a world seat is where a player's
    // holdings are, so losing the identity loses the seat.
    expect(localStorage.getItem('boardsmith:world-dev-client-id')).toBe(hello!.clientId);
    wrapper.unmount();
  });

  it('uses a different key from the table host, since one browser plays both', async () => {
    const wrapper = await open();
    expect(localStorage.getItem('boardsmith:dev-client-id')).toBeNull();
    wrapper.unmount();
  });
});

describe('#167: the seat switcher', () => {
  it('offers exactly the seats the bundle declares', async () => {
    const wrapper = await open();
    socket!.deliver(statusFrame());
    await wrapper.vm.$nextTick();
    await wrapper.find('.world-dev__seat button').trigger('click');
    expect(wrapper.findAll('.world-dev__menu button')).toHaveLength(4);
    wrapper.unmount();
  });

  it('attaches to the seat that was clicked', async () => {
    const wrapper = await open();
    socket!.deliver(stateFrame());
    await wrapper.vm.$nextTick();
    await wrapper.find('.world-dev__seat button').trigger('click');
    await wrapper.findAll('.world-dev__menu button')[2]!.trigger('click');
    expect(frames('attach')).toEqual([{ type: 'attach', seat: 3 }]);
    wrapper.unmount();
  });

  it('sends nothing when the seat already held is chosen again', async () => {
    // Re-attaching to the seat you hold is not a no-op on the host: it would
    // re-announce an arrival to a world whose presence hooks act on one.
    const wrapper = await open();
    socket!.deliver(stateFrame({ seat: 2 }));
    await wrapper.vm.$nextTick();
    await wrapper.find('.world-dev__seat button').trigger('click');
    await wrapper.findAll('.world-dev__menu button')[1]!.trigger('click');
    expect(frames('attach')).toEqual([]);
    wrapper.unmount();
  });

  it('marks which seats somebody is looking through', async () => {
    const wrapper = await open();
    socket!.deliver(statusFrame({ presence: [2] }));
    await wrapper.vm.$nextTick();
    await wrapper.find('.world-dev__seat button').trigger('click');
    const marked = wrapper.findAll('.world-dev__menu li').map((li) => li.text());
    expect(marked[1]).toContain('here');
    expect(marked[0]).not.toContain('here');
    wrapper.unmount();
  });
});

describe('#167: fire due events now', () => {
  it('is refused while nothing is scheduled, rather than sending a no-op', async () => {
    const wrapper = await open();
    socket!.deliver(statusFrame({ pending: [] }));
    await wrapper.vm.$nextTick();
    const button = wrapper.findAll('button').find((b) => b.text().includes('Fire due events'))!;
    expect(button.attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('sends fire_due once the queue holds something, and says when it is due', async () => {
    const wrapper = await open();
    socket!.deliver(
      statusFrame({
        pending: [{ id: 'e1', due: 1_030_000, command: 'settleBurn', owner: 'seat-1' }],
        nextDue: 1_030_000,
      }),
    );
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('next in 30s');
    const button = wrapper.findAll('button').find((b) => b.text().includes('Fire due events'))!;
    await button.trigger('click');
    expect(frames('fire_due')).toEqual([{ type: 'fire_due' }]);
    wrapper.unmount();
  });

  it('shows how far ahead of the wall clock the world now is', async () => {
    // Said out loud because it is the price of the control: after firing, this
    // world's clock is not the author's, and a schedule read later will look
    // wrong to anybody who was not told.
    const wrapper = await open();
    socket!.deliver(statusFrame({ clockSkewMs: 600_000 }));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('clock +10m');
    wrapper.unmount();
  });
});

describe('#167: wake from parked', () => {
  it('sends wake, and reports the residency it is about', async () => {
    const wrapper = await open();
    socket!.deliver(statusFrame({ resident: ['a', 'b', 'c'] }));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Resident: 3');
    await wrapper.findAll('button').find((b) => b.text().includes('Wake from parked'))!.trigger('click');
    expect(frames('wake')).toEqual([{ type: 'wake' }]);
    wrapper.unmount();
  });

  it('shows the host\'s notice about what the wake dropped', async () => {
    const wrapper = await open();
    socket!.deliver({ type: 'world_notice', message: 'Parked and woken: 3 resident partition(s) dropped.' });
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('3 resident partition(s) dropped');
    wrapper.unmount();
  });
});

describe('#167: the bar bridges the socket to the world frame and back', () => {
  it('relays an action from the world UI onto the socket', async () => {
    const wrapper = await open();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          source: WORLD_UI_SOURCE,
          type: 'world_command',
          requestId: 'wc-1',
          action: 'say',
          args: { text: 'hello' },
        },
      }),
    );
    await wrapper.vm.$nextTick();
    expect(frames('action')).toEqual([
      { type: 'action', requestId: 'wc-1', action: 'say', args: { text: 'hello' } },
    ]);
    wrapper.unmount();
  });

  it('ignores a frame that is not stamped by a world UI', async () => {
    // Distinct source strings make a wrong pairing INERT rather than
    // half-consumed, which is what `worldProtocol.ts` chose them for.
    const wrapper = await open();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'shufflewick', type: 'world_command', requestId: 'x', command: 'say' },
      }),
    );
    await wrapper.vm.$nextTick();
    expect(frames('command')).toEqual([]);
    wrapper.unmount();
  });

  it('marks the last view as no longer live when the host stops answering', async () => {
    const wrapper = await open();
    socket!.deliver(stateFrame());
    await wrapper.vm.$nextTick();
    const frame = wrapper.find('iframe').element as HTMLIFrameElement;
    const posted: Array<Record<string, unknown>> = [];
    Object.defineProperty(frame, 'contentWindow', {
      value: { postMessage: (message: Record<string, unknown>) => posted.push(message) },
      configurable: true,
    });
    socket!.drop();
    await wrapper.vm.$nextTick();
    // The last view STAYS on screen, marked: taking the board away tells the
    // player nothing the banner does not already say.
    expect(posted.at(-1)).toMatchObject({
      source: WORLD_HOST_SOURCE,
      phase: 'lost',
      view: { here: 'hall' },
    });
    wrapper.unmount();
  });

  it("names the world the host says it is, not the game's display name", async () => {
    const wrapper = await open();
    socket!.deliver(stateFrame());
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.world-dev__name').text()).toBe('The Dusk Hall');
    wrapper.unmount();
  });
});

describe('#167: which surface is on screen is said out loud', () => {
  it("warns when it is the shell's own surface and not the bundle's", async () => {
    // The two look different, and an author who does not know which they are
    // looking at reads the generic one as their own UI failing to render.
    const wrapper = await open();
    expect(wrapper.text()).toContain("no world.html — showing the shell's own surface");
    wrapper.unmount();
  });

  it('says nothing when the bundle ships its own world.html', async () => {
    const wrapper = await open({ ...CONFIG, ownWorldUi: true });
    expect(wrapper.text()).not.toContain('showing the shell');
    expect(wrapper.find('iframe').attributes('src')).toBe('/__boardsmith-world');
    wrapper.unmount();
  });
});
