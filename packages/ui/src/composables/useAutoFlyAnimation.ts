/**
 * useAutoFlyAnimation - Automatic flying animations when elements leave a zone
 *
 * This composable provides a unified, foolproof way to animate elements
 * flying from a game zone to a player stat display. It automatically:
 * - Captures element positions and imagery BEFORE elements are removed
 * - Detects when elements leave the zone
 * - Flies them to the target player stat with correct imagery
 *
 * ## Setup
 *
 * 1. Add data attributes to your game elements:
 *    ```html
 *    <div
 *      data-element-id="123"
 *      data-face-image="/cards/ah.png"
 *      data-back-image="/cards/back.png"
 *      data-rank="A"
 *      data-suit="H"
 *      data-player-position="0"
 *    >...</div>
 *    ```
 *
 * 2. Add data attributes to your player stat targets:
 *    ```html
 *    <span data-player-stat="books" data-player-position="0">{{ count }}</span>
 *    ```
 *
 * 3. Use the composable in your game board:
 *    ```typescript
 *    const { flyingCards, watchZone } = useAutoFlyAnimation();
 *
 *    // Watch a zone for removals and fly to a stat
 *    watchZone({
 *      containerRef: myHandRef,
 *      gameView: () => props.gameView,
 *      getElementIds: (gv) => getHandCardIds(gv),
 *      targetStat: 'books',
 *      getTargetPlayer: (elementData) => props.playerPosition,
 *    });
 *    ```
 *
 * ## Data Attributes
 *
 * The system captures visual data from these standard data attributes:
 *
 * | Attribute | Purpose | Example |
 * |-----------|---------|---------|
 * | data-element-id | Unique ID for tracking | "123" |
 * | data-face-image | URL of card/piece face | "/cards/ah.png" |
 * | data-back-image | URL of card/piece back | "/cards/back.png" |
 * | data-rank | Card rank | "A", "K", "10" |
 * | data-suit | Card suit | "H", "D", "C", "S" |
 * | data-player-position | Owner position (0, 1, etc.) | "0" |
 * | data-face-up | Whether element shows face | "true" |
 *
 * ## Why This Works
 *
 * Previous implementations had these problems:
 * 1. Each game manually captured imagery, leading to inconsistencies
 * 2. Imagery was extracted from game state, which changes before animation
 * 3. No standard data contract between elements and animation system
 *
 * This solution:
 * 1. Uses DOM data attributes as the source of truth for imagery
 * 2. Captures data BEFORE state changes (using flush: 'sync' watcher)
 * 3. Provides standard attribute names all games can use
 * 4. Requires zero game-specific animation code
 */

import { ref, watch, type Ref, type ComputedRef, nextTick } from 'vue';
import { useFlyingCards, type FlyCardOptions } from './useFlyingCards.js';
import { getPlayerStatElement } from './usePlayerStatAnimation.js';
import { prefersReducedMotion } from './useElementAnimation.js';

/**
 * Data captured from a DOM element before it's removed
 */
export interface CapturedElementData {
  /** Element's bounding rectangle */
  rect: DOMRect;
  /** Face image URL (from data-face-image) */
  faceImage?: string;
  /** Back image URL (from data-back-image) */
  backImage?: string;
  /** Card rank (from data-rank) */
  rank?: string;
  /** Card suit (from data-suit) */
  suit?: string;
  /** Owner player position (from data-player-position) */
  playerPosition?: number;
  /** Whether showing face (from data-face-up) */
  faceUp?: boolean;
  /** Any additional custom data */
  [key: string]: unknown;
}

/**
 * Options for watching a zone for element removals
 */
export interface WatchZoneOptions<T = number> {
  /** Ref to the container DOM element */
  containerRef: Ref<HTMLElement | null>;

  /** CSS selector for elements to track (default: '[data-element-id]') */
  selector?: string;

  /** Function to extract element ID from DOM element */
  getElementId?: (el: Element) => T;

  /** Reactive game view to watch for changes */
  gameView: () => unknown;

  /** Function to get current element IDs from game view */
  getElementIds: (gameView: unknown) => Set<T>;

  /** Target stat name to fly to (e.g., 'books', 'captured', 'score') */
  targetStat: string;

