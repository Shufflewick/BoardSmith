// @vitest-environment jsdom
/**
 * ControlsMenu — "Show action help" toggle (Plan 108-03, Task 1)
 *
 * Behaviors under test:
 *   A. A "Show action help" menuitemcheckbox renders even when `showHint` is
 *      undefined (non-AI game / Teaching group hidden).
 *   B. Clicking it emits `teaching-action` with payload `'help-toggle'`.
 *   C. `aria-checked` reflects the `isActionHelpVisible` prop.
 *   D. The `.toggle` pill carries the `on` class when `isActionHelpVisible` is true.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import ControlsMenu from './ControlsMenu.vue';

// jsdom lacks matchMedia
vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})));

// jsdom lacks ResizeObserver
vi.stubGlobal('ResizeObserver', vi.fn(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
})));

function mountMenu(props: Record<string, unknown> = {}) {
  return mount(ControlsMenu, {
    props: {
      autoEndTurn: false,
      zoom: 1,
      canUndo: false,
      // showHint intentionally omitted (non-AI game) unless overridden
      ...props,
    },
    attachTo: document.body,
  });
}

describe('ControlsMenu — Show action help toggle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('A: renders "Show action help" menuitemcheckbox even when showHint is undefined', async () => {
    const wrapper = mountMenu({ isActionHelpVisible: true });
    // Open the menu
    await wrapper.find('button.menubtn').trigger('click');
    // The toggle must be present without showHint
    const buttons = wrapper.findAll('[role="menuitemcheckbox"]');
    const helpBtn = buttons.find(b => b.text().includes('Show action help'));
    expect(helpBtn, 'Expected "Show action help" menuitemcheckbox to be present').toBeDefined();
    wrapper.unmount();
  });

  it('B: clicking emits teaching-action with payload "help-toggle"', async () => {
    const wrapper = mountMenu({ isActionHelpVisible: false });
    await wrapper.find('button.menubtn').trigger('click');
    const buttons = wrapper.findAll('[role="menuitemcheckbox"]');
    const helpBtn = buttons.find(b => b.text().includes('Show action help'));
    expect(helpBtn).toBeDefined();
    await helpBtn!.trigger('click');
    const emitted = wrapper.emitted('teaching-action') as string[][];
    expect(emitted).toBeDefined();
    expect(emitted.some(args => args[0] === 'help-toggle')).toBe(true);
    wrapper.unmount();
  });

  it('C: aria-checked is true when isActionHelpVisible prop is true', async () => {
    const wrapper = mountMenu({ isActionHelpVisible: true });
    await wrapper.find('button.menubtn').trigger('click');
    const buttons = wrapper.findAll('[role="menuitemcheckbox"]');
    const helpBtn = buttons.find(b => b.text().includes('Show action help'));
    expect(helpBtn).toBeDefined();
    expect(helpBtn!.attributes('aria-checked')).toBe('true');
    wrapper.unmount();
  });

  it('C: aria-checked is false when isActionHelpVisible prop is false', async () => {
    const wrapper = mountMenu({ isActionHelpVisible: false });
    await wrapper.find('button.menubtn').trigger('click');
    const buttons = wrapper.findAll('[role="menuitemcheckbox"]');
    const helpBtn = buttons.find(b => b.text().includes('Show action help'));
    expect(helpBtn).toBeDefined();
    expect(helpBtn!.attributes('aria-checked')).toBe('false');
    wrapper.unmount();
  });

  it('D: .toggle pill has "on" class when isActionHelpVisible is true', async () => {
    const wrapper = mountMenu({ isActionHelpVisible: true });
    await wrapper.find('button.menubtn').trigger('click');
    const buttons = wrapper.findAll('[role="menuitemcheckbox"]');
    const helpBtn = buttons.find(b => b.text().includes('Show action help'));
    expect(helpBtn).toBeDefined();
    const pill = helpBtn!.find('.toggle');
    expect(pill.exists()).toBe(true);
    expect(pill.classes()).toContain('on');
    wrapper.unmount();
  });

  it('D: .toggle pill does NOT have "on" class when isActionHelpVisible is false', async () => {
    const wrapper = mountMenu({ isActionHelpVisible: false });
    await wrapper.find('button.menubtn').trigger('click');
    const buttons = wrapper.findAll('[role="menuitemcheckbox"]');
    const helpBtn = buttons.find(b => b.text().includes('Show action help'));
    expect(helpBtn).toBeDefined();
    const pill = helpBtn!.find('.toggle');
    expect(pill.exists()).toBe(true);
    expect(pill.classes()).not.toContain('on');
    wrapper.unmount();
  });

  it('toggle is NOT inside the Teaching group (showHint-gated) — visible without showHint', async () => {
    // Mount without showHint — if the toggle was inside v-if="showHint !== undefined",
    // it would be absent. This verifies it is in the Play group.
    const wrapper = mountMenu({ isActionHelpVisible: true, showHint: undefined });
    await wrapper.find('button.menubtn').trigger('click');
    const buttons = wrapper.findAll('[role="menuitemcheckbox"]');
    const helpBtn = buttons.find(b => b.text().includes('Show action help'));
    expect(helpBtn).toBeDefined();
    wrapper.unmount();
  });
});
