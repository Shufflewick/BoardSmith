/**
 * useFLIPAnimation - FLIP animation pattern for smooth element transitions
 *
 * FLIP stands for First-Last-Invert-Play:
 * 1. First: Capture the initial position of elements
 * 2. Last: Let the DOM update to the final position
 * 3. Invert: Calculate the delta and apply a transform to appear in original position
 * 4. Play: Animate from inverted position to final position
 *
 * This creates smooth animations when elements move around in the DOM,
 * such as cards being reordered in a hand or moving between zones.
 *
 * ## Usage
 *
 * ```typescript
 * import { useFLIPAnimation } from '@boardsmith/ui';
 *
 * const boardRef = ref<HTMLElement | null>(null);
 * const { capturePositions, animateToNewPositions } = useFLIPAnimation({
 *   containerRef: boardRef,
 *   selector: '[data-card-id]',
 *   duration: 300,
 *   easing: 'ease-out',
 * });
 *
 * // In a watcher
 * watch(
 *   () => props.gameView,
 *   async (newView, oldView) => {
 *     if (!oldView) return;
 *
 *     // First: Capture positions before DOM update
 *     capturePositions();
 *
 *     // Wait for DOM to update (Last position is now set)
 *     await nextTick();
 *
 *     // Invert + Play: Animate from old to new positions
 *     animateToNewPositions();
 *   },
 *   { deep: false }
 * );
 * ```
 */

import { ref, type Ref } from 'vue';
import { prefersReducedMotion } from './useElementAnimation.js';

export interface FLIPAnimationOptions {
  /** Ref to the container element */
  containerRef: Ref<HTMLElement | null>;
  /** CSS selector to find animated elements (default: '[data-card-id]') */
  selector?: string;
  /** Animation duration in ms (default: 300) */
  duration?: number;
  /** CSS easing function (default: 'ease-out') */
  easing?: string;
  /** Minimum distance (px) to trigger animation (default: 1) */
  threshold?: number;
  /** Callback when animation starts */
  onAnimationStart?: () => void;
  /** Callback when all animations complete */
  onAnimationEnd?: () => void;
}

export interface FLIPAnimationReturn {
  /** Capture current positions (call before DOM update) */
  capturePositions: () => void;
  /** Animate elements from captured positions to current positions */
  animateToNewPositions: () => Promise<void>;
  /** Check if any animations are currently running */
  isAnimating: Ref<boolean>;
  /** Clear captured positions */
  clear: () => void;
}

/**
 * Create a FLIP animation handler.
 *
 * @param options - Configuration options
 * @returns FLIP animation utilities
 */
export function useFLIPAnimation(options: FLIPAnimationOptions): FLIPAnimationReturn {
  const {
    containerRef,
    selector = '[data-card-id]',
    duration = 300,
    easing = 'ease-out',
    threshold = 1,
    onAnimationStart,
    onAnimationEnd,
  } = options;

  const positions = new Map<string, DOMRect>();
  const isAnimating = ref(false);

  /**
   * Capture current positions of all matching elements.
   * Call this BEFORE the DOM update happens.
   */
  function capturePositions(): void {
    positions.clear();
    if (!containerRef?.value) {
      return;
    }

    const elements = containerRef.value.querySelectorAll(selector);
    elements.forEach((el) => {
      const id = getElementId(el);
      if (id) {
        positions.set(id, el.getBoundingClientRect());
      }
    });
  }

  /**
   * Get a unique identifier for an element.
   * Tries data-card-id, data-element-id, then id.
   */
  function getElementId(el: Element): string | null {
    return (
      el.getAttribute('data-card-id') ||
      el.getAttribute('data-element-id') ||
      el.getAttribute('id') ||
      null
    );
  }

  /**
   * Animate elements from their captured positions to their current positions.
   * Call this AFTER the DOM has updated (after nextTick).
   */
  async function animateToNewPositions(): Promise<void> {
    // Skip if reduced motion is preferred
    if (prefersReducedMotion.value) {
      positions.clear();
      return;
    }

    if (!containerRef?.value || positions.size === 0) {
      return;
    }

    const animations: Animation[] = [];
    const elements = containerRef.value.querySelectorAll(selector);

    elements.forEach((el) => {
      const id = getElementId(el);
      if (!id) return;

      const oldRect = positions.get(id);
      if (!oldRect) return;

      const newRect = el.getBoundingClientRect();
      const deltaX = oldRect.left - newRect.left;
      const deltaY = oldRect.top - newRect.top;

      // Only animate if movement exceeds threshold
      if (Math.abs(deltaX) < threshold && Math.abs(deltaY) < threshold) {
        return;
      }

      // Create FLIP animation
      const animation = (el as HTMLElement).animate(
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: 'translate(0, 0)' },
        ],
        {
          duration,
          easing,
          fill: 'backwards',
        }
      );

      animations.push(animation);
    });

    if (animations.length > 0) {
      isAnimating.value = true;
      onAnimationStart?.();

      // Wait for all animations to complete
      await Promise.all(animations.map((a) => a.finished));

      isAnimating.value = false;
      onAnimationEnd?.();
    }

    // Clear captured positions
    positions.clear();
  }

  /**
   * Clear captured positions without animating.
   */
  function clear(): void {
    positions.clear();
  }

  return {
    capturePositions,
    animateToNewPositions,
    isAnimating,
    clear,
  };
}

/**
 * Simplified FLIP animation for a single update cycle.
 * Use this for one-off animations without tracking state.
 *
 * @param containerRef - Ref to container element
 * @param selector - CSS selector for elements to animate
 * @param options - Animation options
 * @returns A function that captures positions and returns an animate function
 */
export function createFLIPSnapshot(
  containerRef: Ref<HTMLElement | null>,
  selector: string = '[data-card-id]',
  options: { duration?: number; easing?: string } = {}
): { animate: () => Promise<void> } {
  const { duration = 300, easing = 'ease-out' } = options;
  const positions = new Map<string, DOMRect>();

  // Capture positions immediately
  if (containerRef?.value) {
    const elements = containerRef.value.querySelectorAll(selector);
    elements.forEach((el) => {
      const id =
        el.getAttribute('data-card-id') ||
        el.getAttribute('data-element-id') ||
        el.getAttribute('id');
      if (id) {
        positions.set(id, el.getBoundingClientRect());
      }
    });
  }

  return {
    async animate(): Promise<void> {
      if (prefersReducedMotion.value || !containerRef?.value || positions.size === 0) {
        return;
      }

      const animations: Animation[] = [];
      const elements = containerRef.value.querySelectorAll(selector);

      elements.forEach((el) => {
        const id =
          el.getAttribute('data-card-id') ||
          el.getAttribute('data-element-id') ||
          el.getAttribute('id');
        if (!id) return;

        const oldRect = positions.get(id);
        if (!oldRect) return;

        const newRect = el.getBoundingClientRect();
        const deltaX = oldRect.left - newRect.left;
        const deltaY = oldRect.top - newRect.top;

        if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
          return;
        }

        animations.push(
          (el as HTMLElement).animate(
            [
              { transform: `translate(${deltaX}px, ${deltaY}px)` },
              { transform: 'translate(0, 0)' },
            ],
            { duration, easing, fill: 'backwards' }
          )
        );
      });

      await Promise.all(animations.map((a) => a.finished));
    },
  };
}
