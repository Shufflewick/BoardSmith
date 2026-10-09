// @vitest-environment jsdom
/**
 * BOTH SHELLS BIND EXACTLY THE EXPORTED BOARD CONTRACT (#516).
 *
 * Driven on the REAL shells: a board that declares no props receives every
 * prop as an attribute, so what it sees is exactly what the shell bound. The
 * names are compared with the exported types' keys (held equal to them in
 * `board-props.test.ts`), so a prop added to a template and not to the type,
 * or the other way round, fails here.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { camelize, defineComponent, h, nextTick, useAttrs } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import WorldShell from './world/WorldShell.vue';
import { WORLD_HOST_SOURCE } from './world/worldProtocol.js';
import { defineGameUIs, defaultUI } from './game-uis.js';
import ActionPanel from './components/auto-ui/ActionPanel.vue';
import PlayShell from './components/PlayShell.vue';
import ControlsMenu from './components/ControlsMenu.vue';
import {
  DEBUG_TABLE_PLAYERS,
  leaveIframe,
  mountTableWithDebugPanel,
} from './components/GameShell.platform-mount.test-helper.js';
import { TABLE_BOARD_PROP_NAMES, WORLD_BOARD_PROP_NAMES } from './board-props.test-helper.js';

/** What the board was last handed, by camelCase prop name. Listeners are kept apart. */
let received: Record<string, unknown> = {};

const AttrsBoard = defineComponent({
  name: 'AttrsBoard',
  inheritAttrs: false,
  setup() {
    const attrs = useAttrs();
    return () => {
      received = Object.fromEntries(Object.entries(attrs).map(([key, value]) => [camelize(key), value]));
      return h('div', { class: 'attrs-board' });
    };
  },
});

const propNames = () => Object.keys(received).filter((key) => !/^on[A-Z]/.test(key)).sort();

afterEach(() => {
  received = {};
  leaveIframe();
  document.body.innerHTML = '';
});

const tableWithDebugPanel = () =>
  mountTableWithDebugPanel(AttrsBoard, {
    canUndo: true,
    disabledActions: { move: 'Not yet' },
    actionMetadata: { move: { name: 'move', prompt: 'Move', selections: [] } },
  });

describe('GameShell binds TableBoardProps onto a table board (#516)', () => {
  it('hands exactly the contract\'s props, and the retry listener', async () => {
    const { wrapper } = await tableWithDebugPanel();
    expect(propNames()).toEqual([...TABLE_BOARD_PROP_NAMES].sort());
    expect(typeof received.onRetry).toBe('function');
    wrapper.unmount();
  });

  /**
   * The gating used to be written as template expressions, once for the board
   * and again for the chrome. Each is now one value from `useTableSeat`, so the
   * same instance reaches the board, PlayShell, the Action Panel and the
   * controls menu, live and while the debug panel shows history.
   */
  function expectOneGatedValue(wrapper: Awaited<ReturnType<typeof tableWithDebugPanel>>['wrapper']) {
    const panel = wrapper.findComponent(ActionPanel);
    const chrome = wrapper.findComponent(PlayShell);
    const menu = wrapper.findComponent(ControlsMenu);
    expect(panel.props('disabledActions')).toBe(received.disabledActions);
    expect(chrome.props('disabledActions')).toBe(received.disabledActions);
    expect(panel.props('actionMetadata')).toBe(chrome.props('actionMetadata'));
    expect(panel.props('canUndo')).toBe(received.canUndo);
    expect(chrome.props('canUndo')).toBe(received.canUndo);
    expect(menu.props('canUndo')).toBe(received.canUndo);
  }

  it('gates disabled actions, action metadata and undo once, live', async () => {
    const { wrapper } = await tableWithDebugPanel();
    expect(received.disabledActions).toEqual({ move: 'Not yet' });
    expect(received.canUndo).toBe(true);
    expect(received.isViewingHistory).toBe(false);
    expect((received.state as { flowState: unknown }).flowState).not.toBeNull();
    expectOneGatedValue(wrapper);
    wrapper.unmount();
  });

  it('gates them once while the debug panel shows history', async () => {
    const { wrapper, debugPanel } = await tableWithDebugPanel();
    debugPanel.vm.$emit('time-travel', { view: {}, players: DEBUG_TABLE_PLAYERS }, 3, null);
    await nextTick();
    expect(received.isViewingHistory).toBe(true);
    expect(received.isMyTurn).toBe(false);
    expect(received.availableActions).toEqual([]);
    expect(received.disabledActions).toBeUndefined();
    expect(received.canUndo).toBe(false);
    // The DISPLAYED state: no live flow position superimposed on a past board.
    expect((received.state as { flowState: unknown }).flowState).toBeNull();
    expect(wrapper.findComponent(PlayShell).props('actionMetadata')).toEqual({});
    expectOneGatedValue(wrapper);
    wrapper.unmount();
  });
});

describe('GameShell gates the #player-stats slot like the board (#554)', () => {
  /** What the slot was last handed, for the viewer's own seat. */
  let statsProps: Record<string, unknown> = {};
  const playerStats = (slotProps: Record<string, unknown>) => {
    if ((slotProps.player as { seat: number }).seat === 1) statsProps = slotProps;
    return h('span', { class: 'stats' });
  };

  it('hands the slot the board\'s gated isMyTurn and availableActions, live and in history', async () => {
    const { wrapper, debugPanel } = await mountTableWithDebugPanel(AttrsBoard, {}, { 'player-stats': playerStats });
    expect(statsProps.isMyTurn).toBe(true);
    expect(statsProps.availableActions).toEqual(['move']);

    debugPanel.vm.$emit('time-travel', { view: {}, players: DEBUG_TABLE_PLAYERS }, 3, null);
    await nextTick();
    expect(received.isViewingHistory).toBe(true);
    // The slot draws from the historical gameView beside these, so a live
    // isMyTurn or action list would offer a control that commits against the live game.
    expect(statsProps.isMyTurn).toBe(false);
    expect(statsProps.availableActions).toEqual([]);
    expect(statsProps.availableActions).toBe(received.availableActions);
    wrapper.unmount();
  });
});

describe('WorldShell binds WorldBoardProps onto a world board (#516)', () => {
  it('hands exactly the contract\'s props, with no prompt setter, since WorldShell does not let a board replace its prompt', async () => {
    const wrapper = mount(WorldShell, {
      props: { uis: defineGameUIs({ Board: defaultUI(AttrsBoard) }), displayName: 'Gloamhall' },
    });
    const send = (frame: unknown): void =>
      (wrapper.vm as unknown as { host: { handleMessage(e: unknown): void } }).host.handleMessage({
        origin: 'https://shufflewick.pub',
        data: frame,
      });
    send({
      source: WORLD_HOST_SOURCE,
      type: 'world_state',
      phase: 'watching',
      view: { phase: 'watching', state: { said: 'the fire is low' } },
      seat: 4,
      revision: 1,
      notice: null,
      worldName: 'Gloamhall Rooms',
      presence: [2, 4],
    });
    send({ source: WORLD_HOST_SOURCE, type: 'world_offers', revision: 1, actions: [{ name: 'look', selections: [] }] });
    await flushPromises();

    expect(propNames()).toEqual([...WORLD_BOARD_PROP_NAMES].sort());
    expect(received.worldName).toBe('Gloamhall Rooms');
    expect(received.phase).toBe('watching');
    expect(received.availableActions).toEqual(['look']);
    wrapper.unmount();
  });
});
