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

import { computed, inject, ref, type Ref, type ComputedRef } from 'vue';
import { tryUseBoardInteraction } from '../../../composables/useBoardInteraction.js';
import { useSelectable } from '../../../composables/useSelectable.js';
import { setTransformAwareDragImage } from '../../../composables/dragImage.js';
import { resolvePresentation } from '../presentation.js';
import type { PresentationOverlay } from '../presentation.js';

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

// ---------------------------------------------------------------------------
// Presentation overlay — injected from AutoRenderer (D-04)
// Resolved AFTER engine visibility filtering; resolvePresentation strips
// image/stats for __hidden elements (PRESENT-02).
// ---------------------------------------------------------------------------
const overlay = inject<ComputedRef<PresentationOverlay | undefined>>('presentation');
const presentationEntry = computed(() =>
  resolvePresentation(props.element, overlay?.value)
);

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

// Element identity function — passed to the keyboard/click composable
function elementIdentity() {
  return {
    id: props.element.id,
    name: props.element.name,
    notation: elementNotation.value || undefined,
  };
}

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

// Keyboard/ARIA: tabindex 0 for both action-selectable and drop-target cards
// so keyboard users can reach cards that are valid drag targets too.
const isInteractiveForTabindex = computed(
  () => isActionSelectable.value || isDropTarget.value,
);

// aria-label: name + current interaction state (spec: "<name>, <state>")
const ariaLabel = computed(() => {
  const name = elementNotation.value || props.element.name || props.element.className;
  if (isDisabled.value) return `${name}, unavailable`;
  if (isDropTarget.value) return `${name}, drop target`;
  if (isSelected.value) return `${name}, selected`;
  if (isActionSelectable.value) return `${name}, selectable`;
  return name;
});

// ---------------------------------------------------------------------------
// Keyboard + click wiring — single composable is the ONLY activation point
// ---------------------------------------------------------------------------
const { attrs: selectableAttrs, onActivate, onKeydown: onSelectKey } =
  useSelectable(elementIdentity, boardInteraction, isInteractiveForTabindex, isDisabled);

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

// Convenience computed for the display label — overlay wins, then engine fallback
const displayLabel = computed(
  () => presentationEntry.value?.label ?? props.element.name ?? props.element.className
);

// Effective image: overlay image overrides for visible cards; hidden cards use engine back logic.
// resolvePresentation already strips `image` for __hidden elements, so presentationEntry?.image
// will always be undefined when element.__hidden is true — no additional guard needed here.
const effectiveCardImage = computed((): ImageInfo | null => {
  const overlayImage = presentationEntry.value?.image;
  if (overlayImage) {
    return { type: 'url', src: overlayImage };
  }
  return currentCardImage.value;
});

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
        'has-image': !!(effectiveCardImage || presentationEntry?.image),
      },
    ]"
    :data-element-id="element.id"
    :data-animatable="true"
    :draggable="isActionSelectable"
    v-bind="selectableAttrs"
    :aria-label="ariaLabel"
    :aria-selected="isSelected || undefined"
    @click="onActivate"
    @keydown="onSelectKey"
    @dragstart="handleDragStart"
    @dragend="handleDragEnd"
    @dragover="handleDragOver"
    @drop="handleDrop"
  >
    <!-- Overlay render override: full component replacement (D-04) -->
    <component
      v-if="presentationEntry?.render"
      :is="presentationEntry.render"
      :element="element"
    />

    <!-- Baseline 1: URL image (overlay image or engine face/back image) -->
    <img
      v-else-if="effectiveCardImage?.type === 'url'"
      :src="effectiveCardImage.src"
      class="card-image"
      :class="{ 'card-image-back': element.__hidden || element.attributes?.__hidden }"
      :alt="displayLabel"
    />

    <!-- Baseline 2: Sprite-sheet image -->
    <div
      v-else-if="effectiveCardImage?.type === 'sprite'"
      class="card-image card-sprite"
      :class="{ 'card-image-back': element.__hidden || element.attributes?.__hidden }"
      :style="getSpriteStyle(effectiveCardImage)"
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

    <!-- Overlay stats block (D-04): only rendered when stats present; resolvePresentation
         strips stats for __hidden elements so this is never shown for hidden cards -->
    <dl v-if="presentationEntry?.stats" class="card-stats">
      <template v-for="(val, key) in presentationEntry.stats" :key="key">
        <dt>{{ key }}</dt>
        <dd>{{ val }}</dd>
      </template>
    </dl>
  </div>
</template>

