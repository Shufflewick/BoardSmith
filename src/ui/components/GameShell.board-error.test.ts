// @vitest-environment jsdom
/**
 * A BOARD THAT THROWS WHILE RENDERING DOES NOT FREEZE THE SHELL (#1149).
 *
 * In dev Vue rethrows an unhandled render error out of the patch, so a board
 * that threw once left the shell's vnode tree half-patched: every later update
 * failed ("Cannot set properties of null (setting '__vnode')") and the Action
 * Panel froze until a reload. Driven on the REAL GameShell and transport.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { enterIframe, leaveIframe, mountPlatformShell } from './GameShell.platform-mount.test-helper.js';
import GameShell from './GameShell.vue';
import BoardErrorBoundary from './BoardErrorBoundary.vue';
import { defineGameUIs, defaultUI, devUI } from '../game-uis.js';

function fromHost(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: { source: 'shufflewick', ...data } }));
}

/** Seat 1's frame; `broken` makes the board below throw. */
function frame(broken: boolean, prompt: string): Record<string, unknown> {
  return {
    type: 'game_state',
    view: {
      flowState: { currentPlayer: 1, awaitingInput: true, availableActions: ['go', 'pass'] },
      state: {
        view: { broken },
        players: [{ name: 'P1', seat: 1 }, { name: 'P2', seat: 2 }],
        currentPlayer: 1,
        isMyTurn: true,
        // Two actions, so the panel waits for the player rather than auto-running a sole one.
        availableActions: ['go', 'pass'],
        actionMetadata: { go: { name: 'go', prompt, selections: [] }, pass: { name: 'pass', prompt: 'Pass', selections: [] } },
      },
    },
    winners: [],
  };
}

const ThrowingBoard = defineComponent({
  name: 'ThrowingBoard',
  props: { gameView: { type: Object, default: null } },
  setup(props) {
    return () => {
      if (props.gameView?.broken) throw new Error('hand is undefined');
      return h('div', { class: 'good-board' }, 'board');
    };
  },
});

const mounted: Array<{ unmount(): void }> = [];

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  leaveIframe();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('GameShell board error boundary (#1149)', () => {
  it('shows the error in the board area, logs it once, keeps the panel working, and recovers on the next state', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const posted = enterIframe() as Array<{ type?: string; op?: string }>;
    const wrapper = mountPlatformShell({ board: ThrowingBoard });
    mounted.push(wrapper);
    await nextTick();
    fromHost({ type: 'init', seat: 1 });
    fromHost(frame(false, 'Go first'));
    await flushPromises();
    expect(wrapper.find('.good-board').exists()).toBe(true);

    fromHost(frame(true, 'Go second'));
    await flushPromises();

    const alert = wrapper.find('[data-testid="bs-board-error"]');
    expect(alert.exists(), 'the board area says the board failed').toBe(true);
    expect(alert.attributes('role')).toBe('alert');
    expect(alert.text()).toContain('hand is undefined');
    expect(alert.text()).not.toMatch(/\bat \S+:\d+/);
    expect(consoleError).toHaveBeenCalledTimes(1);

    // The panel still follows the state, and still sends.
    const go = () => wrapper.find('#bs-actionbar .action-panel-root').findAll('button').find((b) => b.text().includes('Go'));
    expect(go()?.text()).toContain('Go second');
    await go()!.trigger('click');
    expect(posted.some((m) => m.type === 'server_request' && m.op === 'action')).toBe(true);

    fromHost(frame(false, 'Go third'));
    await flushPromises();
    expect(wrapper.find('[data-testid="bs-board-error"]').exists()).toBe(false);
    expect(wrapper.find('.good-board').exists()).toBe(true);
    expect(go()?.text()).toContain('Go third');
  });

  it('clears the error when the dev host switches to another board, without waiting for a new state', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    enterIframe();
    const GoodBoard = defineComponent({ name: 'GoodBoard', setup: () => () => h('div', { class: 'other-board' }, 'other') });
    // Shaped like an ES module, which is what defineAsyncComponent unwraps `default` from.
    const otherModule = { __esModule: true, default: GoodBoard };
    const wrapper = mount(GameShell, {
      props: { uis: defineGameUIs({ Broken: defaultUI(ThrowingBoard), Other: devUI(async () => otherModule) }) },
    });
    mounted.push(wrapper);
    await nextTick();
    fromHost({ type: 'init', seat: 1 });
    fromHost(frame(true, 'Go'));
    await flushPromises();
    expect(wrapper.find('[data-testid="bs-board-error"]').exists()).toBe(true);

    fromHost({ type: 'dev-ui-select', name: 'Other' });
    await flushPromises();
    expect(wrapper.find('[data-testid="bs-board-error"]').exists()).toBe(false);
    expect(wrapper.find('.other-board').exists()).toBe(true);
  });
});

describe('BoardErrorBoundary in production', () => {
  it('shows only the fixed sentence, never the thrown message', async () => {
    vi.stubEnv('DEV', false);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Broken = defineComponent({ setup: () => () => { throw new Error('secret internals'); } });
    const wrapper = mount(BoardErrorBoundary, { props: { state: 1, board: Broken }, slots: { default: () => h(Broken) } });
    mounted.push(wrapper);
    await nextTick();
    const alert = wrapper.find('[data-testid="bs-board-error"]');
    expect(alert.text()).toBe('The board hit an error and could not be drawn. It will try again when the game changes.');
    expect(alert.text()).not.toContain('secret internals');
  });
});
