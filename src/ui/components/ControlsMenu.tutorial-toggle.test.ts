// @vitest-environment jsdom
/**
 * ControlsMenu — Tutorial group toggle (R-02)
 *
 * Tests the isTutorialRunning prop:
 *   A. When isTutorialRunning is false (or absent), the button shows "Start tutorial"
 *      and emits 'start-tutorial'.
 *   B. When isTutorialRunning is true, the button shows "Exit tutorial"
 *      and emits 'exit-tutorial'.
 *
 * The popover is Teleported to <body>; assertions use document.body queries.
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
      hasTutorial: true,
      ...props,
    },
    attachTo: document.body,
  });
}

/** Find the tutorial action button within the teleported popover. */
function findTutorialButton(): HTMLElement | undefined {
  const buttons = document.body.querySelectorAll<HTMLElement>('[role="menuitem"]');
  return Array.from(buttons).find(b => {
    const text = b.textContent?.trim() ?? '';
    return text === 'Start tutorial' || text === 'Exit tutorial';
  });
}

describe('ControlsMenu — Tutorial group toggle (R-02)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('A: shows "Start tutorial" and emits start-tutorial when isTutorialRunning is false', async () => {
    const wrapper = mountMenu({ isTutorialRunning: false });
    await wrapper.find('button.menubtn').trigger('click');

    const btn = findTutorialButton();
    expect(btn, 'Expected tutorial button to be present').toBeDefined();
    expect(btn!.textContent?.trim()).toBe('Start tutorial');

    btn!.click();
    await wrapper.vm.$nextTick();

    const emitted = wrapper.emitted('teaching-action') as string[][];
    expect(emitted).toBeDefined();
    expect(emitted.some(args => args[0] === 'start-tutorial')).toBe(true);
    wrapper.unmount();
  });

  it('B: shows "Exit tutorial" and emits exit-tutorial when isTutorialRunning is true', async () => {
    const wrapper = mountMenu({ isTutorialRunning: true });
    await wrapper.find('button.menubtn').trigger('click');

    const btn = findTutorialButton();
    expect(btn, 'Expected tutorial button to be present').toBeDefined();
    expect(btn!.textContent?.trim()).toBe('Exit tutorial');

    btn!.click();
    await wrapper.vm.$nextTick();

    const emitted = wrapper.emitted('teaching-action') as string[][];
    expect(emitted).toBeDefined();
    expect(emitted.some(args => args[0] === 'exit-tutorial')).toBe(true);
    wrapper.unmount();
  });

  it('A-default: shows "Start tutorial" when isTutorialRunning is omitted', async () => {
    // isTutorialRunning defaults to undefined (falsy) — should behave like false.
    const wrapper = mountMenu(/* no isTutorialRunning */);
    await wrapper.find('button.menubtn').trigger('click');

    const btn = findTutorialButton();
    expect(btn, 'Expected tutorial button to be present').toBeDefined();
    expect(btn!.textContent?.trim()).toBe('Start tutorial');
    wrapper.unmount();
  });

  it('tutorial group is hidden when hasTutorial is false/absent', async () => {
    const wrapper = mountMenu({ hasTutorial: false });
    await wrapper.find('button.menubtn').trigger('click');

    const btn = findTutorialButton();
    expect(btn).toBeUndefined();
    wrapper.unmount();
  });
});
