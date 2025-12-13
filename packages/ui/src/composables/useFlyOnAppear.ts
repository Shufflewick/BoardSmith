/**
 * useFlyOnAppear - Composable for flying cards when they appear
 *
 * Watches for an element to become visible and automatically triggers
 * a fly animation from a source element to a target element.
 *
 * Common use cases:
 * - Starter card appearing from deck
 * - Cards being dealt from deck to hands
 * - Cards moving from one zone to another
 *
 * Usage:
 * ```typescript
 * const deckRef = ref<HTMLElement | null>(null);
 * const starterRef = ref<HTMLElement | null>(null);
 * const starterCard = computed(() => findFirstCard(starterElement));
 *
 * const { isFlying } = useFlyOnAppear({
 *   sourceRef: deckRef,
 *   targetRef: starterRef,
 *   element: starterCard,
 *   getCardData: (el) => ({ rank: el.attributes.rank, suit: el.attributes.suit }),
 *   flip: true,
 * });
 *
 * // In template, hide actual element while flying:
 * // <div v-if="starterCard && !isFlying">...</div>
 * ```
 */
import { ref, watch, type Ref, type ComputedRef } from 'vue';
import { useFlyingCards, type FlyCardOptions } from './useFlyingCards.js';
import { prefersReducedMotion } from './useElementAnimation.js';

export interface FlyOnAppearOptions<T> {
  /** Ref to the source element (where the card flies from) */
  sourceRef: Ref<HTMLElement | null>;
  /** Ref to the target element (where the card flies to) */
  targetRef: Ref<HTMLElement | null>;
  /** Reactive element that triggers the animation when it becomes truthy */
  element: ComputedRef<T | null | undefined> | Ref<T | null | undefined>;
  /** Function to extract card data from the element */
  getCardData: (element: T) => { rank?: string; suit?: string; faceImage?: unknown; backImage?: unknown };
  /** Whether to flip the card during flight (default: true) */
  flip?: boolean;
  /** Whether the card starts face up (default: false - starts face down) */
  startFaceUp?: boolean;
  /** Animation duration in ms (default: 500) */
  duration?: number;
  /** Card dimensions (default: { width: 60, height: 84 }) */
  cardSize?: { width: number; height: number };
  /** Callback when animation starts */
  onStart?: () => void;
  /** Callback when animation completes */
  onComplete?: () => void;
}

export interface FlyOnAppearReturn {
  /** Whether an animation is currently in progress */
  isFlying: Ref<boolean>;
  /** The flyingCards array from useFlyingCards (for rendering overlay) */
  flyingCards: ReturnType<typeof useFlyingCards>['flyingCards'];
}

const DEFAULT_CARD_SIZE = { width: 60, height: 84 };
const DEFAULT_DURATION = 500;

export function useFlyOnAppear<T>(options: FlyOnAppearOptions<T>): FlyOnAppearReturn {
  const {
    sourceRef,
    targetRef,
    element,
    getCardData,
    flip = true,
    startFaceUp = false,
    duration = DEFAULT_DURATION,
    cardSize = DEFAULT_CARD_SIZE,
    onStart,
    onComplete,
  } = options;

  const isFlying = ref(false);
  const { flyingCards, flyCard } = useFlyingCards();

  // Watch for element appearing
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

      // Extract card data
      const cardData = getCardData(newElement);

      isFlying.value = true;
      onStart?.();

      await flyCard({
        id: `fly-appear-${Date.now()}`,
        startRect: sourceRect,
        endRect: () => targetRef.value?.getBoundingClientRect() ?? targetRect,
        cardData: {
          ...cardData,
          faceUp: startFaceUp,
        },
        flip,
        duration,
        cardSize,
      });

      isFlying.value = false;
      onComplete?.();
    }
  );

  return {
    isFlying,
    flyingCards,
  };
}
