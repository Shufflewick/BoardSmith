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
 * 3. **Player pieces**: When `playerSeat` is set (circular pieces with player colors)
 *
 * ## Usage
 *
 * ```vue
 * <template>
 *   <div class="game-board">
 *     <!-- Basic: uses default rendering -->
 *     <FlyingCardsOverlay :flying-cards="flyingCards" />
 *
 *     <!-- With player colors for piece games -->
 *     <FlyingCardsOverlay
 *       :flying-cards="flyingCards"
 *       :player-colors="['#e74c3c', '#2c3e50']"
 *     />
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
import type { CSSProperties } from 'vue';

const props = defineProps<{
  /** Array of flying cards from useFlyingElements composable */
  flyingCards: readonly FlyingCard[];
  /** Optional custom card renderer slot data */
  getSuitSymbol?: (suit: string) => string;
  /** Optional custom suit color */
  getSuitColor?: (suit: string) => string;
  /**
   * Player colors for piece rendering (indexed by playerSeat).
   * When set, elements with playerSeat but no images render as colored pieces.
   * Default: ['#e74c3c', '#2c3e50'] (red, dark gray)
   */
  playerColors?: string[];
}>();

// Default player colors (can be overridden via prop)
const defaultPlayerColors = ['#e74c3c', '#2c3e50', '#27ae60', '#f39c12', '#9b59b6', '#3498db'];

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

/**
 * Get player color for piece rendering
 */
function getPlayerColor(playerSeat: number): string {
  const colors = props.playerColors || defaultPlayerColors;
  return colors[playerSeat % colors.length] || defaultPlayerColors[0];
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

// Type for parsed image info (either URL string or sprite with coordinates)
type ImageInfo =
  | { type: 'url'; src: string }
  | { type: 'sprite'; sprite: string; x: number; y: number; width: number; height: number };

// Parse image data from cardData - handles both string URLs and sprite objects
function parseImageInfo(image: unknown): ImageInfo | null {
  if (!image) return null;
  if (typeof image === 'string') return { type: 'url', src: image };
  if (typeof image === 'object' && image !== null) {
    const spriteObj = image as { sprite?: string; x?: number; y?: number; width?: number; height?: number };
    if (spriteObj.sprite && typeof spriteObj.x === 'number' && typeof spriteObj.y === 'number') {
      return {
        type: 'sprite',
        sprite: spriteObj.sprite,
        x: spriteObj.x,
        y: spriteObj.y,
        width: spriteObj.width ?? 238,
        height: spriteObj.height ?? 333,
      };
    }
    if (spriteObj.sprite) {
      return { type: 'url', src: spriteObj.sprite };
    }
  }
  return null;
}

// Helper to check if image is URL type
function isUrlImage(image: unknown): boolean {
  return parseImageInfo(image)?.type === 'url';
}

// Helper to check if image is sprite type
function isSpriteImage(image: unknown): boolean {
  return parseImageInfo(image)?.type === 'sprite';
}

// Helper to get URL src
function getImageSrc(image: unknown): string {
  const info = parseImageInfo(image);
  if (info?.type === 'url') return info.src;
  return '';
}

// Sprite sheet layout constants
// Standard card dimensions in the sprite sheet (face cards)
const NATIVE_CARD_WIDTH = 238;
const NATIVE_CARD_HEIGHT = 333;
const SPRITE_COLS = 13;
const SPRITE_ROWS = 5;

// Helper to get sprite style object with proper scaling
// IMPORTANT: Scale based on native face card dimensions (238x333), not the individual
// card's dimensions, because card backs may have different sizes in the sprite
function getSpriteStyle(image: unknown, displayWidth: number = 60, displayHeight: number = 84): CSSProperties {
  const info = parseImageInfo(image);
  if (info?.type === 'sprite') {
    // Scale based on standard card size, not individual card's dimensions
    const scaleX = displayWidth / NATIVE_CARD_WIDTH;
    const scaleY = displayHeight / NATIVE_CARD_HEIGHT;

    // Total sprite sheet dimensions
    const sheetWidth = SPRITE_COLS * NATIVE_CARD_WIDTH;
    const sheetHeight = SPRITE_ROWS * NATIVE_CARD_HEIGHT;

    // Scaled sprite sheet size
    const scaledSheetWidth = sheetWidth * scaleX;
    const scaledSheetHeight = sheetHeight * scaleY;

    // Scale the position coordinates
    const scaledX = info.x * scaleX;
    const scaledY = info.y * scaleY;

    return {
      backgroundImage: `url(${info.sprite})`,
      backgroundPosition: `-${scaledX}px -${scaledY}px`,
      backgroundSize: `${scaledSheetWidth}px ${scaledSheetHeight}px`,
      backgroundRepeat: 'no-repeat',
    };
  }
  return {};
}

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
              :style="{ color: (getSuitColor || getDefaultSuitColor)(card.cardData.suit || '') }"
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
                <span class="suit">{{ (getSuitSymbol || getDefaultSuitSymbol)(card.cardData.suit || '') }}</span>
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
    rgba(212, 165, 116, 0.3),
    rgba(212, 165, 116, 0.3) 2px,
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
@media (prefers-reduced-motion: reduce) {
  .card-inner {
    transition: none;
  }

  .flying-card {
    transition: none !important;
  }
}
</style>
