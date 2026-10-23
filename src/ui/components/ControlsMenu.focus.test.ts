// @vitest-environment jsdom
/**
 * When every item in the open controls menu turns disabled, focus goes to the
 * menu itself, so its keydown still hears Escape (#1457).
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ControlsMenu from './ControlsMenu.vue';

vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})));

describe('ControlsMenu focus', () => {
  it('moves focus to the menu when its last enabled item turns disabled', async () => {
    const wrapper = mount(ControlsMenu, { attachTo: document.body });
    await wrapper.find('button.menubtn').trigger('click');
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    const focused = document.activeElement as HTMLButtonElement;
    expect(menu.contains(focused)).toBe(true);

    // jsdom keeps focus on a disabled element; blur() stands in for the browser dropping it.
    focused.blur();
    for (const el of menu.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')) el.disabled = true;
    await Promise.resolve();

    expect(document.activeElement).toBe(menu);
    wrapper.unmount();
  });
});
