/**
 * useCardFlip - Composable for 3D card flip animations
 *
 * Provides reactive state and CSS classes for smooth card flip animations
 * when a card's visibility changes (face-up to face-down or vice versa).
 *
 * Usage:
 * ```vue
 * <script setup>
 * import { useCardFlip } from '@boardsmith/ui';
 * import { computed } from 'vue';
 *
 * const props = defineProps<{ card: { faceUp: boolean } }>();
 * const { flipClass, isFlipping } = useCardFlip(() => props.card.faceUp);
 * </script>
 *
 * <template>
 *   <div class="card-flip-container">
 *     <div :class="flipClass">
 *       <div class="card-front">{{ card.name }}</div>
 *       <div class="card-back"></div>
 *     </div>
 *   </div>
 * </template>
 * ```
 */
import { ref, watch, computed, type Ref, type ComputedRef } from 'vue';
import { prefersReducedMotion } from './useElementAnimation.js';

export interface CardFlipOptions {
  /** Duration of the flip animation in ms (default: 400) */
  duration?: number;
}

export interface CardFlipReturn {
  /** Whether the card is currently flipping */
  isFlipping: Ref<boolean>;
  /** The visual face-up state (may lag behind actual state during animation) */
  showFaceUp: Ref<boolean>;
  /** CSS classes to apply to the flippable element */
  flipClass: ComputedRef<Record<string, boolean>>;
  /** Manually trigger a flip animation */
  triggerFlip: () => void;
}

const DEFAULT_FLIP_DURATION = 400;

/**
 * Create card flip animation state
 * @param isFaceUp - Getter function or ref that returns true when card is face-up
 * @param options - Animation options
 */
export function useCardFlip(
  isFaceUp: (() => boolean) | Ref<boolean> | ComputedRef<boolean>,
  options: CardFlipOptions = {}
): CardFlipReturn {
  const duration = options.duration ?? DEFAULT_FLIP_DURATION;
  const halfDuration = duration / 2;

  // Normalize to a getter function
  const getFaceUp = typeof isFaceUp === 'function'
    ? isFaceUp
    : () => isFaceUp.value;

  const isFlipping = ref(false);
  const showFaceUp = ref(getFaceUp());

  // Watch for visibility changes and trigger flip
  watch(
    getFaceUp,
    (newValue, oldValue) => {
      // Skip if same value or if reduced motion is preferred
      if (newValue === oldValue) return;

      if (prefersReducedMotion.value) {
        // Instant change for reduced motion
        showFaceUp.value = newValue;
        return;
      }

      // Start flip animation
      isFlipping.value = true;

      // Update displayed face at midpoint of animation (when card is edge-on)
      setTimeout(() => {
        showFaceUp.value = newValue;
      }, halfDuration);

      // End flip animation
      setTimeout(() => {
        isFlipping.value = false;
      }, duration);
    }
  );

  // Sync initial state
  watch(
    getFaceUp,
    (newValue) => {
      if (!isFlipping.value) {
        showFaceUp.value = newValue;
      }
    },
    { immediate: true }
  );

  const flipClass = computed(() => ({
    'card-flippable': true,
    'card-flipping': isFlipping.value,
    'card-face-down': !showFaceUp.value,
    'card-face-up': showFaceUp.value,
  }));

  function triggerFlip() {
    if (prefersReducedMotion.value) {
      showFaceUp.value = !showFaceUp.value;
      return;
    }

    isFlipping.value = true;

    setTimeout(() => {
      showFaceUp.value = !showFaceUp.value;
    }, halfDuration);

    setTimeout(() => {
      isFlipping.value = false;
    }, duration);
  }

  return {
    isFlipping,
    showFaceUp,
    flipClass,
    triggerFlip,
  };
}

/**
 * Simple hook to detect if a card was just revealed (became visible)
 * Useful for triggering flip animations in AutoUI when cards appear
 */
export function useCardReveal(
  isVisible: (() => boolean) | Ref<boolean> | ComputedRef<boolean>
) {
  const getVisible = typeof isVisible === 'function'
    ? isVisible
    : () => isVisible.value;

  const wasRevealed = ref(false);
  const previousVisible = ref(getVisible());

  watch(
    getVisible,
    (newValue, oldValue) => {
      // Card was revealed (went from hidden to visible)
      wasRevealed.value = !oldValue && newValue;
      previousVisible.value = newValue;

      // Reset after animation duration
      if (wasRevealed.value) {
        setTimeout(() => {
          wasRevealed.value = false;
        }, DEFAULT_FLIP_DURATION);
      }
    }
  );

  return {
    wasRevealed,
  };
}
