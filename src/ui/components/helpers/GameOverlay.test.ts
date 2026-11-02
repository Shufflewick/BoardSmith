// @vitest-environment jsdom
/**
 * GameOverlay is the in-place modal backdrop custom UIs use for round summaries
 * and confirmations. It deliberately does NOT teleport: it relies on being
 * inside GameShell's `contain: layout` container so the header and Action Panel
 * stay reachable behind it.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import GameOverlay from './GameOverlay.vue';

enableAutoUnmount(afterEach);

// Mounts the overlay with the real Transition, so a leave runs its frames before it ends.
// `closed()` resolves on the next `closed` event; the leaving backdrop is no longer the
// component's root, so the tests look for it in the page.
function fadingOverlay() {
  let next = () => {};
  const onClosed = vi.fn(() => next());
  const wrapper = mount(GameOverlay, {
    props: { active: true, onClosed },
    global: { stubs: { transition: false } },
    attachTo: document.body,
  });
  const closed = () => new Promise<void>((resolve) => (next = resolve));
  return { wrapper, onClosed, closed };
}

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

  it('emits closed once its fade-out has finished, not when active turns false', async () => {
    const { wrapper, onClosed, closed } = fadingOverlay();
    const fadedOut = closed();

    await wrapper.setProps({ active: false });
    expect(document.querySelector('.game-overlay')).not.toBeNull();
    expect(onClosed).not.toHaveBeenCalled();

    await fadedOut;
    expect(document.querySelector('.game-overlay')).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('emits closed when active turns true again part way through the fade-out, as the fading backdrop gives way to a new one', async () => {
    const { wrapper, onClosed } = fadingOverlay();
    await wrapper.setProps({ active: false });
    await wrapper.setProps({ active: true });
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.game-overlay')).toHaveLength(1);
  });

  it('emits closed when it is unmounted part way through the fade-out', async () => {
    const onClosed = vi.fn();
    const shown = ref(true);
    const active = ref(true);
    const Board = defineComponent(() => () => (shown.value ? h(GameOverlay, { active: active.value, onClosed }) : null));
    const wrapper = mount(Board, { global: { stubs: { transition: false } }, attachTo: document.body });

    active.value = false;
    await wrapper.vm.$nextTick();
    shown.value = false;
    await wrapper.vm.$nextTick();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('allows a fully transparent backdrop', () => {
    const style = overlay({ backdropOpacity: 0 }).find('.game-overlay').attributes('style')!;
    expect(style).toContain('rgba(0, 0, 0, 0)');
  });
});
