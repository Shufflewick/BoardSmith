// @vitest-environment jsdom
/**
 * ControlsMenu unmounted while open must not leave the app inert (#862).
 * The popover is teleported to <body>, so while open the app root is inert.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ControlsMenu from './ControlsMenu.vue';

vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})));

describe('ControlsMenu unmount', () => {
  it('clears inert from the app root when unmounted while open', async () => {
    const app = document.createElement('div');
    app.id = 'app';
    document.body.appendChild(app);
    const wrapper = mount(ControlsMenu, {
      props: { autoEndTurn: false, zoom: 1, canUndo: false },
      attachTo: app,
    });

    await wrapper.find('button.menubtn').trigger('click');
    await wrapper.vm.$nextTick();
    expect(app.hasAttribute('inert')).toBe(true);

    wrapper.unmount();
    expect(app.hasAttribute('inert')).toBe(false);
  });
});
