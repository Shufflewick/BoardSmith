// @vitest-environment jsdom
/**
 * `createFLIPSnapshot` is the one-shot form of the FLIP helper: capture where
 * things are now, let the DOM reflow, then animate each element from its old
 * position to its new one. `useFLIP.test.ts` covers the stateful composable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';

// jsdom implements neither matchMedia nor ResizeObserver; modules read them at
// import time, so they must be stubbed before the dynamic import below.
vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})));
vi.stubGlobal('ResizeObserver', vi.fn(() => ({
  observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn(),
})));

const { createFLIPSnapshot } = await import('./useFLIP.js');
const { prefersReducedMotion } = await import('./useElementAnimation.js');

const rect = (left: number, top: number): DOMRect => ({
  left, top, right: left, bottom: top, width: 0, height: 0, x: left, y: top,
  toJSON: () => ({}),
} as DOMRect);

/** Positions each tracked element by id: first the "before", then the "after". */
function stubPositions(before: Record<string, [number, number]>, after: Record<string, [number, number]>) {
  let phase: 'before' | 'after' = 'before';
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const id = this.getAttribute('data-card-id') ?? '';
    const source = phase === 'before' ? before : after;
    const [left, top] = source[id] ?? [0, 0];
    return rect(left, top);
  });
  return { moveToAfter: () => { phase = 'after'; } };
}

function container(ids: string[], attribute = 'data-card-id'): HTMLElement {
  const element = document.createElement('div');
  for (const id of ids) {
    const child = document.createElement('div');
    child.setAttribute(attribute, id);
    element.appendChild(child);
  }
  document.body.appendChild(element);
  return element;
}

let animateCalls: Array<{ id: string; keyframes: unknown; options: unknown }>;

