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
import { prefersReducedMotion } from './reducedMotion.js';
import { isAnimationTestModeEnabled, recordTrace } from './useAnimationTestMode.js';
import { isDevThrowEnabled } from '../../utils/dev.js';
import { boardZoomAt } from './boardRegionPin.js';

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

  /** Callback when animation starts (once, even if runs overlap) */
  onAnimationStart?: () => void;

  /** Callback when the last running animation ends */
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
 * Fail-loud report for an element useFLIP was asked to track but that carries
 * none of the recognized anchor attributes on FIRST resolution (capture, or
 * animate's first per-element pass). Throws in dev (actionable, names the
 * composable + the exact attribute set searched + the fix); logs + skips in
 * production so a cosmetic anchor gap never crashes a live game.
 */
function reportMissingAnchor(el: Element): void {
  const message =
    `useFLIP: an element could not be tracked because it has no anchor attribute. ` +
    `useFLIP identifies elements via data-card-id, data-piece-id, data-element-id, or id ` +
    `(checked in that order) — none were found on <${el.tagName.toLowerCase()}>. ` +
    `Add one of these attributes (e.g. spread anchorAttrs(ref) onto the element, or bind ` +
    `useSelectable()'s attrs) so useFLIP can track it across DOM updates.`;
  if (isDevThrowEnabled()) {
    throw new Error(message);
  }
  console.error(`[BoardSmith] ${message}`);
}

/**
 * Each element `handler` captured that is still in `container`, with where it
 * was and where it is now. An element captured but not re-found is a transient
 * render state, not a missing-anchor error, so it is skipped silently.
 */
function forEachCaptured(
  handler: ContainerHandler,
  container: HTMLElement,
  visit: (el: Element, id: string, oldRect: DOMRect, newRect: DOMRect) => void,
): void {
  container.querySelectorAll(handler.selector).forEach((el) => {
    const id = getElementId(el);
    if (!id) {
      reportMissingAnchor(el);
      return;
    }
    const oldRect = handler.positions.get(id);
    if (oldRect) visit(el, id, oldRect, el.getBoundingClientRect());
  });
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
  let activeRuns = 0;

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
        } else {
          reportMissingAnchor(el);
        }
      });
    }
  }

  /**
   * Animate elements from their captured positions to their current positions.
   * Call this AFTER the DOM has updated (after nextTick).
   */
  async function animate(): Promise<void> {
    // Test mode: record instant, assertable flip traces instead of running WAAPI.
    // This branch sits ABOVE prefersReducedMotion and is never merged with it —
    // test-mode and reduced-motion are independent, unrelated flags.
    if (isAnimationTestModeEnabled()) {
      for (const handler of handlers) {
        const container = handler.containerRef?.value;
        if (container && handler.positions.size > 0) {
          const containerLabel = getElementId(container) ?? handler.selector;
          forEachCaptured(handler, container, (_el, id, oldRect, newRect) => {
            recordTrace({
              kind: 'flip',
              element: id,
              from: containerLabel,
              to: containerLabel,
              meta: {
                deltaX: oldRect.left - newRect.left,
                deltaY: oldRect.top - newRect.top,
              },
            });
          });
        }
        handler.positions.clear();
      }
      return;
    }

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

      const zoom = boardZoomAt(container);
      forEachCaptured(handler, container, (el, _id, oldRect, newRect) => {
        const deltaX = oldRect.left - newRect.left;
        const deltaY = oldRect.top - newRect.top;

        // Only animate if movement exceeds threshold
        if (Math.abs(deltaX) < threshold && Math.abs(deltaY) < threshold) {
          return;
        }

        // Create FLIP animation
        const animation = (el as HTMLElement).animate(
          [
            { transform: `translate(${deltaX / zoom}px, ${deltaY / zoom}px)` },
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
      // Runs can overlap: start and end fire once for the whole busy period.
      if (activeRuns++ === 0) {
        isAnimating.value = true;
        onAnimationStart?.();
      }
      try {
        await Promise.all(allAnimations.map((a) => a.finished));
      } finally {
        if (--activeRuns === 0) {
          isAnimating.value = false;
          onAnimationEnd?.();
        }
      }
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
    // Sync watcher: capture positions before update.
    // NOTE: no outer prefersReducedMotion guard here — capture() has no
    // reduced-motion dependency (it only populates the positions map used
    // later), and animate() (below) is what needs to run unconditionally so
    // its own internal test-mode-then-reduced-motion ordering is reachable
    // (never merged, per useAnimationTestMode.ts).
    watch(
      gameView,
      () => {
        capture();
      },
      { flush: 'sync' }
    );

    // Post watcher: animate after DOM update.
    // NOTE: no outer prefersReducedMotion guard here — animate()'s own
    // test-mode branch sits ABOVE its internal prefersReducedMotion check;
    // gating the call itself would make that internal ordering unreachable
    // whenever reduced motion is preferred, silently defeating test mode.
    watch(
      gameView,
      async () => {
        await animate();
      },
      { flush: 'post' }
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
  const flip = useFLIP({ containerRef, selector, ...options });
  flip.capture();
  return { animate: flip.animate };
}
