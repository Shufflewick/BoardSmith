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
import { describe, it, expect, expectTypeOf, afterEach } from 'vitest';
import { camelize, defineComponent, h, nextTick, useAttrs } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import WorldShell from './world/WorldShell.vue';
import { WORLD_HOST_SOURCE } from './world/worldProtocol.js';
import { defineGameUIs, defaultUI } from './game-uis.js';
import ActionPanel from './components/auto-ui/ActionPanel.vue';
import PlayShell from './components/PlayShell.vue';
import GameShell from './components/GameShell.vue';
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

  it('hands the board the players and own player of the state on screen, live and in history (#586)', async () => {
    const { wrapper, debugPanel } = await tableWithDebugPanel();
    expect(received.players).toEqual(DEBUG_TABLE_PLAYERS);
    expect(received.myPlayer).toEqual(DEBUG_TABLE_PLAYERS[0]);

    // The board draws the historical gameView and state, so the players it
    // reads a score off are the snapshot's, not the live seat's.
    const historicalPlayers = DEBUG_TABLE_PLAYERS.map((player) => ({ ...player, score: player.seat * 10 }));
    debugPanel.vm.$emit('time-travel', { view: {}, players: historicalPlayers }, 3, null);
    await nextTick();
    expect(received.isViewingHistory).toBe(true);
    expect(received.players).toEqual(historicalPlayers);
    expect(received.players).toBe((received.state as { state: { players: unknown } }).state.players);
    expect(received.myPlayer).toEqual(historicalPlayers[0]);

    debugPanel.vm.$emit('time-travel', null, null, null);
    await nextTick();
    expect(received.players).toEqual(DEBUG_TABLE_PLAYERS);
    expect(received.myPlayer).toEqual(DEBUG_TABLE_PLAYERS[0]);
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

  it('hands the slot the players of the state on screen, live and in history (#578)', async () => {
    const { wrapper, debugPanel } = await mountTableWithDebugPanel(AttrsBoard, {}, { 'player-stats': playerStats });
    expect(statsProps.players).toEqual(DEBUG_TABLE_PLAYERS);

    // The snapshot the debug panel is showing carries its own players: a game
    // that reads a score off them must read the score as it was then.
    const historicalPlayers = DEBUG_TABLE_PLAYERS.map((player) => ({ ...player, score: player.seat * 10 }));
    debugPanel.vm.$emit('time-travel', { view: {}, players: historicalPlayers }, 3, null);
    await nextTick();
    expect(received.isViewingHistory).toBe(true);
    expect(statsProps.players).toEqual(historicalPlayers);
    expect(statsProps.players).toBe((received.state as { state: { players: unknown } }).state.players);

    debugPanel.vm.$emit('time-travel', null, null, null);
    await nextTick();
    expect(statsProps.players).toEqual(DEBUG_TABLE_PLAYERS);
    wrapper.unmount();
  });

  it('hands the slot its player as the state on screen has it, live and in history (#581)', async () => {
    const { wrapper, debugPanel } = await mountTableWithDebugPanel(AttrsBoard, {}, { 'player-stats': playerStats });
    expect(statsProps.player).toEqual(DEBUG_TABLE_PLAYERS[0]);

    // The panel's own player row stays live; the slot draws beside the
    // historical gameView, so the player it reads a score off is the snapshot's.
    const historicalPlayers = DEBUG_TABLE_PLAYERS.map((player) => ({ ...player, score: player.seat * 10 }));
    debugPanel.vm.$emit('time-travel', { view: {}, players: historicalPlayers }, 3, null);
    await nextTick();
    expect(received.isViewingHistory).toBe(true);
    expect(statsProps.player).toEqual(historicalPlayers[0]);

    debugPanel.vm.$emit('time-travel', null, null, null);
    await nextTick();
    expect(statsProps.player).toEqual(DEBUG_TABLE_PLAYERS[0]);
    wrapper.unmount();
  });

  it('types the slot\'s player as always present, so game code reads it without a guard (#581)', () => {
    type PlayerStatsSlot = NonNullable<InstanceType<typeof GameShell>['$slots']['player-stats']>;
    type SlotPlayer = Parameters<PlayerStatsSlot>[0]['player'];
    expectTypeOf<Extract<SlotPlayer, undefined>>().toBeNever();
    expectTypeOf<SlotPlayer>().toHaveProperty('seat');
  });

  it('refuses, naming the seat, a viewed snapshot that lacks a seat the panel shows (#581)', async () => {
    const { wrapper, debugPanel } = await mountTableWithDebugPanel(AttrsBoard, {}, { 'player-stats': playerStats });
    const errors: unknown[] = [];
    wrapper.vm.$.appContext.config.errorHandler = (error) => { errors.push(error); };
    debugPanel.vm.$emit('time-travel', { view: {}, players: DEBUG_TABLE_PLAYERS.slice(0, 1) }, 3, null);
    await nextTick();
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toMatch(/seat 2/);
    wrapper.unmount();
  });
});

