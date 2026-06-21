<script setup lang="ts">
/**
 * CardRenderer — Per-element renderer for card elements ($type='card').
 *
 * Renders four visual baselines:
 *   1. URL image (face or back)
 *   2. Sprite-sheet image (face or back)
 *   3. No-image visible card — white face with name label (sane floor)
 *   4. No-image hidden card — default back gradient
 *
 * Board interaction states (is-selectable, is-selected, action-selectable,
 * is-board-highlighted, is-board-selected) are reflected via
 * tryUseBoardInteraction — the substrate is never modified.
 *
 * Face/back image selection: hidden cards ALWAYS show the back image;
 * visible cards show the face image. The face URL is never exposed when
 * element.__hidden is true (T-93-04).
 */

import { computed, inject, ref, type Ref } from 'vue';
import { tryUseBoardInteraction } from '../../../composables/useBoardInteraction.js';
import { setTransformAwareDragImage } from '../../../composables/dragImage.js';

// ---------------------------------------------------------------------------
// Local GameElement interface — dependency-free, mirrors auto-ui-helpers.ts
// ---------------------------------------------------------------------------
interface GameElement {
  id: number;
  name?: string;
  className: string;
  attributes?: Record<string, unknown>;
  children?: GameElement[];
  childCount?: number;
  __hidden?: boolean;
}

type ImageInfo =
  | { type: 'url'; src: string }
  | { type: 'sprite'; sprite: string; x: number; y: number; width: number; height: number };

const props = defineProps<{
  element: GameElement;
  depth: number;
}>();

// ---------------------------------------------------------------------------
// Inject context — exact keys provided by AutoRenderer.vue
// ---------------------------------------------------------------------------
const playerSeat = inject<number>('playerSeat', 0);
const selectableElements = inject<Ref<Set<number>>>('selectableElements');
const selectedElements = inject<Ref<Set<number>>>('selectedElements');
const defaultBackImage = inject<Ref<ImageInfo | null>>('defaultBackImage', ref(null));

// Board interaction — always tryUse (never useBoardInteraction directly)
const boardInteraction = tryUseBoardInteraction();

// Suppress unused variable warning for playerSeat and selectableElements/selectedElements
// (injected for context completeness per interface spec; element-level selectable state
// comes via boardInteraction for cards; container injects consumed by parent hand/deck)
void playerSeat;

// ---------------------------------------------------------------------------
// Selectable / selected state (from injected sets — passed down from AutoRenderer)
// ---------------------------------------------------------------------------
const isSelectable = computed(() => selectableElements?.value?.has(props.element.id) ?? false);
const isSelected = computed(() => selectedElements?.value?.has(props.element.id) ?? false);

// ---------------------------------------------------------------------------
// Element notation (used in all boardInteraction calls)
// Pitfall 6: prefer attributes.notation if present; fall back to element.name
// ---------------------------------------------------------------------------
const elementNotation = computed(
  () => (props.element.attributes?.notation as string | undefined) ?? props.element.name ?? null,
);

// ---------------------------------------------------------------------------
// Board state computeds — all with defensive !boardInteraction guard
// ---------------------------------------------------------------------------
const isBoardHighlighted = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isHighlighted({
    id: props.element.id,
    name: props.element.name,
    notation: elementNotation.value || undefined,
  });
});

const isBoardSelected = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isSelected({
    id: props.element.id,
    name: props.element.name,
    notation: elementNotation.value || undefined,
  });
});

const isActionSelectable = computed(() => {
  if (!boardInteraction) return false;
  // Don't show as action-selectable if already board-selected
  if (isBoardSelected.value) return false;

  const elementRef = {
    id: props.element.id,
    name: props.element.name,
    notation: elementNotation.value || undefined,
  };

  if (boardInteraction.isSelectableElement(elementRef)) return true;
  if (boardInteraction.isDraggableSelectedElement(elementRef)) return true;
  return false;
});

const isDragged = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isDraggedElement({
    id: props.element.id,
    name: props.element.name,
    notation: elementNotation.value || undefined,
  });
});

const isDropTarget = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isDropTarget({
    id: props.element.id,
    name: props.element.name,
    notation: elementNotation.value || undefined,
  });
});

const isDisabled = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isDisabledElement({
    id: props.element.id,
    name: props.element.name,
    notation: elementNotation.value || undefined,
  }) !== false;
});

// ---------------------------------------------------------------------------
// Sprite-sheet scaling constants (standard card face dimensions)
// ---------------------------------------------------------------------------
const NATIVE_CARD_WIDTH = 238;
const NATIVE_CARD_HEIGHT = 333;
const SPRITE_COLS = 13;
const SPRITE_ROWS = 5;

