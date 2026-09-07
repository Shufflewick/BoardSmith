// @vitest-environment jsdom
/**
 * THE ONE CHROME BOTH BACKENDS RENDER (#170).
 *
 * `GameShell` and `WorldShell` are transport-and-lifecycle adapters; this is the
 * layout and the chrome they share. The boundary is testable in one sentence:
 * everything that reads `flowState` stays on the table side, and everything that
 * reads the seat's enumerated actions, the seat's identity or the element tree
 * is here.
 *
 * R6 says the parity assertions belong on `PlayShell` and must be driven from
 * both adapters, or the world silently loses a chrome feature the table gains.
 * So these assertions are about the SHELL's own surface -- `data-testid`s
 * included, since #357 re-points the platform's e2e specs at them and must not
 * be left selecting on classes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';
import PlayShell from './PlayShell.vue';
import Toast from './Toast.vue';
import DisabledReasonTooltip from './helpers/DisabledReasonTooltip.vue';
import { GAME_CONTEXT_KEYS } from '../composables/useGameContext.js';
import { useActionController } from '../composables/useActionController.js';
import { ref, computed } from 'vue';

class PanelResizeObserver {
  static instances: PanelResizeObserver[] = [];
  callback: () => void;
  observed?: Element;
  disconnect = vi.fn();
  constructor(callback: () => void) { this.callback = callback; PanelResizeObserver.instances.push(this); }
  observe(el: Element) { this.observed = el; }
}
beforeEach(() => { PanelResizeObserver.instances = []; vi.stubGlobal('ResizeObserver', PanelResizeObserver); });
afterEach(() => vi.unstubAllGlobals());

function controller() {
  return useActionController({
    sendAction: async () => ({ success: true }),
    availableActions: ref(['look']),
    actionMetadata: ref({ look: { name: 'look', prompt: 'Look around', selections: [] } }),
    isMyTurn: ref(true),
  });
}

function mountShell(props: Record<string, unknown> = {}, slots: Record<string, unknown> = {}) {
  const ctl = controller();
  return mount(PlayShell, {
    props: {
      players: [{ seat: 0, name: 'Ivy' }, { seat: 1, name: 'Rook' }],
      playerSeat: 0,
      messages: [],
      mayAct: true,
      availableActions: ['look'],
      actionMetadata: { look: { name: 'look', prompt: 'Look around', selections: [] } },
      ...props,
    },
    slots: { board: () => h('div', { class: 'my-board' }, 'board'), ...slots },
    global: { provide: { [GAME_CONTEXT_KEYS.actionController as symbol]: ctl } },
  });
}

describe('the layout', () => {
  it('draws the sidebar, the board region and the action bar', () => {
    const wrapper = mountShell();
    expect(wrapper.find('[data-testid="bs-seats"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="bs-board"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="bs-actionbar"]').exists()).toBe(true);
  });

  it('puts the game\'s board in the board slot, inside the zoom container', () => {
    const wrapper = mountShell();
    expect(wrapper.find('.game-shell__zoom-container .my-board').exists()).toBe(true);
  });

  it('keeps the modal host outside the board scroller and zoom container', () => {
    const wrapper = mountShell();
    const modal = wrapper.get('#bs-game-modal').element;
    const board = wrapper.get('[data-testid="bs-board"]').element;
    expect(board.contains(modal)).toBe(false);
    expect(modal.parentElement).toBe(board.parentElement);
  });

  it('keeps modal controls above the action panel as it grows without resizing the board', async () => {
    const wrapper = mountShell();
    await nextTick();
    const bar = wrapper.get('[data-testid="bs-actionbar"]').element;
    const observer = PanelResizeObserver.instances.find(o => o.observed === bar);
    expect(observer).toBeDefined();
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({height:260} as DOMRect);
    observer!.callback(); await nextTick();
    expect(wrapper.get('#bs-game-modal').attributes('style')).toContain('bottom: 260px');
    expect(wrapper.get('[data-testid="bs-board"]').attributes('style')).toBeUndefined();
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({height:80} as DOMRect);
    observer!.callback(); await nextTick();
    expect(wrapper.get('#bs-game-modal').attributes('style')).toContain('bottom: 80px');
    wrapper.unmount(); expect(observer!.disconnect).toHaveBeenCalled();
  });

  it('always hosts the modal target a game teleports into', () => {
    expect(mountShell().find('#bs-game-modal').exists()).toBe(true);
  });
});

describe('seat identity and presence', () => {
  it('names the seats it was given', () => {
    expect(mountShell().text()).toContain('Ivy');
  });

  it('marks who is here when the backend has presence', () => {
    const wrapper = mountShell({ presentSeats: [0] });
    const marks = wrapper.findAll('.conn-status');
    expect(marks[0]!.classes()).toContain('is-online');
    expect(marks[1]!.classes()).toContain('is-offline');
  });

  it('marks nobody when it has none', () => {
    expect(mountShell().findAll('.conn-status')).toHaveLength(0);
  });
});

describe('the log', () => {
  it('renders the lines it was given', () => {
    const wrapper = mountShell({ messages: [{ text: 'The fire gutters.' }] });
    expect(wrapper.find('[data-testid="bs-log"]').text()).toContain('The fire gutters.');
  });

  it('says what silence means in the caller\'s own words', () => {
    const wrapper = mountShell({ logEmptyText: 'Nothing has been said since you arrived' });
    expect(wrapper.text()).toContain('Nothing has been said since you arrived');
  });
});

describe('the action panel', () => {
  it('is up when the viewer may act', () => {
    expect(mountShell().find('[data-testid="bs-action-panel"]').exists()).toBe(true);
  });

  it('is down when they may not', () => {
    expect(mountShell({ mayAct: false }).find('[data-testid="bs-action-panel"]').exists()).toBe(false);
  });

  it('offers the actions it was handed', () => {
    expect(mountShell().find('[data-testid="bs-action-panel"]').text()).toMatch(/look/i);
  });
});

describe('what is the adapter\'s and not the shell\'s', () => {
  it('renders the adapter\'s own connection indicator, whatever axis it is on', () => {
    const wrapper = mountShell({ connection: { tone: 'stale', title: 'Connection lost' } });
    const dot = wrapper.find('[data-testid="bs-connection"]');
    expect(dot.attributes('title')).toBe('Connection lost');
    expect(dot.classes()).toContain('stale');
  });

  it('shows no indicator when the adapter has nothing to say', () => {
    expect(mountShell().find('[data-testid="bs-connection"]').exists()).toBe(false);
  });

  it('hosts the adapter\'s debug surface in one place, with the tab set the adapter owns', () => {
    const wrapper = mountShell({}, { debug: () => h('div', { class: 'table-debug' }) });
    expect(wrapper.find('[data-testid="bs-debug"] .table-debug').exists()).toBe(true);
  });

  it('has no debug region at all when the adapter offers none', () => {
    expect(mountShell().find('[data-testid="bs-debug"]').exists()).toBe(false);
  });

  it('hosts the adapter\'s own board overlays above the board', () => {
    const wrapper = mountShell({}, { 'board-overlays': () => h('div', { class: 'game-over' }) });
    expect(wrapper.find('[data-testid="bs-board"] .game-over').exists()).toBe(true);
  });
});

describe('refusals are one voice', () => {
  it('mounts the toast every refusal is spoken through', () => {
    expect(mountShell().findComponent(Toast).exists()).toBe(true);
  });

  it('mounts the one tooltip a greyed control borrows to say why', () => {
    expect(mountShell().findComponent(DisabledReasonTooltip).exists()).toBe(true);
  });
});
