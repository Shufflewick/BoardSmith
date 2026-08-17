// @vitest-environment jsdom
/**
 * GameHeader — the bar every game screen carries: menu, title, zoom, auto-mode
 * toggle, game code and connection badge. Previously it was only ever referred
 * to by a FAKE sentinel in GameShell's IA test, so nothing mounted the real one.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import GameHeader from './GameHeader.vue';

const header = (props: Record<string, unknown> = {}) =>
  mount(GameHeader, {
    props: {
      gameTitle: 'Go Fish',
      gameId: 'abc123',
      connectionStatus: 'connected',
      ...props,
    },
  });

describe('GameHeader', () => {
  it('shows the game title', () => {
    expect(header().find('h1').text()).toBe('Go Fish');
  });

  it('shows the game code so it can be shared', () => {
    expect(header().find('.game-code').text()).toContain('abc123');
  });

  it('omits the code block entirely before a game exists', () => {
    expect(header({ gameId: null }).find('.game-code').exists()).toBe(false);
  });

  it('shows the connection status as a badge that reflects the state', () => {
    const wrapper = header({ connectionStatus: 'disconnected' });
    const badge = wrapper.find('.connection-badge');
    expect(badge.text()).toBe('disconnected');
    expect(badge.classes()).toContain('disconnected');
  });

  it('mounts the hamburger menu and forwards its selections', async () => {
    const wrapper = header();
    const menu = wrapper.findComponent({ name: 'HamburgerMenu' });
    expect(menu.exists()).toBe(true);
    menu.vm.$emit('menu-item-click', 'new-game');
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('menu-item-click')![0]).toEqual(['new-game']);
  });

  describe('zoom control', () => {
    it('shows 100% by default', () => {
      expect(header().find('.zoom-reset').text()).toBe('100%');
    });

    it('renders the current zoom as a whole percentage', () => {
      expect(header({ zoom: 1.5 }).find('.zoom-reset').text()).toBe('150%');
      expect(header({ zoom: 0.75 }).find('.zoom-reset').text()).toBe('75%');
    });

    it('seeds the slider from the current zoom', () => {
      const slider = header({ zoom: 1.5 }).find('.zoom-slider').element as HTMLInputElement;
      expect(slider.value).toBe('1.5');
    });

    it('bounds the slider to the supported zoom range', () => {
      const slider = header().find('.zoom-slider');
      expect(slider.attributes('min')).toBe('0.5');
      expect(slider.attributes('max')).toBe('2');
    });

    it('emits a numeric zoom update when dragged', async () => {
      const wrapper = header();
      const slider = wrapper.find('.zoom-slider');
      (slider.element as HTMLInputElement).value = '1.4';
      await slider.trigger('input');
      expect(wrapper.emitted('update:zoom')![0]).toEqual([1.4]);
    });

    it('emits fit-zoom — not a zoom value — when the percentage is clicked', async () => {
      const wrapper = header();
      await wrapper.find('.zoom-reset').trigger('click');
      expect(wrapper.emitted('fit-zoom')).toHaveLength(1);
      expect(wrapper.emitted('update:zoom')).toBeUndefined();
    });
  });

  describe('auto mode', () => {
    it('is on by default, since skipping forced clicks is the helpful default', () => {
      const toggle = header().find('.auto-end-turn-toggle input').element as HTMLInputElement;
      expect(toggle.checked).toBe(true);
    });

    it('reflects an explicit off state', () => {
      const toggle = header({ autoEndTurn: false }).find('.auto-end-turn-toggle input')
        .element as HTMLInputElement;
      expect(toggle.checked).toBe(false);
    });

    it('emits the new value when toggled off', async () => {
      const wrapper = header({ autoEndTurn: true });
      const toggle = wrapper.find('.auto-end-turn-toggle input');
      (toggle.element as HTMLInputElement).checked = false;
      await toggle.trigger('change');
      expect(wrapper.emitted('update:autoEndTurn')![0]).toEqual([false]);
    });

    it('emits the new value when toggled on', async () => {
      const wrapper = header({ autoEndTurn: false });
      const toggle = wrapper.find('.auto-end-turn-toggle input');
      (toggle.element as HTMLInputElement).checked = true;
      await toggle.trigger('change');
      expect(wrapper.emitted('update:autoEndTurn')![0]).toEqual([true]);
    });
  });

  it('emits nothing on mount', () => {
    const wrapper = header();
    expect(wrapper.emitted()).toEqual({});
  });
});
