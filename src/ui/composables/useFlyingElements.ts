/**
 * useFlyingElements - Unified flying element animation composable
 *
 * Creates temporary "ghost" elements that animate from one position to another,
 * optionally flipping during the animation. Useful for:
 * - Discarding cards to a crib/pile
 * - Dealing cards to players
 * - Moving cards between zones
 * - Drawing cards from deck
 *
 * The animation tracks moving targets in real-time using requestAnimationFrame,
 * so if the target element moves during the animation, the element will follow.
 *
 * ## Flip Animation
 *
 * The `flip` option controls whether the element rotates during flight.
 * The `elementData.faceUp` controls the STARTING state:
 *
 * - `faceUp: true` + `flip: true` → Public to Private (front → back)
 *   Element starts showing front, flips to show back at end
 *
 * - `faceUp: false` + `flip: true` → Private to Public (back → front)
 *   Element starts showing back, flips to show front at end
 *
 * @example Manual flying
 * ```typescript
 * import { useFlyingElements } from 'boardsmith/ui';
 *
 * const { fly, flyMultiple, isAnimating, flyingElements } = useFlyingElements({
 *   duration: 400,
 *   holdDuration: 100,
 * });
 *
 * // Fly a single element
 * await fly({
 *   id: 'deal-card-1',
 *   startRect: deckElement.getBoundingClientRect(),
 *   endRect: () => handElement.getBoundingClientRect(),
 *   elementData: { rank: 'A', suit: 'S', faceUp: false },
 *   flip: true,
 * });
 *
 * // Fly multiple elements with stagger
 * await flyMultiple([config1, config2, config3], 50);
 * ```
 *
 * @example Fly on appear (declarative)
 * ```typescript
 * const deckRef = ref<HTMLElement | null>(null);
 * const starterRef = ref<HTMLElement | null>(null);
 * const starterCard = computed(() => findFirstCard(starterElement));
 *
 * const { flyOnAppear, flyingElements } = useFlyingElements();
 *
 * const { isFlying } = flyOnAppear({
 *   element: starterCard,
 *   sourceRef: deckRef,
 *   targetRef: starterRef,
 *   getElementData: (el) => ({ rank: el.rank, suit: el.suit }),
 *   flip: true,
 * });
 *
 * // Hide actual element while flying
 * // <div v-if="starterCard && !isFlying">...</div>
 * ```
 *
 * @example Auto-watch mode (replaces useAutoAnimations / useAutoFlyingElements)
 * ```typescript
 * const { flyingElements } = useFlyingElements({
 *   autoWatch: {
 *     gameView: () => props.gameView,
 *     containers: [
 *       { ref: handRef, name: 'hand' },
 *       { ref: playAreaRef, name: 'play-area' },
 *       { ref: cribRef, name: 'crib' },
 *     ],
 *     getElementData: (el) => ({
 *       rank: el.attributes?.rank,
 *       suit: el.attributes?.suit,
 *     }),
 *     // Optional: control when to flip
 *     shouldFlip: (from, to, el) => from === 'hand' && to === 'crib',
 *   },
 *   duration: 400,
 * });
 * ```
 *
 * @example With overlay component
 * ```vue
 * <FlyingCardsOverlay :flying-cards="flyingElements" />
 * ```
 */

import { ref, computed, watch, onUnmounted, type Ref, type ComputedRef } from 'vue';
import { prefersReducedMotion } from './useElementAnimation.js';
import { easeOutCubic } from '../../utils/easing.js';

/**
 * Game element type for auto-watch mode
 */
export interface AutoWatchGameElement {
  id: number;
  name?: string;
  className?: string;
  attributes?: Record<string, unknown>;
  children?: AutoWatchGameElement[];
  childCount?: number;
  __hidden?: boolean;
}

/**
 * Data about a flying element for rendering
 */
