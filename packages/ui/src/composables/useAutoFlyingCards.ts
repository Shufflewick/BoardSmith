/**
 * useAutoFlyingCards - Automatic flying card animations between containers
 *
 * This composable automatically animates cards when they move between
 * registered containers in the game state. No manual tracking needed.
 *
 * ## Usage
 *
 * ```typescript
 * // 1. Find your game elements (you probably already do this)
 * const deck = computed(() => findElement(gameView, { type: 'deck' }));
 * const myHand = computed(() => findPlayerHand(gameView, playerPosition));
 * const discard = computed(() => findElement(gameView, { className: 'DiscardPile' }));
 *
 * // 2. Create refs for the DOM elements
 * const deckRef = ref<HTMLElement | null>(null);
 * const handRef = ref<HTMLElement | null>(null);
 * const discardRef = ref<HTMLElement | null>(null);
 *
 * // 3. Set up auto-flying cards
 * const { flyingCards } = useAutoFlyingCards({
 *   gameView: () => props.gameView,
 *   containers: [
 *     { element: deck, ref: deckRef },
 *     { element: myHand, ref: handRef },
 *     { element: discard, ref: discardRef },
 *   ],
 *   getCardData: (card) => ({
 *     rank: card.attributes?.rank,
 *     suit: card.attributes?.suit,
 *   }),
 * });
 *
 * // 4. Add the overlay to your template
 * // <FlyingCardsOverlay :flying-cards="flyingCards" />
 * ```
 *
 * Cards will automatically fly between containers when they move in game state.
 */
import { watch, computed, type Ref, type ComputedRef } from 'vue';
import { useFlyingCards, type FlyingCardData } from './useFlyingCards.js';

export interface ContainerConfig {
  /** The game element (computed or ref) representing this container */
  element: ComputedRef<any> | Ref<any>;
  /** The DOM element ref for animation positioning */
  ref: Ref<HTMLElement | null>;
  /** Optional: custom card size for this container */
  cardSize?: { width: number; height: number };
}

export interface AutoFlyingCardsOptions {
  /** Function that returns the current game view */
  gameView: () => any;

  /** Containers to track - cards moving between these will animate */
  containers: ContainerConfig[] | (() => ContainerConfig[]);

  /**
   * Function to extract card display data from a game element.
   * Return rank, suit, backColor, faceImage, etc.
   */
  getCardData?: (element: any) => FlyingCardData;

  /** Animation duration in ms (default: 400) */
  duration?: number;

  /** Default card size if not specified per-container (default: 60x84) */
  cardSize?: { width: number; height: number };

  /**
   * Whether to flip cards during animation.
   * - 'toPrivate': flip when moving to face-down container (e.g., discard)
   * - 'toPublic': flip when moving to face-up container (e.g., hand from deck)
   * - 'never': never flip
   * - Function: custom logic per movement
   * Default: 'never'
   */
  flip?: 'toPrivate' | 'toPublic' | 'never' | ((from: ContainerConfig, to: ContainerConfig) => boolean);
}

export interface AutoFlyingCardsReturn {
  /** Reactive array of currently flying cards - pass to FlyingCardsOverlay */
  flyingCards: ComputedRef<any[]>;
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
 * Create automatic flying card animations between containers
 */
export function useAutoFlyingCards(options: AutoFlyingCardsOptions): AutoFlyingCardsReturn {
  const { flyingCards, flyCard } = useFlyingCards();

  const {
    gameView,
    containers: containersProp,
    getCardData = () => ({}),
    duration = 400,
    cardSize = { width: 60, height: 84 },
    flip = 'never',
  } = options;

  // Get current containers (supports static array or dynamic function)
  const getContainers = (): ContainerConfig[] => {
    return typeof containersProp === 'function' ? containersProp() : containersProp;
  };

  // Track which container each card was in (by element ID)
  // Map<cardId, containerIndex>
  const cardLocations = new Map<number, number>();

  // Build initial card locations
  function buildCardLocations(): Map<number, number> {
    const locations = new Map<number, number>();
    const containers = getContainers();

    for (let i = 0; i < containers.length; i++) {
      const container = containers[i];
      const element = container.element.value;
      if (element) {
        const childIds = getChildIds(element);
        for (const cardId of childIds) {
          locations.set(cardId, i);
        }
      }
    }

    return locations;
  }

  // Determine if we should flip based on options
  function shouldFlip(fromContainer: ContainerConfig, toContainer: ContainerConfig): boolean {
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
    const newLocations = buildCardLocations();

    // Find cards that moved
    for (const [cardId, newContainerIndex] of newLocations) {
      const oldContainerIndex = cardLocations.get(cardId);

      // Card moved from one tracked container to another
      if (oldContainerIndex !== undefined && oldContainerIndex !== newContainerIndex) {
        const fromContainer = containers[oldContainerIndex];
        const toContainer = containers[newContainerIndex];

        const fromRef = fromContainer.ref.value;
        const toRef = toContainer.ref.value;

        if (fromRef && toRef) {
          // Get the card element from the new container to extract display data
          const cardElement = findChildById(toContainer.element.value, cardId);
          const cardData = cardElement ? getCardData(cardElement) : {};

          const size = toContainer.cardSize || fromContainer.cardSize || cardSize;

          flyCard({
            id: `auto-${cardId}-${Date.now()}`,
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

    // Update tracked locations
    cardLocations.clear();
    for (const [cardId, containerIndex] of newLocations) {
      cardLocations.set(cardId, containerIndex);
    }
  }, { deep: true });

  return {
    flyingCards,
  };
}
