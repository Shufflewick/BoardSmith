<script setup lang="ts">
/**
 * FlyingCardsOverlay - Renders flying cards during animations
 *
 * Place this component at the root of your game board to render
 * cards that are animating between positions.
 *
 * Supports three rendering modes:
 * 1. **Card images**: When `faceImage`/`backImage` are provided
 * 2. **Text cards**: When `rank`/`suit` are provided (default card face)
 * 3. **Player pieces**: When `playerSeat` is set (circular pieces in the seat's colour)
 *
 * ## Usage
 *
 * ```vue
 * <template>
 *   <div class="game-board">
 *     <!-- Basic: uses default rendering -->
 *     <FlyingCardsOverlay :flying-cards="flyingCards" />
 *
 *     <!-- Custom rendering via slot -->
 *     <FlyingCardsOverlay :flying-cards="flyingCards">
 *       <template #card="{ card }">
 *         <MyCustomCard :data="card.cardData" />
 *       </template>
 *     </FlyingCardsOverlay>
 *   </div>
 * </template>
 * ```
 */
import type { FlyingCard } from '../../composables/useFlyingElements.js';
import { inject, type CSSProperties } from 'vue';
import { DEFAULT_COLOR_PALETTE } from '../../../engine/element/seat-defaults.js';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import { seatDisplay } from '../../seat-display.js';
import { isUrlImage, isSpriteImage, getImageSrc, getSpriteStyle } from '../../utils/image.js';
import { getSuitSymbol as defaultSuitSymbol, getSuitColor as defaultSuitColor } from '../../composables/useCardDisplay.js';

defineProps<{
  /** Array of flying cards from useFlyingElements composable */
  flyingCards: readonly FlyingCard[];
  /** Optional custom card renderer slot data */
  getSuitSymbol?: (suit: string) => string;
  /** Optional custom suit color */
  getSuitColor?: (suit: string) => string;
}>();

// The shell's players, for each seat's resolved colour; none outside a shell.
const players = inject(GAME_CONTEXT_KEYS.players, undefined);

/**
 * Determine rendering mode for a flying card:
 * - 'image': Has face/back images
 * - 'card': Has rank/suit (text-based card)
 * - 'piece': Has playerSeat (colored piece)
 * - 'default': None of the above
 */
function getRenderMode(cardData: Record<string, unknown>): 'image' | 'card' | 'piece' | 'default' {
  if (cardData.faceImage || cardData.backImage) return 'image';
  if (cardData.rank || cardData.suit) return 'card';
  if (typeof cardData.playerSeat === 'number') return 'piece';
  return 'default';
}

/** The seat's colour, or the one the engine gives that seat by default (seat 1 is the palette's first). */
function getPlayerColor(playerSeat: number): string {
  return seatDisplay(players?.value ?? [], playerSeat).color
    ?? DEFAULT_COLOR_PALETTE[(playerSeat - 1) % DEFAULT_COLOR_PALETTE.length];
}

/**
 * Get piece style based on player position
 */
function getPieceStyle(cardData: Record<string, unknown>): CSSProperties {
  const playerSeat = cardData.playerSeat as number;
  return {
    backgroundColor: getPlayerColor(playerSeat),
  };
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
        <!-- Custom card rendering via slot -->
        <slot name="card" :card="card">
          <!-- PIECE MODE: Render as colored game piece -->
          <div
            v-if="getRenderMode(card.cardData) === 'piece'"
            class="piece-inner"
            :style="getPieceStyle(card.cardData)"
          ></div>

          <!-- CARD MODE: Render with front/back faces -->
          <div v-else class="card-inner" :class="{ flipped: card.isFlipped }">
            <!-- Front face -->
            <div
              class="card-face card-front"
              :class="{ 'has-image': card.cardData.faceImage }"
              :style="{ color: (getSuitColor || defaultSuitColor)(card.cardData.suit || '') }"
            >
              <!-- URL image -->
              <img
                v-if="isUrlImage(card.cardData.faceImage)"
                :src="getImageSrc(card.cardData.faceImage)"
                class="card-image"
                :alt="`${card.cardData.rank}${card.cardData.suit}`"
              />
              <!-- CSS sprite sheet with background-position -->
              <div
                v-else-if="isSpriteImage(card.cardData.faceImage)"
                class="card-image card-sprite"
                :style="getSpriteStyle(card.cardData.faceImage)"
              ></div>
              <template v-else>
                <span class="rank">{{ card.cardData.rank }}</span>
                <span class="suit">{{ (getSuitSymbol || defaultSuitSymbol)(card.cardData.suit || '') }}</span>
              </template>
            </div>
            <!-- Back face -->
            <div
              class="card-face card-back"
              :class="{ 'has-image': card.cardData.backImage, 'has-color': card.cardData.backColor }"
              :style="card.cardData.backColor ? { background: card.cardData.backColor } : undefined"
            >
              <!-- URL image -->
              <img
                v-if="isUrlImage(card.cardData.backImage)"
                :src="getImageSrc(card.cardData.backImage)"
                class="card-image"
                alt="Card back"
              />
              <!-- CSS sprite sheet with background-position -->
              <div
                v-else-if="isSpriteImage(card.cardData.backImage)"
                class="card-image card-sprite"
                :style="getSpriteStyle(card.cardData.backImage)"
              ></div>
            </div>
          </div>
        </slot>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.flying-cards-overlay {
  /* Teleported out of the shell root, so it does not inherit the shell's font (#451). */
  font-family: var(--bsg-font);
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

/* Piece rendering (for games like checkers, chess) */
.piece-inner {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  box-shadow:
    0 4px 8px rgba(0, 0, 0, 0.3),
    inset 0 2px 4px rgba(255, 255, 255, 0.3),
    inset 0 -2px 4px rgba(0, 0, 0, 0.2);
  border: 2px solid rgba(0, 0, 0, 0.3);
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
  background: var(--bsg-surface);
}

.card-front .rank {
  font-size: 1.3rem;
}

.card-front .suit {
  font-size: 1.5rem;
}

.card-back {
  background: var(--bsg-card-back);
  transform: rotateY(180deg);
}

/* Custom back color - the inline style sets the background,
   we just need to remove the default pattern pseudo-element */
.card-back.has-color {
  /* Don't override - let inline style apply the custom background */
}

.card-back:not(.has-image):not(.has-color)::before {
  content: '';
  width: 60%;
  height: 70%;
  background: repeating-linear-gradient(
    45deg,
    var(--bsg-line),
    var(--bsg-line) 2px,
    transparent 2px,
    transparent 8px
  );
  border-radius: 4px;
}

/* Card image styles */
.card-face.has-image {
  background: transparent;
  padding: 0;
  /* Override flex centering to let image fill container */
  display: block;
}

.card-back.has-image {
  background: transparent;
  /* Override flex centering to let image fill container */
  display: block;
}

.card-image {
  /* Fill the entire card face */
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: 8px;
  object-fit: contain;
}

/* CSS sprite sheet (uses background-position) */
.card-sprite {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: 8px;
  background-repeat: no-repeat;
}

/* Reduced motion: instant transitions */
.bs-reduce-motion .card-inner {
  transition: none;
}

.bs-reduce-motion .flying-card {
  transition: none !important;
}
</style>
