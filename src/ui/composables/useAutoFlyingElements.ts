/**
 * useAutoFlyingElements - Automatic flying element animations between containers
 *
 * This composable automatically animates elements (cards, pieces, tokens) when
 * they move between registered containers in the game state. No manual tracking needed.
 *
 * Works with any element type - cards, checkers pieces, chess pieces, tokens, etc.
 * The rendering is determined by the data returned from getElementData:
 * - Cards: provide rank, suit, faceImage, backImage
 * - Pieces: provide playerSeat (triggers circular piece rendering)
 *
 * ## Usage
 *
 * ```typescript
 * // 1. Find your game elements (you probably already do this)
 * const deck = computed(() => findElement(gameView, { type: 'deck' }));
 * const myHand = computed(() => findPlayerHand(gameView, playerSeat));
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
 *     playerSeat: element.attributes?.player?.seat,
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
import { watch, computed, onUnmounted, getCurrentInstance, type Ref, type ComputedRef } from 'vue';
import { useFlyingCards, type FlyingCardData } from './useFlyingCards.js';
import { useBoardInteraction } from './useBoardInteraction.js';

export interface ElementContainerConfig {
  /** The game element (computed or ref) representing this container */
  element: ComputedRef<any> | Ref<any>;
  /** The DOM element ref for animation positioning */
  ref: Ref<HTMLElement | null>;
  /** Optional: custom element size for this container */
  elementSize?: { width: number; height: number };
  /** Optional: unique name for this container (used for countBasedRoutes) */
  name?: string;
}

export interface CountBasedRoute {
  /** Name of the source container */
  from: string;
  /** Name of the destination container */
  to: string;
  /** Card data to use for the flying animation (since we can't get it from the moved element). Can be static or a function. */
  cardData?: FlyingCardData | (() => FlyingCardData);
}

export interface AutoFlyingElementsOptions {
  /** Function that returns the current game view */
  gameView: () => any;

  /** Containers to track - elements moving between these will animate */
  containers: ElementContainerConfig[] | (() => ElementContainerConfig[]);

  /**
   * Function to extract display data from a game element.
   * For cards: return rank, suit, faceImage, backImage
   * For pieces: return playerSeat (triggers circular piece rendering)
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

  /**
   * Routes for count-based animation detection.
   * Use this when elements moving between containers get new IDs (e.g., moving to hidden areas).
   * When N elements disappear from 'from' and N elements appear in 'to', animate N cards flying.
   * Containers must have 'name' set to use this feature.
   */
  countBasedRoutes?: CountBasedRoute[];

  /**
   * Function that returns additional element IDs to skip animating.
   * Note: Drag-dropped elements are automatically skipped - this is for additional custom cases.
   */
  skipIds?: () => number[];
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

  // Get board interaction to automatically skip drag-dropped elements
  const boardInteraction = useBoardInteraction();

  const {
    gameView,
    containers: containersProp,
    getElementData = () => ({}),
    duration = 400,
    elementSize = { width: 60, height: 84 },
    flip = 'never',
    countBasedRoutes = [],
    skipIds,
  } = options;

  // Get current containers (supports static array or dynamic function)
  const getContainers = (): ElementContainerConfig[] => {
    return typeof containersProp === 'function' ? containersProp() : containersProp;
  };

  // Track which container each element was in (by element ID)
  // Map<elementId, containerIndex>
  const elementLocations = new Map<number, number>();

  // Track container counts for count-based animation
  // Map<containerName, count>
  const containerCounts = new Map<string, number>();

  // Build container counts by name
  function buildContainerCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    const containers = getContainers();

    for (const container of containers) {
      if (container.name) {
        const childCount = container.element.value?.children?.length ?? 0;
        counts.set(container.name, childCount);
      }
    }

