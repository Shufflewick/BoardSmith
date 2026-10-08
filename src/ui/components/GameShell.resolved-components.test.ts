// @vitest-environment jsdom
/**
 * EVERY TAG GAMESHELL RENDERS IS A COMPONENT IT CAN RESOLVE (#308).
 *
 * #170 moved `Toast` and `DisabledReasonTooltip` into `PlayShell` and dropped
 * their imports from `GameShell`, but left the two tags in GameShell's
 * template. Vue rendered them as unknown elements and warned on every render.
 * The helper every other GameShell test mounts with stubs both components,
 * which is why no test noticed.
 *
 * So this file mounts the shell with no stubs for either, and fails on any
 * "Failed to resolve component" warning -- for any component, not just these
 * two.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import GameShell from './GameShell.vue';
import { defineGameUIs, defaultUI } from '../game-uis.js';
import { enterIframe, leaveIframe } from './GameShell.platform-mount.test-helper.js';
import { countPageSingletons, unresolvedComponents } from './page-singletons.test-helper.js';

const StubBoard = defineComponent({ name: 'StubBoard', setup: () => () => h('div', 'board') });

function mountShell(warnings: string[]) {
  return mount(GameShell, {
    attachTo: document.body,
    props: {
      uis: defineGameUIs({ Stub: defaultUI(StubBoard) }),
    },
    global: {
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
  it('inside a host', async () => {
    enterIframe();
    const warnings: string[] = [];
    const wrapper = mountShell(warnings);
    await nextTick();

    expect(unresolvedComponents(warnings)).toEqual([]);
    wrapper.unmount();
  });
});

describe('the toast and the disabled-reason tooltip', () => {
  it('are mounted exactly once each', async () => {
    enterIframe();
    const wrapper = mountShell([]);
    await nextTick();

    expect(countPageSingletons(wrapper)).toEqual({ toast: 1, tooltip: 1 });
    wrapper.unmount();
  });
});
