/**
 * useAutoAnimations - Unified automatic animation system for games
 *
 * This is the one composable to rule them all. Register your containers and
 * everything animates automatically:
 * - Elements flying between containers (deck → hand, hand → discard)
 * - Elements reordering within containers (FLIP animations)
 * - Elements flying to player stats (book formation, piece captures)
 *
 * ## Quick Start
 *
 * ```typescript
 * import { useAutoAnimations } from '@boardsmith/ui';
 *
 * const { flyingElements } = useAutoAnimations({
 *   gameView: () => props.gameView,
 *   containers: [
 *     { element: deck, ref: deckRef },
 *     { element: myHand, ref: handRef, flipWithin: '[data-card-id]' },
 *     { element: board, ref: boardRef, flipWithin: '[data-piece-id]' },
 *   ],
 *   getElementData: (el) => ({
 *     rank: el.attributes?.rank,
 *     suit: el.attributes?.suit,
 *   }),
 * });
 *
 * // Template: <FlyingCardsOverlay :flying-cards="flyingElements" />
 * ```
 *
 * ## With Fly-to-Stats (Books, Captures, Scoring)
 *
 * ```typescript
 * const { flyingElements } = useAutoAnimations({
 *   gameView: () => props.gameView,
 *   containers: [
 *     { element: myHand, ref: handRef },
 *     { element: board, ref: boardRef },
 *   ],
 *   flyToStats: [
 *     // Cards fly to books stat when removed and books count increases
 *     {
 *       stat: 'books',
 *       containerRef: handRef,
 *       selector: '[data-card-id]',
 *       player: playerPosition,
 *       trackCount: () => myBooksCount.value,
 *     },
 *     // Captured pieces fly to opponent's captured stat
 *     {
 *       stat: 'captured',
 *       containerRef: boardRef,
 *       selector: '[data-piece-id]',
 *       player: (piece) => piece.playerPosition === 0 ? 1 : 0,
 *     },
 *   ],
 *   getElementData: (el) => ({
 *     rank: el.attributes?.rank,
 *     suit: el.attributes?.suit,
 *     playerPosition: el.attributes?.player?.position,
 *   }),
 * });
 * ```
 */

import { computed, type Ref, type ComputedRef } from 'vue';
import { useFlyingCards, type FlyingCardData } from './useFlyingCards.js';
import { useAutoFlyingElements, type ElementContainerConfig } from './useAutoFlyingElements.js';
import { useAutoFLIP, type AutoFLIPContainer } from './useAutoFLIP.js';
import { useAutoFlyToStat, type StatConfig as BaseStatConfig } from './useAutoFlyToStat.js';

export interface ContainerConfig extends ElementContainerConfig {
  /**
   * CSS selector for elements that should have FLIP animations within this container.
   * If provided, elements matching this selector will smoothly animate when they
   * reorder within the container.
   *
   * Example: '[data-card-id]' for cards, '[data-piece-id]' for pieces
   */
  flipWithin?: string;
}

export interface FlyToStatConfig {
  /** Name of the stat (e.g., 'books', 'captured', 'score') */
  stat: string;
  /** Ref to the container element to track removals from */
  containerRef: Ref<HTMLElement | null>;
  /** CSS selector to find elements in the container */
  selector: string;
  /**
   * Target player position, or a function to determine the player from the removed element.
   * For captures, use a function: (element) => element.playerPosition === 0 ? 1 : 0
   */
  player: number | ((elementData: any) => number);
  /**
   * Optional function to track count changes. If provided, elements will only fly
   * when this count increases. Good for detecting book formation, scoring, etc.
   */
  trackCount?: () => number;
  /**
   * Optional filter function. If provided, only elements matching this filter will fly.
   */
  filter?: (elementData: any) => boolean;
}

export interface AutoAnimationsOptions {
  /** Function that returns the current game view */
  gameView: () => any;

  /**
   * Containers to track. Elements moving between these will animate.
   * If a container has `flipWithin`, elements reordering within it will also animate.
   */
  containers: ContainerConfig[] | (() => ContainerConfig[]);

  /**
   * Stats to fly elements to when they're removed from containers.
   * Use this for book formation, piece captures, scoring animations, etc.
   */
  flyToStats?: FlyToStatConfig[];

