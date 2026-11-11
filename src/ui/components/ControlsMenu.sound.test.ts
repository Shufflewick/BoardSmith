// @vitest-environment jsdom
/**
 * The controls menu's Sound items drive `audioService`, the one source of the
 * player's sound settings, in a table's menu and a world's alike (#1528).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ControlsMenu from './ControlsMenu.vue';
import { audioService } from '../../client/audio.js';

vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})));

beforeEach(() => {
  audioService.setEnabled(true);
  audioService.setVolume(0.5);
});

async function openMenu(props = {}) {
  const wrapper = mount(ControlsMenu, { props, attachTo: document.body });
  await wrapper.find('button.menubtn').trigger('click');
  return wrapper;
}

const soundItem = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')].find((item) => item.textContent!.trim() === 'Sound')!;
const volumeSlider = () => document.querySelector<HTMLInputElement>('input[type="range"][aria-label="Volume"]')!;

describe('ControlsMenu sound', () => {
  it('mutes and unmutes through audioService, remembered for the next visit', async () => {
    const wrapper = await openMenu();
    expect(soundItem().getAttribute('aria-checked')).toBe('true');

    soundItem().click();
    await nextTick();
    expect(audioService.isEnabled()).toBe(false);
    expect(localStorage.getItem('boardsmith-audio-enabled')).toBe('false');
    expect(soundItem().getAttribute('aria-checked')).toBe('false');
    wrapper.unmount();
  });

  it('sets the volume from the slider, remembered for the next visit', async () => {
    const wrapper = await openMenu({ play: { autoEndTurn: false, zoom: 1, canUndo: false } });
    const slider = volumeSlider();
    expect(slider.value).toBe('0.5');
    expect(slider.getAttribute('aria-valuetext')).toBe('50%');

    slider.value = '0.2';
    slider.dispatchEvent(new Event('input'));
    await nextTick();
    expect(audioService.getVolume()).toBe(0.2);
    expect(localStorage.getItem('boardsmith-audio-volume')).toBe('0.2');
    expect(volumeSlider().getAttribute('aria-valuetext')).toBe('20%');
    wrapper.unmount();
  });

  it('announces the volume the slider shows, not an unsnapped one (#1528 review F6)', async () => {
    const wrapper = await openMenu();
    audioService.setVolume(0.33);
    await nextTick();
    // jsdom does not snap a range's value to its step as a browser does, so snap it here.
    const step = Number(volumeSlider().step);
    const shown = Math.round(Number(volumeSlider().value) / step) * step;
    expect(volumeSlider().getAttribute('aria-valuetext')).toBe(`${Math.round(shown * 100)}%`);
    wrapper.unmount();
  });

  it('follows a change the game makes to audioService itself', async () => {
    const wrapper = await openMenu();
    audioService.setVolume(0.9);
    audioService.setEnabled(false);
    await nextTick();
    expect(volumeSlider().value).toBe('0.9');
    expect(soundItem().getAttribute('aria-checked')).toBe('false');
    wrapper.unmount();
  });
});
