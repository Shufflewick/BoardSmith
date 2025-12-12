/**
 * useFlyingCards - Composable for animating cards flying between positions
 *
 * Creates temporary "ghost" cards that animate from one position to another,
 * optionally flipping during the animation. Useful for:
 * - Discarding cards to a crib/pile
 * - Dealing cards to players
 * - Moving cards between zones
 *
 * The animation tracks moving targets in real-time using requestAnimationFrame,
 * so if the target element moves during the animation, the card will follow.
 *
 * ## Flip Animation
 *
 * The `flip` option controls whether the card rotates during flight.
 * The `cardData.faceUp` controls the STARTING state:
 *
 * - `faceUp: true` + `flip: true` → Public to Private (front → back)
 *   Card starts showing front, flips to show back at end
 *
 * - `faceUp: false` + `flip: true` → Private to Public (back → front)
 *   Card starts showing back, flips to show front at end
 *
 * Usage:
 * ```typescript
 * const { flyingCards, flyCard } = useFlyingCards();
 *
 * // Drawing from deck (private → public): card starts face down, flips to face up
 * await flyCard({
 *   id: 'draw-card',
 *   startRect: deckElement.getBoundingClientRect(),
 *   endRect: () => handElement.getBoundingClientRect(),
 *   cardData: { rank: 'A', suit: 'S', faceUp: false },
 *   flip: true,
 * });
 *
 * // Discarding to crib (public → private): card starts face up, flips to face down
 * await flyCard({
 *   id: 'discard-card',
 *   startRect: cardElement.getBoundingClientRect(),
 *   endRect: () => cribElement.getBoundingClientRect(),
 *   cardData: { rank: 'A', suit: 'S', faceUp: true },
 *   flip: true,
 * });
 * ```
 *
 * In template:
 * ```vue
 * <FlyingCardsOverlay :flying-cards="flyingCards" />
 * ```
 */
import { ref, computed, type ComputedRef } from 'vue';
import { prefersReducedMotion } from './useElementAnimation.js';

export interface FlyingCardData {
  /** Card rank (e.g., 'A', '2', 'K') */
  rank?: string;
  /** Card suit (e.g., 'H', 'D', 'C', 'S') */
  suit?: string;
  /** Whether the card starts face up */
  faceUp?: boolean;
  /** Any additional data for custom rendering */
  [key: string]: unknown;
}

export interface FlyingCard {
  /** Unique identifier for this flying card */
  id: string;
  /** Card data for rendering */
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
  };
  /** Whether the card is currently flipped (face down) */
  isFlipped: boolean;
  /** Animation progress (0-1) */
  progress: number;
}

export interface FlyCardOptions {
  /** Unique identifier for tracking this animation */
  id: string;
  /** Starting position (DOMRect or element to get rect from) */
  startRect: DOMRect | HTMLElement;
  /** Ending position - use a function to track moving targets */
  endRect: DOMRect | HTMLElement | (() => DOMRect | HTMLElement | null);
  /** Card data for rendering the flying card */
  cardData: FlyingCardData;
  /** Whether to flip the card during flight (default: false) */
  flip?: boolean;
  /** Animation duration in ms (default: 400) */
  duration?: number;
  /** Z-index for the flying card (default: 1000) */
  zIndex?: number;
  /** Explicit card dimensions (if not provided, uses startRect dimensions) */
  cardSize?: { width: number; height: number };
}

export interface FlyingCardsReturn {
  /** Reactive array of currently flying cards (read-only) */
  flyingCards: ComputedRef<FlyingCard[]>;
  /** Start a single card flying animation */
  flyCard: (options: FlyCardOptions) => Promise<void>;
  /** Start multiple cards flying (staggered) */
  flyCards: (options: FlyCardOptions[], staggerMs?: number) => Promise<void>;
  /** Cancel all flying animations */
  cancelAll: () => void;
}

const DEFAULT_DURATION = 400;
const DEFAULT_Z_INDEX = 1000;

