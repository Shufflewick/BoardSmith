/**
 * useElementChangeTracker - Track changes to game elements over time
 *
 * Provides utilities for tracking when elements are added/removed from the game,
 * capturing DOM positions before changes, and detecting deltas between states.
 *
 * This is useful for:
 * - Flying cards from source to destination when cards are dealt
 * - Detecting when cards leave a hand (e.g., for book formation animations)
 * - Animating captured pieces in checkers/chess
 * - Tracking counts (e.g., opponent card count, deck count)
 *
 * ## Basic Usage (Cards)
 *
 * ```typescript
 * import { useElementChangeTracker } from '@boardsmith/ui';
 *
 * const handRef = ref<HTMLElement | null>(null);
 *
 * const {
 *   prevIds,
 *   positions,
 *   capturePositions,
 *   getAddedIds,
 *   getRemovedIds,
 *   updateIds,
 * } = useElementChangeTracker({
 *   containerRef: handRef,
 *   selector: '[data-card-id]',
 *   getElementId: (el) => parseInt(el.getAttribute('data-card-id') || '0', 10),
 * });
 * ```
 *
 * ## With Element Metadata (Checkers Example)
 *
 * Track piece ownership so you can animate captured pieces correctly:
 *
 * ```typescript
 * const { positions, capturePositions } = useElementChangeTracker({
 *   containerRef: boardRef,
 *   selector: '[data-piece-id]',
 *   getElementId: (el) => parseInt(el.getAttribute('data-piece-id') || '0', 10),
 *   getElementData: (el) => ({
 *     // Track which player owns this piece (dark = 0, light = 1)
 *     playerPosition: el.classList.contains('dark') ? 0 : 1,
 *     isKing: el.classList.contains('king'),
 *   }),
 * });
 *
 * // Later, when detecting captures:
 * const pieceData = positions.value.get(capturedId);
 * // pieceData.rect - position for animation
 * // pieceData.playerPosition - owner for correct styling
 * ```
 */

import { ref, type Ref } from 'vue';

export interface ElementPositionData {
  /** Bounding rectangle of the element */
  rect: DOMRect;
  /** Any additional data captured from the element */
  [key: string]: any;
}


export interface ElementChangeTrackerOptions<T = number> {
  /** Ref to the container element to query for elements */
  containerRef: Ref<HTMLElement | null>;
  /** CSS selector to find elements (default: '[data-card-id]') */
  selector?: string;
  /** Function to extract ID from an element */
  getElementId: (el: Element) => T;
  /** Optional function to extract additional data from an element (e.g., ownership, type) */
  getElementData?: (el: Element) => Omit<ElementPositionData, 'rect'>;
}

export interface ElementChangeTrackerReturn<T = number> {
  /** Previous set of element IDs (before state change) */
  prevIds: Ref<Set<T>>;
  /** Map of captured positions keyed by element ID */
  positions: Ref<Map<T, ElementPositionData>>;
  /** Capture current positions from DOM */
  capturePositions: () => void;
  /** Get IDs that were added (in current but not in previous) */
  getAddedIds: (prevSnapshot: Set<T>, current: Set<T>) => Set<T>;
  /** Get IDs that were removed (in previous but not in current) */
  getRemovedIds: (prevSnapshot: Set<T>, current: Set<T>) => Set<T>;
  /** Update the prevIds ref with new values */
  updateIds: (ids: Set<T>) => void;
  /** Clear all tracking state */
  reset: () => void;
  /** Check if tracking has been initialized */
  isInitialized: Ref<boolean>;
  /** Mark tracking as initialized */
  initialize: (initialIds: Set<T>) => void;
}

/**
 * Create a tracker for element changes.
 *
 * @param options - Configuration options
 * @returns Tracking utilities
 */
export function useElementChangeTracker<T = number>(
  options: ElementChangeTrackerOptions<T>
): ElementChangeTrackerReturn<T> {
  const {
    containerRef,
    selector = '[data-card-id]',
    getElementId,
    getElementData,
  } = options;

  const prevIds = ref<Set<T>>(new Set()) as Ref<Set<T>>;
  const positions = ref<Map<T, ElementPositionData>>(new Map()) as Ref<Map<T, ElementPositionData>>;
  const isInitialized = ref(false);

  /**
   * Capture current positions of all elements from the DOM.
   * Call this BEFORE Vue updates the DOM (in a sync watcher).
   */
  function capturePositions(): void {
    positions.value.clear();

    if (!containerRef.value) return;

    const elements = containerRef.value.querySelectorAll(selector);
    elements.forEach((el) => {
      const id = getElementId(el);
      if (id !== null && id !== undefined) {
        const rect = el.getBoundingClientRect();
        const extraData = getElementData ? getElementData(el) : {};
        positions.value.set(id, { rect, ...extraData });
      }
    });
  }

  /**
   * Get IDs that are in the current set but weren't in the previous set.
   */
  function getAddedIds(prevSnapshot: Set<T>, current: Set<T>): Set<T> {
    const added = new Set<T>();
    for (const id of current) {
      if (!prevSnapshot.has(id)) {
        added.add(id);
      }
    }
    return added;
  }

  /**
   * Get IDs that were in the previous set but aren't in the current set.
   */
  function getRemovedIds(prevSnapshot: Set<T>, current: Set<T>): Set<T> {
    const removed = new Set<T>();
    for (const id of prevSnapshot) {
      if (!current.has(id)) {
        removed.add(id);
      }
    }
    return removed;
  }

  /**
   * Update the prevIds ref with new values.
   */
  function updateIds(ids: Set<T>): void {
    prevIds.value = ids;
  }

  /**
   * Clear all tracking state.
   */
  function reset(): void {
    prevIds.value = new Set();
    positions.value.clear();
    isInitialized.value = false;
  }

  /**
   * Initialize tracking with initial IDs (call once on first load).
   */
  function initialize(initialIds: Set<T>): void {
    if (isInitialized.value) return;
    prevIds.value = initialIds;
    isInitialized.value = true;
  }

  return {
    prevIds,
    positions,
    capturePositions,
    getAddedIds,
    getRemovedIds,
    updateIds,
    reset,
    isInitialized,
    initialize,
  };
}

/**
 * Simple counter tracker for tracking counts (e.g., opponent card count, deck count).
 * Useful when you don't have access to individual element IDs.
 */
export interface CountTrackerReturn {
  /** Previous count value */
  prevCount: Ref<number>;
  /** Update the count and return the delta (positive = increase, negative = decrease) */
  updateCount: (newCount: number) => number;
  /** Reset the counter */
  reset: () => void;
  /** Initialize with a value */
  initialize: (count: number) => void;
  /** Check if initialized */
  isInitialized: Ref<boolean>;
}

/**
 * Create a simple counter tracker.
 */
export function useCountTracker(): CountTrackerReturn {
  const prevCount = ref(0);
  const isInitialized = ref(false);

  function updateCount(newCount: number): number {
    const delta = newCount - prevCount.value;
    prevCount.value = newCount;
    return delta;
  }

  function reset(): void {
    prevCount.value = 0;
    isInitialized.value = false;
  }

  function initialize(count: number): void {
    if (isInitialized.value) return;
    prevCount.value = count;
    isInitialized.value = true;
  }

  return {
    prevCount,
    updateCount,
    reset,
    initialize,
    isInitialized,
  };
}
