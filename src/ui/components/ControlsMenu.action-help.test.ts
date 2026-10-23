// @vitest-environment jsdom
/**
 * ControlsMenu: the "Show action help" toggle (#108, #1449).
 *
 * It is a built-in preference, so it shows in a world's menu (no `play`) as
 * well as a table's, and both read one stored value. The popover is
 * teleported to <body>, so queries use document.body.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import ControlsMenu from './ControlsMenu.vue';
import { actionHelpPreference } from '../composables/actionHelp.js';

// jsdom lacks matchMedia
vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})));

const actionHelp = actionHelpPreference().use('actionHelp');

async function openMenu(props: Record<string, unknown> = {}) {
  const wrapper = mount(ControlsMenu, { props, attachTo: document.body });
  await wrapper.find('button.menubtn').trigger('click');
  return wrapper;
}

function findHelpToggle(): HTMLElement | undefined {
  const items = document.body.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]');
  return Array.from(items).find((el) => el.textContent?.includes('Show action help'));
}

describe('ControlsMenu: Show action help', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    actionHelp.value = true;
  });

  it('is on by default', () => {
    expect(actionHelp.value).toBe(true);
  });

  it('shows in a menu with no Play group, as a world has (#1449)', async () => {
    const wrapper = await openMenu();
    expect(findHelpToggle()).toBeDefined();
    wrapper.unmount();
  });

  it('shows in a table menu without a bot, whatever the teaching lockout', async () => {
    const wrapper = await openMenu({
      play: { autoEndTurn: false, zoom: 1, zoomSupported: true, canUndo: false },
      teachingDisabled: true,
    });
    expect(findHelpToggle()).toBeDefined();
    wrapper.unmount();
  });

  it('flips the shared preference and saves it for every game in this browser', async () => {
    const wrapper = await openMenu();
    expect(findHelpToggle()!.getAttribute('aria-checked')).toBe('true');
    findHelpToggle()!.click();
    await nextTick();
    expect(actionHelp.value).toBe(false);
    expect(findHelpToggle()!.getAttribute('aria-checked')).toBe('false');
    expect(localStorage.getItem('boardsmith-preference:boardsmith:actionHelp')).toBe('false');
    wrapper.unmount();
  });

  it('is hidden when no available action has help to reveal', async () => {
    const wrapper = await openMenu({ hasActionHelp: false });
    expect(findHelpToggle()).toBeUndefined();
    wrapper.unmount();
  });
});
