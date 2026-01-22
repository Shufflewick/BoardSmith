/**
 * useAutoFlyToStat - Automatic flying animations to player stat displays
 *
 * This composable automatically animates elements flying to player stats when they
 * are removed from one or more containers and a stat count increases.
 *
 * ## Usage
 *
 * ```typescript
 * import { useAutoFlyToStat, useFlyingCards } from '@boardsmith/ui';
 *
 * const zoneARef = ref<HTMLElement | null>(null);
 * const zoneBRef = ref<HTMLElement | null>(null);
 * const { flyingCards, flyCards } = useFlyingCards();
 *
 * useAutoFlyToStat({
 *   gameView: () => props.gameView,
 *   containerRefs: [zoneARef, zoneBRef],  // Track multiple containers
 *   selector: '[data-card-id]',
 *   stats: [
 *     {
 *       stat: 'score',
 *       player: 0,
 *       trackCount: () => playerScore.value,
 *     },
 *   ],
 *   getElementData: (el) => ({
 *     rank: el.getAttribute('data-rank'),
 *     suit: el.getAttribute('data-suit'),
 *   }),
 *   flyCards,
 * });
 * ```
 *
 * Cards will automatically fly to the player stat when removed and count increases.
 */

import { ref, watch, computed, onUnmounted, getCurrentInstance, type Ref } from 'vue';
import { useCountTracker, type ElementPositionData } from './useElementChangeTracker.js';
import { flyToPlayerStat, type CardForAnimation } from './usePlayerStatAnimation.js';
import type { FlyCardOptions, FlyingCardData } from './useFlyingCards.js';

export interface StatConfig {
  /** Name of the stat (e.g., 'books', 'captured', 'score') */
  stat: string;
  /**
   * Target player seat, or a function to determine the player from the removed element.
   * For captures, use a function: (element) => element.playerSeat === 0 ? 1 : 0
   */
  player: number | ((elementData: ElementPositionData) => number);
  /**
   * Optional function to track count changes. If provided, elements will only fly
   * when this count increases. Good for detecting book formation, scoring, etc.
   */
  trackCount?: () => number;
  /**
   * Optional filter function. If provided, only elements matching this filter will fly.
   * Useful when a container has mixed elements (e.g., different piece types).
   */
  filter?: (elementData: ElementPositionData) => boolean;
}

export interface AutoFlyToStatOptions {
  /** Function that returns the current game view */
  gameView: () => any;
  /** Refs to container elements to track removals from (supports multiple containers) */
  containerRefs: Ref<HTMLElement | null>[];
  /** CSS selector to find elements in the containers */
  selector: string;
  /** Stats to fly elements to when removed */
  stats: StatConfig[];
  /**
   * Function to extract ID from a DOM element.
   * Default: parses the first data attribute value as an integer.
   */
  getElementId?: (el: Element) => number;
  /**
   * Function to extract additional element data from DOM for rendering during animation.
   * Returns data like rank, suit, playerSeat, isKing, etc.
   */
  getElementData?: (el: Element) => Partial<FlyingCardData>;
  /**
   * The flyCards function from useFlyingCards.
   * Pass this in so animations appear in your overlay.
   */
  flyCards: (options: FlyCardOptions[], staggerMs?: number) => Promise<void>;
  /** Animation duration in ms (default: 500) */
  duration?: number;
  /** Stagger delay between elements in ms (default: 50) */
  stagger?: number;
  /** Element dimensions (default: { width: 60, height: 84 }) */
  elementSize?: { width: number; height: number };
  /** Whether to flip elements during animation (default: false) */
  flip?: boolean;
}

export interface AutoFlyToStatReturn {
  /** Force a reset of tracking state (e.g., on game restart) */
  reset: () => void;
  /** Whether tracking has been initialized (useful for debugging) */
  isInitialized: Readonly<Ref<boolean>>;
  /** Current tracked IDs (useful for debugging) */
  trackedIds: Readonly<Ref<Set<number>>>;
}

/**
 * Create automatic flying animations to player stats
 */
