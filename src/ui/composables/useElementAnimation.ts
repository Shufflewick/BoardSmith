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
import { customRef } from 'vue';
import { easeOutCubic } from '../../utils/easing.js';
import { isAnimationTestModeEnabled, recordTrace } from './useAnimationTestMode.js';
import { isDevThrowEnabled } from '../../utils/dev.js';

export interface AnimationOptions {
  /** Duration in milliseconds (default: 300) */
  duration?: number;
  /** Selector for animatable elements (default: '[data-animatable="true"]') */
  selector?: string;
}

const DEFAULT_DURATION = 300;
const DEFAULT_SELECTOR = '[data-animatable="true"]';

// ---------------------------------------------------------------------------
// D19 (TOOL-03, Blocking): reading `window.matchMedia(...)` at MODULE SCOPE
// throws under jsdom (jsdom implements `window` but not `matchMedia`), which
// makes the entire `boardsmith/ui` barrel unimportable in a bare jsdom test
// environment without a manual polyfill/stub. The read + `change` listener
// registration are deferred into a lazy initializer that runs on FIRST
// ACCESS of `prefersReducedMotion.value` (via `customRef`'s `track`/`trigger`,
// which lets a plain `Ref<boolean>`-shaped export intercept its own first
// read) — nothing executes at import. Guarded on
// `typeof window.matchMedia === 'function'` (not just `typeof window !==
// 'undefined'`, which jsdom satisfies but which does NOT guarantee
// `matchMedia` exists). Real consumers (useFLIP, AutoRenderer) still observe
// a reactive value that updates on the OS `change` event once initialized —
// only the IMPORT becomes side-effect-free.
// ---------------------------------------------------------------------------
let reducedMotionInitialized = false;
// Tracks whether a consumer/test has explicitly assigned `.value` BEFORE the
// lazy initializer ran (initialization is deferred to first GET, but a
// write can legitimately happen first — e.g. a test driving the ref
// directly). Without this guard, a subsequent first-read init would clobber
// that explicit assignment with the OS's actual `matchMedia().matches`,
// silently discarding it.
let reducedMotionExplicitlySet = false;
let reducedMotionValue = false;

function ensureReducedMotionInitialized(trigger: () => void): void {
  if (reducedMotionInitialized) return;
  reducedMotionInitialized = true;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!reducedMotionExplicitlySet) {
    reducedMotionValue = mql.matches;
  }
  mql.addEventListener('change', (e) => {
    reducedMotionValue = e.matches;
    trigger();
  });
}

// Check reduced motion preference (reactive, singleton; lazily initialized — see above).
export const prefersReducedMotion = customRef<boolean>((track, trigger) => ({
  get() {
    ensureReducedMotionInitialized(trigger);
    track();
    return reducedMotionValue;
  },
  set(value: boolean) {
    reducedMotionExplicitlySet = true;
    reducedMotionValue = value;
    trigger();
  },
}));

/**
 * Fail-loud report for an element useElementAnimation was asked to animate
 * but that carries no `data-element-id` on FIRST resolution (the per-element
 * pass inside `animateToCurrentPositions()`). Throws in dev (actionable,
 * names the composable + the exact attribute searched + the fix); logs +
 * skips in production so a cosmetic anchor gap never crashes a live game.
 */
function reportMissingAnchor(el: Element): void {
  const message =
    `useElementAnimation: an element could not be animated because it has no ` +
    `anchor attribute. useElementAnimation identifies elements via ` +
    `data-element-id — none was found on <${el.tagName.toLowerCase()}>. ` +
    `Add data-element-id to the element (e.g. spread anchorAttrs(ref) onto it, ` +
    `or bind useSelectable()'s attrs) so useElementAnimation can track it.`;
  if (isDevThrowEnabled()) {
    throw new Error(message);
  }
  console.error(`[BoardSmith] ${message}`);
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
    // Test mode: record instant, assertable element traces instead of
    // running the RAF loop. This branch sits ABOVE prefersReducedMotion and
    // is never merged with it — test-mode and reduced-motion are
    // independent, unrelated flags.
    if (isAnimationTestModeEnabled()) {
      if (!container) {
        positions.clear();
        return;
      }

      const selector = options.selector ?? DEFAULT_SELECTOR;
      const containerLabel = container.getAttribute('data-element-id') ?? undefined;
      const elements = container.querySelectorAll(selector);

      elements.forEach((el) => {
        const id = el.getAttribute('data-element-id');
        if (!id) {
          reportMissingAnchor(el);
          return;
        }

        const startPos = positions.get(id);
        if (!startPos) return; // not previously captured => not a moved element

        const currentRect = (el as HTMLElement).getBoundingClientRect();
        recordTrace({
          kind: 'element',
          element: id,
          from: containerLabel,
          to: containerLabel,
          meta: {
            deltaX: startPos.left - currentRect.left,
            deltaY: startPos.top - currentRect.top,
          },
        });
      });

      positions.clear();
      return;
    }

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
      if (!id) {
        reportMissingAnchor(el);
        return;
      }

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
        const animatingRect = htmlEl.getBoundingClientRect();

        // Calculate where we want to visually appear
        // Interpolate from start position towards current DOM position
        const visualLeft = capturedStartPos.left + (animatingRect.left - capturedStartPos.left) * progress;
        const visualTop = capturedStartPos.top + (animatingRect.top - capturedStartPos.top) * progress;

        // Calculate the transform needed to move from current DOM position to visual position
        const offsetX = visualLeft - animatingRect.left;
        const offsetY = visualTop - animatingRect.top;

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
