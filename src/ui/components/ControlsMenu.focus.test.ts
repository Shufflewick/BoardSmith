// @vitest-environment jsdom
/**
 * When every item in the open controls menu is removed, focus goes to the
 * menu itself, so its keydown still hears Escape (#1457). Up, Down, Home and
 * End move between the items of every kind, wrapping (#1458). A disabled item
 * stays focusable and choosing it does nothing (#1465).
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ControlsMenu from './ControlsMenu.vue';
import { definePlayerPreferences } from '../player-preferences.js';

vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})));

describe('ControlsMenu focus', () => {
  it('moves focus to the menu when its last item is removed', async () => {
    const wrapper = mount(ControlsMenu, { attachTo: document.body });
    await wrapper.find('button.menubtn').trigger('click');
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    const focused = document.activeElement as HTMLButtonElement;
    expect(menu.contains(focused)).toBe(true);

    // jsdom keeps focus on a removed element; blur() stands in for the browser dropping it.
    focused.blur();
    for (const el of menu.querySelectorAll('button, input')) el.remove();
    await Promise.resolve();

    expect(document.activeElement).toBe(menu);
    wrapper.unmount();
  });

  describe('arrow keys (#1458)', () => {
    const ITEMS = ['Auto end turn', 'Undo last action', 'Fit', 'Deal', 'Shuffle', 'Reduce motion', 'Show action help', 'Full', 'Slow'];

    async function openMenu() {
      localStorage.clear();
      const preferences = definePlayerPreferences('i1458', {
        flicker: { label: 'Flicker', options: [{ value: 'full', label: 'Full' }, { value: 'slow', label: 'Slow' }], default: 'full' },
      });
      const wrapper = mount(ControlsMenu, {
        props: {
          play: { autoEndTurn: false, zoom: 1, zoomSupported: true, canUndo: false },
          commands: [{ label: 'Deal', run: () => {} }, { label: 'Shuffle', enabled: false, run: () => {} }],
          preferences,
        },
        attachTo: document.body,
      });
      await wrapper.find('button.menubtn').trigger('click');
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();
      const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
      const press = (key: string) => {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        document.activeElement!.dispatchEvent(event);
        return event;
      };
      const focusedLabel = () => document.activeElement!.textContent!.trim();
      return { wrapper, menu, press, focusedLabel };
    }

    it('opens with focus on the first item', async () => {
      const { wrapper, focusedLabel } = await openMenu();
      expect(focusedLabel()).toContain(ITEMS[0]);
      wrapper.unmount();
    });

    it('Down visits every item in order, disabled ones too, and wraps to the first', async () => {
      const { wrapper, press, focusedLabel } = await openMenu();
      const visited = [focusedLabel()];
      for (let i = 0; i < ITEMS.length; i++) {
        expect(press('ArrowDown').defaultPrevented).toBe(true);
        visited.push(focusedLabel());
      }
      ITEMS.forEach((label, i) => expect(visited[i]).toContain(label));
      expect(visited[ITEMS.length]).toContain(ITEMS[0]);
      wrapper.unmount();
    });

    it('Up wraps from the first item to the last and walks back', async () => {
      const { wrapper, press, focusedLabel } = await openMenu();
      press('ArrowUp');
      expect(focusedLabel()).toBe('Slow');
      press('ArrowUp');
      expect(focusedLabel()).toBe('Full');
      wrapper.unmount();
    });

    it('End goes to the last item and Home to the first', async () => {
      const { wrapper, press, focusedLabel } = await openMenu();
      press('End');
      expect(focusedLabel()).toBe('Slow');
      press('Home');
      expect(focusedLabel()).toContain(ITEMS[0]);
      wrapper.unmount();
    });

    it('leaves the arrow keys to the zoom slider while it has focus', async () => {
      const { wrapper, menu, press } = await openMenu();
      const slider = menu.querySelector<HTMLInputElement>('input.zoom-range')!;
      slider.focus();
      expect(press('ArrowUp').defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(slider);
      wrapper.unmount();
    });

    it('labels the zoom row as a group, so its slider is not hidden inside a menu item', async () => {
      const { wrapper, menu } = await openMenu();
      const slider = menu.querySelector('input.zoom-range')!;
      expect(slider.closest('[role^="menuitem"]')).toBeNull();
      expect(slider.closest('[role="group"]')?.getAttribute('aria-label')).toBe('Zoom');
      wrapper.unmount();
    });
  });

  describe('a disabled item (#1465)', () => {
    async function openMenu() {
      const run = vi.fn();
      const wrapper = mount(ControlsMenu, {
        props: {
          play: { autoEndTurn: false, zoom: 1, zoomSupported: true, canUndo: false },
          showHint: true,
          hintDisabled: true,
          commands: [{ label: 'Shuffle', enabled: false, run }],
        },
        attachTo: document.body,
      });
      await wrapper.find('button.menubtn').trigger('click');
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();
      const item = (label: string) => Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'))
        .find((el) => el.textContent!.includes(label))!;
      return { wrapper, run, item };
    }

    it.each(['Undo last action', 'Get a hint', 'Shuffle'])('"%s" is marked aria-disabled alone, so it keeps focus', async (label) => {
      const { wrapper, item } = await openMenu();
      expect(item(label).getAttribute('aria-disabled')).toBe('true');
      expect(item(label).hasAttribute('disabled')).toBe(false);
      item(label).focus();
      expect(document.activeElement).toBe(item(label));
      wrapper.unmount();
    });

    it.each(['Undo last action', 'Get a hint', 'Shuffle'])('choosing "%s" does nothing and leaves the menu open', async (label) => {
      const { wrapper, run, item } = await openMenu();
      item(label).click();
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted('undo')).toBeUndefined();
      expect(wrapper.emitted('teaching-action')).toBeUndefined();
      expect(run).not.toHaveBeenCalled();
      expect(document.querySelector('[role="menu"]')).not.toBeNull();
      wrapper.unmount();
    });
  });
});
