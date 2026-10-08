// @vitest-environment jsdom
/**
 * THE GAME CONTEXT GATES ITS TURN SIGNALS DURING TIME TRAVEL, LIKE THE BOARD'S PROPS (#520).
 *
 * While the debug panel shows history, the board is handed `isMyTurn` and
 * `availableActions` gated off (GameShell.custom-board-history-parity.test.ts).
 * The context published the LIVE ones beside the historical `gameView`, so a
 * child of the board that read the context offered controls the action
 * controller would refuse, and had no `isViewingHistory` to tell it why.
 *
 * Asserted on the REAL GameShell: the debug panel's own `time-travel` event
 * enters history, and a registered board reads the context back.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { usePlayContext } from '../composables/useGameContext.js';
import DebugPanel from './DebugPanel.vue';
import {
  enterIframe,
  leaveIframe,
  mountPlatformShell,
} from './GameShell.platform-mount.test-helper.js';

/** A board that draws the three turn signals from the context, the way a child component reads them. */
const ContextBoard = defineComponent({
  name: 'ContextBoard',
  setup() {
    const { isMyTurn, isViewingHistory, availableActions } = usePlayContext();
    return () =>
      h('div', { 'data-testid': 'context-signals' },
        `history=${isViewingHistory.value} myTurn=${isMyTurn.value} actions=${availableActions.value.join(',')}`);
  },
});

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { data: { source: 'shufflewick', ...data } }));
}

const players = [{ name: 'P1', seat: 1 }, { name: 'P2', seat: 2 }];

async function mountWithDebugPanel() {
  enterIframe();
  const wrapper = mountPlatformShell({ board: ContextBoard });
  await nextTick();
  post({ type: 'init', seat: 1 });
  post({ type: 'dev-debug-available', available: true });
  post({ type: 'dev-debug-toggle' });
  post({
    type: 'game_state',
    view: {
      flowState: { currentPlayer: 1, awaitingInput: true, availableActions: ['move'] },
      state: { view: {}, players, currentPlayer: 1, isMyTurn: true, availableActions: ['move'] },
    },
    winners: [],
  });
  await nextTick();
  await nextTick();
  const debugPanel = wrapper.findComponent(DebugPanel);
  expect(debugPanel.exists()).toBe(true);
  return { wrapper, debugPanel };
}

const signals = (wrapper: Awaited<ReturnType<typeof mountWithDebugPanel>>['wrapper']) =>
  wrapper.find('[data-testid="context-signals"]').text();

afterEach(() => {
  leaveIframe();
  document.body.innerHTML = '';
});

describe('GameShell game context during time travel (#520)', () => {
  it('publishes the live turn signals during live play', async () => {
    const { wrapper } = await mountWithDebugPanel();
    expect(signals(wrapper)).toBe('history=false myTurn=true actions=move');
    wrapper.unmount();
  });

  it('says it is viewing history, and that the seat cannot act, while the debug panel shows history', async () => {
    const { wrapper, debugPanel } = await mountWithDebugPanel();

    debugPanel.vm.$emit('time-travel', { view: {}, players, isMyTurn: true, availableActions: ['move'] }, 3, null);
    await nextTick();

    expect(wrapper.find('.time-travel-banner').exists()).toBe(true);
    expect(signals(wrapper)).toBe('history=true myTurn=false actions=');
    wrapper.unmount();
  });

  it('restores the live signals on return to the current position', async () => {
    const { wrapper, debugPanel } = await mountWithDebugPanel();

    debugPanel.vm.$emit('time-travel', { view: {}, players }, 3, null);
    await nextTick();
    debugPanel.vm.$emit('time-travel', null, null, null);
    await nextTick();

    expect(signals(wrapper)).toBe('history=false myTurn=true actions=move');
    wrapper.unmount();
  });
});
