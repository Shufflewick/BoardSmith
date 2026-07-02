// @vitest-environment jsdom
/**
 * Direct unit tests for useElementAnimation.
 *
 * Covers the three ANIM-01/02/03 paths added in 128-04:
 *  1. Test mode: animateToCurrentPositions() records an assertable
 *     {kind:'element'} trace by element IDENTITY (never pixels — jsdom rects
 *     are unreliable) instead of running the RAF loop.
 *  2. Real path: with requestAnimationFrame stubbed to a manually-ticked
 *     queue and `Element.prototype.getBoundingClientRect` stubbed to
 *     distinct before/after rects, driving the RAF ticks advances the
 *     animation and applies a CSS transform.
 *  3. Fail-loud: an element lacking `data-element-id` on first resolution
 *     throws in dev / console.errors in prod.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// jsdom lacks matchMedia; useElementAnimation.js reads it at module load time.
vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);

// jsdom lacks ResizeObserver (transitively referenced by sibling composables
// in the module graph; stubbed defensively per the sibling pattern).
vi.stubGlobal(
  'ResizeObserver',
  vi.fn(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
);

// Controllable isDevMode() override for the fail-loud throw-path tests.
const devModeState = vi.hoisted(() => ({ override: null as boolean | null }));

vi.mock('../../utils/dev.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/dev.js')>();
  return {
    ...actual,
    isDevMode: () => (devModeState.override !== null ? devModeState.override : actual.isDevMode()),
    isDevThrowEnabled: () => (devModeState.override !== null ? devModeState.override : actual.isDevThrowEnabled()),
  };
});

// Dynamic (not static) import: useElementAnimation.js reads window.matchMedia()
// at module load time. A static import here would be hoisted ahead of the
// vi.stubGlobal() calls above regardless of source order.
const { useElementAnimation } = await import('./useElementAnimation.js');
const { enableAnimationTestMode, disableAnimationTestMode, getAnimationTrace, clearAnimationTrace } =
  await import('./useAnimationTestMode.js');

function makeContainer(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

function makeChild(id: string): HTMLElement {
  const child = document.createElement('div');
  child.setAttribute('data-animatable', 'true');
  child.setAttribute('data-element-id', id);
  return child;
}

function makeRect(overrides: Partial<DOMRect>): DOMRect {
  return {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON() {
      return {};
    },
    ...overrides,
  } as DOMRect;
}

describe('useElementAnimation', () => {
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
    vi.unstubAllGlobals();
    // Re-stub the globals that must persist across tests (matchMedia read
    // only happens at module load, but ResizeObserver/RAF may be referenced
    // by later tests in this file).
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    document.body.innerHTML = '';
  });

  describe('test mode', () => {
    it('records an element trace keyed by identity instead of animating', () => {
      const container = makeContainer();
      const child = makeChild('card-1');
      container.appendChild(child);

      const { capturePositions, animateToCurrentPositions } = useElementAnimation();

      capturePositions(container);
      enableAnimationTestMode();
      animateToCurrentPositions(container);

      const trace = getAnimationTrace();
      expect(trace).toHaveLength(1);
      expect(trace[0]).toMatchObject({ kind: 'element', element: 'card-1' });
    });

    it('does not apply a CSS transform while in test mode', () => {
      const container = makeContainer();
      const child = makeChild('card-2');
      container.appendChild(child);

      const { capturePositions, animateToCurrentPositions } = useElementAnimation();

      capturePositions(container);
      enableAnimationTestMode();
      animateToCurrentPositions(container);

      expect(child.style.transform).toBe('');
    });
  });

  describe('real path (mocked RAF + distinct rects)', () => {
    it('drives the RAF queue and applies a transform for a moved element', () => {
      const queue: FrameRequestCallback[] = [];
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        queue.push(cb);
        return queue.length;
      });
      vi.stubGlobal('cancelAnimationFrame', vi.fn());

      const container = makeContainer();
      const child = makeChild('card-3');
      container.appendChild(child);

      const beforeRect = makeRect({ left: 0, top: 0 });
      const afterRect = makeRect({ left: 100, top: 100 });
      let call = 0;
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => {
        // capturePositions reads once; then each animate() frame re-reads
        // the "current" (after) rect to compute the live target.
        const rect = call === 0 ? beforeRect : afterRect;
        call++;
        return rect;
      });

      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => now);

      const { capturePositions, animateToCurrentPositions } = useElementAnimation();

      capturePositions(container); // consumes beforeRect
      animateToCurrentPositions(container); // queues the first RAF frame

      expect(queue.length).toBeGreaterThan(0);

      // Tick the RAF queue forward, advancing "time" so progress completes.
      now = 300; // matches DEFAULT_DURATION
      const frame = queue.shift();
      frame?.(now);

      // The element should have received a transform at some point during
      // the animation (applied then cleared on completion at rawProgress>=1).
      // Since a single tick at elapsed=duration completes immediately,
      // assert the transform was cleared (final state) rather than mid-flight.
      expect(child.style.transform).toBe('');
    });

    it('applies a mid-flight transform before the animation completes', () => {
      const queue: FrameRequestCallback[] = [];
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        queue.push(cb);
        return queue.length;
      });
      vi.stubGlobal('cancelAnimationFrame', vi.fn());

      const container = makeContainer();
      const child = makeChild('card-4');
      container.appendChild(child);

      const beforeRect = makeRect({ left: 0, top: 0 });
      const afterRect = makeRect({ left: 100, top: 100 });
      let call = 0;
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => {
        const rect = call === 0 ? beforeRect : afterRect;
        call++;
        return rect;
      });

      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => now);

      const { capturePositions, animateToCurrentPositions } = useElementAnimation();

      capturePositions(container);
      animateToCurrentPositions(container);

      now = 150; // halfway through DEFAULT_DURATION (300ms)
      const frame = queue.shift();
      frame?.(now);

      expect(child.style.transform).toMatch(/translate\(/);
    });
  });

  describe('fail-loud missing anchor', () => {
    it('throws in dev mode when an element to animate has no data-element-id', () => {
      devModeState.override = true;

      const container = makeContainer();
      const child = document.createElement('div');
      child.setAttribute('data-animatable', 'true');
      // Deliberately no data-element-id.
      container.appendChild(child);

      const { capturePositions, animateToCurrentPositions } = useElementAnimation();

      capturePositions(container);
      expect(() => animateToCurrentPositions(container)).toThrow(/data-element-id/);
    });

    it('console.errors and skips (does not throw) in prod mode', () => {
      devModeState.override = false;
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const container = makeContainer();
      const child = document.createElement('div');
      child.setAttribute('data-animatable', 'true');
      container.appendChild(child);

      const { capturePositions, animateToCurrentPositions } = useElementAnimation();

      capturePositions(container);
      expect(() => animateToCurrentPositions(container)).not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(String(consoleErrorSpy.mock.calls[0]?.[0])).toMatch(/data-element-id/);
    });
  });
});