function getSpriteStyle(
  info: ImageInfo,
  displayWidth: number = 60,
  displayHeight: number = 84,
): Record<string, string> {
  if (info.type !== 'sprite') return {};

  const scaleX = displayWidth / NATIVE_CARD_WIDTH;
  const scaleY = displayHeight / NATIVE_CARD_HEIGHT;
  const sheetWidth = SPRITE_COLS * NATIVE_CARD_WIDTH * scaleX;
  const sheetHeight = SPRITE_ROWS * NATIVE_CARD_HEIGHT * scaleY;
  const scaledX = info.x * scaleX;
  const scaledY = info.y * scaleY;

  return {
    backgroundImage: `url(${info.sprite})`,
    backgroundPosition: `-${scaledX}px -${scaledY}px`,
    backgroundSize: `${sheetWidth}px ${sheetHeight}px`,
    backgroundRepeat: 'no-repeat',
  };
}

// ---------------------------------------------------------------------------
// Card image resolution — face when visible, back when hidden (T-93-04)
// ---------------------------------------------------------------------------
const cardImages = computed(() => {
  const attrs = props.element.attributes;
  if (!attrs?.$images) return null;
  const images = attrs.$images as Record<string, string | { sprite: string; x: number; y: number; width?: number; height?: number }>;
  return { face: images.face, back: images.back };
});

const currentCardImage = computed((): ImageInfo | null => {
  if (!cardImages.value) return null;

  // CRITICAL: hidden cards always show back, never face (T-93-04)
  const isHidden = props.element.__hidden || props.element.attributes?.__hidden;
  const image = isHidden ? cardImages.value.back : cardImages.value.face;

  if (!image) return null;

  if (typeof image === 'string') {
    return { type: 'url' as const, src: image };
  }

  if (typeof image === 'object' && 'sprite' in image && 'x' in image && 'y' in image) {
    const s = image as { sprite: string; x: number; y: number; width: number; height: number };
    return { type: 'sprite' as const, sprite: s.sprite, x: s.x, y: s.y, width: s.width, height: s.height };
  }

  return null;
});

// Back image for hidden cards when no $images.back is present
const backImageFallback = computed((): ImageInfo | null => {
  // Check element's own $images.back first
  const ownImages = props.element.attributes?.$images as Record<string, unknown> | undefined;
  if (ownImages?.back) {
    const back = ownImages.back;
    if (typeof back === 'string') return { type: 'url', src: back };
    if (typeof back === 'object' && back !== null) {
      const s = back as { sprite?: string; x?: number; y?: number; width?: number; height?: number };
      if (s.sprite && typeof s.x === 'number' && typeof s.y === 'number') {
        return { type: 'sprite', sprite: s.sprite, x: s.x, y: s.y, width: s.width ?? 238, height: s.height ?? 333 };
      }
    }
  }
  // Fall back to default back image from game view
  return defaultBackImage.value;
});

// Convenience computed for the display label
const displayLabel = computed(() => props.element.name || props.element.className);

// ---------------------------------------------------------------------------
// Drag handlers
// ---------------------------------------------------------------------------
function handleDragStart(event: DragEvent) {
  if (!boardInteraction || !isActionSelectable.value) {
    event.preventDefault();
    return;
  }

  setTransformAwareDragImage(event, event.currentTarget as HTMLElement);

  event.dataTransfer?.setData('boardsmith/element', JSON.stringify({
    id: props.element.id,
    name: props.element.name,
    notation: elementNotation.value,
  }));
  event.dataTransfer!.effectAllowed = 'move';

  boardInteraction.startDrag({
    id: props.element.id,
    name: props.element.name,
    notation: elementNotation.value || undefined,
  });
}

function handleDragEnd() {
  if (boardInteraction?.isDragging) {
    boardInteraction.endDrag();
  }
}

function handleDragOver(event: DragEvent) {
  if (!boardInteraction?.isDragging) return;
  if (!isDropTarget.value) return;

  event.preventDefault();
  event.dataTransfer!.dropEffect = 'move';
}

function handleDrop(event: DragEvent) {
  if (!boardInteraction?.isDragging) return;

  event.preventDefault();

  boardInteraction.triggerDrop({
    id: props.element.id,
    name: props.element.name,
    notation: elementNotation.value || undefined,
  });
}

// ---------------------------------------------------------------------------
// Click handler
// ---------------------------------------------------------------------------
function handleClick(event: MouseEvent) {
  event.stopPropagation();

  if (!boardInteraction) return;
  if (isDisabled.value) return;

  const elementRef = {
    id: props.element.id,
    name: props.element.name,
    notation: elementNotation.value || undefined,
  };

  if (boardInteraction.isSelectableElement(elementRef)) {
    boardInteraction.triggerElementSelect(elementRef);
    return;
  }

  if (elementNotation.value) {
    boardInteraction.selectElement({
      id: props.element.id,
      name: props.element.name,
      notation: elementNotation.value,
    });
  }
}
</script>

