// @vitest-environment jsdom
/**
 * THE DEBUG PANEL WORKS ONLY FOR WHAT IS ON SCREEN (#748).
 *
 * Every tab stays mounted (v-show), so before #748 each push stringified the
 * whole state, discovered decks, grouped elements and refetched the active tab
 * even with the drawer shut. Only the tab on screen, in an open drawer, may
 * spend anything on a push.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import DebugPanel from './DebugPanel.vue';
import { GAME_CONTEXT_KEYS } from '../composables/useGameContext.js';
import * as viewTree from './debug/debug-view-tree.js';
import * as debugFormat from './debug/debug-format.js';

vi.mock('./debug/debug-view-tree.js', async (importOriginal) => {
  const real = await importOriginal<typeof viewTree>();
  return {
    ...real,
    discoverDecks: vi.fn(real.discoverDecks),
    discoverCardContainers: vi.fn(real.discoverCardContainers),
    groupElementsByClass: vi.fn(real.groupElementsByClass),
  };
});
vi.mock('./debug/debug-format.js', async (importOriginal) => {
  const real = await importOriginal<typeof debugFormat>();
  return { ...real, formatState: vi.fn(real.formatState) };
});

type Op = (op: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;

let cardReads = 0;
function stateWithCard() {
  const card = { id: 2, className: 'Card' };
  Object.defineProperty(card, 'name', {
    enumerable: true,
    get: () => {
      cardReads++;
      return 'card';
    },
  });
  return {
    state: { view: { id: 1, className: 'Board', children: [card] }, players: [], gameInstanceId: 'g' },
    flowState: null,
  };
}

function mountPanel(expanded: boolean) {
  // The Decks tab reads the host's unfiltered table, which here is the seat's own view.
  const host: ReturnType<typeof vi.fn<Op>> = vi.fn<Op>(async (op) =>
    op === 'debug:deck-view' ? { success: true, view: wrapper.props('state').state.view } : { success: true });
  const wrapper = mount(DebugPanel, {
    props: { state: stateWithCard(), playerSeat: 1, expanded },
    global: { provide: { [GAME_CONTEXT_KEYS.platformRequest as symbol]: host } },
    attachTo: document.body,
  });
  return { wrapper, host };
}

const opsCalled = (host: ReturnType<typeof vi.fn<Op>>) => host.mock.calls.map(([op]) => op);

beforeEach(() => {
  vi.clearAllMocks();
  cardReads = 0;
});

describe('the debug panel on a push (#748)', () => {
  it('does no state work and fetches nothing while the drawer is closed', async () => {
    const { wrapper, host } = mountPanel(true);
    await wrapper.find('#debug-tab-logs').trigger('click');
    (wrapper.vm as unknown as { showRawState: boolean; stateSearchQuery: string }).showRawState = true;
    (wrapper.vm as unknown as { stateSearchQuery: string }).stateSearchQuery = 'card';
    await wrapper.setProps({ expanded: false });
    vi.clearAllMocks();
    cardReads = 0;

    await wrapper.setProps({ state: stateWithCard() });

    expect(debugFormat.formatState).not.toHaveBeenCalled();
    expect(viewTree.discoverDecks).not.toHaveBeenCalled();
    expect(viewTree.discoverCardContainers).not.toHaveBeenCalled();
    expect(viewTree.groupElementsByClass).not.toHaveBeenCalled();
    expect(cardReads).toBe(0);
    expect(host).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('refetches the tab on screen when the drawer opens', async () => {
    const { wrapper, host } = mountPanel(true);
    await wrapper.find('#debug-tab-logs').trigger('click');
    await wrapper.setProps({ expanded: false });
    host.mockClear();

    await wrapper.setProps({ expanded: true });
    await nextTick();

    expect(opsCalled(host)).toContain('debug:logs');
    wrapper.unmount();
  });

  it('leaves hidden tabs alone and keeps the shown tab current', async () => {
    const { wrapper } = mountPanel(true);
    vi.clearAllMocks();

    await wrapper.setProps({ state: stateWithCard() });
    expect(debugFormat.formatState).not.toHaveBeenCalled();
    expect(viewTree.discoverCardContainers).not.toHaveBeenCalled();
    expect(viewTree.groupElementsByClass).not.toHaveBeenCalled();

    await wrapper.find('#debug-tab-decks').trigger('click');
    vi.clearAllMocks();
    const withDeck = stateWithCard();
    withDeck.state.view.children.push({ id: 3, className: 'Deck', name: 'Draw pile' } as never);
    await wrapper.setProps({ state: withDeck });
    await flushPromises();
    expect(wrapper.find('#debug-panel-decks .deck-name').text()).toBe('Draw pile');
    expect(viewTree.groupElementsByClass).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
