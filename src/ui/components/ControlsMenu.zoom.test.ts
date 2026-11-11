// @vitest-environment jsdom
/**
 * The zoom is a magnifier, 100% to 200%, with a button back to 100% (#1608).
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ControlsMenu from './ControlsMenu.vue';

vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})));

describe('ControlsMenu zoom magnifier', () => {
  it('ranges from 100% to 200% and puts the board back to 100% on request', async () => {
    const wrapper = mount(ControlsMenu, {
      props: { play: { autoEndTurn: false, zoom: 1.5, canUndo: false } },
      attachTo: document.body,
    });
    await wrapper.find('button.menubtn').trigger('click');
    const slider = document.querySelector<HTMLInputElement>('input.zoom-range')!;

    expect([slider.min, slider.max]).toEqual(['1', '2']);
    expect(slider.getAttribute('aria-valuetext')).toBe('150%');
    document.querySelector<HTMLButtonElement>('button.zoom-reset')!.click();
    expect(wrapper.emitted('reset-zoom')).toHaveLength(1);
    wrapper.unmount();
  });
});
