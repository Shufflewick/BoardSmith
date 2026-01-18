/**
 * useAutoFLIP - Automatic FLIP animations for element movements within containers
 *
 * This composable automatically animates elements when they reorder within a container.
 * No manual capturePositions/animateToNewPositions calls needed.
 *
 * ## Usage
 *
 * ```typescript
 * import { useAutoFLIP } from '@boardsmith/ui';
 *
 * const boardRef = ref<HTMLElement | null>(null);
 * const handRef = ref<HTMLElement | null>(null);
 *
 * useAutoFLIP({
 *   gameView: () => props.gameView,
 *   containers: [
 *     { ref: boardRef, selector: '[data-piece-id]' },
 *     { ref: handRef, selector: '[data-card-id]' },
 *   ],
 * });
 * ```
 *
 * Elements will automatically animate when they move within their containers.
 */

import { watch, computed, nextTick, onUnmounted, getCurrentInstance, type Ref } from 'vue';
import { useFLIPAnimation } from './useFLIPAnimation.js';

export interface AutoFLIPContainer {
  /** The DOM element ref for the container */
  ref: Ref<HTMLElement | null>;
  /** CSS selector to find animated elements within this container */
  selector: string;
  /** Optional custom duration for this container */
  duration?: number;
  /** Optional custom easing for this container */
  easing?: string;
}

export interface AutoFLIPOptions {
  /** Function that returns the current game view */
  gameView: () => any;
  /** Containers to track - elements moving within these will animate */
  containers: AutoFLIPContainer[] | (() => AutoFLIPContainer[]);
  /** Animation duration in ms (default: 300) */
  duration?: number;
  /** CSS easing function (default: 'ease-out') */
  easing?: string;
  /** Callback when any animation starts */
  onAnimationStart?: () => void;
  /** Callback when all animations complete */
  onAnimationEnd?: () => void;
}

export interface AutoFLIPReturn {
  /** Whether any animations are currently running */
  isAnimating: Ref<boolean>;
}

/**
 * Create automatic FLIP animations for containers
 */
export function useAutoFLIP(options: AutoFLIPOptions): AutoFLIPReturn {
  const {
    gameView,
    containers: containersProp,
    duration: defaultDuration = 300,
    easing: defaultEasing = 'ease-out',
    onAnimationStart,
    onAnimationEnd,
  } = options;

  // Get current containers (supports static array or dynamic function)
  const getContainers = (): AutoFLIPContainer[] => {
    return typeof containersProp === 'function' ? containersProp() : containersProp;
  };

  // Create a FLIP animation handler for each unique container/selector combo
  // We use a map to track them by a composite key
  const flipHandlers = new Map<string, ReturnType<typeof useFLIPAnimation>>();

  function getOrCreateHandler(container: AutoFLIPContainer, index: number): ReturnType<typeof useFLIPAnimation> {
    // Create a unique key for this container configuration
    // Include index to ensure each container gets its own handler even with same selector
    const key = `${index}-${container.selector}`;

    if (!flipHandlers.has(key)) {
      const handler = useFLIPAnimation({
        containerRef: container.ref,
        selector: container.selector,
        duration: container.duration ?? defaultDuration,
        easing: container.easing ?? defaultEasing,
        onAnimationStart,
        onAnimationEnd,
      });
      flipHandlers.set(key, handler);
    }

    return flipHandlers.get(key)!;
  }

  const gameViewComputed = computed(() => gameView());

  // Track animation state across all handlers
  const isAnimating = computed(() => {
    for (const handler of flipHandlers.values()) {
      if (handler.isAnimating.value) return true;
    }
    return false;
  });

  // Watch with flush: 'sync' to capture positions BEFORE DOM update
  const stopSyncWatch = watch(
    gameViewComputed,
    () => {
      const containers = getContainers();
      for (let i = 0; i < containers.length; i++) {
        const container = containers[i];
        if (container?.ref?.value) {
          const handler = getOrCreateHandler(container, i);
          handler.capturePositions();
        }
      }
    },
    { flush: 'sync' }
  );

  // Watch normally to animate AFTER DOM update
  const stopPostWatch = watch(
    gameViewComputed,
    async () => {
      await nextTick();

      const containers = getContainers();
      const animationPromises: Promise<void>[] = [];

      for (let i = 0; i < containers.length; i++) {
        const container = containers[i];
        if (container?.ref?.value) {
          const handler = getOrCreateHandler(container, i);
          animationPromises.push(handler.animateToNewPositions());
        }
      }

      await Promise.all(animationPromises);
    },
    { deep: true }
  );

  // Auto-cleanup: register onUnmounted if we're in a component setup context
  const instance = getCurrentInstance();
  if (instance) {
    onUnmounted(() => {
      stopSyncWatch();
      stopPostWatch();
    });
  } else {
    console.warn(
      '[useAutoFLIP] Called outside of component setup(). ' +
      'Watchers will not be automatically cleaned up. ' +
      'This can cause errors if the component unmounts while watchers are still active.'
    );
  }

  return {
    isAnimating: computed(() => isAnimating.value),
  };
}
