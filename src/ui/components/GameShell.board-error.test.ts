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
import { SETTLE_MS } from '../composables/useAutoZoom.js';

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

/** A second UI, twice the size of a drawn ThrowingBoard. */
const BigBoard = defineComponent({ name: 'BigBoard', setup: () => () => h('div', { class: 'big-board' }, 'big') });

describe('GameShell board error boundary and the zoom fit (#1154)', () => {
  // jsdom has no layout: the message is 400x300, a drawn board 800x600, a big one 1600x1200, an empty one 0x0, and the region `region`.
  const region = { width: 800, height: 600 };
  const observers: Array<{ target: Element; fire: () => void }> = [];
  const priorObserver = globalThis.ResizeObserver;
  /** A layout change: the observers of what changed size fire, then the region re-fit's frame runs. */
  async function relayout(changed: 'board' | 'board and region'): Promise<void> {
    for (const { target, fire } of observers) {
      if (changed === 'board and region' || target.classList.contains('game-shell__zoom-container')) fire();
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await nextTick();
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    Object.assign(region, { width: 800, height: 600 });
    observers.length = 0;
    vi.stubGlobal('ResizeObserver', class {
      live = true;
      constructor(private readonly callback: () => void) {}
      observe(target: Element) {
        observers.push({ target, fire: () => { if (this.live) this.callback(); } });
        this.callback();
      }
      disconnect() { this.live = false; }
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (!this.classList.contains('game-shell__zoom-container')) return { width: 0, height: 0 } as DOMRect;
      if (this.querySelector('[data-testid="bs-board-error"]')) return { width: 400, height: 300 } as DOMRect;
      if (this.querySelector('.big-board')) return { width: 1600, height: 1200 } as DOMRect;
      return (this.querySelector('.good-board') ? { width: 800, height: 600 } : { width: 0, height: 0 }) as DOMRect;
    });
    const isRegion = (el: HTMLElement) => el.dataset.testid === 'bs-board';
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return isRegion(this) ? region.width : 0; });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return isRegion(this) ? region.height : 0; });
    enterIframe();
  });

  afterEach(() => {
    vi.stubGlobal('ResizeObserver', priorObserver);
  });

  /** `board` is the default UI; the dev switcher offers BigBoard as 'Big'. */
  async function mountBoard(board: BoardComponent) {
    // Shaped like an ES module, which is what defineAsyncComponent unwraps `default` from.
    const bigModule = { __esModule: true, default: BigBoard };
    const wrapper = mount(GameShell, { props: { uis: defineGameUIs({ Stub: defaultUI(board), Big: devUI(async () => bigModule) }) } });
    mounted.push(wrapper);
    await nextTick();
    fromHost({ type: 'init', seat: 1 });
    return {
      zoom: () => (wrapper.find('.game-shell__zoom-container').element as HTMLElement).style.getPropertyValue('--zoom-level'),
      /** The player's own zoom, as the controls menu sets it. */
      zoomByHand: (level: number) => wrapper.findComponent(ControlsMenu).vm.$emit('update:zoom', level),
      /** The dev host's UI switcher picks BigBoard, which lays out once it has loaded. */
      switchToBig: async () => {
        fromHost({ type: 'dev-ui-select', name: 'Big' });
        await flushPromises();
        await relayout('board');
      },
    };
  }

  /** Later than any settle timer a fit before it started, so a finished startup is finished. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 1));

  it('a board that throws on its first state and draws on the second gets the zoom a normal first render gives', async () => {
    // Like many real boards, it draws nothing until the first state arrives.
    const { zoom } = await mountBoard(defineComponent({
      props: { gameView: { type: Object, default: null } },
      setup: (props) => () => (props.gameView ? h(ThrowingBoard, { gameView: props.gameView }) : null),
    }));
    fromHost(frame(true, 'Go first'));
    await flushPromises();
    await relayout('board and region');
    await settle();

    fromHost(frame(false, 'Go second'));
    await flushPromises();
    await relayout('board');
    expect(zoom()).toBe('1');
  });

  it('a board that throws after startup, while the region shrinks, comes back fitted to the new region, not to the message', async () => {
    // This board draws before any state (as Hex does), so startup ends on it.
    const { zoom } = await mountBoard(ThrowingBoard);
    await relayout('board and region');
    await settle();
    expect(zoom()).toBe('1');

    fromHost(frame(true, 'Go first'));
    await flushPromises();
    Object.assign(region, { width: 600, height: 450 });
    await relayout('board and region');

    fromHost(frame(false, 'Go second'));
    await flushPromises();
    await relayout('board');
    expect(zoom()).toBe('0.75');
  });

  it('a board that recovers after the player set the zoom by hand keeps the player\'s zoom', async () => {
    const { zoom, zoomByHand } = await mountBoard(ThrowingBoard);
    await relayout('board and region');
    await settle();

    fromHost(frame(true, 'Go first'));
    await flushPromises();
    zoomByHand(1.5);
    await nextTick();
    Object.assign(region, { width: 600, height: 450 });
    await relayout('board and region');

    fromHost(frame(false, 'Go second'));
    await flushPromises();
    await relayout('board');
    expect(zoom()).toBe('1.5');
  });

  it('a UI picked after startup has settled is fitted afresh, not left at the first UI\'s zoom (#1161)', async () => {
    const { zoom, switchToBig } = await mountBoard(ThrowingBoard);
    await relayout('board and region');
    await settle();
    expect(zoom()).toBe('1');

    await switchToBig();
    expect(zoom()).toBe('0.5');
  });

  it('a UI picked while the board shows its error message is fitted to the new board, not the message (#1161)', async () => {
    const { zoom, switchToBig } = await mountBoard(ThrowingBoard);
    await relayout('board and region');
    await settle();
    fromHost(frame(true, 'Go first'));
    await flushPromises();
    expect(zoom()).toBe('1');

    await switchToBig();
    expect(zoom()).toBe('0.5');
  });

  it('a UI picked after the player set the zoom by hand is fitted afresh, as a new board is (#1161)', async () => {
    const { zoom, zoomByHand, switchToBig } = await mountBoard(ThrowingBoard);
    await relayout('board and region');
    await settle();
    zoomByHand(1.5);
    await nextTick();
    expect(zoom()).toBe('1.5');

    await switchToBig();
    expect(zoom()).toBe('0.5');
  });

  it('a UI picked after the player set the zoom by hand re-fits when the region later resizes (#1163)', async () => {
    const { zoom, zoomByHand, switchToBig } = await mountBoard(ThrowingBoard);
    await relayout('board and region');
    await settle();
    zoomByHand(1.5);
    await nextTick();
    await switchToBig();
    await settle();
    expect(zoom()).toBe('0.5');

    Object.assign(region, { width: 1200, height: 900 });
    await relayout('board and region');
    expect(zoom()).toBe('0.75');
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
