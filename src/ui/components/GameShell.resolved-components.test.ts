// @vitest-environment jsdom
/**
 * EVERY TAG GAMESHELL RENDERS IS A COMPONENT IT CAN RESOLVE (#308).
 *
 * #170 moved `Toast` and `DisabledReasonTooltip` into `PlayShell` and dropped
 * their imports from `GameShell`, but left the two tags in GameShell's
 * template. Vue rendered them as unknown elements and warned on every render,
 * and the lobby and waiting room -- the screens outside `PlayShell` -- lost the
 * toast they speak through. The helper every other GameShell test mounts with
 * stubs both components, which is why no test noticed.
 *
 * So this file mounts the shell with no stubs for either, on each screen it can
 * reach, and fails on any "Failed to resolve component" warning -- for any
 * component, not just these two.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import GameShell from './GameShell.vue';
import { defineGameUIs, defaultUI } from '../game-uis.js';
import { useToast } from '../composables/useToast.js';
import { enterIframe, leaveIframe } from './GameShell.platform-mount.test-helper.js';
import { countPageSingletons, unresolvedComponents } from './page-singletons.test-helper.js';

const StubBoard = defineComponent({ name: 'StubBoard', setup: () => () => h('div', 'board') });

function mountShell(warnings: string[]) {
  return mount(GameShell, {
    attachTo: document.body,
    props: {
      gameType: 'resolved-components',
      uis: defineGameUIs({ Stub: defaultUI(StubBoard) }),
    },
    global: {
      // The real lobby opens a WebSocket to a dev server that is not running.
      // Stubbing it cannot hide an unresolved tag: GameShell imports GameLobby.
      stubs: { GameLobby: true },
      config: {
        warnHandler: (msg) => {
          warnings.push(msg);
        },
      },
    },
  });
}

afterEach(() => {
  leaveIframe();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('GameShell resolves every component it renders', () => {
  it('on the game screen (platform mode)', async () => {
    enterIframe();
    const warnings: string[] = [];
    const wrapper = mountShell(warnings);
    await nextTick();

    expect(unresolvedComponents(warnings)).toEqual([]);
    wrapper.unmount();
  });

  it('on the lobby screen', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, definitions: [] })),
    );
    const warnings: string[] = [];
    const wrapper = mountShell(warnings);
    await nextTick();

    expect(unresolvedComponents(warnings)).toEqual([]);
    wrapper.unmount();
  });
});

describe('the toast and the disabled-reason tooltip are mounted on every screen', () => {
  it('the lobby, which has no PlayShell, still shows a toast', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, definitions: [] })),
    );
    const wrapper = mountShell([]);
    await nextTick();

    expect(countPageSingletons(wrapper)).toEqual({ toast: 1, tooltip: 1 });

    const { error, remove } = useToast();
    const id = error('Could not load this game\'s setup options.');
    await nextTick();
    expect(document.body.textContent).toContain('Could not load this game\'s setup options.');
    remove(id);
    wrapper.unmount();
  });

  it('the game screen mounts exactly one of each', async () => {
    enterIframe();
    const wrapper = mountShell([]);
    await nextTick();

    expect(countPageSingletons(wrapper)).toEqual({ toast: 1, tooltip: 1 });
    wrapper.unmount();
  });
});
