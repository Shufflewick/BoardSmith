// @vitest-environment jsdom
/**
 * REDUCED-MOTION CSS WORKS WITH NO SHELL ON THE PAGE (#1446).
 *
 * A BoardSmith component or composable whose CSS keys on `.bs-reduce-motion`
 * keeps that class in step itself, so it follows the device setting and the
 * player's Reduce motion item even when no GameShell or WorldShell is mounted.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

let deviceReduces = true;
let deviceChange: ((e: { matches: boolean }) => void) | undefined;
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: query === '(prefers-reduced-motion: reduce)' && deviceReduces,
  media: query,
  addEventListener: (_: string, listener: (e: { matches: boolean }) => void) => { deviceChange = listener; },
  removeEventListener: () => {},
}));

const freshModules = async () => {
  vi.resetModules();
  // Dynamic import: each test needs a fresh module, so no earlier mount has synced the class.
  return {
    BoardMessage: (await import('../components/helpers/BoardMessage.vue')).default,
    useDragDrop: (await import('./useDragDrop.js')).useDragDrop,
    reduceMotionPreference: (await import('./reducedMotion.js')).reduceMotionPreference,
  };
};
const htmlHasClass = () => document.documentElement.classList.contains('bs-reduce-motion');

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('bs-reduce-motion');
  document.getElementById('bs-reduce-motion')?.remove();
  deviceReduces = true;
});

describe('reduced-motion CSS with no shell (#1446)', () => {
  it('a component mounted alone follows the device setting', async () => {
    const { BoardMessage } = await freshModules();
    mount(BoardMessage, { props: { visible: true } });
    await nextTick();
    expect(htmlHasClass()).toBe(true);
    deviceChange!({ matches: false });
    await nextTick();
    expect(htmlHasClass()).toBe(false);
  });

  it('a component mounted alone follows the player\'s Reduce motion item', async () => {
    deviceReduces = false;
    const { BoardMessage, reduceMotionPreference } = await freshModules();
    mount(BoardMessage, { props: { visible: true } });
    await nextTick();
    expect(htmlHasClass()).toBe(false);
    reduceMotionPreference().use('reduceMotion').value = true;
    await nextTick();
    expect(htmlHasClass()).toBe(true);
  });

  it('useDragDrop, whose classes drag-drop.css styles, follows it too', async () => {
    const { useDragDrop } = await freshModules();
    mount(defineComponent({ setup: () => { useDragDrop(); return () => null; } }));
    await nextTick();
    expect(htmlHasClass()).toBe(true);
  });
});