  /**
   * Function to extract display data from a game element.
   * For cards: return rank, suit, faceImage, backImage
   * For pieces: return playerPosition (triggers circular piece rendering)
   */
  getElementData?: (element: any) => FlyingCardData;

  /**
   * Function to extract display data from a DOM element (for flyToStats).
   * If not provided, getElementData is used when possible.
   */
  getDOMElementData?: (el: Element) => Partial<FlyingCardData>;

  /** Animation duration in ms for flying (default: 400) */
  duration?: number;

  /** Animation duration in ms for FLIP (default: 300) */
  flipDuration?: number;

  /** Default element size if not specified per-container (default: 60x84) */
  elementSize?: { width: number; height: number };

  /** Whether to flip elements during flying animation (default: 'never') */
  flip?: 'toPrivate' | 'toPublic' | 'never' | ((from: ContainerConfig, to: ContainerConfig) => boolean);
}

export interface AutoAnimationsReturn {
  /** Reactive array of currently flying elements - pass to FlyingCardsOverlay */
  flyingElements: ComputedRef<any[]>;

  /** Whether any FLIP animations are currently running */
  isAnimating: ComputedRef<boolean>;

  /** Reset all tracking state (call on game restart) */
  reset: () => void;
}

/**
 * Create a unified automatic animation system for your game.
 */
export function useAutoAnimations(options: AutoAnimationsOptions): AutoAnimationsReturn {
  const {
    gameView,
    containers: containersProp,
    flyToStats = [],
    getElementData = () => ({}),
    getDOMElementData,
    duration = 400,
    flipDuration = 300,
    elementSize = { width: 60, height: 84 },
    flip = 'never',
  } = options;

  // Get current containers (supports static array or dynamic function)
  const getContainers = (): ContainerConfig[] => {
    return typeof containersProp === 'function' ? containersProp() : containersProp;
  };

  // Main flying cards for all animations
  const { flyingCards: statFlyingCards, flyCards } = useFlyingCards();

  // Set up auto-flying between containers
  const { flyingElements: containerFlyingElements } = useAutoFlyingElements({
    gameView,
    containers: () => getContainers().map((c) => ({
      element: c.element,
      ref: c.ref,
      elementSize: c.elementSize,
    })),
    getElementData,
    duration,
    elementSize,
    flip,
  });

  // Set up auto-FLIP for containers that have flipWithin
  const flipContainers = computed<AutoFLIPContainer[]>(() => {
    return getContainers()
      .filter((c) => c.flipWithin)
      .map((c) => ({
        ref: c.ref,
        selector: c.flipWithin!,
      }));
  });

  const { isAnimating } = useAutoFLIP({
    gameView,
    containers: () => flipContainers.value,
    duration: flipDuration,
  });

  // Set up auto-fly-to-stat for each stat config
  const statResetters: Array<() => void> = [];

  for (const statConfig of flyToStats) {
    const { reset } = useAutoFlyToStat({
      gameView,
      containerRef: statConfig.containerRef,
      selector: statConfig.selector,
      stats: [
        {
          stat: statConfig.stat,
          player: statConfig.player,
          trackCount: statConfig.trackCount,
          filter: statConfig.filter,
        },
      ],
      getElementData: getDOMElementData || ((el: Element) => {
        // Try to extract common data attributes
        const data: Partial<FlyingCardData> = {};
        const rank = el.getAttribute('data-rank');
        const suit = el.getAttribute('data-suit');
        const playerPos = el.getAttribute('data-player-position');

        if (rank) data.rank = rank;
        if (suit) data.suit = suit;
        if (playerPos) data.playerPosition = parseInt(playerPos, 10);

        return data;
      }),
      flyCards,
      duration,
      elementSize,
    });

    statResetters.push(reset);
  }

  // Combine all flying elements
  const flyingElements = computed(() => [
    ...containerFlyingElements.value,
    ...statFlyingCards.value,
  ]);

  function reset(): void {
    for (const resetFn of statResetters) {
      resetFn();
    }
  }

  return {
    flyingElements,
    isAnimating: computed(() => isAnimating.value),
    reset,
  };
}
