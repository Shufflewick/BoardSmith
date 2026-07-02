// @vitest-environment jsdom
/**
 * Direct unit tests for useFlyingElements.
 *
 * Covers the ANIM-01/02/03 paths added in 128-05:
 *  1. Test mode - autoWatch: moving an element between two named containers
 *     records the CONTEXT flagship trace {kind:'fly', from:<source>,
 *     to:<dest>} keyed by the engine element id, resolved instantly without
 *     running the RAF chain.
 *  2. Test mode - manual fly(): records a {kind:'fly', element: id} trace and
 *     resolves its promise immediately.
 *  3. Real path (mocked RAF): a fly() call with a stubbed requestAnimationFrame
 *     drives the animation to completion and resolves the fly promise.
 *  4. Fail-loud: a fly() whose start target resolves to null throws in dev /
 *     console.errors in prod, on first resolution only.
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

// Dynamic (not static) import: useFlyingElements.js transitively imports
// useElementAnimation.js, which reads window.matchMedia() at module load
// time. A static `import` here would be hoisted ahead of the vi.stubGlobal()
// calls above — dynamic import guarantees the stubs are installed first
// (matches the 128-03 useFLIP.test.ts precedent).
const { useFlyingElements } = await import('./useFlyingElements.js');
const { enableAnimationTestMode, disableAnimationTestMode, getAnimationTrace, clearAnimationTrace } =
  await import('./useAnimationTestMode.js');
type AutoWatchGameElement = import('./useFlyingElements.js').AutoWatchGameElement;

function makeContainer(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

/**
 * Poll until a predicate is true (or timeout). The autoWatch watcher's async
 * handler and the fly()/flyMultiple() promise chain it kicks off resolve
 * across several microtask hops — a single nextTick() is not reliably enough.
 */
async function waitFor(predicate: () => boolean, timeout = 500): Promise<void> {
  const start = Date.now();
  while (!predicate() && Date.now() - start < timeout) {
    await nextTick();
    await new Promise((r) => setTimeout(r, 5));
  }
}

function makeRect(overrides: Partial<DOMRect> = {}): DOMRect {
  const { left = 0, top = 0, width = 0, height = 0 } = overrides;
  // A real DOMRect instance — getRect()'s `target instanceof DOMRect` branch
  // requires this (a plain object cast to DOMRect fails that check and falls
  // through to calling .getBoundingClientRect(), which doesn't exist on it).
  return new DOMRect(left, top, width, height);
}

