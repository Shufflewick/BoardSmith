// @vitest-environment jsdom
/**
 * The zoom slider keeps its 0.5 minimum while the automatic fit may go lower (#1162).
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ControlsMenu from './ControlsMenu.vue';

vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})));

describe('ControlsMenu zoom slider', () => {
  it('keeps a 0.5 minimum and reports a fitted zoom below it without changing it', async () => {
    const wrapper = mount(ControlsMenu, {
      props: { autoEndTurn: false, zoom: 0.23, canUndo: false },
      attachTo: document.body,
    });
    await wrapper.find('button.menubtn').trigger('click');
    const slider = document.querySelector<HTMLInputElement>('input.zoom-range')!;

    expect(slider.min).toBe('0.5');
    expect(slider.max).toBe('2');
    expect(slider.getAttribute('aria-valuetext')).toBe('23%');
    expect(wrapper.emitted('update:zoom')).toBeUndefined();
    wrapper.unmount();
  });
});
