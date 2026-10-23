// @vitest-environment jsdom
/**
 * ONE REDUCED-MOTION SETTING: THE DEVICE'S, OR THE PLAYER'S OWN (#1442).
 *
 * `prefersReducedMotion` is on when the device asks for less motion or the
 * player turned on Reduce motion in the controls menu, and the shells mirror
 * it as a class on `<html>` that every reduced-motion CSS rule keys on.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { effectScope, nextTick } from 'vue';

let deviceReduces = false;
let deviceChange: ((e: { matches: boolean }) => void) | undefined;
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: query === '(prefers-reduced-motion: reduce)' && deviceReduces,
  media: query,
  addEventListener: (_: string, listener: (e: { matches: boolean }) => void) => { deviceChange = listener; },
  removeEventListener: () => {},
}));

const { prefersReducedMotion, reduceMotionPreference, useReducedMotionClass } = await import('./reducedMotion.js');
const playerChoice = () => reduceMotionPreference().use('reduceMotion');
const htmlHasClass = () => document.documentElement.classList.contains('bs-reduce-motion');

beforeEach(() => {
  playerChoice().value = false;
  deviceChange?.({ matches: false });
});

describe('prefersReducedMotion (#1442)', () => {
  it('reads true while the player has Reduce motion on', () => {
    expect(prefersReducedMotion.value).toBe(false);
    playerChoice().value = true;
    expect(prefersReducedMotion.value).toBe(true);
  });

  it('reads true while the device asks for less motion, whatever the player chose', () => {
    deviceChange!({ matches: true });
    expect(prefersReducedMotion.value).toBe(true);
  });

  it('saves the choice once for every BoardSmith game in this browser', () => {
    playerChoice().value = true;
    expect(localStorage.getItem('boardsmith-preference:boardsmith:reduceMotion')).toBe('true');
  });
});

describe('useReducedMotionClass (#1442)', () => {
  it('keeps bs-reduce-motion on <html> in step with the setting, and takes it off when the shell goes', async () => {
    const scope = effectScope();
    scope.run(() => useReducedMotionClass());
    expect(htmlHasClass()).toBe(false);
    playerChoice().value = true;
    await nextTick();
    expect(htmlHasClass()).toBe(true);
    playerChoice().value = false;
    deviceChange!({ matches: true });
    await nextTick();
    expect(htmlHasClass()).toBe(true);
    scope.stop();
    expect(htmlHasClass()).toBe(false);
  });
});
