// @vitest-environment jsdom
/**
 * A BOARD THAT THROWS WHILE RENDERING DOES NOT FREEZE THE SHELL (#1149).
 *
 * In dev Vue rethrows an unhandled render error out of the patch, so a board
 * that threw once left the shell's vnode tree half-patched: every later update
 * failed ("Cannot set properties of null (setting '__vnode')") and the Action
 * Panel froze until a reload. Driven on the REAL GameShell and transport.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { enterIframe, leaveIframe, mountPlatformShell, type BoardComponent } from './GameShell.platform-mount.test-helper.js';
import GameShell from './GameShell.vue';
import BoardErrorBoundary from './BoardErrorBoundary.vue';
import ControlsMenu from './ControlsMenu.vue';
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

  it('tells a game\'s own action-panel slot whether the board failed, and that it recovered (#1160)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    enterIframe();
    const wrapper = mountPlatformShell({
      board: ThrowingBoard,
      slots: { 'action-panel': ({ boardFailed }) => h('div', { class: 'own-panel' }, `boardFailed=${String(boardFailed)}`) },
    });
    mounted.push(wrapper);
    await nextTick();
    fromHost({ type: 'init', seat: 1 });
    fromHost(frame(true, 'Go'));
    await flushPromises();
    const ownPanel = () => wrapper.find('#bs-actionbar .own-panel').text();
    expect(ownPanel()).toBe('boardFailed=true');

    fromHost(frame(false, 'Go'));
    await flushPromises();
    expect(wrapper.find('.good-board').exists()).toBe(true);
    expect(ownPanel()).toBe('boardFailed=false');
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

describe('GameShell board error boundary and the zoom (#1158)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    enterIframe();
  });

  it('a board that recovers after the player set the zoom keeps the player\'s zoom, and the message is drawn unzoomed', async () => {
    const wrapper = mount(GameShell, { props: { uis: defineGameUIs({ Stub: defaultUI(ThrowingBoard) }) }, attachTo: document.body });
    mounted.push(wrapper);
    await nextTick();
    fromHost({ type: 'init', seat: 1 });
    const zoom = () => (wrapper.find('.game-shell__zoom-container').element as HTMLElement).style.getPropertyValue('--zoom-level');

    fromHost(frame(true, 'Go first'));
    await flushPromises();
    wrapper.findComponent(ControlsMenu).vm.$emit('update:zoom', 1.5);
    await nextTick();
    expect(zoom(), 'the message is drawn at the region\'s own size').toBe('1');

    fromHost(frame(false, 'Go second'));
    await flushPromises();
    expect(zoom()).toBe('1.5');
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

describe('GameShell board error boundary and a pick handed to the board (#1153)', () => {
  /** 50 cells, each drawn on the board, so the panel hands the pick to the board. */
  const validElements = Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    display: `cell-${i + 1}`,
    refs: [{ role: 'target', ref: { id: i + 1, notation: `c${i + 1}` } }],
  }));

  /** Seat 1's only action, `place`, asks for one cell, so auto mode opens the pick. */
  function cellPickFrame(broken: boolean): Record<string, unknown> {
    const selections = [{ name: 'cell', type: 'element', prompt: 'Select a cell' }];
    const seatFrame = frame(broken, 'unused') as { view: { flowState: Record<string, unknown>; state: Record<string, unknown> } };
    seatFrame.view.flowState.availableActions = ['place'];
    Object.assign(seatFrame.view.state, { availableActions: ['place'], actionMetadata: { place: { name: 'place', prompt: 'Place', selections } } });
    return seatFrame;
  }

  type Posted = { type?: string; op?: string; requestId?: string };

  /** Answer every cell fetch not yet answered, as a live server does. */
  async function answerFetches(posted: Posted[], answered: Set<string>): Promise<void> {
    for (const request of posted) {
      if (request.op !== 'resolve_choices' || answered.has(request.requestId!)) continue;
      answered.add(request.requestId!);
      fromHost({ type: 'server_response', requestId: request.requestId, result: { success: true, validElements } });
    }
    await flushPromises();
  }

  async function mountCellPick() {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const posted = enterIframe() as Posted[];
    const answered = new Set<string>();
    const wrapper = mountPlatformShell({ board: ThrowingBoard });
    mounted.push(wrapper);
    await nextTick();
    fromHost({ type: 'init', seat: 1 });
    fromHost(cellPickFrame(true));
    await flushPromises();
    await answerFetches(posted, answered);
    const panel = () => wrapper.find('#bs-actionbar .action-panel-root');
    const nextFrame = async (broken: boolean) => {
      fromHost(cellPickFrame(broken));
      await flushPromises();
      await answerFetches(posted, answered);
    };
    return { wrapper, posted, panel, nextFrame };
  }

  it('lists the candidates in the panel while the board shows its error, and a listed one can be picked', async () => {
    const { wrapper, posted, panel } = await mountCellPick();
    expect(wrapper.find('[data-testid="bs-board-error"]').exists()).toBe(true);
    expect(panel().text()).toContain('Select a cell');

    expect(panel().find('.board-handoff-btn').exists(), 'there is no board to choose on').toBe(false);
    const cells = panel().findAll('.element-btn');
    expect(cells).toHaveLength(50);

    await cells[6].trigger('click');
    await flushPromises();
    const sent = posted.find((m) => m.type === 'server_request' && m.op === 'action');
    expect(sent, 'picking a listed cell sends the action').toBeDefined();
    expect(JSON.stringify(sent)).toContain('"cell":7');
  });

  it('hands the pick back to the board when the board draws again', async () => {
    const { wrapper, panel, nextFrame } = await mountCellPick();
    expect(panel().findAll('.element-btn')).toHaveLength(50);

    await nextFrame(false);
    expect(wrapper.find('.good-board').exists()).toBe(true);
    expect(panel().findAll('.element-btn')).toHaveLength(0);
    expect(panel().find('.board-handoff-btn').text()).toBe('Choose on the board (50)');
  });
});