<style scoped>
/* Card container — fluid card token (IA-05) */
.card-container {
  --card-w: clamp(44px, 14cqw, 84px);
  --card-h: calc(var(--card-w) * 1.4);
  display: inline-block;
  transition: transform var(--bsg-dur-base) var(--bsg-ease);
}

/* Selection states */
.card-container.is-selectable {
  cursor: pointer;
}

.card-container.is-selectable:hover {
  transform: translateY(-2px);
  box-shadow: var(--bsg-shadow-sm);
}

.card-container.is-selected {
  outline: 3px solid var(--bsg-accent);
  outline-offset: 2px;
  box-shadow: var(--bsg-ring);
}

/* action-selectable: Slate dashed accent outline + translucent fill (T-93-03 XSS guard) */
.card-container.action-selectable {
  cursor: pointer;
  outline: 2px dashed var(--bsg-accent);
  outline-offset: 2px;
  border-radius: var(--bsg-r-sm);
  background: var(--bsg-selectable);
  animation: pulse-card 2s ease-in-out infinite;
}

.card-container.action-selectable:hover {
  outline-color: var(--bsg-accent-2);
  outline-width: 3px;
  transform: translateY(-8px);
}

@keyframes pulse-card {
  0%, 100% {
    outline-color: var(--bsg-accent);
  }
  50% {
    outline-color: var(--bsg-accent-2);
  }
}

/* Board interaction highlights */
.card-container.is-board-highlighted {
  background: var(--bsg-selectable);
}

.card-container.is-board-selected {
  background: color-mix(in srgb, var(--bsg-selected) 20%, transparent);
}

/* Hidden cards */
.card-container.is-hidden {
  opacity: 0.5;
}

/* Disabled state — hatch pattern (A11Y-09: non-color cue, not opacity alone) */
.card-container.is-disabled {
  background-image: repeating-linear-gradient(45deg, var(--bsg-cell), var(--bsg-cell) 5px, transparent 5px, transparent 10px);
  opacity: 0.6;
  cursor: not-allowed;
}

.card-container.is-disabled:hover {
  transform: none;
  box-shadow: none;
}

/* Dragging state — consume CSS vars from drag-drop.css, never redefine */
.card-container.is-dragging {
  opacity: var(--bsg-dragging-opacity);
  transform: scale(var(--bsg-dragging-scale));
}

.card-container.is-drop-target {
  background: var(--bsg-droptarget);
  outline: 1px dotted var(--bsg-accent-2);
  outline-offset: 2px;
}

.card-container.is-drop-target:hover {
  background: var(--bsg-droptarget-hover);
}

/* Baseline 3: no-image visible card — surface face with name label */
.card-face {
  width: var(--card-w);
  height: var(--card-h);
  background: var(--bsg-surface);
  border-radius: var(--bsg-r-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: var(--bsg-text-sm);
  color: var(--bsg-ink);
  text-align: center;
  padding: var(--bsg-s1);
  border: 1px solid var(--bsg-line);
  box-shadow: var(--bsg-shadow-sm);
  flex-shrink: 0;
}

/* Baseline 1: URL image */
.card-image {
  width: var(--card-w);
  height: var(--card-h);
  border-radius: var(--bsg-r-sm);
  box-shadow: var(--bsg-shadow-sm);
  flex-shrink: 0;
  object-fit: contain;
}

/* Baseline 2: sprite sheet */
.card-sprite {
  width: var(--card-w);
  height: var(--card-h);
  border-radius: var(--bsg-r-sm);
  box-shadow: var(--bsg-shadow-sm);
  flex-shrink: 0;
  background-repeat: no-repeat;
}

/* Baseline 4: default card back — shared token surface (THEME-05) */
.card-back {
  width: var(--card-w);
  height: var(--card-h);
  background: var(--bsg-card-back);
  border-radius: var(--bsg-r-sm);
  border: 1px solid var(--bsg-line-2);
  box-shadow: var(--bsg-shadow-sm);
  flex-shrink: 0;
}

.card-back.has-image {
  background: transparent;
  border: none;
}

.card-back .card-image {
  width: 100%;
  height: 100%;
  border-radius: var(--bsg-r-sm);
  object-fit: contain;
}

/* Overlay stats block (D-04) */
.card-stats {
  margin: var(--bsg-s1) 0 0;
  font-size: var(--bsg-text-xs);
  color: var(--bsg-ink-2);
  display: grid;
  grid-template-columns: auto auto;
  gap: 2px 8px;
}

.card-stats dt {
  font-weight: 700;
  color: var(--bsg-ink-3);
}

.card-stats dd {
  margin: 0;
  color: var(--bsg-ink);
}
</style>
