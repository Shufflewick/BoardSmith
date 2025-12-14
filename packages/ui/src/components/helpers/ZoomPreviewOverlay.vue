<script setup lang="ts">
/**
 * ZoomPreviewOverlay - Renders an enlarged card or die preview
 *
 * Shows a larger version of a card or die when the user holds Alt and hovers.
 * Uses Teleport to render above all other content.
 *
 * Supports three modes:
 * 1. Card data-based: Renders card from explicit cardData (rank, suit, images)
 * 2. Die data-based: Renders die from explicit dieData (sides, value, color)
 * 3. Clone-based: Displays a scaled clone of the actual DOM element
 *
 * Usage:
 * ```vue
 * <ZoomPreviewOverlay :preview-state="previewState" />
 * ```
 */
import { computed, ref, watchEffect } from 'vue';
import type { PreviewState } from '../../composables/useZoomPreview.js';
import { Die3D } from '../dice/index.js';

const props = defineProps<{
  /** Preview state from useZoomPreview */
  previewState: PreviewState;
  /** Optional custom suit symbol getter */
  getSuitSymbol?: (suit: string) => string;
  /** Optional custom suit color getter */
  getSuitColor?: (suit: string) => string;
}>();

// Sprite sheet layout constants (same as other components)
const NATIVE_CARD_WIDTH = 238;
const NATIVE_CARD_HEIGHT = 333;
const SPRITE_COLS = 13;
const SPRITE_ROWS = 5;

// Default card display size (standard playing card proportion)
const DEFAULT_CARD_WIDTH = 60;
const DEFAULT_CARD_HEIGHT = 84;

// Scale factor for preview (how much larger than the original card)
const PREVIEW_SCALE = 3;

// Type for parsed image info
type ImageInfo =
  | { type: 'url'; src: string }
  | { type: 'sprite'; sprite: string; x: number; y: number; width: number; height: number };

// Parse image data
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
        width: spriteObj.width ?? NATIVE_CARD_WIDTH,
        height: spriteObj.height ?? NATIVE_CARD_HEIGHT,
      };
    }
    if (spriteObj.sprite) {
      return { type: 'url', src: spriteObj.sprite };
    }
  }
  return null;
}

// Dynamic preview dimensions based on card data (supports any shape)
const previewDimensions = computed(() => {
  const cardData = props.previewState.cardData;
  const cardWidth = cardData?.width ?? DEFAULT_CARD_WIDTH;
  const cardHeight = cardData?.height ?? DEFAULT_CARD_HEIGHT;

  return {
    width: cardWidth * PREVIEW_SCALE,
    height: cardHeight * PREVIEW_SCALE,
  };
});

// Compute sprite styles for preview size (uses dynamic dimensions)
function getSpriteStyle(info: ImageInfo): Record<string, string> {
  if (info.type !== 'sprite') return {};

  const { width: previewWidth, height: previewHeight } = previewDimensions.value;

  const scaleX = previewWidth / NATIVE_CARD_WIDTH;
  const scaleY = previewHeight / NATIVE_CARD_HEIGHT;

  const sheetWidth = SPRITE_COLS * NATIVE_CARD_WIDTH;
  const sheetHeight = SPRITE_ROWS * NATIVE_CARD_HEIGHT;

  const scaledSheetWidth = sheetWidth * scaleX;
  const scaledSheetHeight = sheetHeight * scaleY;

  const scaledX = info.x * scaleX;
  const scaledY = info.y * scaleY;

  return {
    backgroundImage: `url(${info.sprite})`,
    backgroundPosition: `-${scaledX}px -${scaledY}px`,
    backgroundSize: `${scaledSheetWidth}px ${scaledSheetHeight}px`,
    backgroundRepeat: 'no-repeat',
  };
}

// Get the image to show (only for data-based mode)
const imageInfo = computed(() => {
  const cardData = props.previewState.cardData;
  if (!cardData) return null;

  const image = cardData.showBack ? cardData.backImage : cardData.faceImage;
  return parseImageInfo(image);
});

// Default suit symbols
const defaultSuitSymbols: Record<string, string> = {
  'H': '\u2665', // ♥
  'D': '\u2666', // ♦
  'C': '\u2663', // ♣
  'S': '\u2660', // ♠
};

function getDefaultSuitSymbol(suit: string): string {
  return defaultSuitSymbols[suit?.toUpperCase()] || suit;
}

function getDefaultSuitColor(suit: string): string {
  const s = suit?.toUpperCase();
  return s === 'H' || s === 'D' ? '#e74c3c' : '#2c3e50';
}

// Position style
const positionStyle = computed(() => ({
  left: `${props.previewState.x}px`,
  top: `${props.previewState.y}px`,
}));

// Check which mode we're in
const isCloneMode = computed(() => props.previewState.clonedElement !== null);
const isCardDataMode = computed(() => props.previewState.cardData !== null);
const isDieDataMode = computed(() => props.previewState.dieData !== null);

// Die preview size (larger than default die size)
const DIE_PREVIEW_SIZE = 150;

// Ref for the clone container
const cloneContainer = ref<HTMLElement | null>(null);

// Watch for clonedElement changes and append to container
watchEffect(() => {
  if (cloneContainer.value) {
    // Clear previous content
    cloneContainer.value.innerHTML = '';

    // Append new clone if present
    if (props.previewState.clonedElement) {
      cloneContainer.value.appendChild(props.previewState.clonedElement);
    }
  }
});