beforeEach(() => {
  animateCalls = [];
  prefersReducedMotion.value = false;
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = function (
    this: HTMLElement, keyframes: unknown, options: unknown,
  ) {
    animateCalls.push({ id: this.getAttribute('data-card-id') ?? '', keyframes, options });
    return { finished: Promise.resolve() } as unknown as Animation;
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  document.body.innerHTML = '';
  prefersReducedMotion.value = false;
});

describe('createFLIPSnapshot', () => {
  it('returns an animate function', () => {
    const snapshot = createFLIPSnapshot(ref(container(['a'])));
    expect(snapshot.animate).toBeTypeOf('function');
  });

  it('animates an element that moved between capture and animate', async () => {
    const element = container(['a']);
    const positions = stubPositions({ a: [0, 0] }, { a: [100, 50] });
    const snapshot = createFLIPSnapshot(ref(element));
    positions.moveToAfter();
    await snapshot.animate();
    expect(animateCalls.map((call) => call.id)).toEqual(['a']);
  });

  it('animates from the old position back to zero', async () => {
    const element = container(['a']);
    const positions = stubPositions({ a: [0, 0] }, { a: [100, 50] });
    const snapshot = createFLIPSnapshot(ref(element));
    positions.moveToAfter();
    await snapshot.animate();
    expect(animateCalls[0].keyframes).toEqual([
      { transform: 'translate(-100px, -50px)' },
      { transform: 'translate(0, 0)' },
    ]);
  });

  it('skips an element that did not move', async () => {
    const element = container(['a']);
    stubPositions({ a: [10, 10] }, { a: [10, 10] });
    const snapshot = createFLIPSnapshot(ref(element));
    await snapshot.animate();
    expect(animateCalls).toEqual([]);
  });

  it('skips sub-pixel movement, which is layout noise rather than motion', async () => {
    const element = container(['a']);
    const positions = stubPositions({ a: [0, 0] }, { a: [0.4, 0.4] });
    const snapshot = createFLIPSnapshot(ref(element));
    positions.moveToAfter();
    await snapshot.animate();
    expect(animateCalls).toEqual([]);
  });

  it('animates only the elements that actually moved', async () => {
    const element = container(['a', 'b']);
    const positions = stubPositions({ a: [0, 0], b: [0, 0] }, { a: [100, 0], b: [0, 0] });
    const snapshot = createFLIPSnapshot(ref(element));
    positions.moveToAfter();
    await snapshot.animate();
    expect(animateCalls.map((call) => call.id)).toEqual(['a']);
  });

  it('uses a 300ms ease-out by default', async () => {
    const element = container(['a']);
    const positions = stubPositions({ a: [0, 0] }, { a: [100, 0] });
    const snapshot = createFLIPSnapshot(ref(element));
    positions.moveToAfter();
    await snapshot.animate();
    expect(animateCalls[0].options).toMatchObject({ duration: 300, easing: 'ease-out' });
  });

  it('honours a custom duration and easing', async () => {
    const element = container(['a']);
    const positions = stubPositions({ a: [0, 0] }, { a: [100, 0] });
    const snapshot = createFLIPSnapshot(ref(element), '[data-card-id]', {
      duration: 90, easing: 'linear',
    });
    positions.moveToAfter();
    await snapshot.animate();
    expect(animateCalls[0].options).toMatchObject({ duration: 90, easing: 'linear' });
  });

  it('fills backwards so the element does not flash at its new position', async () => {
    const element = container(['a']);
    const positions = stubPositions({ a: [0, 0] }, { a: [100, 0] });
    const snapshot = createFLIPSnapshot(ref(element));
    positions.moveToAfter();
    await snapshot.animate();
    expect(animateCalls[0].options).toMatchObject({ fill: 'backwards' });
  });

  it('honours a custom selector', async () => {
    const element = container(['a'], 'data-piece-id');
    vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValueOnce(rect(0, 0))
      .mockReturnValue(rect(100, 0));
    const snapshot = createFLIPSnapshot(ref(element), '[data-piece-id]');
    await snapshot.animate();
    expect(animateCalls).toHaveLength(1);
  });

  it('ignores elements the selector does not match', async () => {
    const element = container(['a']);
    const stranger = document.createElement('div');
    element.appendChild(stranger);
    const positions = stubPositions({ a: [0, 0] }, { a: [100, 0] });
    const snapshot = createFLIPSnapshot(ref(element));
    positions.moveToAfter();
    await snapshot.animate();
    expect(animateCalls).toHaveLength(1);
  });

  it('does nothing when the container is empty', async () => {
    const snapshot = createFLIPSnapshot(ref(container([])));
    await snapshot.animate();
    expect(animateCalls).toEqual([]);
  });

  it('does nothing when there is no container at all', async () => {
    const snapshot = createFLIPSnapshot(ref(null));
    await expect(snapshot.animate()).resolves.toBeUndefined();
    expect(animateCalls).toEqual([]);
  });

  it('respects a reduced-motion preference', async () => {
    const element = container(['a']);
    const positions = stubPositions({ a: [0, 0] }, { a: [100, 0] });
    const snapshot = createFLIPSnapshot(ref(element));
    positions.moveToAfter();
    prefersReducedMotion.value = true;
    await snapshot.animate();
    expect(animateCalls).toEqual([]);
  });

  it('ignores an element that appeared after the snapshot was taken', async () => {
    const element = container(['a']);
    const positions = stubPositions({ a: [0, 0], b: [0, 0] }, { a: [100, 0], b: [100, 0] });
    const snapshot = createFLIPSnapshot(ref(element));
    const late = document.createElement('div');
    late.setAttribute('data-card-id', 'b');
    element.appendChild(late);
    positions.moveToAfter();
    await snapshot.animate();
    expect(animateCalls.map((call) => call.id)).toEqual(['a']);
  });

  it('resolves once every animation has finished', async () => {
    const element = container(['a']);
    const positions = stubPositions({ a: [0, 0] }, { a: [100, 0] });
    let resolveAnimation: () => void = () => {};
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = () => ({
      finished: new Promise<void>((resolve) => { resolveAnimation = resolve; }),
    } as unknown as Animation);
    const snapshot = createFLIPSnapshot(ref(element));
    positions.moveToAfter();

    let settled = false;
    const pending = snapshot.animate().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    resolveAnimation();
    await pending;
    expect(settled).toBe(true);
  });
});
