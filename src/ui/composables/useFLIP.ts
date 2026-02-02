/**
 * useFLIP - Unified FLIP animation composable
 *
 * FLIP stands for First-Last-Invert-Play:
 * 1. First: Capture the initial position of elements
 * 2. Last: Let the DOM update to the final position
 * 3. Invert: Calculate the delta and apply a transform to appear in original position
 * 4. Play: Animate from inverted position to final position
 *
 * Use this for animating elements from their old positions to new positions
 * when the DOM layout changes.
 *
 * @example Manual mode with single container
 * ```typescript
 * import { useFLIP } from 'boardsmith/ui';
 *
 * const containerRef = ref<HTMLElement | null>(null);
 * const { capture, animate, isAnimating } = useFLIP({
 *   containerRef,
 *   selector: '[data-element-id]',
 *   duration: 300,
 * });
 *
 * // Before state change
 * capture();
 *
 * // After state change (in nextTick or watch callback)
 * await animate();
 * ```
 *
 * @example Multi-container support
 * ```typescript
 * const boardRef = ref<HTMLElement | null>(null);
 * const handRef = ref<HTMLElement | null>(null);
 *
 * const { capture, animate, isAnimating } = useFLIP({
 *   containers: [
 *     { ref: boardRef, selector: '[data-piece-id]' },
 *     { ref: handRef, selector: '[data-card-id]' },
 *   ],
 *   duration: 300,
 * });
 * ```
 *
 * @example Auto-mode (watches game state automatically)
 * ```typescript
 * const { isAnimating } = useFLIP({
 *   containerRef,
 *   selector: '[data-element-id]',
 *   auto: true,
 *   gameView: () => gameState.value.view,
 * });
 * ```
 */

import { ref, watch, computed, type Ref, onUnmounted, getCurrentInstance } from 'vue';
import { prefersReducedMotion } from './useElementAnimation.js';

// Re-export for convenience
export { prefersReducedMotion };

/**
 * Configuration for a single FLIP container
 */
export interface FLIPContainer {
  /** Reference to the container element */
  ref: Ref<HTMLElement | null>;
  /** CSS selector for elements to animate (default: '[data-element-id]') */
  selector?: string;
  /** Animation duration in ms (overrides default) */
  duration?: number;
  /** CSS easing string (overrides default) */
  easing?: string;
}

/**
 * Options for useFLIP composable
 */
export interface UseFLIPOptions {
  /**
   * Single container reference (use this OR containers, not both)
   */
  containerRef?: Ref<HTMLElement | null>;

  /**
   * Multiple containers (use this OR containerRef, not both)
   */
  containers?: FLIPContainer[];

  /** CSS selector for elements to animate (default: '[data-element-id]') */
  selector?: string;

  /** Animation duration in ms (default: 300) */
  duration?: number;

  /** CSS easing string for Web Animations API (default: 'ease-out') */
  easing?: string;

  /** Minimum movement threshold in pixels (default: 1) */
  threshold?: number;

  /** Callback when animation starts */
  onAnimationStart?: () => void;

  /** Callback when animation ends */
  onAnimationEnd?: () => void;

  /**
   * Enable automatic mode - automatically capture before and animate after
   * state changes. Requires `gameView` option.
   */
  auto?: boolean;

  /**
   * Function returning the game view to watch for changes.
   * Required when `auto: true`.
   */
  gameView?: () => unknown;
}

/**
 * Return type for useFLIP composable
 */
export interface UseFLIPReturn {
  /** Capture current element positions (call before state change) */
  capture: () => void;

  /** Animate elements from captured positions to current positions */
  animate: () => Promise<void>;

  /** Whether any FLIP animation is currently running */
  isAnimating: Ref<boolean>;

  /** Clear captured positions without animating */
  clear: () => void;
}

const DEFAULT_SELECTOR = '[data-element-id]';
const DEFAULT_DURATION = 300;
const DEFAULT_EASING = 'ease-out';

/**
 * Get a unique identifier for an element.
 * Tries data-card-id, data-element-id, then id.
 */
function getElementId(el: Element): string | null {
  return (
    el.getAttribute('data-card-id') ||
    el.getAttribute('data-piece-id') ||
    el.getAttribute('data-element-id') ||
    el.getAttribute('id') ||
    null
  );
}

