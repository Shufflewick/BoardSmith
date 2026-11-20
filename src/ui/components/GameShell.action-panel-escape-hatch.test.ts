// @vitest-environment jsdom
/**
 * The platform's escape hatch is the one thing that removes the Action Panel (#1643): the bar
 * keeps the prompt and drops the panel. A game cannot reach it; every action a game offers is in the panel.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { enterIframe, leaveIframe, mountPlatformShell } from './GameShell.platform-mount.test-helper.js';

const mounted: Array<{ unmount(): void }> = [];

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  leaveIframe();
});

async function shellOnMove(platformActionPanelEscapeHatch: boolean) {
  enterIframe();
  const wrapper = mountPlatformShell({ props: { platformActionPanelEscapeHatch } });
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
        availableActions: ['go', 'pass'],
        actionMetadata: { go: { name: 'go', prompt: 'Go now', selections: [] }, pass: { name: 'pass', prompt: 'Pass', selections: [] } },
      },
    },
    winners: [],
  });
  await flushPromises();
  return wrapper;
}

describe('the platform Action Panel escape hatch', () => {
  it('shows the Action Panel by default', async () => {
    const wrapper = await shellOnMove(false);
    expect(wrapper.find('#bs-actionbar .action-panel-root').exists()).toBe(true);
  });

  it('replaces the Action Panel with the prompt when the platform sets it', async () => {
    const wrapper = await shellOnMove(true);
    expect(wrapper.find('#bs-actionbar .action-panel-root').exists()).toBe(false);
    expect(wrapper.find('#bs-actionbar .turn .pr').exists()).toBe(true);
  });
});