<template>
  <div
    :class="[
      'card-container',
      {
        'is-selectable': isSelectable,
        'is-selected': isSelected,
        'action-selectable': isActionSelectable,
        'is-board-highlighted': isBoardHighlighted,
        'is-board-selected': isBoardSelected,
        'is-hidden': element.__hidden,
        'is-disabled': isDisabled,
        'is-draggable': isActionSelectable,
        'is-dragging': isDragged,
        'is-drop-target': isDropTarget,
        'has-image': !!currentCardImage,
      },
    ]"
    :data-element-id="element.id"
    :data-animatable="true"
    :draggable="isActionSelectable"
    @click="handleClick"
    @dragstart="handleDragStart"
    @dragend="handleDragEnd"
    @dragover="handleDragOver"
    @drop="handleDrop"
  >
    <!-- Baseline 1: URL image -->
    <img
      v-if="currentCardImage?.type === 'url'"
      :src="currentCardImage.src"
      class="card-image"
      :class="{ 'card-image-back': element.__hidden || element.attributes?.__hidden }"
      :alt="displayLabel"
    />

    <!-- Baseline 2: Sprite-sheet image -->
    <div
      v-else-if="currentCardImage?.type === 'sprite'"
      class="card-image card-sprite"
      :class="{ 'card-image-back': element.__hidden || element.attributes?.__hidden }"
      :style="getSpriteStyle(currentCardImage)"
    ></div>

    <!-- Baseline 3 / 4: No image from $images — show face or back fallback -->
    <template v-else>
      <!-- Hidden card with no face image — show back gradient or back image fallback -->
      <template v-if="element.__hidden || element.attributes?.__hidden">
        <div class="card-back" :class="{ 'has-image': !!backImageFallback }">
          <img
            v-if="backImageFallback?.type === 'url'"
            :src="backImageFallback.src"
            class="card-image"
            alt="Card back"
          />
          <div
            v-else-if="backImageFallback?.type === 'sprite'"
            class="card-image card-sprite"
            :style="getSpriteStyle(backImageFallback)"
          ></div>
          <!-- Default back gradient rendered via .card-back CSS when no image -->
        </div>
      </template>
      <!-- Baseline 3: Visible card with no image — white face with name label -->
      <div v-else class="card-face">
        {{ displayLabel }}
      </div>
    </template>
  </div>
</template>

<style scoped>
/* Card container */
.card-container {
  display: inline-block;
  transition: transform 0.2s ease;
}

/* Selection states */
.card-container.is-selectable {
  cursor: pointer;
}

.card-container.is-selectable:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 217, 255, 0.3);
}

.card-container.is-selected {
  outline: 3px solid #00d9ff;
  outline-offset: 2px;
}

/* action-selectable: green pulse (T-93-03 XSS guard) */
.card-container.action-selectable {
  cursor: pointer;
  outline: 2px solid rgba(46, 204, 113, 0.6);
  outline-offset: 2px;
  border-radius: 8px;
  animation: pulse-card 2s ease-in-out infinite;
}

.card-container.action-selectable:hover {
  outline-color: rgba(46, 204, 113, 1);
  outline-width: 3px;
  transform: translateY(-8px);
}

@keyframes pulse-card {
  0%, 100% {
    outline-color: rgba(46, 204, 113, 0.6);
  }
  50% {
    outline-color: rgba(46, 204, 113, 1);
  }
}

/* Board interaction highlights */
.card-container.is-board-highlighted {
  background: rgba(0, 217, 255, 0.2);
}

.card-container.is-board-selected {
  background: rgba(0, 255, 136, 0.2);
}

/* Hidden cards */
.card-container.is-hidden {
  opacity: 0.5;
}

/* Disabled state */
.card-container.is-disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.card-container.is-disabled:hover {
  transform: none;
  box-shadow: none;
}

/* Dragging state — consume CSS vars from drag-drop.css, never redefine */
.card-container.is-dragging {
  opacity: var(--bs-dragging-opacity, 0.5);
  transform: scale(var(--bs-dragging-scale, 0.95));
}

.card-container.is-drop-target {
  background: var(--bs-drop-target-bg);
}

.card-container.is-drop-target:hover {
  background: var(--bs-drop-hover-bg);
}

/* Baseline 3: no-image visible card — white face with name label */
.card-face {
  width: 60px;
  min-width: 45px;
  height: 84px;
  background: #fff;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 14px;
  color: #000;
  text-align: center;
  padding: 4px;
  border: 2px solid #333;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  flex-shrink: 0;
}

/* Baseline 1: URL image */
.card-image {
  width: 60px;
  min-width: 45px;
  height: 84px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  flex-shrink: 0;
  object-fit: contain;
}

/* Baseline 2: sprite sheet */
.card-sprite {
  width: 60px;
  min-width: 45px;
  height: 84px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  flex-shrink: 0;
  background-repeat: no-repeat;
}

/* Baseline 4: default back gradient (no back image provided) */
.card-back {
  width: 60px;
  min-width: 45px;
  height: 84px;
  background: linear-gradient(135deg, #1a365d 0%, #2c5282 100%);
  border-radius: 8px;
  border: 2px solid #4a6fa5;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  flex-shrink: 0;
}

.card-back.has-image {
  background: transparent;
  border: none;
}

.card-back .card-image {
  width: 100%;
  height: 100%;
  border-radius: 8px;
  object-fit: contain;
}
</style>