describe('useFlyingElements', () => {
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
    // Re-stub the globals every module needs at import time, since
    // vi.unstubAllGlobals() above would otherwise remove them for the next test.
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.stubGlobal(
      'ResizeObserver',
      vi.fn(() => ({
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      })),
    );
    document.body.innerHTML = '';
  });

  describe('test mode - autoWatch (flagship assertion)', () => {
    it('records {kind:"fly", from:"opponentHand", to:"myHand"} when an element moves containers', async () => {
      const opponentHandEl = makeContainer();
      const myHandEl = makeContainer();
      // Distinct, non-zero rects so a real path (if accidentally taken) would
      // be observable; test-mode assertion itself is by identity, not pixels.
      vi.spyOn(opponentHandEl, 'getBoundingClientRect').mockReturnValue(
        makeRect({ left: 0, top: 0, width: 60, height: 84 })
      );
      vi.spyOn(myHandEl, 'getBoundingClientRect').mockReturnValue(
        makeRect({ left: 300, top: 0, width: 60, height: 84 })
      );

      const opponentHandRef = ref<HTMLElement | null>(opponentHandEl);
      const myHandRef = ref<HTMLElement | null>(myHandEl);

      const card: AutoWatchGameElement = { id: 42, name: 'card' };
      const opponentHandGameEl: AutoWatchGameElement = { id: 1, children: [card] };
      const myHandGameEl: AutoWatchGameElement = { id: 2, children: [] };

      // Start with no view: the composable's watcher only runs (and only
      // initializes its tracking state) on a genuine CHANGE of gameView, not
      // on setup — a ref that already holds its "initial" value at
      // useFlyingElements() call time never fires the watcher at all.
      const gameViewRef = ref<AutoWatchGameElement | null>(null);

      useFlyingElements({
        autoWatch: {
          gameView: () => gameViewRef.value,
          containers: [
            { ref: opponentHandRef, name: 'opponentHand', element: () => opponentHandGameEl },
            { ref: myHandRef, name: 'myHand', element: () => myHandGameEl },
          ],
          getElementData: () => ({}),
        },
      });

      // First real gameView: initializes tracking (card starts in opponentHand).
      gameViewRef.value = {
        id: 0,
        children: [opponentHandGameEl, myHandGameEl],
      };
      await nextTick();
      expect(getAnimationTrace()).toHaveLength(0);

      // Move the card from opponentHand to myHand.
      opponentHandGameEl.children = [];
      myHandGameEl.children = [card];
      gameViewRef.value = {
        id: 0,
        children: [{ ...opponentHandGameEl }, { ...myHandGameEl }],
      };

      enableAnimationTestMode();
      await nextTick();
      await waitFor(() => getAnimationTrace().length > 0);

      expect(getAnimationTrace()).toContainEqual(
        expect.objectContaining({ kind: 'fly', element: '42', from: 'opponentHand', to: 'myHand' })
      );
    });
  });

  describe('test mode - manual fly()', () => {
    it('records a {kind:"fly", element:id} trace and resolves immediately', async () => {
      const startEl = makeContainer();
      const endEl = makeContainer();

      const { fly } = useFlyingElements();

      enableAnimationTestMode();
      await fly({
        id: 'manual-fly-1',
        startRect: startEl,
        endRect: endEl,
        elementData: { faceUp: true },
      });

      const trace = getAnimationTrace();
      expect(trace).toHaveLength(1);
      expect(trace[0]).toMatchObject({ kind: 'fly', element: 'manual-fly-1' });
    });

    it('derives from/to from HTMLElement anchor attributes when no override is given', async () => {
      const startEl = makeContainer();
      startEl.setAttribute('data-element-id', 'deck');
      const endEl = makeContainer();
      endEl.setAttribute('data-element-id', 'hand');

      const { fly } = useFlyingElements();

      enableAnimationTestMode();
      await fly({
        id: 'manual-fly-2',
        startRect: startEl,
        endRect: endEl,
        elementData: { faceUp: true },
      });

      expect(getAnimationTrace()).toContainEqual(
        expect.objectContaining({ kind: 'fly', from: 'deck', to: 'hand' })
      );
    });

    it('leaves from/to undefined for a raw DOMRect target (no container/element identity)', async () => {
      const { fly } = useFlyingElements();

      enableAnimationTestMode();
      await fly({
        id: 'manual-fly-3',
        startRect: makeRect({ left: 0, top: 0, width: 10, height: 10 }),
        endRect: makeRect({ left: 50, top: 50, width: 10, height: 10 }),
        elementData: { faceUp: true },
      });

      expect(getAnimationTrace()).toContainEqual(
        expect.objectContaining({ kind: 'fly', from: undefined, to: undefined })
      );
    });

    it('skips the real stagger delay between elements in test mode (WR-02)', async () => {
      const { flyMultiple } = useFlyingElements();

      enableAnimationTestMode();
      const start = Date.now();
      await flyMultiple(
        [
          { id: 'stagger-1', startRect: makeRect(), endRect: makeRect(), elementData: {} },
          { id: 'stagger-2', startRect: makeRect(), endRect: makeRect(), elementData: {} },
          { id: 'stagger-3', startRect: makeRect(), endRect: makeRect(), elementData: {} },
        ],
        1000, // large stagger: if not skipped, this alone would exceed the test timeout
      );
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(500);
      expect(getAnimationTrace()).toHaveLength(3);
    });
  });

  describe('flyOnAppear', () => {
    it('records a {kind:"fly"} trace in test mode even when reduced motion is preferred (CR-01)', async () => {
      const sourceEl = makeContainer();
      const targetEl = makeContainer();
      vi.spyOn(sourceEl, 'getBoundingClientRect').mockReturnValue(
        makeRect({ left: 0, top: 0, width: 60, height: 84 })
      );
      vi.spyOn(targetEl, 'getBoundingClientRect').mockReturnValue(
        makeRect({ left: 200, top: 0, width: 60, height: 84 })
      );

      // Reduced motion preferred: without CR-01's fix, flyOnAppear's own
      // early-return would bypass fly()/flyCardInternal entirely and no
      // trace would ever be recorded, regardless of test mode.
      const { prefersReducedMotion } = await import('./useElementAnimation.js');
      prefersReducedMotion.value = true;

      const { flyOnAppear } = useFlyingElements();
      const elementRef = ref<{ rank: string } | null>(null);

      flyOnAppear({
        element: elementRef,
        sourceRef: ref(sourceEl),
        targetRef: ref(targetEl),
        getElementData: (el) => ({ rank: el.rank }),
      });

      enableAnimationTestMode();
      elementRef.value = { rank: 'A' };
      await waitFor(() => getAnimationTrace().length > 0);

      expect(getAnimationTrace()).toContainEqual(
        expect.objectContaining({ kind: 'fly' })
      );

      prefersReducedMotion.value = false;
    });

    it('skips the real animation (does not throw, resolves) when reduced motion is preferred and test mode is off', async () => {
      const sourceEl = makeContainer();
      const targetEl = makeContainer();
      vi.spyOn(sourceEl, 'getBoundingClientRect').mockReturnValue(
        makeRect({ left: 0, top: 0, width: 60, height: 84 })
      );
      vi.spyOn(targetEl, 'getBoundingClientRect').mockReturnValue(
        makeRect({ left: 200, top: 0, width: 60, height: 84 })
      );

      const { prefersReducedMotion } = await import('./useElementAnimation.js');
      prefersReducedMotion.value = true;

      const { flyOnAppear, isAnimating } = useFlyingElements();
      const elementRef = ref<{ rank: string } | null>(null);

      flyOnAppear({
        element: elementRef,
        sourceRef: ref(sourceEl),
        targetRef: ref(targetEl),
        getElementData: (el) => ({ rank: el.rank }),
      });

      elementRef.value = { rank: 'A' };
      await nextTick();
      await new Promise((r) => setTimeout(r, 10));

      // flyCardInternal's internal prefersReducedMotion check (after the
      // test-mode check) still short-circuits the real RAF-driven path.
      expect(isAnimating.value).toBe(false);
      expect(getAnimationTrace()).toHaveLength(0);

      prefersReducedMotion.value = false;
    });
  });

  describe('real path (mocked RAF)', () => {
    it('drives the RAF chain to completion and resolves the fly promise', async () => {
      const rafQueue: FrameRequestCallback[] = [];
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        rafQueue.push(cb);
        return rafQueue.length;
      });
      vi.stubGlobal('cancelAnimationFrame', vi.fn());

      const startEl = makeContainer();
      const endEl = makeContainer();
      vi.spyOn(startEl, 'getBoundingClientRect').mockReturnValue(
        makeRect({ left: 0, top: 0, width: 60, height: 84 })
      );
      vi.spyOn(endEl, 'getBoundingClientRect').mockReturnValue(
        makeRect({ left: 200, top: 200, width: 60, height: 84 })
      );

      const { fly, flyingElements } = useFlyingElements({ duration: 50, holdDuration: 0 });

      const flyPromise = fly({
        id: 'real-fly-1',
        startRect: startEl,
        endRect: endEl,
        elementData: { faceUp: true },
      });

      // requestAnimationFrame(animate) is queued synchronously inside the
      // Promise executor before flyCardInternal's returned promise settles.
      expect(flyingElements.value).toHaveLength(1);
      expect(rafQueue.length).toBeGreaterThan(0);

      const cb = rafQueue.shift()!;
      // Drive the animation far past its duration so rawProgress clamps to 1
      // and (with holdDuration: 0) the promise resolves on this single tick.
      cb(performance.now() + 10_000);

      await flyPromise;
      expect(flyingElements.value).toHaveLength(0);
      // Not in test mode: no trace should have been recorded.
      expect(getAnimationTrace()).toHaveLength(0);
    });
  });

  describe('fail-loud missing start/end target', () => {
    it('throws in dev mode when the start target resolves to null', async () => {
      devModeState.override = true;

      const { fly } = useFlyingElements();
      const endEl = makeContainer();

      await expect(
        fly({
          id: 'throw-fly-1',
          startRect: () => null,
          endRect: endEl,
          elementData: { faceUp: true },
        })
      ).rejects.toThrow(/start/i);
    });

    it('throws in dev mode when the end target resolves to null', async () => {
      devModeState.override = true;

      const startEl = makeContainer();
      const { fly } = useFlyingElements();

      await expect(
        fly({
          id: 'throw-fly-2',
          startRect: startEl,
          endRect: () => null,
          elementData: { faceUp: true },
        })
      ).rejects.toThrow(/end/i);
    });

    it('console.errors and skips (does not throw) in prod mode', async () => {
      devModeState.override = false;
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { fly, flyingElements } = useFlyingElements();
      const endEl = makeContainer();

      await expect(
        fly({
          id: 'throw-fly-3',
          startRect: () => null,
          endRect: endEl,
          elementData: { faceUp: true },
        })
      ).resolves.toBeUndefined();

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(String(consoleErrorSpy.mock.calls[0]?.[0])).toMatch(/start/i);
      expect(flyingElements.value).toHaveLength(0);
    });
  });
});
