// @vitest-environment jsdom
/**
 * The platform's escape hatch is the one thing that removes the Action Panel (#1643): the bar
 * keeps the prompt and drops the panel. A game cannot reach it; every action a game offers is in the panel.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { usePlayContext } from '../composables/useGameContext.js';
import { enterIframe, leaveIframe, mountPlatformShell } from './GameShell.platform-mount.test-helper.js';

/** The platform's own board, which asks the question the Action Panel would have asked. */
const AskingBoard = defineComponent({
  name: 'AskingBoard',
  setup() {
    const { actionController } = usePlayContext();
    return () => h('button', { 'data-testid': 'ask', onClick: () => actionController.start('go') }, 'Go');
  },
});

const mounted: Array<{ unmount(): void }> = [];

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  leaveIframe();
});

async function shellOnMove(props?: { platformActionPanelEscapeHatch: boolean }) {
  enterIframe();
  const wrapper = mountPlatformShell({ board: AskingBoard, props });
  mounted.push(wrapper);
  await nextTick();
  const fromHost = (data: Record<string, unknown>) =>
    window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: { source: 'shufflewick', ...data } }));
  fromHost({ type: 'init', seat: 1 });
  fromHost({
    type: 'game_state',
    view: {
      flowState: { currentPlayer: 1, awaitingInput: true, availableActions: ['go', 'pass'] },
      state: {
        view: {},
        players: [{ name: 'P1', seat: 1 }, { name: 'P2', seat: 2 }],
        currentPlayer: 1,
        isMyTurn: true,
        // Two actions, so the shell starts neither by itself.
        availableActions: ['go', 'pass'],
        actionMetadata: {
          go: { name: 'go', prompt: 'Go', selections: [{ name: 'to', type: 'choice', prompt: 'Where to?', choices: [{ value: 1, display: 'North' }] }] },
          pass: { name: 'pass', prompt: 'Pass', selections: [] },
        },
      },
    },
    winners: [],
  });
  await flushPromises();
  return wrapper;
}

describe('the platform Action Panel escape hatch', () => {
  it('leaves the Action Panel in place by default', async () => {
    const wrapper = await shellOnMove();
    expect(wrapper.find('#bs-actionbar .action-panel-root').exists()).toBe(true);
  });

  it('replaces the Action Panel with the open question when the platform sets it', async () => {
    const wrapper = await shellOnMove({ platformActionPanelEscapeHatch: true });
    await wrapper.get('[data-testid="ask"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('#bs-actionbar .action-panel-root').exists()).toBe(false);
    expect(wrapper.get('#bs-actionbar .turn .pr').text()).toBe('Where to?');
  });
});
