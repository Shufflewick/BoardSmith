/**
 * Tests for useAnimationTestMode (ANIM-01 recorder).
 *
 * This module is Vue-free and DOM-free, so a node test environment is fine —
 * no `@vitest-environment jsdom` pragma needed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  enableAnimationTestMode,
  disableAnimationTestMode,
  isAnimationTestModeEnabled,
  recordTrace,
  getAnimationTrace,
  clearAnimationTrace,
  type AnimationTrace,
} from './useAnimationTestMode.js';

describe('useAnimationTestMode', () => {
  beforeEach(() => {
    clearAnimationTrace();
    disableAnimationTestMode();
  });

  it('is disabled by default', () => {
    expect(isAnimationTestModeEnabled()).toBe(false);
  });

  it('enableAnimationTestMode() flips the flag', () => {
    enableAnimationTestMode();
    expect(isAnimationTestModeEnabled()).toBe(true);
  });

  it('records entries in insertion order while enabled', () => {
    enableAnimationTestMode();
    const a: AnimationTrace = { kind: 'flip', element: 'card-1', from: 'deck', to: 'hand' };
    const b: AnimationTrace = { kind: 'fly', element: 'card-2', from: 'hand', to: 'discard' };

    recordTrace(a);
    recordTrace(b);

    expect(getAnimationTrace()).toEqual([a, b]);
  });

  it('recordTrace is a no-op while disabled', () => {
    const entry: AnimationTrace = { kind: 'element', element: 'card-1', from: undefined, to: undefined };

    recordTrace(entry);

    expect(getAnimationTrace()).toEqual([]);
  });

  it('clearAnimationTrace() empties the buffer', () => {
    enableAnimationTestMode();
    recordTrace({ kind: 'action', element: null, from: 'a', to: 'b' });
    expect(getAnimationTrace().length).toBe(1);

    clearAnimationTrace();

    expect(getAnimationTrace()).toEqual([]);
  });

  it('disableAnimationTestMode() stops recording but leaves existing entries intact', () => {
    enableAnimationTestMode();
    const a: AnimationTrace = { kind: 'flip', element: 'card-1', from: 'deck', to: 'hand' };
    recordTrace(a);

    disableAnimationTestMode();
    recordTrace({ kind: 'flip', element: 'card-2', from: 'hand', to: 'discard' });

    expect(getAnimationTrace()).toEqual([a]);
    expect(isAnimationTestModeEnabled()).toBe(false);
  });
});
