// @vitest-environment jsdom
/**
 * Direct unit tests for useActionAnimations.
 *
 * Covers the ANIM-01/02/03 paths added in 128-06:
 *  1. Test mode - an action animation records a {kind:'action'} trace using
 *     the composable's OWN interpolated elementSelector/destinationSelector
 *     strings and resolves instantly WITHOUT delegating to useFlyingElements'
 *     fly() (no double-record).
 *  2. Real path (fake timers) - with source+destination elements present in
 *     the DOM, triggering the animation and advancing fake timers drives the
 *     setTimeout-based CSS-transition wait (and the RAF chain fly() runs
 *     internally, also faked by vi.useFakeTimers()) to completion.
 *  3. Fail-loud - a missing source element throws in dev mode / console.errors
 *     in prod mode; a missing destination element behaves the same way.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick } from 'vue';

// jsdom lacks matchMedia; modules that read it at import time would throw.
vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);

// jsdom lacks ResizeObserver
vi.stubGlobal(
  'ResizeObserver',
  vi.fn(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
);

// Controllable isDevMode() override for the fail-loud throw-path tests.
// Uses vi.hoisted() so the mutable state is safely referenceable inside the
// vi.mock() factory (which vitest hoists above this file's imports).
const devModeState = vi.hoisted(() => ({ override: null as boolean | null }));

vi.mock('../../utils/dev.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/dev.js')>();
  return {
    ...actual,
    isDevMode: () => (devModeState.override !== null ? devModeState.override : actual.isDevMode()),
    isDevThrowEnabled: () => (devModeState.override !== null ? devModeState.override : actual.isDevThrowEnabled()),
  };
});

// Dynamic (not static) import: useActionAnimations.js transitively imports
// useFlyingElements.js -> useElementAnimation.js, which reads
// window.matchMedia() at module load time. A static `import` here would be
// hoisted ahead of the vi.stubGlobal() calls above (128-03/128-05 precedent).
const { useActionAnimations } = await import('./useActionAnimations.js');
const { enableAnimationTestMode, disableAnimationTestMode, getAnimationTrace, clearAnimationTrace } =
  await import('./useAnimationTestMode.js');
type ActionAnimationConfig = import('./useActionAnimations.js').ActionAnimationConfig;
type GameElement = import('../types.js').GameElement;

function makeElement(attr: string, value: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute(attr, value);
  document.body.appendChild(el);
  return el;
}

/**
 * The gameView ref's only role in these tests is to change reference identity
 * so the composable's `watch(gameView, ...)` fires - its shape is otherwise
 * irrelevant, so a minimal stand-in cast satisfies the GameElement type.
 */
function fakeGameView(): GameElement {
  return {} as GameElement;
}

/**
 * Poll until a predicate is true (or timeout).
 */
async function waitFor(predicate: () => boolean, timeout = 500): Promise<void> {
  const start = Date.now();
  while (!predicate() && Date.now() - start < timeout) {
    await nextTick();
    await new Promise((r) => setTimeout(r, 5));
  }
}

const moveConfig: ActionAnimationConfig = {
  action: 'moveCard',
  elementSelection: 'cardId',
  elementSelector: '[data-card-id="{cardId}"]',
  destinationSelector: '[data-zone="{zone}"]',
  duration: 50,
};

