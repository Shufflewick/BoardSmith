/**
 * useAutoFlyToStat - Automatic flying animations to player stat displays
 *
 * This composable automatically animates elements flying to player stats when they
 * are removed from a container and a stat count increases.
 *
 * ## Usage
 *
 * ```typescript
 * import { useAutoFlyToStat, useFlyingCards } from '@boardsmith/ui';
 *
 * const handRef = ref<HTMLElement | null>(null);
 * const { flyingCards, flyCards } = useFlyingCards();
 *
 * useAutoFlyToStat({
 *   gameView: () => props.gameView,
 *   containerRef: handRef,
 *   selector: '[data-card-id]',
 *   stats: [
 *     {
 *       stat: 'books',
 *       player: 0,
 *       trackCount: () => myBooksCount.value,
 *     },
 *   ],
 *   getElementData: (element) => ({
 *     rank: element.attributes?.rank,
 *     suit: element.attributes?.suit,
 *   }),
 *   flyCards,
 * });
 * ```
 *
 * Cards will automatically fly to the player stat when removed and count increases.
 */

import { watch, computed, type Ref, type ComputedRef } from 'vue';
import { useElementChangeTracker, useCountTracker, type ElementPositionData } from './useElementChangeTracker.js';
import { flyToPlayerStat, type CardForAnimation } from './usePlayerStatAnimation.js';
import type { FlyCardOptions, FlyingCardData } from './useFlyingCards.js';

export interface StatConfig {
  /** Name of the stat (e.g., 'books', 'captured', 'score') */
  stat: string;
  /**
   * Target player position, or a function to determine the player from the removed element.
   * For captures, use a function: (element) => element.playerPosition === 0 ? 1 : 0
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
  /** Ref to the container element to track removals from */
  containerRef: Ref<HTMLElement | null>;
  /** CSS selector to find elements in the container */
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
   * Returns data like rank, suit, playerPosition, isKing, etc.
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
}

/**
 * Create automatic flying animations to player stats
 */
export function useAutoFlyToStat(options: AutoFlyToStatOptions): AutoFlyToStatReturn {
  const {
    gameView,
    containerRef,
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

  // Element change tracker for positions
  const tracker = useElementChangeTracker({
    containerRef,
    selector,
    getElementId,
    getElementData: (el) => getElementData(el) as Record<string, any>,
  });

  // Count trackers for each stat that has trackCount
  const countTrackers = new Map<string, ReturnType<typeof useCountTracker>>();
  for (const stat of stats) {
    if (stat.trackCount) {
      countTrackers.set(stat.stat, useCountTracker());
    }
  }

  const gameViewComputed = computed(() => gameView());

  // Extract current element IDs from container
  function getCurrentIds(): Set<number> {
    const ids = new Set<number>();
    if (!containerRef.value) return ids;

    const elements = containerRef.value.querySelectorAll(selector);
    elements.forEach((el) => {
      const id = getElementId(el);
      if (id) ids.add(id);
    });
    return ids;
  }

  // Watch with flush: 'sync' to capture positions BEFORE DOM update
  watch(
    gameViewComputed,
    () => {
      tracker.capturePositions();
    },
    { flush: 'sync' }
  );

  // Watch normally to detect removals and fly to stats
  watch(
    gameViewComputed,
    () => {
      // Skip if not initialized
      if (!tracker.isInitialized.value) {
        const currentIds = getCurrentIds();
        tracker.initialize(currentIds);

        // Initialize count trackers
        for (const stat of stats) {
          if (stat.trackCount) {
            const countTracker = countTrackers.get(stat.stat);
            if (countTracker) {
              countTracker.initialize(stat.trackCount());
            }
          }
        }
        return;
      }

      const currentIds = getCurrentIds();
      const removedIds = tracker.getRemovedIds(tracker.prevIds.value, currentIds);

      if (removedIds.size > 0) {
        // Check each stat config
        for (const statConfig of stats) {
          // Check if count increased (if tracking)
          if (statConfig.trackCount) {
            const countTracker = countTrackers.get(statConfig.stat);
            if (countTracker) {
              const delta = countTracker.updateCount(statConfig.trackCount());
              if (delta <= 0) continue; // Skip if count didn't increase
            }
          }

          // Build cards to animate
          const cardsToFly: CardForAnimation[] = [];

          for (const id of removedIds) {
            const posData = tracker.positions.value.get(id);
            if (!posData) continue;

            // Apply filter if provided
            if (statConfig.filter && !statConfig.filter(posData)) {
              continue;
            }

            // Determine target player
            const targetPlayer =
              typeof statConfig.player === 'function'
                ? statConfig.player(posData)
                : statConfig.player;

            cardsToFly.push({
              rect: posData.rect,
              rank: posData.rank as string,
              suit: posData.suit as string,
              playerPosition: posData.playerPosition as number,
              isKing: posData.isKing as boolean,
              faceImage: posData.faceImage as string,
              backImage: posData.backImage as string,
            });
          }

          if (cardsToFly.length > 0) {
            // Determine target player from first card (or config)
            const targetPlayer =
              typeof statConfig.player === 'function'
                ? statConfig.player(tracker.positions.value.get([...removedIds][0])!)
                : statConfig.player;

            flyToPlayerStat(flyCards, {
              cards: cardsToFly,
              playerPosition: targetPlayer,
              statName: statConfig.stat,
              duration,
              stagger,
              cardSize: elementSize,
              flip,
            });
          }
        }
      }

      // Update previous IDs
      tracker.updateIds(currentIds);
    },
    { deep: true }
  );

  function reset(): void {
    tracker.reset();
    for (const countTracker of countTrackers.values()) {
      countTracker.reset();
    }
  }

  return {
    reset,
  };
}