    return counts;
  }

  // Find container by name
  function findContainerByName(name: string): ElementContainerConfig | undefined {
    return getContainers().find(c => c.name === name);
  }

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

  // Initialize element locations on first access
  let initialized = false;

  const stopWatch = watch(gameViewComputed, () => {
    // On first watch trigger, just populate locations without animating
    if (!initialized) {
      initialized = true;
      const initialLocations = buildElementLocations();
      const initialCounts = buildContainerCounts();
      for (const [elemId, containerIndex] of initialLocations) {
        elementLocations.set(elemId, containerIndex);
      }
      for (const [name, count] of initialCounts) {
        containerCounts.set(name, count);
      }
      return;
    }
    const containers = getContainers();
    const newLocations = buildElementLocations();

    // Get IDs to skip - automatically includes drag-dropped elements + any custom skipIds
    const idsToSkip = new Set<number>();

    // Automatically skip elements that were just drag-dropped (the drag gesture is the visual feedback)
    const lastDroppedId = boardInteraction?.lastDroppedElementId;
    if (lastDroppedId !== undefined && lastDroppedId !== null) {
      idsToSkip.add(lastDroppedId);
    }

    // Add any additional custom skipIds
    if (skipIds) {
      for (const id of skipIds()) {
        idsToSkip.add(id);
      }
    }

    // Find elements that moved
    for (const [elemId, newContainerIndex] of newLocations) {
      const oldContainerIndex = elementLocations.get(elemId);

      // Element moved from one tracked container to another
      if (oldContainerIndex !== undefined && oldContainerIndex !== newContainerIndex) {
        // Skip animation for elements that were just drag-dropped
        if (idsToSkip.has(elemId)) {
          continue;
        }

        const fromContainer = containers[oldContainerIndex];
        const toContainer = containers[newContainerIndex];

        const fromRef = fromContainer?.ref?.value;
        const toRef = toContainer?.ref?.value;

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

    // Count-based animation for routes where IDs change (e.g., moving to hidden areas)
    if (countBasedRoutes.length > 0) {
      const newCounts = buildContainerCounts();

      for (const route of countBasedRoutes) {
        const fromContainer = findContainerByName(route.from);
        const toContainer = findContainerByName(route.to);

        if (!fromContainer || !toContainer) continue;

        const oldFromCount = containerCounts.get(route.from) ?? 0;
        const newFromCount = newCounts.get(route.from) ?? 0;
        const oldToCount = containerCounts.get(route.to) ?? 0;
        const newToCount = newCounts.get(route.to) ?? 0;

        const lostFromSource = oldFromCount - newFromCount;
        const gainedAtDest = newToCount - oldToCount;

        // If source lost N elements and dest gained N elements, animate N cards
        if (lostFromSource > 0 && gainedAtDest > 0) {
          const cardsToAnimate = Math.min(lostFromSource, gainedAtDest);
          const fromRef = fromContainer?.ref?.value;
          const toRef = toContainer?.ref?.value;

          if (fromRef && toRef) {
            const size = toContainer.elementSize || fromContainer.elementSize || elementSize;

            // Resolve cardData (can be static or function)
            const cardData = typeof route.cardData === 'function' ? route.cardData() : (route.cardData || {});

            for (let i = 0; i < cardsToAnimate; i++) {
              flyCard({
                id: `count-${route.from}-${route.to}-${Date.now()}-${i}`,
                startRect: fromRef.getBoundingClientRect(),
                endRect: () => toRef?.getBoundingClientRect() || fromRef.getBoundingClientRect(),
                cardData,
                flip: shouldFlip(fromContainer, toContainer),
                duration,
                cardSize: size,
              });
            }
          }
        }
      }

      // Update container counts
      containerCounts.clear();
      for (const [name, count] of newCounts) {
        containerCounts.set(name, count);
      }
    }

    // Update tracked locations
    elementLocations.clear();
    for (const [elemId, containerIndex] of newLocations) {
      elementLocations.set(elemId, containerIndex);
    }
  }, { deep: true });

  // Auto-cleanup: register onUnmounted if we're in a component setup context
  const instance = getCurrentInstance();
  if (instance) {
    onUnmounted(() => {
      stopWatch();
    });
  } else {
    console.warn(
      '[useAutoFlyingElements] Called outside of component setup(). ' +
      'Watchers will not be automatically cleaned up. ' +
      'This can cause errors if the component unmounts while watchers are still active.'
    );
  }

  return {
    flyingElements: flyingCards,
  };
}

