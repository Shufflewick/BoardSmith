// @vitest-environment jsdom
/**
 * A touch-only tap outside the open controls menu closes it (#1607). A touch
 * sends no mouse events when a pointerdown handler cancels them, as drag does.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ControlsMenu from './ControlsMenu.vue';

vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})));

describe('ControlsMenu outside tap', () => {
  it('closes on a touch pointerdown outside it, with no mousedown', async () => {
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    const wrapper = mount(ControlsMenu, {
      props: { play: { autoEndTurn: false, zoom: 1, zoomSupported: true, canUndo: false } },
      attachTo: document.body,
    });
    await wrapper.find('button.menubtn').trigger('click');
    expect(document.querySelector('[role="menu"]')).not.toBeNull();

    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    await wrapper.vm.$nextTick();

    expect(document.querySelector('[role="menu"]')).toBeNull();
    wrapper.unmount();
    outside.remove();
  });
});
