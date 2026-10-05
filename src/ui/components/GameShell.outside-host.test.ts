// @vitest-environment jsdom
/**
 * A GAME OPENED OUTSIDE A HOST SAYS WHERE IT RUNS, AND CALLS NOTHING (#515).
 *
 * Every host mounts `GameShell` in an iframe: the `boardsmith dev` host and
 * ShufflewickPub. The only way to reach a top-level shell is to open the game's
 * URL directly. That used to render a lobby talking to an HTTP game server
 * which was deleted in 77d1e85a, so the page offered buttons that could only
 * fail. It now says, in one sentence, how to run the game, and makes no request.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import GameShell from './GameShell.vue';
import { defineGameUIs, defaultUI } from '../game-uis.js';
import './GameShell.platform-mount.test-helper.js';

const StubBoard = defineComponent({ name: 'StubBoard', setup: () => () => h('div', 'board') });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('GameShell outside a host frame (#515)', () => {
  it('renders only the "runs inside a host" sentence and makes no network request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const sockets: unknown[] = [];
    vi.stubGlobal('WebSocket', class { constructor(url: unknown) { sockets.push(url); } });

    // `window.parent === window`: no `enterIframe`, so this is a top-level page.
    const wrapper = mount(GameShell, {
      attachTo: document.body,
      props: { gameType: 'outside-host', uis: defineGameUIs({ Stub: defaultUI(StubBoard) }) },
    });
    await nextTick();
    await nextTick();

    expect(wrapper.text()).toBe(
      'This game runs inside a host. Start it with boardsmith dev or play it on Shufflewick.',
    );
    expect(wrapper.find('code').text()).toBe('boardsmith dev');
    expect(wrapper.findComponent(StubBoard).exists()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sockets).toEqual([]);
    wrapper.unmount();
  });
});