  /**
   * Function to determine target player for a removed element.
   * Receives the captured element data.
   */
  getTargetPlayer: (elementData: CapturedElementData, elementId: T) => number;

  /** Animation duration in ms (default: 500) */
  duration?: number;

  /** Stagger delay between multiple elements (default: 50) */
  stagger?: number;

  /** Card size for animation (default: { width: 70, height: 100 }) */
  cardSize?: { width: number; height: number };

  /** Whether to flip cards during animation (default: false) */
  flip?: boolean;

  /**
   * Optional function to extract additional data from DOM element.
   * Called during position capture.
   */
  getElementData?: (el: Element) => Record<string, unknown>;

  /**
   * Whether elements start face up (default: true).
   * Used when data-face-up attribute is not present.
   */
  defaultFaceUp?: boolean;
}

export interface AutoFlyAnimationReturn {
  /** Flying cards array for rendering */
  flyingCards: ComputedRef<readonly import('./useFlyingCards.js').FlyingCard[]>;

  /**
   * Watch a zone for element removals and automatically fly them to target.
   * Returns a cleanup function.
   */
  watchZone: <T = number>(options: WatchZoneOptions<T>) => () => void;

  /** Manually trigger a fly animation */
  flyToStat: (options: {
    elements: CapturedElementData[];
    targetStat: string;
    targetPlayer: number;
    duration?: number;
    stagger?: number;
    cardSize?: { width: number; height: number };
    flip?: boolean;
  }) => Promise<void>;
}

/**
 * Capture visual data from a DOM element using standard data attributes
 */
function captureElementFromDOM(el: Element, extraData?: Record<string, unknown>): CapturedElementData {
  const rect = el.getBoundingClientRect();

  // Extract standard data attributes
  const faceImage = el.getAttribute('data-face-image') || undefined;
  const backImage = el.getAttribute('data-back-image') || undefined;
  const rank = el.getAttribute('data-rank') || undefined;
  const suit = el.getAttribute('data-suit') || undefined;
  const playerPosAttr = el.getAttribute('data-player-position');
  const playerPosition = playerPosAttr !== null ? parseInt(playerPosAttr, 10) : undefined;
  const faceUpAttr = el.getAttribute('data-face-up');
  const faceUp = faceUpAttr !== null ? faceUpAttr === 'true' : undefined;

  return {
    rect,
    faceImage,
    backImage,
    rank,
    suit,
    playerPosition,
    faceUp,
    ...extraData,
  };
}

/**
 * Create an auto-fly animation system
 */