describe('useActionAnimations', () => {
  beforeEach(() => {
    disableAnimationTestMode();
    clearAnimationTrace();
    devModeState.override = null;
  });

  afterEach(() => {
    disableAnimationTestMode();
    clearAnimationTrace();
    devModeState.override = null;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('test mode', () => {
    it('records a {kind:"action"} trace from its own interpolated selector strings and skips fly()', async () => {
      makeElement('data-card-id', '42');
      makeElement('data-zone', 'hand');

      const gameViewRef = ref<GameElement | null>(null);
      const { onBeforeAutoExecute } = useActionAnimations({
        gameView: gameViewRef,
        animations: [moveConfig],
      });

      await onBeforeAutoExecute('moveCard', { cardId: '42', zone: 'hand' });

      enableAnimationTestMode();
      gameViewRef.value = fakeGameView();
      await nextTick();
      await waitFor(() => getAnimationTrace().length > 0);

      expect(getAnimationTrace()).toHaveLength(1);
      expect(getAnimationTrace()[0]).toMatchObject({
        kind: 'action',
        element: '42',
        from: '[data-card-id="42"]',
        to: '[data-zone="hand"]',
      });
      // useFlyingElements has its own independent 'fly' trace branch; test mode
      // returning early here must never delegate to fly() (no double-record).
      // Since only useActionAnimations' own trace was recorded (length 1,
      // kind:'action'), no separate 'fly' entry was ever pushed.
    });
  });

  describe('real path (fake timers)', () => {
    it('drives the setTimeout-based lifecycle to completion with source+destination in the DOM', async () => {
      vi.useFakeTimers({
        toFake: [
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          'requestAnimationFrame',
          'cancelAnimationFrame',
          'performance',
          'Date',
        ],
      });
      try {
        const sourceEl = makeElement('data-card-id', '42');
        const destEl = makeElement('data-zone', 'hand');
        vi.spyOn(sourceEl, 'getBoundingClientRect').mockReturnValue(
          new DOMRect(0, 0, 60, 84),
        );
        vi.spyOn(destEl, 'getBoundingClientRect').mockReturnValue(
          new DOMRect(200, 200, 60, 84),
        );

        const gameViewRef = ref<GameElement | null>(null);
        const { onBeforeAutoExecute, flyingElements } = useActionAnimations({
          gameView: gameViewRef,
          animations: [moveConfig],
        });

        await onBeforeAutoExecute('moveCard', { cardId: '42', zone: 'hand' });

        gameViewRef.value = fakeGameView();
        await vi.advanceTimersByTimeAsync(0);
        // The flying element should now be in flight.
        expect(flyingElements.value.length).toBeGreaterThan(0);

        // Advance well past the animation duration + cleanup wait so the RAF
        // chain completes and the setTimeout-based cleanup wait resolves.
        await vi.advanceTimersByTimeAsync(1000);

        expect(flyingElements.value).toHaveLength(0);
        // Not in test mode: no trace should have been recorded.
        expect(getAnimationTrace()).toHaveLength(0);
        // Source element's animating attribute/inline styles must be cleaned up.
        expect(destEl.hasAttribute('data-action-animating')).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('test mode + missing destination (CR-03)', () => {
    it('surfaces an error in dev mode for a typo\'d destination selector even when test mode is enabled', async () => {
      devModeState.override = true;

      // The throw happens inside Vue's async watch callback (same mechanism
      // as the non-test-mode "surfaces an error in dev mode" test below) —
      // capture it via unhandledRejection rather than an awaitable promise.
      const rejections: unknown[] = [];
      const onUnhandled = (reason: unknown) => rejections.push(reason);
      process.on('unhandledRejection', onUnhandled);

      try {
        makeElement('data-card-id', '42');
        // No element matching the destination selector — a typo'd/misconfigured
        // destinationSelector, the canonical authoring bug ANIM-03 exists to
        // catch. Without CR-03's fix, enabling test mode would record a
        // "successful" {kind:'action'} trace instead of ever reaching this
        // fail-loud check.

        const gameViewRef = ref<GameElement | null>(null);
        const { onBeforeAutoExecute } = useActionAnimations({
          gameView: gameViewRef,
          animations: [moveConfig],
        });

        await onBeforeAutoExecute('moveCard', { cardId: '42', zone: 'hand' });

        enableAnimationTestMode();
        gameViewRef.value = fakeGameView();
        await nextTick();
        await waitFor(() => rejections.length > 0);

        expect(rejections).toHaveLength(1);
        expect(String((rejections[0] as Error).message)).toMatch(/Could not find destination element/i);
        // No trace should have been recorded — the fail-loud throw fired
        // before the test-mode trace branch was ever reached.
        expect(getAnimationTrace()).toHaveLength(0);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });
  });

  describe('fail-loud missing source/destination element', () => {
    it('throws in dev mode when the source element is missing', async () => {
      devModeState.override = true;

      const gameViewRef = ref<GameElement | null>(null);
      const { onBeforeAutoExecute } = useActionAnimations({
        gameView: gameViewRef,
        animations: [moveConfig],
      });

      await expect(
        onBeforeAutoExecute('moveCard', { cardId: '42', zone: 'hand' }),
      ).rejects.toThrow(/Could not find element for selector/i);
    });

    it('console.errors (does not throw) in prod mode when the source element is missing', async () => {
      devModeState.override = false;
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const gameViewRef = ref<GameElement | null>(null);
      const { onBeforeAutoExecute } = useActionAnimations({
        gameView: gameViewRef,
        animations: [moveConfig],
      });

      await expect(
        onBeforeAutoExecute('moveCard', { cardId: '42', zone: 'hand' }),
      ).resolves.toBeUndefined();

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(String(consoleErrorSpy.mock.calls[0]?.[0])).toMatch(/Could not find element for selector/i);
    });

    it('console.errors (does not throw) in prod mode when the destination element is missing', async () => {
      devModeState.override = false;
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      makeElement('data-card-id', '42');
      // No destination element created.

      const gameViewRef = ref<GameElement | null>(null);
      const { onBeforeAutoExecute } = useActionAnimations({
        gameView: gameViewRef,
        animations: [moveConfig],
      });

      await onBeforeAutoExecute('moveCard', { cardId: '42', zone: 'hand' });
      gameViewRef.value = fakeGameView();
      await nextTick();
      await waitFor(() => consoleErrorSpy.mock.calls.length > 0);

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(String(consoleErrorSpy.mock.calls[0]?.[0])).toMatch(/Could not find destination element/i);
    });

    it('surfaces an error in dev mode when the destination element is missing', async () => {
      devModeState.override = true;

      // The throw happens inside Vue's async watch callback, so it never
      // reaches an awaitable promise on our side - it surfaces as an
      // unhandled rejection (Vue logs+rethrows via its own error handling).
      // Capture it directly to prove the throw actually fired.
      const rejections: unknown[] = [];
      const onUnhandled = (reason: unknown) => rejections.push(reason);
      process.on('unhandledRejection', onUnhandled);

      try {
        makeElement('data-card-id', '42');
        // No destination element created.

        const gameViewRef = ref<GameElement | null>(null);
        const { onBeforeAutoExecute } = useActionAnimations({
          gameView: gameViewRef,
          animations: [moveConfig],
        });

        await onBeforeAutoExecute('moveCard', { cardId: '42', zone: 'hand' });
        gameViewRef.value = fakeGameView();
        await nextTick();
        await waitFor(() => rejections.length > 0);

        expect(rejections).toHaveLength(1);
        expect(String((rejections[0] as Error).message)).toMatch(/Could not find destination element/i);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });
  });
});