// Scale style for clone mode
// Note: CSS sprite backgrounds are pre-scaled in useZoomPreview
// because transform: scale() doesn't scale background-position/size
const cloneScaleStyle = computed(() => ({
  transform: `scale(${props.previewState.scale})`,
  transformOrigin: 'top left',
}));

// Wrapper size for clone mode (must match scaled dimensions)
const cloneWrapperStyle = computed(() => ({
  width: `${props.previewState.originalWidth * props.previewState.scale}px`,
  height: `${props.previewState.originalHeight * props.previewState.scale}px`,
}));

// Dynamic style for data-based preview card (supports any shape)
const previewCardStyle = computed(() => ({
  width: `${previewDimensions.value.width}px`,
  height: `${previewDimensions.value.height}px`,
}));
</script>

<template>
  <Teleport to="body">
    <Transition name="zoom-preview">
      <div
        v-if="previewState.visible && (previewState.cardData || previewState.dieData || previewState.clonedElement)"
        class="zoom-preview-overlay"
        :style="positionStyle"
      >
        <!-- Clone-based mode: display scaled clone of the actual element -->
        <div v-if="isCloneMode" class="zoom-preview-clone-wrapper" :style="cloneWrapperStyle">
          <div
            ref="cloneContainer"
            class="zoom-preview-clone"
            :style="cloneScaleStyle"
          ></div>
        </div>

        <!-- Die data-based mode: render Die3D component -->
        <div v-else-if="isDieDataMode && previewState.dieData" class="zoom-preview-die">
          <Die3D
            :sides="previewState.dieData.sides"
            :value="previewState.dieData.value"
            :color="previewState.dieData.color"
            :face-labels="previewState.dieData.faceLabels"
            :face-images="previewState.dieData.faceImages"
            :size="DIE_PREVIEW_SIZE"
          />
        </div>

        <!-- Card data-based mode: render from card data -->
        <div v-else-if="isCardDataMode" class="zoom-preview-card" :style="previewCardStyle">
          <!-- Image-based card -->
          <template v-if="imageInfo">
            <!-- URL image -->
            <img
              v-if="imageInfo.type === 'url'"
              :src="imageInfo.src"
              class="preview-image"
              :alt="previewState.cardData?.label || 'Card'"
            />
            <!-- CSS sprite -->
            <div
              v-else-if="imageInfo.type === 'sprite'"
              class="preview-image preview-sprite"
              :style="getSpriteStyle(imageInfo)"
            ></div>
          </template>
          <!-- Fallback: card back or text-based card -->
          <template v-else>
            <!-- Card back without image - show decorative back -->
            <div v-if="previewState.cardData?.showBack" class="preview-card-back">
              <div class="card-back-pattern"></div>
            </div>
            <!-- Face card without image - show rank/suit -->
            <div
              v-else
              class="preview-fallback"
              :style="{ color: (getSuitColor || getDefaultSuitColor)(previewState.cardData?.suit || '') }"
            >
              <span class="preview-rank">{{ previewState.cardData?.rank }}</span>
              <span class="preview-suit">{{ (getSuitSymbol || getDefaultSuitSymbol)(previewState.cardData?.suit || '') }}</span>
            </div>
          </template>
        </div>

      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.zoom-preview-overlay {
  position: fixed;
  z-index: 10000;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

/* Clone-based preview */
.zoom-preview-clone-wrapper {
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 2px rgba(255, 255, 255, 0.2);
  overflow: hidden;
  background: transparent;
}

.zoom-preview-clone {
  /* The cloned element will be appended here and scaled */
}

/* Die preview */
.zoom-preview-die {
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 2px rgba(255, 255, 255, 0.2);
  background: rgba(30, 30, 50, 0.95);
  padding: 10px;
}

/* Card data-based preview - dimensions set via inline style for shape flexibility */
.zoom-preview-card {
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 2px rgba(255, 255, 255, 0.2);
  overflow: hidden;
  background: #fff;
}

.preview-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 12px;
}

.preview-sprite {
  width: 100%;
  height: 100%;
  border-radius: 12px;
}

.preview-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #fff;
  border-radius: 12px;
}

.preview-card-back {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, #1a365d 0%, #2c5282 100%);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 3px solid #4a6fa5;
}

.card-back-pattern {
  width: 70%;
  height: 80%;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 8px;
  background: repeating-linear-gradient(
    45deg,
    transparent,
    transparent 10px,
    rgba(255, 255, 255, 0.05) 10px,
    rgba(255, 255, 255, 0.05) 20px
  );
}

.preview-rank {
  font-size: 3rem;
  font-weight: bold;
}

.preview-suit {
  font-size: 4rem;
}

/* Transition */
.zoom-preview-enter-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.zoom-preview-leave-active {
  transition: opacity 0.1s ease, transform 0.1s ease;
}

.zoom-preview-enter-from {
  opacity: 0;
  transform: scale(0.8);
}

.zoom-preview-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .zoom-preview-enter-active,
  .zoom-preview-leave-active {
    transition: opacity 0.1s ease;
  }

  .zoom-preview-enter-from,
  .zoom-preview-leave-to {
    transform: none;
  }
}
</style>
