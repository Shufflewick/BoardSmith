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

describe('GameShell board error boundary and the zoom fit (#1154)', () => {
  // jsdom has no layout: the message is 400x300, a drawn board 800x600, an empty one 0x0, and the region `region`.
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

  async function mountBoard(board: BoardComponent) {
    const wrapper = mountPlatformShell({ board });
    mounted.push(wrapper);
    await nextTick();
    fromHost({ type: 'init', seat: 1 });
    return {
      zoom: () => (wrapper.find('.game-shell__zoom-container').element as HTMLElement).style.getPropertyValue('--zoom-level'),
      /** The player's own zoom, as the controls menu sets it. */
      zoomByHand: (level: number) => wrapper.findComponent(ControlsMenu).vm.$emit('update:zoom', level),
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