export interface FlyingCardData {
  /** Card rank (e.g., 'A', '2', 'K') */
  rank?: string;
  /** Card suit (e.g., 'H', 'D', 'C', 'S') */
  suit?: string;
  /** Whether the element starts face up */
  faceUp?: boolean;
  /** Custom back color/gradient (e.g., '#1a1a2e' or 'linear-gradient(...)') */
  backColor?: string;
  /** Face image - URL string or sprite object */
  faceImage?: string | { sprite: string; x: number; y: number; width?: number; height?: number };
  /** Back image - URL string or sprite object */
  backImage?: string | { sprite: string; x: number; y: number; width?: number; height?: number };
  /** Player seat who owns this element (for piece rendering) */
  playerSeat?: number;
  /** Any additional data for custom rendering */
  [key: string]: unknown;
}

/**
 * A flying element in the animation system
 */
export interface FlyingCard {
  /** Unique identifier for this flying element */
  id: string;
  /** Element data for rendering */
  cardData: FlyingCardData;
  /** Current position/transform style */
  style: {
    position: 'fixed';
    left: string;
    top: string;
    width: string;
    height: string;
    transform: string;
    transition: string;
    zIndex: number;
    pointerEvents: 'none';
    opacity?: number;
  };
  /** Whether the element is currently flipped (face down) */
  isFlipped: boolean;
  /** Animation progress (0-1) */
  progress: number;
}

/**
 * Configuration for a flying element
 */
export interface FlyConfig {
  /** Unique identifier for this flight */
  id: string;

  /** Starting position (DOMRect, element, or function returning either) */
  startRect: DOMRect | HTMLElement | (() => DOMRect | HTMLElement | null);

  /** Ending position (use function to track moving targets) */
  endRect: DOMRect | HTMLElement | (() => DOMRect | HTMLElement | null);

  /** Data about the element being animated (for rendering) */
  elementData: FlyingCardData;

  /** Whether to flip the element during flight (default: false) */
  flip?: boolean;

  /** Animation duration in ms (overrides default) */
  duration?: number;

  /** Z-index for the flying element (default: 1000) */
  zIndex?: number;

  /** Element dimensions (default: 60x84) */
  elementSize?: { width: number; height: number };

  /** Hold duration at end position before removing (default: 0) */
  holdDuration?: number;

  /** Callback when position animation completes (before hold) */
  onPositionComplete?: () => void;

  /** Skip fade-out during hold (for 3D flip compatibility) */
  skipFadeOut?: boolean;
}

/**
 * Legacy FlyCardOptions type for backwards compatibility
 * @deprecated Use FlyConfig instead
 */
export interface FlyCardOptions {
  id: string;
  startRect: DOMRect | HTMLElement;
  endRect: DOMRect | HTMLElement | (() => DOMRect | HTMLElement | null);
  cardData: FlyingCardData;
  flip?: boolean;
  duration?: number;
  zIndex?: number;
  cardSize?: { width: number; height: number };
  holdDuration?: number;
  onPositionComplete?: () => void;
  skipFadeOut?: boolean;
}

/**
 * Options for the flyOnAppear helper
 */
export interface FlyOnAppearOptions<T> {
  /** Reactive element that triggers the animation when it becomes truthy */
  element: Ref<T | null | undefined> | ComputedRef<T | null | undefined>;

  /** Ref to the source element (where the element flies from) */
  sourceRef: Ref<HTMLElement | null>;

  /** Ref to the target element (where the element flies to) */
  targetRef: Ref<HTMLElement | null>;

  /** Function to extract element data for rendering */
  getElementData: (el: T) => FlyingCardData;

  /** Whether to flip the element during flight (default: true) */
  flip?: boolean;

  /** Animation duration in ms (default: 500) */
  duration?: number;

  /** Element dimensions (default: { width: 60, height: 84 }) */
  elementSize?: { width: number; height: number };

  /** Callback when animation starts */
  onStart?: () => void;

  /** Callback when animation completes */
  onComplete?: () => void;
}

/**
 * Container configuration for auto-watch mode
 */
export interface AutoWatchContainer {
  /** Ref to the container DOM element */
  ref: Ref<HTMLElement | null>;

