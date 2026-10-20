/**
 * useOverlayTracking — keeps a viewport-fixed overlay (tutorial, hint, heatmap)
 * aligned with the board: re-measures when the content changes, when the window,
 * the board region or a target resizes, and when the board region scrolls.
 *
 * Every listener and observer is removed on unmount from the exact element it
 * was added to, never a re-queried one (#749).
 */

import { onMounted, onUnmounted, watch, nextTick, type Ref } from 'vue';
import type { AnnotationTarget } from '../../engine/tutorial/types.js';
import { buildSelector } from '../components/helpers/overlay-utils.js';

export function useOverlayTracking<T>(options: {
  /** The overlay's root element (null while nothing is shown). */
  root: Ref<HTMLElement | null>;
  /** What the overlay shows. Watched by identity, so keep it stable when unchanged (#748). */
  content: Ref<readonly T[]>;
  /** The target an item is drawn at, if any; each found target is watched for resizes. */
  targetOf: (item: T) => AnnotationTarget | undefined;
  /** Recompute positions. `boardRect` is the board region's rect, or null with no board. */
  measure: (boardRect: DOMRect | null) => void;
}): void {
  const { root, content, targetOf, measure } = options;

  let resizeObserver: ResizeObserver | null = null;
  let scrollRegion: Element | null = null;

  // With Teleport the root sits in <body>, so closest() finds nothing and the query does.
  const boardRegion = (): Element | null =>
    root.value?.closest('.boardregion') ?? document.querySelector('.boardregion');

  function remeasure() {
    measure(content.value.length > 0 ? (boardRegion()?.getBoundingClientRect() ?? null) : null);
  }

  function onChange() {
    void nextTick(remeasure);
  }

  function stop() {
    resizeObserver?.disconnect();
    resizeObserver = null;
    scrollRegion?.removeEventListener('scroll', onChange);
    scrollRegion = null;
  }

  function rebuildObservers() {
    stop();
    if (!root.value) return;

    resizeObserver = new ResizeObserver(onChange);
    // The root is fixed to the screen, so it resizes with the window (#1300).
    const observed = new Set<Element>([root.value]);
    for (const item of content.value) {
      const target = targetOf(item);
      const selector = target ? buildSelector(target) : '';
      const el = selector ? document.querySelector(selector) : null;
      if (el) observed.add(el);
    }
    const region = boardRegion();
    if (region) {
      observed.add(region);
      region.addEventListener('scroll', onChange, { passive: true });
      scrollRegion = region;
    }
    for (const el of observed) resizeObserver.observe(el);
  }

  function refresh() {
    remeasure();
    rebuildObservers();
  }

  watch(content, () => void nextTick(refresh), { immediate: true });
  onMounted(refresh);
  onUnmounted(stop);
}
