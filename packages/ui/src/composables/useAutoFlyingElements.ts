/**
 * useAutoFlyingElements - Automatic flying element animations between containers
 *
 * This composable automatically animates elements (cards, pieces, tokens) when
 * they move between registered containers in the game state. No manual tracking needed.
 *
 * Works with any element type - cards, checkers pieces, chess pieces, tokens, etc.
 * The rendering is determined by the data returned from getElementData:
 * - Cards: provide rank, suit, faceImage, backImage
 * - Pieces: provide playerPosition (triggers circular piece rendering)
 *
 * ## Usage
 *
 * ```typescript
 * // 1. Find your game elements (you probably already do this)
 * const deck = computed(() => findElement(gameView, { type: 'deck' }));
 * const myHand = computed(() => findPlayerHand(gameView, playerPosition));
 * const board = computed(() => findElement(gameView, { type: 'board' }));
 *
 * // 2. Create refs for the DOM elements
 * const deckRef = ref<HTMLElement | null>(null);
 * const handRef = ref<HTMLElement | null>(null);
 * const boardRef = ref<HTMLElement | null>(null);
 *
 * // 3. Set up auto-flying elements
 * const { flyingElements } = useAutoFlyingElements({
 *   gameView: () => props.gameView,
 *   containers: [
 *     { element: deck, ref: deckRef },
 *     { element: myHand, ref: handRef },
 *     { element: board, ref: boardRef },
 *   ],
 *   getElementData: (element) => ({
 *     // For cards
 *     rank: element.attributes?.rank,
 *     suit: element.attributes?.suit,
 *     // For pieces (triggers circular rendering)
 *     playerPosition: element.attributes?.player?.position,
 *     isKing: element.attributes?.isKing,
 *   }),
 * });
 *
 * // 4. Add the overlay to your template
 * // <FlyingCardsOverlay :flying-cards="flyingElements" />
 * ```
 *
 * Elements will automatically fly between containers when they move in game state.
 */
import { watch, computed, type Ref, type ComputedRef } from 'vue';
import { useFlyingCards, type FlyingCardData } from './useFlyingCards.js';

export interface ElementContainerConfig {
  /** The game element (computed or ref) representing this container */
  element: ComputedRef<any> | Ref<any>;
  /** The DOM element ref for animation positioning */
  ref: Ref<HTMLElement | null>;
  /** Optional: custom element size for this container */
  elementSize?: { width: number; height: number };
}

export interface AutoFlyingElementsOptions {
  /** Function that returns the current game view */
  gameView: () => any;

  /** Containers to track - elements moving between these will animate */
  containers: ElementContainerConfig[] | (() => ElementContainerConfig[]);

  /**
   * Function to extract display data from a game element.
   * For cards: return rank, suit, faceImage, backImage
   * For pieces: return playerPosition (triggers circular piece rendering)
   */
  getElementData?: (element: any) => FlyingCardData;

  /** Animation duration in ms (default: 400) */
  duration?: number;

  /** Default element size if not specified per-container (default: 60x84) */
  elementSize?: { width: number; height: number };

  /**
   * Whether to flip elements during animation.
   * - 'toPrivate': flip when moving to face-down container (e.g., discard)
   * - 'toPublic': flip when moving to face-up container (e.g., hand from deck)
   * - 'never': never flip
   * - Function: custom logic per movement
   * Default: 'never'
   */
  flip?: 'toPrivate' | 'toPublic' | 'never' | ((from: ElementContainerConfig, to: ElementContainerConfig) => boolean);
}

export interface AutoFlyingElementsReturn {
  /** Reactive array of currently flying elements - pass to FlyingCardsOverlay */
  flyingElements: ComputedRef<any[]>;
}

/**
 * Get all child element IDs from a container element
 */
function getChildIds(container: any): Set<number> {
  const ids = new Set<number>();
  if (container?.children) {
    for (const child of container.children) {
      if (typeof child.id === 'number') {
        ids.add(child.id);
      }
    }
  }
  return ids;
}

/**
 * Find an element by ID in a container's children
 */
function findChildById(container: any, id: number): any | null {
  if (container?.children) {
    for (const child of container.children) {
      if (child.id === id) {
        return child;
      }
    }
  }
  return null;
}

/**
 * Create automatic flying element animations between containers
 */
export function useAutoFlyingElements(options: AutoFlyingElementsOptions): AutoFlyingElementsReturn {
  const { flyingCards, flyCard } = useFlyingCards();

  const {
    gameView,
    containers: containersProp,
    getElementData = () => ({}),
    duration = 400,
    elementSize = { width: 60, height: 84 },
    flip = 'never',
  } = options;

  // Get current containers (supports static array or dynamic function)
  const getContainers = (): ElementContainerConfig[] => {
    return typeof containersProp === 'function' ? containersProp() : containersProp;
  };

  // Track which container each element was in (by element ID)
  // Map<elementId, containerIndex>
  const elementLocations = new Map<number, number>();

  // Build initial element locations
  function buildElementLocations(): Map<number, number> {
    const locations = new Map<number, number>();
    const containers = getContainers();

    for (let i = 0; i < containers.length; i++) {
      const container = containers[i];
      const element = container.element.value;
      if (element) {
        const childIds = getChildIds(element);
        for (const elemId of childIds) {
          locations.set(elemId, i);
        }
      }
    }

    return locations;
  }

  // Determine if we should flip based on options
  function shouldFlip(fromContainer: ElementContainerConfig, toContainer: ElementContainerConfig): boolean {
    if (typeof flip === 'function') {
      return flip(fromContainer, toContainer);
    }
    // For now, simple flip options don't have enough info - just return false
    return false;
  }

  // Watch the game view for changes
  const gameViewComputed = computed(() => gameView());

  watch(gameViewComputed, () => {
    const containers = getContainers();
    const newLocations = buildElementLocations();

    // Find elements that moved
    for (const [elemId, newContainerIndex] of newLocations) {
      const oldContainerIndex = elementLocations.get(elemId);

      // Element moved from one tracked container to another
      if (oldContainerIndex !== undefined && oldContainerIndex !== newContainerIndex) {
        const fromContainer = containers[oldContainerIndex];
        const toContainer = containers[newContainerIndex];

        const fromRef = fromContainer.ref.value;
        const toRef = toContainer.ref.value;

        if (fromRef && toRef) {
          // Get the element from the new container to extract display data
          const gameElement = findChildById(toContainer.element.value, elemId);
          const elemData = gameElement ? getElementData(gameElement) : {};

          const size = toContainer.elementSize || fromContainer.elementSize || elementSize;

          flyCard({
            id: `auto-${elemId}-${Date.now()}`,
            startRect: fromRef.getBoundingClientRect(),
            endRect: () => toRef?.getBoundingClientRect() || fromRef.getBoundingClientRect(),
            cardData: elemData,
            flip: shouldFlip(fromContainer, toContainer),
            duration,
            cardSize: size,
          });
        }
      }
    }

    // Update tracked locations
    elementLocations.clear();
    for (const [elemId, containerIndex] of newLocations) {
      elementLocations.set(elemId, containerIndex);
    }
  }, { deep: true });

  return {
    flyingElements: flyingCards,
  };
}

// Re-export with old names for backward compatibility
export type {
  ElementContainerConfig as ContainerConfig,
  AutoFlyingElementsOptions as AutoFlyingCardsOptions,
  AutoFlyingElementsReturn as AutoFlyingCardsReturn,
};

/**
 * @deprecated Use useAutoFlyingElements instead
 */
export const useAutoFlyingCards = useAutoFlyingElements;
