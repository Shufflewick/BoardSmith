// @vitest-environment jsdom
/**
 * HamburgerMenu accessibility tests — QUICK-02
 *
 * Verifies ARIA attributes on the hamburger toggle button and close button:
 *   - aria-label present on hamburger button
 *   - aria-expanded reflects open/closed state
 *   - aria-controls targets the drawer element id
 *   - drawer element has id matching aria-controls when open
 *   - close button has aria-label
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import HamburgerMenu from './HamburgerMenu.vue';

describe('HamburgerMenu accessibility (QUICK-02)', () => {
  it('hamburger button has aria-label, aria-expanded=false, and aria-controls when closed', () => {
    const wrapper = mount(HamburgerMenu, {
      props: { gameTitle: 'Test Game' },
    });

    const btn = wrapper.find('.hamburger-btn');
    expect(btn.attributes('aria-label')).toBeTruthy();
    expect(btn.attributes('aria-expanded')).toBe('false');
    expect(btn.attributes('aria-controls')).toBe('hamburger-menu-drawer');
  });

  it('hamburger button aria-expanded becomes true after click', async () => {
    const wrapper = mount(HamburgerMenu, {
      props: { gameTitle: 'Test Game' },
    });

    const btn = wrapper.find('.hamburger-btn');
    await btn.trigger('click');

    expect(btn.attributes('aria-expanded')).toBe('true');
  });

  it('drawer gets id matching aria-controls when open', async () => {
    const wrapper = mount(HamburgerMenu, {
      props: { gameTitle: 'Test Game' },
    });

    await wrapper.find('.hamburger-btn').trigger('click');

    const drawer = wrapper.find('#hamburger-menu-drawer');
    expect(drawer.exists()).toBe(true);
  });

  it('close button has aria-label', async () => {
    const wrapper = mount(HamburgerMenu, {
      props: { gameTitle: 'Test Game' },
    });

    await wrapper.find('.hamburger-btn').trigger('click');

    const closeBtn = wrapper.find('.close-btn');
    expect(closeBtn.attributes('aria-label')).toBeTruthy();
  });
});
