// @vitest-environment jsdom
/**
 * A BOARD'S `<Teleport to="#bs-game-modal">` RESOLVES ON THE REAL GameShell.
 *
 * A board mounted in the same pass as the shell looks the target up while the tree is still
 * detached, finds nothing, and its first re-render throws mid-patch, wedging the whole UI
 * (the cribbage round-summary wedge). The shell mounts the board one tick late so the host exists.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, nextTick, Teleport } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { enterIframe, leaveIframe, mountPlatformShell } from './GameShell.platform-mount.test-helper.js';

function fromHost(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: { source: 'shufflewick', ...data } }));
}

function frame(summary: boolean, prompt: string): Record<string, unknown> {
  return {
    type: 'game_state',
    view: {
      flowState: { currentPlayer: 1, awaitingInput: true, availableActions: ['go', 'pass'] },
      state: {
        view: { summary },
        players: [{ name: 'P1', seat: 1 }, { name: 'P2', seat: 2 }],
        currentPlayer: 1,
        isMyTurn: true,
        availableActions: ['go', 'pass'],
        actionMetadata: { go: { name: 'go', prompt, selections: [] }, pass: { name: 'pass', prompt: 'Pass', selections: [] } },
      },
    },
    winners: [],
  };
}

/** Like cribbage's round summary: the Teleport is always rendered, its content only at a round's end. */
const ModalBoard = defineComponent({
  name: 'ModalBoard',
  props: { gameView: { type: Object, default: null } },
  setup(props) {
    return () =>
      h('div', { class: 'modal-board' }, [
        h(Teleport, { to: '#bs-game-modal' }, [
          props.gameView?.summary ? h('div', { class: 'round-summary' }, 'Round summary') : null,
        ]),
      ]);
  },
});

const mounted: Array<{ unmount(): void }> = [];

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.innerHTML = '';
  leaveIframe();
});

describe('GameShell #bs-game-modal host', () => {
  it('renders a board\'s teleported modal into the host, and the board and Action Panel keep updating', async () => {
    enterIframe();
    const root = document.body.appendChild(document.createElement('div'));
    const wrapper = mountPlatformShell({ board: ModalBoard, attachTo: root });
    mounted.push(wrapper);
    await nextTick();
    fromHost({ type: 'init', seat: 1 });
    fromHost(frame(false, 'Go first'));
    await flushPromises();
    const goButton = () => wrapper.find('#bs-actionbar .action-panel-root').findAll('button').find((b) => b.text().includes('Go'));
    expect(wrapper.find('.modal-board').exists()).toBe(true);
    expect(goButton()?.text()).toContain('Go first');

    fromHost(frame(true, 'Go second'));
    await flushPromises();
    expect(document.querySelector('#bs-game-modal .round-summary')?.textContent).toBe('Round summary');
    expect(goButton()?.text()).toContain('Go second');

    fromHost(frame(false, 'Go third'));
    await flushPromises();
    expect(document.querySelector('#bs-game-modal .round-summary')).toBeNull();
    expect(goButton()?.text()).toContain('Go third');
  });
});