/**
 * Internal handler for a single container's FLIP animations
 */
interface ContainerHandler {
  containerRef: Ref<HTMLElement | null>;
  selector: string;
  duration: number;
  easing: string;
  positions: Map<string, DOMRect>;
}

/**
 * Unified FLIP animation composable.
 *
 * Provides both manual and automatic modes for FLIP animations.
 * Supports single container or multiple containers.
 *
 * @param options - Configuration options
 * @returns FLIP animation controls
 */
export function useFLIP(options: UseFLIPOptions): UseFLIPReturn {
  const {
    containerRef,
    containers,
    selector: defaultSelector = DEFAULT_SELECTOR,
    duration: defaultDuration = DEFAULT_DURATION,
    easing: defaultEasing = DEFAULT_EASING,
    threshold = 1,
    onAnimationStart,
    onAnimationEnd,
    auto = false,
    gameView,
  } = options;

  const isAnimating = ref(false);

  // Build list of container handlers
  const handlers: ContainerHandler[] = [];

  if (containers && containers.length > 0) {
    // Multi-container mode
    for (const container of containers) {
      handlers.push({
        containerRef: container.ref,
        selector: container.selector ?? defaultSelector,
        duration: container.duration ?? defaultDuration,
        easing: container.easing ?? defaultEasing,
        positions: new Map(),
      });
    }
  } else if (containerRef) {
    // Single container mode
    handlers.push({
      containerRef,
      selector: defaultSelector,
      duration: defaultDuration,
      easing: defaultEasing,
      positions: new Map(),
    });
  }

  /**
   * Capture current positions of all matching elements in all containers.
   * Call this BEFORE the DOM update happens.
   */
  function capture(): void {
    for (const handler of handlers) {
      handler.positions.clear();

      const container = handler.containerRef?.value;
      if (!container) continue;

      const elements = container.querySelectorAll(handler.selector);
      elements.forEach((el) => {
        const id = getElementId(el);
        if (id) {
          handler.positions.set(id, el.getBoundingClientRect());
        }
      });
    }
  }

  /**
   * Animate elements from their captured positions to their current positions.
   * Call this AFTER the DOM has updated (after nextTick).
   */
  async function animate(): Promise<void> {
    // Skip if reduced motion is preferred
    if (prefersReducedMotion.value) {
      for (const handler of handlers) {
        handler.positions.clear();
      }
      return;
    }

    const allAnimations: Animation[] = [];
    let hasAnyAnimations = false;

    for (const handler of handlers) {
      const container = handler.containerRef?.value;
      if (!container || handler.positions.size === 0) {
        handler.positions.clear();
        continue;
      }

      const elements = container.querySelectorAll(handler.selector);

      elements.forEach((el) => {
        const id = getElementId(el);
        if (!id) return;

        const oldRect = handler.positions.get(id);
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
            duration: handler.duration,
            easing: handler.easing,
            fill: 'backwards',
          }
        );

        allAnimations.push(animation);
        hasAnyAnimations = true;
      });

      // Clear captured positions for this handler
      handler.positions.clear();
    }

    if (hasAnyAnimations) {
      isAnimating.value = true;
      onAnimationStart?.();

      // Wait for all animations to complete
      await Promise.all(allAnimations.map((a) => a.finished));

      isAnimating.value = false;
      onAnimationEnd?.();
    }
  }

  /**
   * Clear captured positions without animating.
   */
  function clear(): void {
    for (const handler of handlers) {
      handler.positions.clear();
    }
  }

  // Auto mode: set up watchers for automatic capture/animate
  if (auto && gameView) {
    // Sync watcher: capture positions before update
    watch(
      gameView,
      () => {
        if (!prefersReducedMotion.value) {
          capture();
        }
      },
      { deep: true, flush: 'sync' }
    );

    // Post watcher: animate after DOM update
    watch(
      gameView,
      async () => {
        if (!prefersReducedMotion.value) {
          await animate();
        }
      },
      { deep: true, flush: 'post' }
    );

    // Cleanup on unmount
    const instance = getCurrentInstance();
    if (instance) {
      onUnmounted(() => {
        clear();
      });
    }
  }

  return {
    capture,
    animate,
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
      const id = getElementId(el);
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
        const id = getElementId(el);
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
