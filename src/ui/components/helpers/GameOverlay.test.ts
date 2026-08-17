// @vitest-environment jsdom
/**
 * GameOverlay is the in-place modal backdrop custom UIs use for round summaries
 * and confirmations. It deliberately does NOT teleport: it relies on being
 * inside GameShell's `contain: layout` container so the header and Action Panel
 * stay reachable behind it.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import GameOverlay from './GameOverlay.vue';

const overlay = (props: Record<string, unknown> = {}, slots: Record<string, string> = {}) =>
  mount(GameOverlay, { props: { active: true, ...props }, slots });

describe('GameOverlay', () => {
  it('renders nothing while inactive', () => {
    expect(overlay({ active: false }).find('.game-overlay').exists()).toBe(false);
  });

  it('renders the backdrop when active', () => {
    expect(overlay().find('.game-overlay').exists()).toBe(true);
  });

  it('appears and disappears as the active prop changes', async () => {
    const wrapper = overlay({ active: false });
    await wrapper.setProps({ active: true });
    expect(wrapper.find('.game-overlay').exists()).toBe(true);
    await wrapper.setProps({ active: false });
    expect(wrapper.find('.game-overlay').exists()).toBe(false);
  });

  it('renders its slot content', () => {
    const wrapper = overlay({}, { default: '<div class="modal">Round over</div>' });
    expect(wrapper.find('.modal').text()).toBe('Round over');
  });

  it('renders no slot content while inactive', () => {
    const wrapper = overlay({ active: false }, { default: '<div class="modal">Round over</div>' });
    expect(wrapper.find('.modal').exists()).toBe(false);
  });

  it('emits click when the backdrop is clicked', async () => {
    const wrapper = overlay();
    await wrapper.find('.game-overlay').trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);
  });

  it('lets content stop the click from reaching the backdrop', async () => {
    const wrapper = overlay({}, { default: '<button class="inside" @click.stop>Keep open</button>' });
    await wrapper.find('.inside').trigger('click');
    expect(wrapper.emitted('click')).toBeUndefined();
  });

  it('treats a click on unguarded content as a backdrop click', async () => {
    const wrapper = overlay({}, { default: '<button class="inside">Close</button>' });
    await wrapper.find('.inside').trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);
  });

  it('dims the game with a 0.85 black backdrop by default', () => {
    const style = overlay().find('.game-overlay').attributes('style')!;
    expect(style).toContain('rgba(0, 0, 0, 0.85)');
  });

  it('honours a custom backdrop opacity', () => {
    const style = overlay({ backdropOpacity: 0.3 }).find('.game-overlay').attributes('style')!;
    expect(style).toContain('rgba(0, 0, 0, 0.3)');
  });

  it('blurs the backdrop by default', () => {
    expect(overlay().find('.game-overlay').attributes('style')).toContain('blur(4px)');
  });

  it('drops the blur when asked to', () => {
    const style = overlay({ backdrop: false }).find('.game-overlay').attributes('style')!;
    expect(style).toContain('none');
    expect(style).not.toContain('blur(4px)');
  });

  it('updates the backdrop when the opacity prop changes', async () => {
    const wrapper = overlay({ backdropOpacity: 0.85 });
    await wrapper.setProps({ backdropOpacity: 0.5 });
    expect(wrapper.find('.game-overlay').attributes('style')).toContain('rgba(0, 0, 0, 0.5)');
  });

  it('stays in place rather than teleporting, so GameShell can contain it', () => {
    const wrapper = overlay({}, { default: '<div class="modal">Round over</div>' });
    // The overlay must be a descendant of the component's own root, not moved
    // to document.body — teleporting would escape GameShell's contain: layout
    // and cover the header and Action Panel.
    expect(wrapper.element.querySelector('.modal')).not.toBeNull();
  });

  it('allows a fully transparent backdrop', () => {
    const style = overlay({ backdropOpacity: 0 }).find('.game-overlay').attributes('style')!;
    expect(style).toContain('rgba(0, 0, 0, 0)');
  });
});
