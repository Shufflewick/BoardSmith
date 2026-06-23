// @vitest-environment jsdom
/**
 * ARIA tabs pattern tests for DebugPanel.vue (102-01-PLAN.md Task 1).
 *
 * Covers:
 *  - Tab container has role="tablist"
 *  - Each of the 6 tab buttons has role="tab", a unique id, aria-controls, and aria-selected
 *  - Active tab has tabindex=0; inactive tabs have tabindex=-1
 *  - Each tab panel has role="tabpanel", an id, and aria-labelledby pointing at its tab
 *  - ArrowRight advances activeTab (wrapping controls → state)
 *  - ArrowLeft retreats activeTab (wrapping state → controls)
 *  - Home selects the first tab ("state")
 *  - End selects the last tab ("controls")
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import DebugPanel from './DebugPanel.vue';

const MIN_PROPS = {
  state: { phase: 'test', round: 1 },
  playerSeat: 1,
  playerCount: 2,
  gameId: 'test-game',
  expanded: true, // open so panels are rendered
};

const TAB_IDS = ['state', 'elements', 'decks', 'actions', 'history', 'controls'] as const;

describe('DebugPanel ARIA tablist', () => {
  let wrapper: ReturnType<typeof mount>;

  beforeEach(() => {
    wrapper = mount(DebugPanel, { props: MIN_PROPS, attachTo: document.body });
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it('tab container has role="tablist"', () => {
    const tablist = wrapper.element.querySelector('[role="tablist"]');
    expect(tablist).not.toBeNull();
  });

  it('renders exactly 6 tab buttons with role="tab"', () => {
    const tabs = wrapper.element.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(6);
  });

  it.each(TAB_IDS)('tab "%s" has correct id and aria-controls', (id) => {
    const tab = wrapper.element.querySelector(`#debug-tab-${id}`);
    expect(tab).not.toBeNull();
    expect(tab!.getAttribute('role')).toBe('tab');
    expect(tab!.getAttribute('aria-controls')).toBe(`debug-panel-${id}`);
  });

  it('active tab (state) has aria-selected="true" and tabindex="0"', () => {
    const stateTab = wrapper.element.querySelector('#debug-tab-state');
    expect(stateTab).not.toBeNull();
    expect(stateTab!.getAttribute('aria-selected')).toBe('true');
    expect(stateTab!.getAttribute('tabindex')).toBe('0');
  });

  it('inactive tabs have aria-selected="false" and tabindex="-1"', () => {
    const inactiveTabs = wrapper.element.querySelectorAll('[role="tab"][aria-selected="false"]');
    expect(inactiveTabs.length).toBe(5);
    inactiveTabs.forEach((tab) => {
      expect(tab.getAttribute('tabindex')).toBe('-1');
    });
  });

  it.each(TAB_IDS)('tab panel "%s" has correct id, role, and aria-labelledby', (id) => {
    const panel = wrapper.element.querySelector(`#debug-panel-${id}`);
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute('role')).toBe('tabpanel');
    expect(panel!.getAttribute('aria-labelledby')).toBe(`debug-tab-${id}`);
  });
});

describe('DebugPanel arrow-key navigation', () => {
  let wrapper: ReturnType<typeof mount>;

  beforeEach(() => {
    wrapper = mount(DebugPanel, { props: MIN_PROPS, attachTo: document.body });
  });

  afterEach(() => {
    wrapper.unmount();
  });

  function activeTabId(): string {
    const selected = wrapper.element.querySelector('[role="tab"][aria-selected="true"]');
    return selected?.id.replace('debug-tab-', '') ?? '';
  }

  async function dispatchTabKey(tabId: string, key: string) {
    const tabEl = wrapper.element.querySelector(`#debug-tab-${tabId}`) as HTMLElement;
    expect(tabEl).not.toBeNull();
    const evt = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    tabEl.dispatchEvent(evt);
    await nextTick();
  }

  it('ArrowRight on "state" tab advances to "elements"', async () => {
    expect(activeTabId()).toBe('state');
    await dispatchTabKey('state', 'ArrowRight');
    expect(activeTabId()).toBe('elements');
  });

  it('ArrowRight on "controls" (last) tab wraps to "state"', async () => {
    // Navigate to controls first via clicks
    const controlsTab = wrapper.element.querySelector('#debug-tab-controls') as HTMLElement;
    controlsTab.click();
    await nextTick();
    expect(activeTabId()).toBe('controls');

    await dispatchTabKey('controls', 'ArrowRight');
    expect(activeTabId()).toBe('state');
  });

  it('ArrowLeft on "state" (first) tab wraps to "controls"', async () => {
    expect(activeTabId()).toBe('state');
    await dispatchTabKey('state', 'ArrowLeft');
    expect(activeTabId()).toBe('controls');
  });

  it('Home key selects "state" (first tab)', async () => {
    // Navigate to elements first
    const elementsTab = wrapper.element.querySelector('#debug-tab-elements') as HTMLElement;
    elementsTab.click();
    await nextTick();
    expect(activeTabId()).toBe('elements');

    await dispatchTabKey('elements', 'Home');
    expect(activeTabId()).toBe('state');
  });

  it('End key selects "controls" (last tab)', async () => {
    expect(activeTabId()).toBe('state');
    await dispatchTabKey('state', 'End');
    expect(activeTabId()).toBe('controls');
  });
});
