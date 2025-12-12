<script setup lang="ts">
/**
 * FlyingCardsOverlay - Renders flying cards during animations
 *
 * Place this component at the root of your game board to render
 * cards that are animating between positions.
 *
 * Usage:
 * ```vue
 * <template>
 *   <div class="game-board">
 *     <!-- Your game content -->
 *     <FlyingCardsOverlay :flying-cards="flyingCards" :render-card="renderCard" />
 *   </div>
 * </template>
 * ```
 */
import type { FlyingCard } from '../../composables/useFlyingCards.js';

defineProps<{
  /** Array of flying cards from useFlyingCards composable */
  flyingCards: readonly FlyingCard[];
  /** Optional custom card renderer slot data */
  getSuitSymbol?: (suit: string) => string;
  /** Optional custom suit color */
  getSuitColor?: (suit: string) => string;
}>();

// Default suit symbols
const defaultSuitSymbols: Record<string, string> = {
  'H': '\u2665', // ♥
  'D': '\u2666', // ♦
  'C': '\u2663', // ♣
  'S': '\u2660', // ♠
};

function getDefaultSuitSymbol(suit: string): string {
  return defaultSuitSymbols[suit] || suit;
}

function getDefaultSuitColor(suit: string): string {
  return suit === 'H' || suit === 'D' ? '#e74c3c' : '#2c3e50';
}
</script>

<template>
  <Teleport to="body">
    <div class="flying-cards-overlay">
      <div
        v-for="card in flyingCards"
        :key="card.id"
        class="flying-card"
        :class="{ flipping: card.isFlipped }"
        :style="card.style"
      >
        <!-- Default card rendering with front and back faces -->
        <slot name="card" :card="card">
          <div class="card-inner" :class="{ flipped: card.isFlipped }">
            <!-- Front face -->
            <div
              class="card-face card-front"
              :style="{ color: (getSuitColor || getDefaultSuitColor)(card.cardData.suit || '') }"
            >
              <span class="rank">{{ card.cardData.rank }}</span>
              <span class="suit">{{ (getSuitSymbol || getDefaultSuitSymbol)(card.cardData.suit || '') }}</span>
            </div>
            <!-- Back face -->
            <div class="card-face card-back"></div>
          </div>
        </slot>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.flying-cards-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 9999;
  /* Perspective applies to child .flying-card elements */
  perspective: 1000px;
}

.flying-card {
  /* Preserve 3D for child transforms */
  transform-style: preserve-3d;
}

.card-inner {
  width: 100%;
  height: 100%;
  position: relative;
  transform-style: preserve-3d;
  /* No transition - animation is handled by JS via parent transform */
}

.card-inner.flipped {
  /* When flipped, rotate 180deg so back face shows initially.
     The parent's rotateY animation (0→180) then flips it to show front.
     Without flipped: starts showing front, ends showing back.
     With flipped: starts showing back, ends showing front. */
  transform: rotateY(180deg);
}

.card-face {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.card-front {
  background: #fff;
}

.card-front .rank {
  font-size: 1.3rem;
}

.card-front .suit {
  font-size: 1.5rem;
}

.card-back {
  background: linear-gradient(135deg, #8b5a2b, #6b4423);
  transform: rotateY(180deg);
}

.card-back::before {
  content: '';
  width: 60%;
  height: 70%;
  background: repeating-linear-gradient(
    45deg,
    rgba(212, 165, 116, 0.3),
    rgba(212, 165, 116, 0.3) 2px,
    transparent 2px,
    transparent 8px
  );
  border-radius: 4px;
}

/* Reduced motion: instant transitions */
@media (prefers-reduced-motion: reduce) {
  .card-inner {
    transition: none;
  }

  .flying-card {
    transition: none !important;
  }
}
</style>
