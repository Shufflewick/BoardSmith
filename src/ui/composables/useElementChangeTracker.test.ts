// @vitest-environment jsdom
/**
 * Change tracking for animated custom UIs: which elements appeared or vanished
 * between two states, and where they were on screen just before the update.
 * A miss here means a card that should fly across the table simply pops.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';
import { useElementChangeTracker, useCountTracker } from './useElementChangeTracker.js';

const rect = (left: number, top: number): DOMRect => ({
  left, top, right: left, bottom: top, width: 10, height: 10, x: left, y: top,
  toJSON: () => ({}),
} as DOMRect);

function container(ids: number[], attribute = 'data-card-id'): HTMLElement {
  const element = document.createElement('div');
  for (const id of ids) {
    const child = document.createElement('div');
    child.setAttribute(attribute, String(id));
    element.appendChild(child);
  }
  document.body.appendChild(element);
  return element;
}

const tracker = (element: HTMLElement | null, overrides = {}) =>
  useElementChangeTracker<number>({
    containerRef: ref(element),
    getElementId: (el) => parseInt(el.getAttribute('data-card-id') ?? '0', 10),
    ...overrides,
  });

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const id = Number(this.getAttribute('data-card-id') ?? this.getAttribute('data-piece-id') ?? 0);
    return rect(id * 10, id * 5);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('useElementChangeTracker', () => {
  describe('starting state', () => {
    it('starts with no known ids, no positions and uninitialized', () => {
      const track = tracker(container([]));
      expect(track.prevIds.value.size).toBe(0);
      expect(track.positions.value.size).toBe(0);
      expect(track.isInitialized.value).toBe(false);
    });
  });

  describe('capturePositions', () => {
    it('records a rect per matching element, keyed by id', () => {
      const track = tracker(container([1, 2]));
      track.capturePositions();
      expect([...track.positions.value.keys()].sort()).toEqual([1, 2]);
      expect(track.positions.value.get(2)!.rect.left).toBe(20);
    });

    it('replaces the previous capture rather than accumulating', () => {
      const element = container([1, 2]);
      const track = tracker(element);
      track.capturePositions();
      element.removeChild(element.firstChild!);
      track.capturePositions();
      expect([...track.positions.value.keys()]).toEqual([2]);
    });

    it('captures extra element data alongside the rect', () => {
      const element = container([1]);
      (element.firstChild as HTMLElement).classList.add('king');
      const track = tracker(element, {
        getElementData: (el: Element) => ({ isKing: el.classList.contains('king') }),
      });
      track.capturePositions();
      expect(track.positions.value.get(1)).toMatchObject({ isKing: true });
      expect(track.positions.value.get(1)!.rect).toBeDefined();
    });

    it('honours a custom selector', () => {
      const element = container([7], 'data-piece-id');
      const track = useElementChangeTracker<number>({
        containerRef: ref(element),
        selector: '[data-piece-id]',
        getElementId: (el) => Number(el.getAttribute('data-piece-id')),
      });
      track.capturePositions();
      expect(track.positions.value.has(7)).toBe(true);
    });

    it('ignores elements the selector does not match', () => {
      const element = container([1]);
      element.appendChild(document.createElement('span'));
      const track = tracker(element);
      track.capturePositions();
      expect(track.positions.value.size).toBe(1);
    });

    it('clears the capture when there is no container', () => {
      const track = tracker(container([1]));
      track.capturePositions();
      const detached = tracker(null);
      detached.capturePositions();
      expect(detached.positions.value.size).toBe(0);
      expect(track.positions.value.size).toBe(1);
    });

    it('skips an element whose id extractor returns nothing', () => {
      const element = container([1, 2]);
      const track = useElementChangeTracker<number | null>({
        containerRef: ref(element),
        getElementId: (el) => (el.getAttribute('data-card-id') === '1' ? 1 : null),
      });
      track.capturePositions();
      expect([...track.positions.value.keys()]).toEqual([1]);
    });
  });

  describe('diffing', () => {
    const track = () => tracker(container([]));

    it('reports ids that appeared', () => {
      expect([...track().getAddedIds(new Set([1, 2]), new Set([1, 2, 3]))]).toEqual([3]);
    });

    it('reports ids that vanished', () => {
      expect([...track().getRemovedIds(new Set([1, 2, 3]), new Set([1, 3]))]).toEqual([2]);
    });

    it('reports nothing when the sets match', () => {
      const t = track();
      expect(t.getAddedIds(new Set([1, 2]), new Set([1, 2])).size).toBe(0);
      expect(t.getRemovedIds(new Set([1, 2]), new Set([1, 2])).size).toBe(0);
    });

    it('handles a wholly replaced set', () => {
      const t = track();
      expect([...t.getAddedIds(new Set([1]), new Set([2]))]).toEqual([2]);
      expect([...t.getRemovedIds(new Set([1]), new Set([2]))]).toEqual([1]);
    });

    it('treats an empty previous set as everything added', () => {
      expect(track().getAddedIds(new Set(), new Set([1, 2])).size).toBe(2);
    });

    it('treats an empty current set as everything removed', () => {
      expect(track().getRemovedIds(new Set([1, 2]), new Set()).size).toBe(2);
    });

    it('does not mutate the sets it compares', () => {
      const t = track();
      const previous = new Set([1, 2]);
      const current = new Set([2, 3]);
      t.getAddedIds(previous, current);
      t.getRemovedIds(previous, current);
      expect([...previous]).toEqual([1, 2]);
      expect([...current]).toEqual([2, 3]);
    });
  });

  describe('id bookkeeping', () => {
    it('updateIds replaces the remembered set', () => {
      const track = tracker(container([]));
      track.updateIds(new Set([1, 2]));
      expect([...track.prevIds.value]).toEqual([1, 2]);
      track.updateIds(new Set([3]));
      expect([...track.prevIds.value]).toEqual([3]);
    });

    it('initialize seeds the first state and marks tracking live', () => {
      const track = tracker(container([]));
      track.initialize(new Set([1, 2]));
      expect(track.isInitialized.value).toBe(true);
      expect([...track.prevIds.value]).toEqual([1, 2]);
    });

    it('initialize is a no-op once tracking has started, so a reload cannot rewrite history', () => {
      const track = tracker(container([]));
      track.initialize(new Set([1]));
      track.initialize(new Set([9]));
      expect([...track.prevIds.value]).toEqual([1]);
    });

    it('reset clears ids, positions and the initialized flag', () => {
      const track = tracker(container([1]));
      track.capturePositions();
      track.initialize(new Set([1]));
      track.reset();
      expect(track.prevIds.value.size).toBe(0);
      expect(track.positions.value.size).toBe(0);
      expect(track.isInitialized.value).toBe(false);
    });

    it('allows initialize again after a reset', () => {
      const track = tracker(container([]));
      track.initialize(new Set([1]));
      track.reset();
      track.initialize(new Set([5]));
      expect([...track.prevIds.value]).toEqual([5]);
    });
  });

  describe('a deal-then-play cycle', () => {
    it('detects the dealt cards and remembers where they were', () => {
      const element = container([1, 2]);
      const track = tracker(element);
      track.initialize(new Set([1, 2]));
      track.capturePositions();

      const current = new Set([1, 2, 3]);
      const added = track.getAddedIds(track.prevIds.value, current);
      expect([...added]).toEqual([3]);

      track.updateIds(current);
      const afterPlay = new Set([1, 3]);
      expect([...track.getRemovedIds(track.prevIds.value, afterPlay)]).toEqual([2]);
      expect(track.positions.value.get(2)!.rect.left).toBe(20);
    });
  });
});

describe('useCountTracker', () => {
  it('starts at zero and uninitialized', () => {
    const count = useCountTracker();
    expect(count.prevCount.value).toBe(0);
    expect(count.isInitialized.value).toBe(false);
  });

  it('reports the delta on each update', () => {
    const count = useCountTracker();
    expect(count.updateCount(5)).toBe(5);
    expect(count.updateCount(3)).toBe(-2);
    expect(count.updateCount(3)).toBe(0);
  });

  it('remembers the latest count', () => {
    const count = useCountTracker();
    count.updateCount(7);
    expect(count.prevCount.value).toBe(7);
  });

  it('initialize seeds the baseline without reporting a delta', () => {
    const count = useCountTracker();
    count.initialize(5);
    expect(count.prevCount.value).toBe(5);
    expect(count.updateCount(6)).toBe(1);
  });

  it('initialize is a no-op once initialized', () => {
    const count = useCountTracker();
    count.initialize(5);
    count.initialize(50);
    expect(count.prevCount.value).toBe(5);
  });

  it('reset returns to zero and uninitialized', () => {
    const count = useCountTracker();
    count.initialize(5);
    count.updateCount(9);
    count.reset();
    expect(count.prevCount.value).toBe(0);
    expect(count.isInitialized.value).toBe(false);
  });

  it('allows initialize again after a reset', () => {
    const count = useCountTracker();
    count.initialize(5);
    count.reset();
    count.initialize(2);
    expect(count.prevCount.value).toBe(2);
  });

  it('tracks an opponent hand shrinking and growing', () => {
    const count = useCountTracker();
    count.initialize(7);
    expect(count.updateCount(6)).toBe(-1);
    expect(count.updateCount(8)).toBe(2);
    expect(count.prevCount.value).toBe(8);
  });

  it('gives each tracker its own state', () => {
    const first = useCountTracker();
    const second = useCountTracker();
    first.updateCount(10);
    expect(second.prevCount.value).toBe(0);
  });
});
