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
 * Board interaction states (action-selectable, is-board-highlighted,
 * is-board-selected, is-disabled) come from useElementBoardState — the
 * substrate is never modified.
 *
 * Face/back image selection: hidden cards ALWAYS show the back image;
 * visible cards show the face image. The face URL is never exposed when
 * the element is a hidden placeholder (T-93-04).
 */

import { computed, inject, ref, watch, type Ref } from 'vue';
import { useElementBoardState } from '../../../composables/useElementBoardState.js';
import { useSelectable } from '../../../composables/useSelectable.js';
import { setTransformAwareDragImage } from '../../../composables/dragImage.js';
import { usePresentationEntry } from '../../../composables/usePresentationEntry.js';
import { isHiddenPlaceholder } from '../../../../engine/element/hidden-placeholder.js';
import { getSpriteStyle, parseImageInfo, type ImageInfo } from '../../../utils/image.js';
import CardBack from './CardBack.vue';
import type { GameElement } from '../auto-ui-helpers.js';

const props = defineProps<{
  element: GameElement;
}>();

// ---------------------------------------------------------------------------
// Inject context — exact keys provided by AutoRenderer.vue
// ---------------------------------------------------------------------------
const defaultBackImage = inject<Ref<ImageInfo | null>>('defaultBackImage', ref(null));

const {
  boardInteraction,
  identity: elementIdentity,
  isHighlighted: isBoardHighlighted,
  isSelected: isBoardSelected,
  isActionSelectable: isCandidate,
  isDraggableSelected,
  isDisabled,
  canStartDrag,
  isDropTarget,
  isDragged,
} = useElementBoardState(() => props.element);

// A card can be dragged, so it also offers the auto-filled first pick to drag on.
const isActionSelectable = computed(() => isCandidate.value || isDraggableSelected.value);

const presentationEntry = usePresentationEntry(() => props.element);

// Whether the seat is sent a placeholder for this card rather than the card.
const isHidden = computed(() => isHiddenPlaceholder(props.element));

// Keyboard/ARIA: tabindex 0 for both action-selectable and drop-target cards
// so keyboard users can reach cards that are valid drag targets too.
// A disabled candidate starts no drag, as a click on it chooses nothing (#1190).
const canDrag = computed(() => isActionSelectable.value && canStartDrag.value);

const isInteractiveForTabindex = computed(
  () => isActionSelectable.value || isDropTarget.value,
);

// aria-label: name + current interaction state (spec: "<name>, <state>")
const ariaLabel = computed(() => {
  const name = (props.element.attributes?.notation as string | undefined) || props.element.name || props.element.className;
  if (isDisabled.value) return `${name}, unavailable`;
  if (isDropTarget.value) return `${name}, drop target`;
  if (isBoardSelected.value) return `${name}, selected`;
  if (isActionSelectable.value) return `${name}, selectable`;
  return name;
});

// ---------------------------------------------------------------------------
// Keyboard + click wiring — single composable is the ONLY activation point
// ---------------------------------------------------------------------------
const { attrs: selectableAttrs, onActivate, onKeydown: onSelectKey } =
  useSelectable(elementIdentity, boardInteraction, isInteractiveForTabindex, isDisabled, 'card');

// ---------------------------------------------------------------------------
// Card image resolution — face when visible, back when hidden (T-93-04)
// ---------------------------------------------------------------------------
const cardImages = computed(() => {
  const attrs = props.element.attributes;
  if (!attrs?.$images) return null;
  const images = attrs.$images as Record<string, unknown>;
  return { face: images.face, back: images.back };
});

const currentCardImage = computed((): ImageInfo | null => {
  if (!cardImages.value) return null;

  // CRITICAL: hidden cards always show back, never face (T-93-04)
  return parseImageInfo(isHidden.value ? cardImages.value.back : cardImages.value.face);
});

// Back image for hidden cards when no $images.back is present
const backImageFallback = computed((): ImageInfo | null => {
  // Check element's own $images.back first
  const ownImages = props.element.attributes?.$images as Record<string, unknown> | undefined;
  // Fall back to default back image from game view
  return parseImageInfo(ownImages?.back) ?? defaultBackImage.value;
});

// Convenience computed for the display label — overlay wins, then engine fallback
const displayLabel = computed(
  () => presentationEntry.value?.label ?? props.element.name ?? props.element.className
);

// Effective image: overlay image overrides for visible cards; hidden cards use engine back logic.
// resolvePresentation already strips `image` for hidden placeholders, so presentationEntry?.image
// is always undefined when isHidden is true — no additional guard needed here.
const effectiveCardImage = computed((): ImageInfo | null => {
  const overlayImage = presentationEntry.value?.image;
  if (overlayImage) {
    return { type: 'url', src: overlayImage };
  }
  return currentCardImage.value;
});

