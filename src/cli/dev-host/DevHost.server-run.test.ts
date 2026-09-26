// @vitest-environment jsdom
/**
 * #416: a tab left open across a `boardsmith dev` restart is not a player of
 * the new run.
 *
 * The page remembers the run it joined (`welcome`) and names it in every later
 * `hello`. Vite reloads every open page when the dev server comes back, so a
 * tab left open across a restart arrives as a new page load: the run it joined
 * survives exactly that reload, through sessionStorage, written when the socket
 * drops. On `stale_run` the page asks to be reloaded instead of showing a game
 * it holds no seat in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import DevHost from './DevHost.vue';
import type { DevHostConfig } from './config-types.js';

/** A browser socket this suite opens, drops and speaks for by hand. */
class ScriptedSocket extends EventTarget {
  static readonly OPEN = 1;
  readyState = 0;
  readonly sent: Array<Record<string, unknown>> = [];
  constructor() {
    super();
    opened.push(this);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.readyState = 3;
  }
  connect(): void {
    this.readyState = ScriptedSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }
  receive(frame: Record<string, unknown>): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(frame) }));
  }
  drop(): void {
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
  hellos(): Array<Record<string, unknown>> {
    return this.sent.filter((frame) => frame.type === 'hello');
  }
}

let opened: ScriptedSocket[] = [];
const latest = (): ScriptedSocket => opened[opened.length - 1];

const config: DevHostConfig = {
  gameType: 'server-run',
  displayName: 'Server Run',
  playerCount: 2,
  minPlayers: 2,
  maxPlayers: 2,
  botLevel: '',
  botSeats: [],
  presets: [],
  gameOptions: [],
  playerOptions: [],
  colorPalette: [],
  gameUrl: 'http://localhost:3000/game',
};

const DROPPED_RUN_KEY = 'boardsmith:dev-run-left';

async function openPage() {
  const wrapper = mount(DevHost, { props: { config }, attachTo: document.body });
  await wrapper.vm.$nextTick();
  return wrapper;
}

/** Drop the socket and let the page's one-second retry open the next one. */
function reconnect(): ScriptedSocket {
  latest().drop();
  vi.advanceTimersByTime(1000);
  latest().connect();
  return latest();
}

beforeEach(() => {
  opened = [];
  vi.stubGlobal('WebSocket', ScriptedSocket);
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost', reload: vi.fn() });
  localStorage.clear();
  sessionStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
});

describe('DevHost — the dev-server run this page joined (#416)', () => {
  it('a fresh page load names no run in its hello', async () => {
    await openPage();
    latest().connect();
    expect(latest().hellos()).toEqual([{ type: 'hello', clientId: expect.any(String) }]);
  });

  it('names the run it joined when its socket reconnects', async () => {
    await openPage();
    const first = latest();
    first.connect();
    first.receive({ type: 'welcome', runId: 'run-1' });

    const second = reconnect();
    expect(second).not.toBe(first);
    expect(second.hellos()).toEqual([{ type: 'hello', clientId: first.hellos()[0].clientId, runId: 'run-1' }]);
  });

  it('remembers the run it joined for the next page load when its socket drops', async () => {
    await openPage();
    latest().connect();
    latest().receive({ type: 'welcome', runId: 'run-1' });
    expect(sessionStorage.getItem(DROPPED_RUN_KEY)).toBeNull();
    latest().drop();
    expect(sessionStorage.getItem(DROPPED_RUN_KEY)).toBe('run-1');
  });

  it('a page loaded after its socket dropped (Vite reloading it) names that run, once', async () => {
    sessionStorage.setItem(DROPPED_RUN_KEY, 'run-1');
    await openPage();
    latest().connect();
    expect(latest().hellos()[0].runId).toBe('run-1');
    expect(sessionStorage.getItem(DROPPED_RUN_KEY)).toBeNull();
  });

  it('forgets the dropped run once the same run welcomes it back', async () => {
    await openPage();
    latest().connect();
    latest().receive({ type: 'welcome', runId: 'run-1' });
    reconnect().receive({ type: 'welcome', runId: 'run-1' });
    expect(sessionStorage.getItem(DROPPED_RUN_KEY)).toBeNull();
  });

  it('on stale_run shows the restart message and a reload button, and no game', async () => {
    const wrapper = await openPage();
    latest().connect();
    latest().receive({ type: 'welcome', runId: 'run-1' });
    latest().receive({ type: 'init', seat: 1 });
    await wrapper.vm.$nextTick();
    expect(wrapper.find('iframe').exists()).toBe(true);

    reconnect().receive({ type: 'stale_run' });
    await wrapper.vm.$nextTick();

    const notice = wrapper.find('[data-testid="server-restarted"]');
    expect(notice.text()).toContain('The dev server restarted. Reload to join the new game.');
    expect(wrapper.find('iframe').exists()).toBe(false);
    expect(wrapper.find('.dev-chrome').exists()).toBe(false);

    await notice.find('button').trigger('click');
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it('keeps naming the run it joined, and asking to be reloaded, across further drops', async () => {
    const wrapper = await openPage();
    latest().connect();
    latest().receive({ type: 'welcome', runId: 'run-1' });
    reconnect().receive({ type: 'stale_run' });
    const third = reconnect();
    await wrapper.vm.$nextTick();

    expect(third.hellos()[0].runId).toBe('run-1');
    expect(wrapper.find('[data-testid="server-restarted"]').exists()).toBe(true);
  });
});