  /** Unique name for this container (used for tracking and shouldFlip) */
  name: string;

  /**
   * CSS selector for elements within this container.
   * Defaults to '[data-element-id]'.
   */
  selector?: string;

  /**
   * Game element that corresponds to this container.
   * Used for matching elements in the game view tree.
   * Can be a reactive getter for dynamic matching.
   */
  element?: AutoWatchGameElement | (() => AutoWatchGameElement | null | undefined);
}

/**
 * Count-based route for tracking hidden element movements
 */
export interface CountBasedRoute {
  /** Source container name */
  from: string;

  /** Destination container name */
  to: string;

  /** Function to get element data for the flying element */
  getElementData?: () => FlyingCardData;

  /** Whether to flip during this transition */
  flip?: boolean;
}

/**
 * Auto-watch configuration for automatic cross-container flying animations
 */
export interface AutoWatchOptions {
  /**
   * Reactive getter for the game view tree.
   * The watcher will trigger when this changes.
   */
  gameView: () => AutoWatchGameElement | null | undefined;

  /**
   * Container configurations for tracking element positions.
   */
  containers: AutoWatchContainer[];

  /**
   * Extract element data for rendering the flying element.
   * Called when an element moves between containers.
   */
  getElementData: (element: AutoWatchGameElement) => FlyingCardData;

  /**
   * Determine whether to flip during a transition.
   * Receives source container name, destination container name, and element.
   * Default: flip when visibility changes (hidden → visible or visible → hidden).
   */
  shouldFlip?: (from: string, to: string, element: AutoWatchGameElement) => boolean;

  /**
   * Routes for tracking elements that become hidden.
   * When elements disappear from a container and another container's count increases,
   * fly from source to destination.
   */
  countBasedRoutes?: CountBasedRoute[];

  /**
   * Animation duration for auto-watch animations.
   * Overrides the default duration.
   */
  duration?: number;

  /**
   * Stagger delay between multiple simultaneous animations (default: 50ms).
   */
  staggerMs?: number;
}

/**
 * Options for useFlyingElements composable
 */
export interface UseFlyingElementsOptions {
  /** Default animation duration in ms (default: 400) */
  duration?: number;

  /** Default hold duration at end position (default: 0) */
  holdDuration?: number;

  /** Default element size (default: { width: 60, height: 84 }) */
  elementSize?: { width: number; height: number };

  /**
   * Auto-watch configuration for automatic cross-container flying animations.
   * When provided, the composable will watch the game view and automatically
   * trigger flying animations when elements move between containers.
   */
  autoWatch?: AutoWatchOptions;
}

/**
 * Return type for useFlyingElements composable
 */
export interface UseFlyingElementsReturn {
  /** Fly a single element from start to end position */
  fly: (config: FlyConfig) => Promise<void>;

  /** Fly multiple elements with optional stagger delay */
  flyMultiple: (configs: FlyConfig[], staggerMs?: number) => Promise<void>;

  /**
   * Declarative "fly when element appears" helper.
   * Encapsulates the watch, null checks, reduced motion check, and state management.
   */
  flyOnAppear: <T>(options: FlyOnAppearOptions<T>) => { isFlying: Ref<boolean> };

  /** Whether any flying animation is currently running */
  isAnimating: Ref<boolean>;

  /** Currently active flying elements (for rendering in overlay) */
  flyingElements: ComputedRef<FlyingCard[]>;

  /**
   * Legacy flyCard method for backwards compatibility
   * @deprecated Use fly() instead
   */
  flyCard: (options: FlyCardOptions) => Promise<void>;

  /**
   * Legacy flyCards method for backwards compatibility
   * @deprecated Use flyMultiple() instead
   */
  flyCards: (options: FlyCardOptions[], staggerMs?: number) => Promise<void>;

  /** Cancel all active flying animations */
  cancelAll: () => void;
}

const DEFAULT_DURATION = 400;
const DEFAULT_HOLD_DURATION = 0;
const DEFAULT_ELEMENT_SIZE = { width: 60, height: 84 };
const DEFAULT_Z_INDEX = 1000;

