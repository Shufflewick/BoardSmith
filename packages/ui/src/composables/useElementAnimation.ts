/**
 * useElementAnimation - Animation composable for smooth element movements
 *
 * Uses requestAnimationFrame to animate elements from their old positions
 * to their new positions, tracking both in real-time. This handles cases
 * where the target position changes during animation (e.g., layout shifts).
 *
 * Usage:
 * ```typescript
 * const { capturePositions, animateToCurrentPositions } = useElementAnimation();
 *
 * // Before state change - capture where elements are now
 * capturePositions(containerEl);
 *
 * // After state change - animate from old positions to new positions
 * // Elements will track their targets if they keep moving
 * animateToCurrentPositions(containerEl);
 * ```
 */
import { ref } from 'vue';

export interface AnimationOptions {
  /** Duration in milliseconds (default: 300) */
  duration?: number;
  /** Selector for animatable elements (default: '[data-animatable="true"]') */
  selector?: string;
}

const DEFAULT_DURATION = 300;
const DEFAULT_SELECTOR = '[data-animatable="true"]';

// Easing function (ease-out cubic)
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// Check reduced motion preference (reactive, singleton)
export const prefersReducedMotion = ref(
  typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
);

// Listen for preference changes
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-reduced-motion: reduce)')
    .addEventListener('change', (e) => {
      prefersReducedMotion.value = e.matches;
    });
}

export function useElementAnimation() {
  // Map of element ID -> captured start position
  const positions = new Map<string | number, { left: number; top: number; width: number; height: number }>();
  // Track active animations so we can cancel them
  const activeAnimations = new Map<string | number, { cancel: () => void }>();

  /**
   * Capture current positions of all animatable elements within a container.
   * Call this BEFORE state changes.
   */
  function capturePositions(container: HTMLElement | null, options: AnimationOptions = {}) {
    positions.clear();
    if (!container) return;

    const selector = options.selector ?? DEFAULT_SELECTOR;
    const elements = container.querySelectorAll(selector);

    elements.forEach((el) => {
      const id = el.getAttribute('data-element-id');
      if (id) {
        const rect = el.getBoundingClientRect();
        positions.set(id, {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        });
      }
    });
  }

  /**
   * Animate elements from their captured positions to their current positions.
   * Uses requestAnimationFrame to track moving targets in real-time.
   * Call this AFTER state changes.
   */
  function animateToCurrentPositions(container: HTMLElement | null, options: AnimationOptions = {}) {
    if (prefersReducedMotion.value) {
      positions.clear();
      return;
    }
    if (!container) {
      positions.clear();
      return;
    }

    const duration = options.duration ?? DEFAULT_DURATION;
    const selector = options.selector ?? DEFAULT_SELECTOR;
    const elements = container.querySelectorAll(selector);

    elements.forEach((el) => {
      const id = el.getAttribute('data-element-id');
      if (!id) return;

      const startPos = positions.get(id);
      if (!startPos) return;

      const htmlEl = el as HTMLElement;

      // Cancel any existing animation on this element
      const existing = activeAnimations.get(id);
      if (existing) {
        existing.cancel();
      }

      // Check if element actually moved
      const currentRect = htmlEl.getBoundingClientRect();
      const deltaX = Math.abs(startPos.left - currentRect.left);
      const deltaY = Math.abs(startPos.top - currentRect.top);

      if (deltaX < 1 && deltaY < 1) {
        return; // No significant movement
      }

      // Start the animation
      const startTime = performance.now();
      let animationFrameId: number;
      let cancelled = false;

      const cancel = () => {
        cancelled = true;
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
        }
        htmlEl.style.transform = '';
        activeAnimations.delete(id);
      };

      activeAnimations.set(id, { cancel });

      const capturedStartPos = startPos; // Capture for closure

      function animate(currentTime: number) {
        if (cancelled) return;

        const elapsed = currentTime - startTime;
        const rawProgress = Math.min(elapsed / duration, 1);
        const progress = easeOutCubic(rawProgress);

        // Get the element's CURRENT position in the DOM (may have moved)
        const currentRect = htmlEl.getBoundingClientRect();

        // Calculate where we want to visually appear
        // Interpolate from start position towards current DOM position
        const visualLeft = capturedStartPos.left + (currentRect.left - capturedStartPos.left) * progress;
        const visualTop = capturedStartPos.top + (currentRect.top - capturedStartPos.top) * progress;

        // Calculate the transform needed to move from current DOM position to visual position
        const offsetX = visualLeft - currentRect.left;
        const offsetY = visualTop - currentRect.top;

        if (Math.abs(offsetX) > 0.5 || Math.abs(offsetY) > 0.5) {
          htmlEl.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
        } else {
          htmlEl.style.transform = '';
        }

        if (rawProgress < 1) {
          animationFrameId = requestAnimationFrame(animate);
        } else {
          // Animation complete
          htmlEl.style.transform = '';
          activeAnimations.delete(id!);
        }
      }

      animationFrameId = requestAnimationFrame(animate);
    });

    positions.clear();
  }

  /**
   * Cancel all active animations
   */
  function cancelAll() {
    for (const { cancel } of activeAnimations.values()) {
      cancel();
    }
    activeAnimations.clear();
    positions.clear();
  }

  return {
    capturePositions,
    animateToCurrentPositions,
    cancelAll,
    prefersReducedMotion,
  };
}
