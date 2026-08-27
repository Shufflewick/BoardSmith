// @vitest-environment jsdom
/**
 * The State tab's search box actually filters the tree (#153).
 *
 * The box shipped bound to a ref nothing read, so typing in it changed nothing
 * on screen and told the reader their term matched nothing. These drive the box
 * through the panel's own binding, the way a reader does.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import DebugPanel from './DebugPanel.vue';
import { GAME_CONTEXT_KEYS } from '../composables/useGameContext.js';

const VIEW = {
  id: 1,
  className: 'Board',
  children: [
    { id: 2, className: 'Hand', name: 'My Hand' },
    { id: 3, className: 'Deck', name: 'Draw Pile' },
  ],
};

const STATE = { state: { view: VIEW, phase: 'play' }, flowState: null };

function mountPanel() {
  const platformRequest = vi.fn(async () => ({ success: true }));
  const wrapper = mount(DebugPanel, {
    props: { state: STATE, playerSeat: 1, playerCount: 2, gameId: 'g', expanded: true },
    global: { provide: { [GAME_CONTEXT_KEYS.platformRequest as symbol]: platformRequest } },
    attachTo: document.body,
  });
  return wrapper;
}

/** Type into the State tab's search box the way a reader would. */
async function search(wrapper: ReturnType<typeof mountPanel>, query: string) {
  const input = wrapper.get('.state-search .search-input');
  await input.setValue(query);
  await nextTick();
}

function treeText(wrapper: ReturnType<typeof mountPanel>): string {
  return wrapper.get('.state-tree').text();
}

describe('State tab search (#153)', () => {
  it('shows the whole tree before anything is typed', async () => {
    const wrapper = mountPanel();
    await nextTick();
    expect(treeText(wrapper)).toContain('state');
    expect(treeText(wrapper)).toContain('flowState');
    wrapper.unmount();
  });

  it('hides the rows that do not match what was typed', async () => {
    const wrapper = mountPanel();
    await search(wrapper, 'phase');
    expect(treeText(wrapper)).toContain('phase');
    expect(treeText(wrapper)).not.toContain('flowState');
    wrapper.unmount();
  });

  it('opens the tree down to a match, so the match is actually on screen', async () => {
    const wrapper = mountPanel();
    await search(wrapper, 'Draw Pile');
    expect(treeText(wrapper)).toContain('Draw Pile');
    wrapper.unmount();
  });

  it('says so when nothing matches, rather than showing an empty tree', async () => {
    const wrapper = mountPanel();
    await search(wrapper, 'zzz-no-such-thing');
    const text = wrapper.get('.state-tree').text();
    expect(text).toContain('zzz-no-such-thing');
    expect(text.toLowerCase()).toContain('no ');
    wrapper.unmount();
  });

  it('puts the whole tree back when the box is cleared', async () => {
    const wrapper = mountPanel();
    await search(wrapper, 'phase');
    await search(wrapper, '');
    expect(treeText(wrapper)).toContain('flowState');
    wrapper.unmount();
  });

  it('leaves the Raw view unfiltered, since it is the state verbatim', async () => {
    const wrapper = mountPanel();
    await wrapper.get('.toggle-raw input').setValue(true);
    await search(wrapper, 'phase');
    expect(wrapper.get('.state-display pre').text()).toContain('flowState');
    wrapper.unmount();
  });
});