/**
 * Get DOMRect from various input types
 */
function getRect(
  target: DOMRect | HTMLElement | (() => DOMRect | HTMLElement | null)
): DOMRect | null {
  if (typeof target === 'function') {
    const result = target();
    if (!result) return null;
    return result instanceof DOMRect ? result : result.getBoundingClientRect();
  }
  return target instanceof DOMRect ? target : target.getBoundingClientRect();
}

/**
 * Normalize a rect input to a DOMRect or HTMLElement.
 * Throws if function returns null.
 */
function normalizeRect(
  input: DOMRect | HTMLElement | (() => DOMRect | HTMLElement | null)
): DOMRect | HTMLElement {
  if (typeof input === 'function') {
    const result = input();
    if (!result) {
      throw new Error('Flying element start position returned null');
    }
    return result;
  }
  return input;
}

/**
 * Unified flying elements composable.
 *
 * Provides methods for flying elements between positions with optional flipping.
 *
 * @param options - Configuration options
 * @returns Flying element controls
 */
export function useFlyingElements(
  options: UseFlyingElementsOptions = {}
): UseFlyingElementsReturn {
  const {
    duration: defaultDuration = DEFAULT_DURATION,
    holdDuration: defaultHoldDuration = DEFAULT_HOLD_DURATION,
    elementSize: defaultElementSize = DEFAULT_ELEMENT_SIZE,
  } = options;

  const flyingCards = ref<FlyingCard[]>([]);
  const activeAnimations = new Map<string, { cancel: () => void }>();
  const isAnimating = ref(false);

  /**
   * Core flying animation implementation
   */
  async function flyCardInternal(flyOptions: FlyCardOptions): Promise<void> {
    // Skip animation if reduced motion preferred
    if (prefersReducedMotion.value) {
      return;
    }

    const {
      id,
      startRect: startTarget,
      endRect: endTarget,
      cardData,
      flip = false,
      duration = defaultDuration,
      zIndex = DEFAULT_Z_INDEX,
      cardSize,
      holdDuration = defaultHoldDuration,
      onPositionComplete,
      skipFadeOut = false,
    } = flyOptions;

    const startRect = getRect(startTarget);
    if (!startRect) return;

    // Use explicit card size if provided, otherwise use default
    const cardWidth = cardSize?.width ?? defaultElementSize.width;
    const cardHeight = cardSize?.height ?? defaultElementSize.height;

    // Calculate start position - center the element on the start rect's center
    const startCenterX = startRect.left + startRect.width / 2;
    const startCenterY = startRect.top + startRect.height / 2;
    const startX = startCenterX - cardWidth / 2;
    const startY = startCenterY - cardHeight / 2;

    // Determine starting flip state based on cardData.faceUp
    const startFlipped = cardData.faceUp === false;

    // Create the flying element at start position
    const flyingCard: FlyingCard = {
      id,
      cardData,
      style: {
        position: 'fixed',
        left: `${startX}px`,
        top: `${startY}px`,
        width: `${cardWidth}px`,
        height: `${cardHeight}px`,
        transform: 'rotateY(0deg)',
        transition: 'none',
        zIndex,
        pointerEvents: 'none',
      },
      isFlipped: startFlipped,
      progress: 0,
    };

    flyingCards.value = [...flyingCards.value, flyingCard];
    isAnimating.value = true;

    return new Promise<void>((resolve) => {
      let cancelled = false;
      let animationFrameId: number;
      const startTime = performance.now();

      const cancel = () => {
        cancelled = true;
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
        }
        flyingCards.value = flyingCards.value.filter((c) => c.id !== id);
        activeAnimations.delete(id);
        updateAnimatingState();
        resolve();
      };

      activeAnimations.set(id, { cancel });

      function animate(currentTime: number) {
        if (cancelled) return;

        const elapsed = currentTime - startTime;
        const rawProgress = Math.min(elapsed / duration, 1);
        const progress = easeOutCubic(rawProgress);

        // Get current end position (may have moved)
        const endRect = getRect(endTarget);
        if (!endRect) {
          // Target disappeared, complete the animation
          flyingCards.value = flyingCards.value.filter((c) => c.id !== id);
          activeAnimations.delete(id);
          updateAnimatingState();
          resolve();
          return;
        }

        // Calculate current position (interpolate from start to current end)
        const endCenterX = endRect.left + endRect.width / 2;
        const endCenterY = endRect.top + endRect.height / 2;

        const currentCenterX = startCenterX + (endCenterX - startCenterX) * progress;
        const currentCenterY = startCenterY + (endCenterY - startCenterY) * progress;

        const currentX = currentCenterX - cardWidth / 2;
        const currentY = currentCenterY - cardHeight / 2;

        // Flip rotation
        const flipRotation = flip ? progress * 180 : 0;

        // Update the card
        const cardIndex = flyingCards.value.findIndex((c) => c.id === id);
        if (cardIndex >= 0) {
          const updated = [...flyingCards.value];
          updated[cardIndex] = {
            ...updated[cardIndex],
            style: {
              ...updated[cardIndex].style,
              left: `${currentX}px`,
              top: `${currentY}px`,
              transform: `rotateY(${flipRotation}deg)`,
            },
            progress,
          };
          flyingCards.value = updated;
        }

        if (rawProgress < 1) {
          animationFrameId = requestAnimationFrame(animate);
        } else if (holdDuration > 0) {
          // Position animation complete, notify caller
          onPositionComplete?.();

          if (skipFadeOut) {
            // Hide instantly - useful for 3D flip animations
            flyingCards.value = flyingCards.value.filter((c) => c.id !== id);
            activeAnimations.delete(id);
            updateAnimatingState();
            resolve();
          } else {
            // Start hold/fade-out phase
            const holdStartTime = performance.now();

            function animateHold(currentTime: number) {
              if (cancelled) return;

              const holdElapsed = currentTime - holdStartTime;
              const holdProgress = Math.min(holdElapsed / holdDuration, 1);
              const opacity = 1 - holdProgress;

              const cardIndex = flyingCards.value.findIndex((c) => c.id === id);
              if (cardIndex >= 0) {
                const updated = [...flyingCards.value];
                updated[cardIndex] = {
                  ...updated[cardIndex],
                  style: {
                    ...updated[cardIndex].style,
                    opacity,
                  },
                };
                flyingCards.value = updated;
              }

              if (holdProgress < 1) {
                animationFrameId = requestAnimationFrame(animateHold);
              } else {
                flyingCards.value = flyingCards.value.filter((c) => c.id !== id);
                activeAnimations.delete(id);
                updateAnimatingState();
                resolve();
              }
            }

            animationFrameId = requestAnimationFrame(animateHold);
          }
        } else {
          // No hold, notify and remove immediately
          onPositionComplete?.();
          flyingCards.value = flyingCards.value.filter((c) => c.id !== id);
          activeAnimations.delete(id);
          updateAnimatingState();
          resolve();
        }
      }

      animationFrameId = requestAnimationFrame(animate);
    });
  }

  function updateAnimatingState() {
    isAnimating.value = flyingCards.value.length > 0;
  }

  /**
   * Fly a single element (new API)
   */
  async function fly(config: FlyConfig): Promise<void> {
    if (prefersReducedMotion.value) {
      return;
    }

    await flyCardInternal({
      id: config.id,
      startRect: normalizeRect(config.startRect),
      endRect: config.endRect,
      cardData: config.elementData,
      flip: config.flip,
      duration: config.duration ?? defaultDuration,
      zIndex: config.zIndex,
      cardSize: config.elementSize ?? defaultElementSize,
      holdDuration: config.holdDuration ?? defaultHoldDuration,
      onPositionComplete: config.onPositionComplete,
      skipFadeOut: config.skipFadeOut,
    });
  }

  /**
   * Fly multiple elements with optional stagger (new API)
   */
  async function flyMultiple(configs: FlyConfig[], staggerMs: number = 50): Promise<void> {
    if (prefersReducedMotion.value || configs.length === 0) {
      return;
    }

    const promises: Promise<void>[] = [];

    for (let i = 0; i < configs.length; i++) {
      if (staggerMs > 0 && i > 0) {
        await new Promise((r) => setTimeout(r, staggerMs));
      }
      promises.push(fly(configs[i]));
    }

    await Promise.all(promises);
  }

  /**
   * Declarative "fly when element appears" helper.
   * Sets up a watcher and triggers animation when element becomes truthy.
   */
  function flyOnAppear<T>(appearOptions: FlyOnAppearOptions<T>): { isFlying: Ref<boolean> } {
    const {
      element,
      sourceRef,
      targetRef,
      getElementData,
      flip = true,
      duration = 500,
      elementSize = defaultElementSize,
      onStart,
      onComplete,
    } = appearOptions;

    const isFlying = ref(false);

    watch(
      () => element.value,
      async (newElement, oldElement) => {
        // Only trigger when element becomes truthy (appears)
        if (!newElement || oldElement) return;

        // Skip if reduced motion preferred
        if (prefersReducedMotion.value) return;

        // Get source and target rects
        const sourceRect = sourceRef.value?.getBoundingClientRect();
        const targetRect = targetRef.value?.getBoundingClientRect();

        if (!sourceRect || !targetRect) return;

        // Extract element data
        const elementData = getElementData(newElement);

        isFlying.value = true;
        onStart?.();

        await fly({
          id: `fly-appear-${Date.now()}`,
          startRect: sourceRect,
          endRect: () => targetRef.value?.getBoundingClientRect() ?? targetRect,
          elementData,
          flip,
          duration,
          elementSize,
        });

        isFlying.value = false;
        onComplete?.();
      }
    );

    return { isFlying };
  }

  /**
   * Legacy flyCard method for backwards compatibility
   */
  async function flyCard(options: FlyCardOptions): Promise<void> {
    return flyCardInternal(options);
  }

  /**
   * Legacy flyCards method for backwards compatibility
   */
  async function flyCards(options: FlyCardOptions[], staggerMs = 50): Promise<void> {
    if (prefersReducedMotion.value) {
      return;
    }

    const promises: Promise<void>[] = [];

    for (let i = 0; i < options.length; i++) {
      if (staggerMs > 0 && i > 0) {
        await new Promise((r) => setTimeout(r, staggerMs));
      }
      promises.push(flyCardInternal(options[i]));
    }

    await Promise.all(promises);
  }

  /**
   * Cancel all active flying animations
   */
  function cancelAll(): void {
    for (const { cancel } of activeAnimations.values()) {
      cancel();
    }
    activeAnimations.clear();
    flyingCards.value = [];
    isAnimating.value = false;
  }

  // ============================================
  // Auto-watch mode implementation
  // ============================================

  if (options.autoWatch) {
    const {
      gameView,
      containers,
      getElementData: autoWatchGetElementData,
      shouldFlip,
      countBasedRoutes = [],
      duration: autoWatchDuration = defaultDuration,
      staggerMs = 50,
    } = options.autoWatch;

    // Track element locations: elementId -> containerName
    const elementLocations = new Map<number, string>();
    // Track element data for flying animations
    const elementDataCache = new Map<number, { element: AutoWatchGameElement; wasHidden: boolean }>();
    // Track container child counts for count-based routes
    const containerCounts = new Map<string, number>();

    /**
     * Find which container an element belongs to in the game view tree
     */
    function findElementContainer(
      element: AutoWatchGameElement,
      containerElements: Map<string, AutoWatchGameElement | null>
    ): string | null {
      for (const [name, containerEl] of containerElements) {
        if (containerEl && isDescendantOf(element, containerEl)) {
          return name;
        }
      }
      return null;
    }

    /**
     * Check if an element is a descendant of a container element
     */
    function isDescendantOf(element: AutoWatchGameElement, container: AutoWatchGameElement): boolean {
      if (!container.children) return false;

      for (const child of container.children) {
        if (child.id === element.id) return true;
        if (isDescendantOf(element, child)) return true;
      }
      return false;
    }

    /**
     * Collect all elements from the game view tree with their locations
     */
    function collectElements(
      root: AutoWatchGameElement,
      containerElements: Map<string, AutoWatchGameElement | null>,
      result: Map<number, { element: AutoWatchGameElement; container: string | null; isHidden: boolean }>
    ): void {
      const isHidden = root.__hidden === true || root.attributes?.__hidden === true;
      const container = findElementContainer(root, containerElements);

      // Only track elements that are in tracked containers or have been tracked before
      if (container || elementLocations.has(root.id)) {
        result.set(root.id, { element: root, container, isHidden });
      }

      if (root.children) {
        for (const child of root.children) {
          collectElements(child, containerElements, result);
        }
      }
    }

    /**
     * Get the game element for a container
     */
    function getContainerElement(container: AutoWatchContainer): AutoWatchGameElement | null {
      if (!container.element) return null;
      if (typeof container.element === 'function') {
        return container.element() ?? null;
      }
      return container.element;
    }

    /**
     * Count children in a container element
     */
    function countChildren(containerEl: AutoWatchGameElement | null): number {
      if (!containerEl) return 0;
      return containerEl.childCount ?? containerEl.children?.length ?? 0;
    }

    /**
     * Find element in game view tree by ID
     */
    function findElementById(root: AutoWatchGameElement | null, id: number): AutoWatchGameElement | null {
      if (!root) return null;
      if (root.id === id) return root;
      if (root.children) {
        for (const child of root.children) {
          const found = findElementById(child, id);
          if (found) return found;
        }
      }
      return null;
    }

    /**
     * Default shouldFlip: flip when visibility changes
     */
    function defaultShouldFlip(
      _from: string,
      _to: string,
      element: AutoWatchGameElement
    ): boolean {
      const cached = elementDataCache.get(element.id);
      const wasHidden = cached?.wasHidden ?? false;
      const isHidden = element.__hidden === true || element.attributes?.__hidden === true;
      return wasHidden !== isHidden;
    }

    const stopWatcher = watch(
      gameView,
      async (newView, oldView) => {
        if (!newView) return;
        if (prefersReducedMotion.value) return;

        // Build container element map
        const containerElements = new Map<string, AutoWatchGameElement | null>();
        for (const container of containers) {
          containerElements.set(container.name, getContainerElement(container));
        }

        // Collect current element states
        const currentElements = new Map<number, { element: AutoWatchGameElement; container: string | null; isHidden: boolean }>();
        collectElements(newView, containerElements, currentElements);

        // Collect current container counts
        const currentCounts = new Map<string, number>();
        for (const container of containers) {
          const el = getContainerElement(container);
          currentCounts.set(container.name, countChildren(el));
        }

        // Skip on first run (no old state)
        if (!oldView) {
          // Initialize tracking state
          for (const [id, { container, element, isHidden }] of currentElements) {
            if (container) {
              elementLocations.set(id, container);
              elementDataCache.set(id, { element, wasHidden: isHidden });
            }
          }
          for (const [name, count] of currentCounts) {
            containerCounts.set(name, count);
          }
          return;
        }

        const flyConfigs: FlyConfig[] = [];

        // Check for elements that moved between containers
        for (const [id, { element, container: newContainer, isHidden }] of currentElements) {
          const oldContainer = elementLocations.get(id);

          if (oldContainer && newContainer && oldContainer !== newContainer) {
            // Element moved between containers - trigger fly animation
            const fromContainerConfig = containers.find((c) => c.name === oldContainer);
            const toContainerConfig = containers.find((c) => c.name === newContainer);

            if (fromContainerConfig?.ref.value && toContainerConfig?.ref.value) {
              const shouldFlipFn = shouldFlip ?? defaultShouldFlip;
              const flip = shouldFlipFn(oldContainer, newContainer, element);
              const elementData = autoWatchGetElementData(element);

              flyConfigs.push({
                id: `auto-fly-${id}-${Date.now()}`,
                startRect: fromContainerConfig.ref.value.getBoundingClientRect(),
                endRect: () => toContainerConfig.ref.value?.getBoundingClientRect() ?? null,
                elementData,
                flip,
                duration: autoWatchDuration,
              });
            }
          }

          // Update tracking
          if (newContainer) {
            elementLocations.set(id, newContainer);
          }
          elementDataCache.set(id, { element, wasHidden: isHidden });
        }

        // Check for elements that disappeared (visible → hidden or removed)
        for (const [id, oldContainer] of elementLocations) {
          if (!currentElements.has(id)) {
            // Element disappeared - check count-based routes
            const cachedData = elementDataCache.get(id);

            for (const route of countBasedRoutes) {
              if (route.from !== oldContainer) continue;

              const oldCount = containerCounts.get(route.to) ?? 0;
              const newCount = currentCounts.get(route.to) ?? 0;

              if (newCount > oldCount) {
                // Destination gained children - fly from source to destination
                const fromContainerConfig = containers.find((c) => c.name === route.from);
                const toContainerConfig = containers.find((c) => c.name === route.to);

                if (fromContainerConfig?.ref.value && toContainerConfig?.ref.value) {
                  const elementData = route.getElementData?.() ??
                    (cachedData ? autoWatchGetElementData(cachedData.element) : { faceUp: false });

                  flyConfigs.push({
                    id: `auto-fly-count-${id}-${Date.now()}`,
                    startRect: fromContainerConfig.ref.value.getBoundingClientRect(),
                    endRect: () => toContainerConfig.ref.value?.getBoundingClientRect() ?? null,
                    elementData,
                    flip: route.flip ?? true,
                    duration: autoWatchDuration,
                  });
                }
              }
            }

            // Remove from tracking
            elementLocations.delete(id);
            elementDataCache.delete(id);
          }
        }

        // Check for elements that appeared (hidden → visible or new)
        for (const [id, { element, container, isHidden }] of currentElements) {
          if (!elementLocations.has(id) && container && !isHidden) {
            // New visible element - check count-based routes for source
            for (const route of countBasedRoutes) {
              if (route.to !== container) continue;

              const oldCount = containerCounts.get(route.from) ?? 0;
              const newCount = currentCounts.get(route.from) ?? 0;

              if (newCount < oldCount) {
                // Source lost children - fly from source to this element
                const fromContainerConfig = containers.find((c) => c.name === route.from);
                const toContainerConfig = containers.find((c) => c.name === container);

                if (fromContainerConfig?.ref.value && toContainerConfig?.ref.value) {
                  const elementData = autoWatchGetElementData(element);

                  flyConfigs.push({
                    id: `auto-fly-appear-${id}-${Date.now()}`,
                    startRect: fromContainerConfig.ref.value.getBoundingClientRect(),
                    endRect: () => toContainerConfig.ref.value?.getBoundingClientRect() ?? null,
                    elementData: { ...elementData, faceUp: false },
                    flip: route.flip ?? true,
                    duration: autoWatchDuration,
                  });
                }
              }
            }

            // Add to tracking
            elementLocations.set(id, container);
            elementDataCache.set(id, { element, wasHidden: isHidden });
          }
        }

        // Update container counts
        for (const [name, count] of currentCounts) {
          containerCounts.set(name, count);
        }

        // Execute fly animations
        if (flyConfigs.length > 0) {
          await flyMultiple(flyConfigs, staggerMs);
        }
      },
      { deep: false }
    );

    // Cleanup on unmount
    onUnmounted(() => {
      stopWatcher();
      cancelAll();
    });
  }

  return {
    fly,
    flyMultiple,
    flyOnAppear,
    isAnimating,
    flyingElements: computed(() => flyingCards.value),
    // Legacy methods
    flyCard,
    flyCards,
    cancelAll,
  };
}

// Re-export legacy types for backwards compatibility
export type { FlyingCard as FlyingCardsReturn };
