/**
 * Tests for useCurrentView composable
 *
 * Uses Vue's app.runWithContext() to test provide/inject without DOM.
 */
import { describe, it, expect } from 'vitest';
import { createApp, computed } from 'vue';
import { useCurrentView, CURRENT_VIEW_KEY } from './useCurrentView.js';

/**
 * Helper to run a function inside a Vue app context with optional app-level provides.
 * Uses app.runWithContext() -- no DOM or component mounting needed.
 */
function withAppContext<T>(
  fn: () => T,
  providers?: Array<{ key: string | symbol; value: unknown }>
): T {
  const app = createApp({});
  if (providers) {
    for (const { key, value } of providers) {
      app.provide(key, value);
    }
  }
  return app.runWithContext(fn);
}

describe('useCurrentView', () => {
  it('throws when called outside GameShell context', () => {
    expect(() => {
      withAppContext(() => useCurrentView());
    }).toThrow('useCurrentView() must be called inside a GameShell context');
  });

  it('returns the provided current view', () => {
    const truthView = { id: 1, type: 'game', children: [] };

    const result = withAppContext(
      () => useCurrentView(),
      [{ key: CURRENT_VIEW_KEY, value: computed(() => truthView) }]
    );

    expect(result).toBeDefined();
    expect(result.value).toEqual(truthView);
  });

  it('returns null when provided value is null', () => {
    const result = withAppContext(
      () => useCurrentView(),
      [{ key: CURRENT_VIEW_KEY, value: computed(() => null) }]
    );

    expect(result).toBeDefined();
    expect(result.value).toBeNull();
  });

  it('error message suggests gameView as alternative for theatre state', () => {
    try {
      withAppContext(() => useCurrentView());
      expect.fail('Expected useCurrentView to throw');
    } catch (e: any) {
      expect(e.message).toContain('gameView');
      expect(e.message).toContain('theatre state');
    }
  });

  it('CURRENT_VIEW_KEY is the string "currentGameView"', () => {
    expect(CURRENT_VIEW_KEY).toBe('currentGameView');
  });
});