// ---------------------------------------------------------------------------
// Load-guarded reveal for Baseline 1 (url image) — DEF-A guard.
// The url <img> is revealed only after its own @load fires; @error reverts to
// the always-rendered .card-face drawn fallback. Reset when the resolved src
// changes so a card reused for a different asset re-guards (Pitfall: stale
// `loaded=true` would flash a broken image state for the old src).
// ---------------------------------------------------------------------------
const loaded = ref(false);
watch(
  () => (effectiveCardImage.value?.type === 'url' ? effectiveCardImage.value.src : null),
  () => {
    loaded.value = false;
  },
);

// ---------------------------------------------------------------------------
// Drag handlers
// ---------------------------------------------------------------------------
function handleDragStart(event: DragEvent) {
  if (!boardInteraction || !canDrag.value || !boardInteraction.startDrag(elementIdentity())) {
    event.preventDefault();
    return;
  }

  setTransformAwareDragImage(event, event.currentTarget as HTMLElement);

  event.dataTransfer?.setData('boardsmith/element', JSON.stringify(elementIdentity()));
  event.dataTransfer!.effectAllowed = 'move';
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

  boardInteraction.triggerDrop(elementIdentity());
}


</script>

<template>
  <div
    :class="[
      'card-container',
      {
        'action-selectable': isActionSelectable,
        'is-board-highlighted': isBoardHighlighted,
        'is-board-selected': isBoardSelected,
        'is-hidden': isHidden,
        'is-disabled': isDisabled,
        'is-draggable': canDrag,
        'is-dragging': isDragged,
        'is-drop-target': isDropTarget,
        'has-image': !!(effectiveCardImage || presentationEntry?.image),
      },
    ]"
    :data-animatable="true"
    :draggable="canDrag"
    v-bind="selectableAttrs"
    :aria-label="ariaLabel"
    :aria-pressed="isBoardSelected || undefined"
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

    <!-- Baseline 1: URL image (overlay image or engine face/back image).
         Zero-layout-diff (DEF-A guard): the drawn .card-face fallback is always
         rendered underneath at the fixed card-w/card-h box; the <img> overlays it
         absolutely and is revealed only on @load, reverting to the fallback on
         @error. Neither element leaves flow, so toggling `loaded` never resizes
         the slot. -->
    <div v-else-if="effectiveCardImage?.type === 'url'" class="card-face-container">
      <div class="card-face">
        {{ displayLabel }}
      </div>
      <img
        :src="effectiveCardImage.src"
        class="card-image card-image-overlay"
        :class="{
          'card-image-back': isHidden,
          'is-loaded': loaded,
        }"
        :alt="displayLabel"
        @load="loaded = true"
        @error="loaded = false"
      />
    </div>

    <!-- Baseline 2: Sprite-sheet image -->
    <div
      v-else-if="effectiveCardImage?.type === 'sprite'"
      class="card-image card-sprite"
      :class="{ 'card-image-back': isHidden }"
      :style="getSpriteStyle(effectiveCardImage)"
    ></div>

    <!-- Baseline 3 / 4: No image from $images — show face or back fallback -->
    <template v-else>
      <!-- Hidden card with no face image — show back gradient or back image fallback -->
      <CardBack v-if="isHidden" :image="backImageFallback" />
      <!-- Baseline 3: Visible card with no image — white face with name label -->
      <div v-else class="card-face">
        {{ displayLabel }}
      </div>
    </template>

    <!-- Overlay stats block (D-04): only rendered when stats present; resolvePresentation
         strips stats for hidden placeholders so this is never shown for hidden cards -->
    <dl v-if="presentationEntry?.stats" class="card-stats">
      <template v-for="(val, key) in presentationEntry.stats" :key="key">
        <dt>{{ key }}</dt>
        <dd>{{ val }}</dd>
      </template>
    </dl>
  </div>
</template>

<style scoped>
/* Card container — natural card token (IA-05) */
.card-container {
  --card-w: var(--bsg-card-w);
  --card-h: calc(var(--card-w) * 1.4);
  display: inline-block;
  transition: transform var(--bsg-dur-base) var(--bsg-ease);
}

/* action-selectable: Slate dashed accent outline + translucent fill (T-93-03 XSS guard) */
/* CALM, NOT A DISCO — static glow ring for selectable; no infinite attract pulse */
.card-container.action-selectable {
  cursor: pointer;
  outline: 2px dashed var(--bsg-accent);
  outline-offset: 2px;
  border-radius: var(--bsg-r-sm);
  background: var(--bsg-selectable);
  box-shadow: var(--bsg-ring);
}

.card-container.action-selectable:hover {
  outline-color: var(--bsg-accent-2);
  outline-width: 3px;
  transform: translateY(-8px);
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

/* Baseline 1 load-guard: fixed-size container shared by the drawn fallback and
   the overlay <img> (DEF-A guard, zero-layout-diff) */
.card-face-container {
  position: relative;
  width: var(--card-w);
  height: var(--card-h);
  flex-shrink: 0;
}

.card-face-container .card-face {
  width: 100%;
  height: 100%;
}

.card-image-overlay {
  position: absolute;
  inset: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--bsg-dur-base) var(--bsg-ease);
}

.card-image-overlay.is-loaded {
  opacity: 1;
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
