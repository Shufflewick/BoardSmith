// @vitest-environment jsdom
/**
 * HamburgerMenu accessibility tests — QUICK-02 + A11Y-07
 *
 * Verifies ARIA attributes on the hamburger toggle button and close button:
 *   - aria-label present on hamburger button
 *   - aria-expanded reflects open/closed state
 *   - aria-controls targets the drawer element id
 *   - drawer element has id matching aria-controls when open
 *   - close button has aria-label
 *
 * A11Y-07 additions:
 *   - drawer has role="dialog" and aria-modal="true" when open
 *   - drawer has aria-label="Game menu"
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
    expect(btn.attributes('aria-label')).toBe('Open menu');
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

  it('hamburger button aria-label changes to "Close menu" when open', async () => {
    const wrapper = mount(HamburgerMenu, {
      props: { gameTitle: 'Test Game' },
    });

    const btn = wrapper.find('.hamburger-btn');
    expect(btn.attributes('aria-label')).toBe('Open menu');
    await btn.trigger('click');
    expect(btn.attributes('aria-label')).toBe('Close menu');
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

describe('HamburgerMenu accessibility (A11Y-07 — dialog semantics)', () => {
  it('drawer has role="dialog" when open', async () => {
    const wrapper = mount(HamburgerMenu, {
      props: { gameTitle: 'Test Game' },
    });

    await wrapper.find('.hamburger-btn').trigger('click');

    const drawer = wrapper.find('#hamburger-menu-drawer');
    expect(drawer.attributes('role')).toBe('dialog');
  });

  it('drawer has aria-modal="true" when open', async () => {
    const wrapper = mount(HamburgerMenu, {
      props: { gameTitle: 'Test Game' },
    });

    await wrapper.find('.hamburger-btn').trigger('click');

    const drawer = wrapper.find('#hamburger-menu-drawer');
    expect(drawer.attributes('aria-modal')).toBe('true');
  });

  it('drawer has aria-label="Game menu"', async () => {
    const wrapper = mount(HamburgerMenu, {
      props: { gameTitle: 'Test Game' },
    });

    await wrapper.find('.hamburger-btn').trigger('click');

    const drawer = wrapper.find('#hamburger-menu-drawer');
    expect(drawer.attributes('aria-label')).toBe('Game menu');
  });
});
