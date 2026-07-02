// @vitest-environment jsdom
/**
 * Direct unit tests for useFLIP.
 *
 * Covers the three ANIM-01/02/03 paths added in 128-03:
 *  1. Test mode: animate() records an assertable {kind:'flip'} trace by
 *     element IDENTITY (never pixels — jsdom rects are unreliable) instead of
 *     running WAAPI.
 *  2. Real path: with `Element.prototype.getBoundingClientRect` stubbed to
 *     distinct before/after rects and `HTMLElement.prototype.animate`
 *     stubbed (jsdom implements neither), animate() invokes the stubbed
 *     `animate()` for a moved element.
 *  3. Fail-loud: an element useFLIP was asked to track but that carries none
 *     of the recognized anchor attributes throws in dev / console.errors in
 *     prod, on first resolution only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';

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
  };
});

// Dynamic (not static) import: useFLIP.js transitively imports
// useElementAnimation.js, which reads window.matchMedia() at module load
// time. A static `import` here would be hoisted ahead of the vi.stubGlobal()
// calls above (unlike useDragDrop.ts's siblings, which never touch
// matchMedia and so tolerate either ordering) — dynamic import guarantees
// the stubs are installed first.
const { useFLIP } = await import('./useFLIP.js');
const { enableAnimationTestMode, disableAnimationTestMode, getAnimationTrace, clearAnimationTrace } =
  await import('./useAnimationTestMode.js');

function makeContainer(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
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

describe('useFLIP', () => {
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
    delete (HTMLElement.prototype as any).animate;
    document.body.innerHTML = '';
  });

  describe('test mode', () => {
    it('records a flip trace keyed by element identity instead of animating', async () => {
      const container = makeContainer();
      const child = document.createElement('div');
      child.setAttribute('data-element-id', 'card-1');
      container.appendChild(child);

      const containerRef = ref<HTMLElement | null>(container);
      const { capture, animate } = useFLIP({ containerRef });

      capture();
      enableAnimationTestMode();
      await animate();

      const trace = getAnimationTrace();
      expect(trace).toHaveLength(1);
      expect(trace[0]).toMatchObject({ kind: 'flip', element: 'card-1' });
    });

    it('does not call el.animate() while in test mode', async () => {
      const container = makeContainer();
      const child = document.createElement('div');
      child.setAttribute('data-element-id', 'card-2');
      container.appendChild(child);

      const animateSpy = vi.fn().mockReturnValue({ finished: Promise.resolve(), cancel: vi.fn() });
      (HTMLElement.prototype as any).animate = animateSpy;

      const containerRef = ref<HTMLElement | null>(container);
      const { capture, animate } = useFLIP({ containerRef });

      capture();
      enableAnimationTestMode();
      await animate();

      expect(animateSpy).not.toHaveBeenCalled();
    });
  });

  describe('real path (mocked WAAPI + distinct rects)', () => {
    it('invokes the stubbed animate() for a moved element', async () => {
      const container = makeContainer();
      const child = document.createElement('div');
      child.setAttribute('data-element-id', 'card-3');
      container.appendChild(child);

      const beforeRect = makeRect({ left: 0, top: 0 });
      const afterRect = makeRect({ left: 100, top: 100 });
      let call = 0;
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => {
        const rect = call === 0 ? beforeRect : afterRect;
        call++;
        return rect;
      });

      const animateSpy = vi.fn().mockReturnValue({ finished: Promise.resolve(), cancel: vi.fn() });
      (HTMLElement.prototype as any).animate = animateSpy;

      const containerRef = ref<HTMLElement | null>(container);
      const { capture, animate } = useFLIP({ containerRef, threshold: 1 });

      capture(); // consumes beforeRect
      await animate(); // consumes afterRect, computes a real delta

      expect(animateSpy).toHaveBeenCalledTimes(1);
      // Not in test mode: no trace should have been recorded.
      expect(getAnimationTrace()).toHaveLength(0);
    });
  });

  describe('fail-loud missing anchor', () => {
    it('throws in dev mode when a tracked element has no anchor attribute', () => {
      devModeState.override = true;

      const container = makeContainer();
      const child = document.createElement('div');
      // Matches the custom selector below but deliberately carries none of
      // data-card-id / data-piece-id / data-element-id / id.
      child.className = 'flip-target';
      container.appendChild(child);

      const containerRef = ref<HTMLElement | null>(container);
      const { capture } = useFLIP({ containerRef, selector: '.flip-target' });

      expect(() => capture()).toThrow(/data-card-id|data-piece-id|data-element-id|anchor/);
    });

    it('console.errors and skips (does not throw) in prod mode', () => {
      devModeState.override = false;
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const container = makeContainer();
      const child = document.createElement('div');
      child.className = 'flip-target';
      container.appendChild(child);

      const containerRef = ref<HTMLElement | null>(container);
      const { capture } = useFLIP({ containerRef, selector: '.flip-target' });

      expect(() => capture()).not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(String(consoleErrorSpy.mock.calls[0]?.[0])).toMatch(/anchor/);
    });
  });
});