export function useAutoFlyAnimation(): AutoFlyAnimationReturn {
  const { flyingCards, flyCards } = useFlyingCards();

  /**
   * Manually fly elements to a player stat
   */
  async function flyToStat(options: {
    elements: CapturedElementData[];
    targetStat: string;
    targetPlayer: number;
    duration?: number;
    stagger?: number;
    cardSize?: { width: number; height: number };
    flip?: boolean;
  }): Promise<void> {
    if (prefersReducedMotion.value || options.elements.length === 0) return;

    const {
      elements,
      targetStat,
      targetPlayer,
      duration = 500,
      stagger = 50,
      cardSize = { width: 70, height: 100 },
      flip = false,
    } = options;

    const targetEl = getPlayerStatElement(targetPlayer, targetStat);
    if (!targetEl) {
      console.warn(
        `[useAutoFlyAnimation] Target not found: player ${targetPlayer}, stat "${targetStat}". ` +
        `Add data-player-stat="${targetStat}" and data-player-position="${targetPlayer}" to target element.`
      );
      return;
    }

    const flyOptions: FlyCardOptions[] = elements.map((el, i) => ({
      id: `auto-fly-${targetStat}-${targetPlayer}-${Date.now()}-${i}`,
      startRect: el.rect,
      endRect: () => targetEl.getBoundingClientRect(),
      cardData: {
        rank: el.rank || '',
        suit: el.suit || '',
        faceUp: el.faceUp ?? true,
        faceImage: el.faceImage,
        backImage: el.backImage,
        playerPosition: el.playerPosition,
        // Include any extra custom data
        ...Object.fromEntries(
          Object.entries(el).filter(
            ([k]) => !['rect', 'rank', 'suit', 'faceUp', 'faceImage', 'backImage', 'playerPosition'].includes(k)
          )
        ),
      },
      flip,
      duration,
      cardSize,
    }));

    await flyCards(flyOptions, stagger);
  }

  /**
   * Watch a zone for element removals and automatically animate them
   */
  function watchZone<T = number>(options: WatchZoneOptions<T>): () => void {
    const {
      containerRef,
      selector = '[data-element-id]',
      getElementId = (el) => parseInt(el.getAttribute('data-element-id') || '0', 10) as unknown as T,
      gameView,
      getElementIds,
      targetStat,
      getTargetPlayer,
      duration = 500,
      stagger = 50,
      cardSize = { width: 70, height: 100 },
      flip = false,
      getElementData,
      defaultFaceUp = true,
    } = options;

    // Tracking state
    const prevIds = ref<Set<T>>(new Set()) as Ref<Set<T>>;
    const positions = ref<Map<T, CapturedElementData>>(new Map()) as Ref<Map<T, CapturedElementData>>;
    const isInitialized = ref(false);

    /**
     * Capture positions from DOM
     */
    function capturePositions(): void {
      positions.value.clear();
      if (!containerRef.value) return;

      const elements = containerRef.value.querySelectorAll(selector);
      elements.forEach((el) => {
        const id = getElementId(el);
        if (id !== null && id !== undefined) {
          const extraData = getElementData ? getElementData(el) : {};
          const captured = captureElementFromDOM(el, extraData);

          // Apply default faceUp if not set
          if (captured.faceUp === undefined) {
            captured.faceUp = defaultFaceUp;
          }

          positions.value.set(id, captured);
        }
      });
    }

    // Watch game view changes
    const stopWatch = watch(
      gameView,
      async () => {
        if (prefersReducedMotion.value) return;

        // Capture positions BEFORE Vue updates DOM
        const snapshotPrevIds = new Set(prevIds.value);
        capturePositions();

        // Wait for DOM to update
        await nextTick();
        await new Promise(r => setTimeout(r, 10));

        // Get current IDs from game view
        const gv = gameView();
        if (!gv) return;

        const currentIds = getElementIds(gv);

        // Initialize on first run
        if (!isInitialized.value) {
          prevIds.value = currentIds;
          isInitialized.value = true;
          return;
        }

        // Find removed elements
        const removedIds: T[] = [];
        for (const id of snapshotPrevIds) {
          if (!currentIds.has(id)) {
            removedIds.push(id);
          }
        }

        // Animate removed elements
        if (removedIds.length > 0) {
          // Group by target player
          const byPlayer = new Map<number, CapturedElementData[]>();

          for (const id of removedIds) {
            const data = positions.value.get(id);
            if (data) {
              const targetPlayer = getTargetPlayer(data, id);
              if (!byPlayer.has(targetPlayer)) {
                byPlayer.set(targetPlayer, []);
              }
              byPlayer.get(targetPlayer)!.push(data);
            }
          }

          // Fly to each player's stat
          for (const [player, elements] of byPlayer) {
            flyToStat({
              elements,
              targetStat,
              targetPlayer: player,
              duration,
              stagger,
              cardSize,
              flip,
            });
          }
        }

        // Update tracking
        prevIds.value = currentIds;
      },
      { flush: 'sync' }
    );

    return stopWatch;
  }

  return {
    flyingCards,
    watchZone,
    flyToStat,
  };
}

/**
 * Helper to create data attributes object for a card/piece element
 *
 * Usage in template:
 * ```vue
 * <div v-bind="getElementDataAttrs(card)">...</div>
 * ```
 */
export function getElementDataAttrs(options: {
  id: string | number;
  faceImage?: string;
  backImage?: string;
  rank?: string;
  suit?: string;
  playerPosition?: number;
  faceUp?: boolean;
}): Record<string, string | undefined> {
  return {
    'data-element-id': String(options.id),
    'data-face-image': options.faceImage,
    'data-back-image': options.backImage,
    'data-rank': options.rank,
    'data-suit': options.suit,
    'data-player-position': options.playerPosition !== undefined ? String(options.playerPosition) : undefined,
    'data-face-up': options.faceUp !== undefined ? String(options.faceUp) : undefined,
  };
}