// Easing function (ease-out cubic)
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function getRect(target: DOMRect | HTMLElement | (() => DOMRect | HTMLElement | null)): DOMRect | null {
  if (typeof target === 'function') {
    const result = target();
    if (!result) return null;
    return result instanceof DOMRect ? result : result.getBoundingClientRect();
  }
  return target instanceof DOMRect ? target : target.getBoundingClientRect();
}

export function useFlyingCards(): FlyingCardsReturn {
  const flyingCards = ref<FlyingCard[]>([]);
  const activeAnimations = new Map<string, { cancel: () => void }>();

  /**
   * Start a single card flying animation
   */
  async function flyCard(options: FlyCardOptions): Promise<void> {
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
      duration = DEFAULT_DURATION,
      zIndex = DEFAULT_Z_INDEX,
      cardSize,
    } = options;

    const startRect = getRect(startTarget);
    if (!startRect) return;

    // Use explicit card size if provided, otherwise use startRect dimensions
    const cardWidth = cardSize?.width ?? startRect.width;
    const cardHeight = cardSize?.height ?? startRect.height;

    // Calculate start position - center the card on the start rect's center
    const startCenterX = startRect.left + startRect.width / 2;
    const startCenterY = startRect.top + startRect.height / 2;
    const startX = startCenterX - cardWidth / 2;
    const startY = startCenterY - cardHeight / 2;

    // Determine starting flip state based on cardData.faceUp
    // If card starts face DOWN (faceUp=false), we start flipped so back is visible
    // The rotation animation (0→180) will then flip it to show the front
    // If card starts face UP (faceUp=true), we start not flipped so front is visible
    // The rotation animation (0→180) will then flip it to show the back
    const startFlipped = cardData.faceUp === false;

    // Create the flying card at start position
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

    return new Promise<void>((resolve) => {
      let cancelled = false;
      let animationFrameId: number;
      const startTime = performance.now();

      const cancel = () => {
        cancelled = true;
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
        }
        flyingCards.value = flyingCards.value.filter(c => c.id !== id);
        activeAnimations.delete(id);
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
          flyingCards.value = flyingCards.value.filter(c => c.id !== id);
          activeAnimations.delete(id);
          resolve();
          return;
        }

        // Calculate current position (interpolate from start to current end)
        // Use center-to-center positioning (startCenterX/Y captured from outer scope)
        const endCenterX = endRect.left + endRect.width / 2;
        const endCenterY = endRect.top + endRect.height / 2;

        // Current position based on progress
        const currentCenterX = startCenterX + (endCenterX - startCenterX) * progress;
        const currentCenterY = startCenterY + (endCenterY - startCenterY) * progress;

        // Convert back to top-left position
        const currentX = currentCenterX - cardWidth / 2;
        const currentY = currentCenterY - cardHeight / 2;

        // Flip rotation
        const flipRotation = flip ? progress * 180 : 0;

        // Update the card
        // Note: isFlipped stays constant - it determines starting state
        // The rotation animation (0→180) handles the visual flip
        const cardIndex = flyingCards.value.findIndex(c => c.id === id);
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
        } else {
          // Animation complete
          flyingCards.value = flyingCards.value.filter(c => c.id !== id);
          activeAnimations.delete(id);
          resolve();
        }
      }

      animationFrameId = requestAnimationFrame(animate);
    });
  }

  /**
   * Start multiple cards flying with optional stagger
   */
  async function flyCards(options: FlyCardOptions[], staggerMs = 50): Promise<void> {
    if (prefersReducedMotion.value) {
      return;
    }

    const promises: Promise<void>[] = [];

    for (let i = 0; i < options.length; i++) {
      if (staggerMs > 0 && i > 0) {
        await new Promise(r => setTimeout(r, staggerMs));
      }
      promises.push(flyCard(options[i]));
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
  }

  return {
    flyingCards: computed(() => flyingCards.value),
    flyCard,
    flyCards,
    cancelAll,
  };
}