describe('GameShell hands the #sidebar-extra slot the state on screen (#582)', () => {
  it('hands the slot the players of the displayed state, live and in history', async () => {
    let sidebarProps: Record<string, unknown> = {};
    const sidebarExtra = (slotProps: Record<string, unknown>) => {
      sidebarProps = slotProps;
      return h('span', { class: 'sidebar-extra' });
    };
    const { wrapper, debugPanel } = await mountTableWithDebugPanel(AttrsBoard, {}, { 'sidebar-extra': sidebarExtra });
    expect(sidebarProps.players).toEqual(DEBUG_TABLE_PLAYERS);

    const historicalPlayers = DEBUG_TABLE_PLAYERS.map((player) => ({ ...player, score: player.seat * 10 }));
    debugPanel.vm.$emit('time-travel', { view: {}, players: historicalPlayers }, 3, null);
    await nextTick();
    expect(received.isViewingHistory).toBe(true);
    expect(sidebarProps.players).toEqual(historicalPlayers);
    expect(sidebarProps.players).toBe((sidebarProps.state as { state: { players: unknown } }).state.players);

    debugPanel.vm.$emit('time-travel', null, null, null);
    await nextTick();
    expect(sidebarProps.players).toEqual(DEBUG_TABLE_PLAYERS);
    wrapper.unmount();
  });
});

describe('GameShell exposes the board\'s gated turn and actions (#576)', () => {
  it('hands a parent the gated isMyTurn and availableActions, live and in history', async () => {
    const { wrapper, debugPanel } = await tableWithDebugPanel();
    const exposed = wrapper.vm as unknown as { isMyTurn: boolean; availableActions: string[] };
    expect(exposed.isMyTurn).toBe(true);
    expect(exposed.availableActions).toEqual(['move']);

    debugPanel.vm.$emit('time-travel', { view: {}, players: DEBUG_TABLE_PLAYERS }, 3, null);
    await nextTick();
    expect(received.isViewingHistory).toBe(true);
    // The exposed gameView is the historical one, so a live turn or action list
    // beside it would describe a game the parent is not showing.
    expect(exposed.isMyTurn).toBe(false);
    expect(exposed.availableActions).toEqual([]);
    expect(exposed.availableActions).toBe(received.availableActions);
    wrapper.unmount();
  });

  it('hands a parent the state, players and own player on screen, live and in history (#581, #582)', async () => {
    const { wrapper, debugPanel } = await tableWithDebugPanel();
    const exposed = wrapper.vm as unknown as {
      state: { state: { players: unknown }; flowState: unknown } | null;
      players: unknown[];
      myPlayer: unknown;
    };
    expect(exposed.players).toEqual(DEBUG_TABLE_PLAYERS);
    expect(exposed.myPlayer).toEqual(DEBUG_TABLE_PLAYERS[0]);
    expect(exposed.state?.flowState).not.toBeNull();

    const historicalPlayers = DEBUG_TABLE_PLAYERS.map((player) => ({ ...player, score: player.seat * 10 }));
    debugPanel.vm.$emit('time-travel', { view: {}, players: historicalPlayers }, 3, null);
    await nextTick();
    expect(received.isViewingHistory).toBe(true);
    // Beside the historical gameView, the state and players are the snapshot's.
    expect(exposed.state).toBe(received.state);
    expect(exposed.state?.flowState).toBeNull();
    expect(exposed.players).toEqual(historicalPlayers);
    expect(exposed.players).toBe(exposed.state?.state.players);
    expect(exposed.myPlayer).toEqual(historicalPlayers[0]);

    debugPanel.vm.$emit('time-travel', null, null, null);
    await nextTick();
    expect(exposed.players).toEqual(DEBUG_TABLE_PLAYERS);
    expect(exposed.myPlayer).toEqual(DEBUG_TABLE_PLAYERS[0]);
    expect(exposed.state?.flowState).not.toBeNull();
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