export function useAutoFlyToStat(options: AutoFlyToStatOptions): AutoFlyToStatReturn {
  const {
    gameView,
    containerRefs,
    selector,
    stats,
    getElementId = (el) => {
      // Try common data attributes
      for (const attr of ['data-card-id', 'data-piece-id', 'data-element-id']) {
        const val = el.getAttribute(attr);
        if (val) return parseInt(val, 10);
      }
      return 0;
    },
    getElementData = () => ({}),
    flyCards,
    duration = 500,
    stagger = 50,
    elementSize = { width: 60, height: 84 },
    flip = false,
  } = options;

  // Track positions and IDs ourselves since we have multiple containers
  const positions = ref<Map<number, ElementPositionData>>(new Map());
  const prevIds = ref<Set<number>>(new Set());
  const isInitialized = ref(false);

  // Count trackers for each stat that has trackCount
  const countTrackers = new Map<string, ReturnType<typeof useCountTracker>>();
  for (const stat of stats) {
    if (stat.trackCount) {
      countTrackers.set(stat.stat, useCountTracker());
    }
  }

  const gameViewComputed = computed(() => gameView());

  // Check if any container ref is ready
  function hasAnyContainer(): boolean {
    return containerRefs.some(ref => ref?.value !== null);
  }

  // Capture positions from all containers
  function capturePositions(): void {
    positions.value.clear();

    for (const containerRef of containerRefs) {
      if (!containerRef?.value) continue;

      const elements = containerRef.value.querySelectorAll(selector);
      elements.forEach((el) => {
        const id = getElementId(el);
        if (id) {
          const rect = el.getBoundingClientRect();
          const extraData = getElementData(el) as Record<string, any>;
          positions.value.set(id, { rect, ...extraData });
        }
      });
    }
  }

  // Extract current element IDs from all containers
  function getCurrentIds(): Set<number> {
    const ids = new Set<number>();

    for (const containerRef of containerRefs) {
      if (!containerRef?.value) continue;

      const elements = containerRef.value.querySelectorAll(selector);
      elements.forEach((el) => {
        const id = getElementId(el);
        if (id) ids.add(id);
      });
    }

    return ids;
  }

  // Get IDs that were removed (in previous but not in current)
  function getRemovedIds(prev: Set<number>, current: Set<number>): Set<number> {
    const removed = new Set<number>();
    for (const id of prev) {
      if (!current.has(id)) {
        removed.add(id);
      }
    }
    return removed;
  }

  // Watch with flush: 'sync' to capture positions BEFORE DOM update
  const stopSyncWatch = watch(
    gameViewComputed,
    () => {
      // Skip if no container refs are ready yet
      if (!hasAnyContainer()) return;

      capturePositions();
    },
    { flush: 'sync' }
  );

  // Track initialization attempts for warning
  let initAttempts = 0;
  const MAX_INIT_ATTEMPTS_BEFORE_WARN = 10;

  // Watch with flush: 'post' to detect removals AFTER DOM is fully updated
  // This ensures getCurrentIds() sees the complete, updated DOM
  const stopPostWatch = watch(
    gameViewComputed,
    () => {
      // Skip if no container refs are ready yet (components not mounted)
      if (!hasAnyContainer()) {
        return;
      }

      // Skip if not initialized
      if (!isInitialized.value) {
        const currentIds = getCurrentIds();
        // Don't initialize with empty set - wait for elements to appear
        if (currentIds.size === 0) {
          initAttempts++;
          if (initAttempts === MAX_INIT_ATTEMPTS_BEFORE_WARN) {
            console.warn(
              `[useAutoFlyToStat] No elements found after ${initAttempts} attempts. ` +
              `Check that your selector "${selector}" matches elements in the containers.`
            );
          }
          return;
        }
        prevIds.value = new Set(currentIds);
        isInitialized.value = true;

        // Initialize count trackers
        for (const stat of stats) {
          if (stat.trackCount) {
            const countTracker = countTrackers.get(stat.stat);
            if (countTracker) {
              const initialCount = stat.trackCount();
              countTracker.initialize(initialCount);
            }
          }
        }
        return;
      }

      const currentIds = getCurrentIds();
      const removedIds = getRemovedIds(prevIds.value, currentIds);

      if (removedIds.size > 0) {
        // Check each stat config
        for (const statConfig of stats) {
          // Check if count increased (if tracking)
          if (statConfig.trackCount) {
            const countTracker = countTrackers.get(statConfig.stat);
            if (countTracker) {
              const currentCount = statConfig.trackCount();
              const delta = countTracker.updateCount(currentCount);
              if (delta <= 0) {
                continue; // Skip if count didn't increase
              }
            }
          }

          // Build cards to animate
          const cardsToFly: CardForAnimation[] = [];

          for (const id of removedIds) {
            const posData = positions.value.get(id);
            if (!posData) {
              // This can happen if the sync watcher didn't capture the position
              // (e.g., no container refs were ready when the watcher ran)
              console.warn(
                `[useAutoFlyToStat] Position not found for removed element ${id}. ` +
                `This usually means the element was removed before its position could be captured. ` +
                `Make sure the container refs are mounted before elements are added.`
              );
              continue;
            }

            // Apply filter if provided
            if (statConfig.filter && !statConfig.filter(posData)) {
              continue;
            }

            cardsToFly.push({
              rect: posData.rect,
              rank: posData.rank as string,
              suit: posData.suit as string,
              playerSeat: posData.playerSeat as number,
              isKing: posData.isKing as boolean,
              faceImage: posData.faceImage as string,
              backImage: posData.backImage as string,
            });
          }

          if (cardsToFly.length > 0) {
            // Determine target player from first card (or config)
            const targetPlayer =
              typeof statConfig.player === 'function'
                ? statConfig.player(positions.value.get([...removedIds][0])!)
                : statConfig.player;

            flyToPlayerStat(flyCards, {
              cards: cardsToFly,
              playerSeat: targetPlayer,
              statName: statConfig.stat,
              duration,
              stagger,
              cardSize: elementSize,
              flip,
            });
          }
        }
      }

      // Update previous IDs for next comparison
      prevIds.value = new Set(currentIds);
    },
    { deep: true, flush: 'post' }
  );

  function reset(): void {
    prevIds.value = new Set();
    positions.value.clear();
    isInitialized.value = false;
    for (const countTracker of countTrackers.values()) {
      countTracker.reset();
    }
  }

  // Auto-cleanup: register onUnmounted if we're in a component setup context
  const instance = getCurrentInstance();
  if (instance) {
    onUnmounted(() => {
      stopSyncWatch();
      stopPostWatch();
    });
  } else {
    console.warn(
      '[useAutoFlyToStat] Called outside of component setup(). ' +
      'Watchers will not be automatically cleaned up. ' +
      'This can cause errors if the component unmounts while watchers are still active.'
    );
  }

  return {
    reset,
    isInitialized,
    trackedIds: prevIds,
  };
}
