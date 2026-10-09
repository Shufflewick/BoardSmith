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
import { defineComponent, h, nextTick, type PropType } from 'vue';
import { usePlayContext, type PlayContext } from '../composables/useGameContext.js';
import ActionPanel from './auto-ui/ActionPanel.vue';
import PlayShell from './PlayShell.vue';
import {
  DEBUG_TABLE_PLAYERS,
  leaveIframe,
  mountTableWithDebugPanel,
} from './GameShell.platform-mount.test-helper.js';

/** The board's context and props, as last rendered, for comparing with what the Action Panel is handed. */
let boardSaw: { context: PlayContext; isMyTurn: boolean; availableActions: string[] } | null = null;

/** A board that draws the three turn signals from the context, the way a child component reads them. */
const ContextBoard = defineComponent({
  name: 'ContextBoard',
  props: {
    isMyTurn: { type: Boolean, required: true },
    availableActions: { type: Array as PropType<string[]>, required: true },
  },
  setup(props) {
    const context = usePlayContext();
    const { isMyTurn, isViewingHistory, availableActions } = context;
    return () => {
      boardSaw = { context, isMyTurn: props.isMyTurn, availableActions: props.availableActions };
      return h('div', { 'data-testid': 'context-signals' },
        `history=${isViewingHistory.value} myTurn=${isMyTurn.value} actions=${availableActions.value.join(',')}`);
    };
  },
});

const players = DEBUG_TABLE_PLAYERS;
const mountWithDebugPanel = () => mountTableWithDebugPanel(ContextBoard);

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

describe('the context, the board and the Action Panel read ONE gated value (#520 review)', () => {
  /**
   * The gating used to be written twice: once for the context in useTableSeat
   * and again as template expressions for the board, PlayShell and the Action
   * Panel. Equal values are not enough to keep two definitions from drifting,
   * so this asserts the same array INSTANCE reaches all of them.
   */
  function expectOneValue(wrapper: Awaited<ReturnType<typeof mountWithDebugPanel>>['wrapper']) {
    if (!boardSaw) throw new Error('the board never rendered');
    const panel = wrapper.findComponent(ActionPanel);
    expect(panel.exists()).toBe(true);
    const { context } = boardSaw;

    expect(boardSaw.isMyTurn).toBe(context.isMyTurn.value);
    expect(panel.props('isMyTurn')).toBe(context.isMyTurn.value);
    expect(boardSaw.availableActions).toBe(context.availableActions.value);
    expect(panel.props('availableActions')).toBe(context.availableActions.value);
    expect(wrapper.findComponent(PlayShell).props('availableActions')).toBe(context.availableActions.value);
  }

  it('during live play', async () => {
    const { wrapper } = await mountWithDebugPanel();
    expectOneValue(wrapper);
    wrapper.unmount();
  });

  it('while the debug panel shows history', async () => {
    const { wrapper, debugPanel } = await mountWithDebugPanel();
    debugPanel.vm.$emit('time-travel', { view: {}, players }, 3, null);
    await nextTick();

    expect(boardSaw?.context.isViewingHistory.value).toBe(true);
    expectOneValue(wrapper);
    wrapper.unmount();
  });
});
