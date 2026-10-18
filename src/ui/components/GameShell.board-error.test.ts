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
import { flushPromises } from '@vue/test-utils';
import { enterIframe, leaveIframe, mountPlatformShell } from './GameShell.platform-mount.test-helper.js';

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
});
