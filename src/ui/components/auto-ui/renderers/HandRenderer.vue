<script setup lang="ts">
/**
 * HandRenderer — Per-element renderer for hand elements ($type='hand').
 *
 * Renders children (cards) via ElementRenderer.
 * Supports fan, overlap, and two-row layout modes.
 *
 * The two-row hand sorting logic is copied verbatim from the source component
 * lines 409-453 (named Phase 92 carry-forward; Pitfall 6).
 */

import { computed, inject, type Ref, type ComputedRef } from 'vue';
import { tryUseBoardInteraction } from '../../../composables/useBoardInteraction.js';
import { useSelectable } from '../../../composables/useSelectable.js';
import ElementRenderer from './ElementRenderer.vue';
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
const defaultBackImage = inject<Ref<ImageInfo | null>>('defaultBackImage');

// ---------------------------------------------------------------------------
// Board interaction — whole-hand action-selectable state
// ---------------------------------------------------------------------------
const boardInteraction = tryUseBoardInteraction();

// ---------------------------------------------------------------------------
// Presentation overlay injection (D-04)
// ---------------------------------------------------------------------------
const overlay = inject<ComputedRef<PresentationOverlay | undefined>>('presentation');
const presentationEntry = computed(() =>
  resolvePresentation(props.element, overlay?.value)
);

// ---------------------------------------------------------------------------
// Selectable / selected state (from injected sets)
// ---------------------------------------------------------------------------
const isSelectable = computed(() => selectableElements?.value?.has(props.element.id) ?? false);
const isSelected = computed(() => selectedElements?.value?.has(props.element.id) ?? false);

// Element identity helper — passes notation from attributes (Pitfall 6)
function elementIdentity() {
  return {
    id: props.element.id,
    name: props.element.name,
    notation: props.element.attributes?.notation as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// Board state computeds — all six required states + drop-target (zone renderer)
// ---------------------------------------------------------------------------
const isBoardHighlighted = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isHighlighted(elementIdentity());
});

const isBoardSelected = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isSelected(elementIdentity());
});

const isActionSelectable = computed(() => {
  if (!boardInteraction) return false;
  if (isBoardSelected.value) return false;
  return boardInteraction.isSelectableElement(elementIdentity());
});

const isDropTarget = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isDropTarget(elementIdentity());
});

const isDisabled = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isDisabledElement(elementIdentity()) !== false;
});

// ---------------------------------------------------------------------------
// Player info for header
// ---------------------------------------------------------------------------
const playerInfo = computed(() => {
  const player = props.element.attributes?.player as { seat?: number; name?: string } | undefined;
  return player;
});

const isOwned = computed(() => playerInfo.value?.seat === playerSeat);

const playerName = computed(() => {
  const player = playerInfo.value;
  return player?.name || `Player ${(player?.seat ?? 0) + 1}`;
});

// ---------------------------------------------------------------------------
// Fan + overlap layout attributes
// ---------------------------------------------------------------------------
const isFan = computed(() => props.element.attributes?.$fan === true);
const fanAngle = computed(() => (props.element.attributes?.$fanAngle as number) ?? 30);
const hasOverlap = computed(() => props.element.attributes?.$overlap !== undefined);

// ---------------------------------------------------------------------------
// Visible children
// ---------------------------------------------------------------------------
const visibleChildren = computed(() => {
  if (props.element.__hidden) return [];
  return props.element.children ?? [];
});

// Count display (for hidden hands that expose only childCount)
const childCountDisplay = computed(() => {
  if (props.element.childCount !== undefined) return props.element.childCount;
  return visibleChildren.value.length;
});

// ---------------------------------------------------------------------------
// Back image for hidden card placeholders (from defaultBackImage)
// ---------------------------------------------------------------------------
const childBackImage = computed((): ImageInfo | null => {
  // Check visible children for back image
  for (const child of (props.element.children ?? [])) {
    const images = child.attributes?.$images as Record<string, unknown> | undefined;
    if (images?.back) {
      const back = images.back;
      if (typeof back === 'string') return { type: 'url', src: back };
      if (typeof back === 'object' && back !== null) {
        const s = back as { sprite?: string; x?: number; y?: number; width?: number; height?: number };
        if (s.sprite && typeof s.x === 'number' && typeof s.y === 'number') {
          return { type: 'sprite', sprite: s.sprite, x: s.x, y: s.y, width: s.width ?? 238, height: s.height ?? 333 };
        }
      }
    }
  }
  return defaultBackImage?.value ?? null;
});

// Helper to compute sprite style for hidden card placeholders
function getSpriteStyle(info: ImageInfo): Record<string, string> {
  if (info.type !== 'sprite') return {};
  const NATIVE_CARD_WIDTH = 238;
  const NATIVE_CARD_HEIGHT = 333;
  const SPRITE_COLS = 13;
  const SPRITE_ROWS = 5;
  const displayWidth = 60;
  const displayHeight = 84;
  const scaleX = displayWidth / NATIVE_CARD_WIDTH;
  const scaleY = displayHeight / NATIVE_CARD_HEIGHT;
  return {
    backgroundImage: `url(${info.sprite})`,
    backgroundPosition: `-${info.x * scaleX}px -${info.y * scaleY}px`,
    backgroundSize: `${SPRITE_COLS * NATIVE_CARD_WIDTH * scaleX}px ${SPRITE_ROWS * NATIVE_CARD_HEIGHT * scaleY}px`,
    backgroundRepeat: 'no-repeat',
  };
}

// ---------------------------------------------------------------------------
// TWO-ROW HAND SORTING LOGIC — COPIED VERBATIM FROM LEGACY COMPONENT LINES 409-453
// Phase 92 carry-forward; Pitfall 6 — DO NOT RE-IMPLEMENT
// ---------------------------------------------------------------------------

// Threshold for splitting hand into two rows (cards per row)
const MAX_CARDS_PER_ROW = 10;

// Sort cards alphanumerically by their name/label
const sortedHandCards = computed(() => {
  const cards = [...visibleChildren.value];
  return cards.sort((a, b) => {
    const nameA = a.name || '';
    const nameB = b.name || '';
    // Natural sort: extract rank and suit for proper ordering
    // Card names are typically like "5H", "10S", "KD", "AC"
    const parseCard = (name: string) => {
      const match = name.match(/^(\d+|[AJQK])([CDHS]?)$/i);
      if (!match) return { rank: 0, suit: name };
      const rankStr = match[1].toUpperCase();
      const suit = (match[2] || '').toUpperCase();
      // Convert rank to number for proper sorting
      const rankMap: Record<string, number> = { 'A': 1, 'J': 11, 'Q': 12, 'K': 13 };
      const rank = rankMap[rankStr] ?? parseInt(rankStr, 10);
      return { rank, suit };
    };
    const cardA = parseCard(nameA);
    const cardB = parseCard(nameB);
    // Sort by rank first, then by suit
    if (cardA.rank !== cardB.rank) return cardA.rank - cardB.rank;
    return cardA.suit.localeCompare(cardB.suit);
  });
});

// Whether hand needs to split into two rows
const handNeedsTwoRows = computed(() => {
  const count = visibleChildren.value.length || props.element.childCount || 0;
  return count > MAX_CARDS_PER_ROW;
});

// Back row cards (first half, displayed behind)
const backRowCards = computed(() => {
  if (!handNeedsTwoRows.value) return [];
  const cards = sortedHandCards.value;
  const halfPoint = Math.ceil(cards.length / 2);
  return cards.slice(0, halfPoint);
});

// Front row cards (second half, or all if single row)
const frontRowCards = computed(() => {
  if (!handNeedsTwoRows.value) return sortedHandCards.value;
  const cards = sortedHandCards.value;
  const halfPoint = Math.ceil(cards.length / 2);
  return cards.slice(halfPoint);
});

// ---------------------------------------------------------------------------
// useSelectable — whole-hand action-selectable (A11Y-01)
// Provides click + keyboard (Enter/Space) activation for the hand container.
// ---------------------------------------------------------------------------
const { onActivate: handleSelect, onKeydown, attrs: selectableAttrs } = useSelectable(
  elementIdentity,
  boardInteraction ?? null,
  isActionSelectable,
  isDisabled,
);

// Drop handler — hand zones are valid drop targets (Go Fish "ask" target, etc.)
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

// Suppress unused warnings for injected values not used directly in script
// (they drive CSS classes in the template)
void isSelectable;
void isSelected;
void isBoardHighlighted;
void isBoardSelected;
</script>

<template>
  <div
    role="group"
    :aria-label="`Your hand, ${childCountDisplay} cards`"
    :tabindex="selectableAttrs.tabindex"
    :aria-disabled="selectableAttrs['aria-disabled']"
    :aria-selected="isSelected || undefined"
    :class="[
      'hand-container',
      {
        'is-selectable': isSelectable,
        'is-selected': isSelected,
        'action-selectable': isActionSelectable,
        'is-board-highlighted': isBoardHighlighted,
        'is-board-selected': isBoardSelected,
        'is-drop-target': isDropTarget,
        'is-disabled': isDisabled,
      },
    ]"
    :data-zone="element.name"
    :data-zone-id="element.id"
    @click="handleSelect"
    @keydown="onKeydown"
    @dragover="handleDragOver"
    @drop="handleDrop"
  >
    <!-- Header: overlay label wins, then element.name, then ownership fallback (CF-2 + D-04) -->
    <div class="hand-header">
      <span class="hand-label">
        {{ presentationEntry?.label ?? element.name ?? (isOwned ? 'Your Hand' : `${playerName}'s Hand`) }}
      </span>
      <span class="hand-count">({{ childCountDisplay }})</span>
    </div>

    <!-- Cards wrapper -->
    <div
      class="hand-cards-wrapper"
      :class="{
        'has-fan': isFan,
        'has-overlap': hasOverlap,
        'two-rows': handNeedsTwoRows,
      }"
      :style="isFan ? { '--layout-fan-angle': `${fanAngle}deg` } : {}"
    >
      <!-- Back row (first half of cards when split) -->
      <div v-if="handNeedsTwoRows" class="hand-cards hand-cards-back">
        <template v-if="visibleChildren.length > 0">
          <ElementRenderer
            v-for="(child, index) in backRowCards"
            :key="child.id"
            :element="child"
            :depth="depth + 1"
            class="hand-card"
            :style="{ '--card-index': index, '--card-count': backRowCards.length, '--row': 'back' }"
          />
        </template>
        <template v-else-if="element.childCount">
          <div
            v-for="i in Math.ceil(element.childCount / 2)"
            :key="i"
            class="hand-card card-back-small"
            :class="{ 'has-image': !!childBackImage }"
            :style="{ '--card-index': i - 1, '--card-count': Math.ceil(element.childCount / 2), '--row': 'back' }"
          >
            <img v-if="childBackImage?.type === 'url'" :src="childBackImage.src" class="card-image" alt="Card back" />
            <div
              v-else-if="childBackImage?.type === 'sprite'"
              class="card-image card-sprite"
              :style="getSpriteStyle(childBackImage)"
            ></div>
          </div>
        </template>
      </div>

      <!-- Front row (or all cards when single row) -->
      <div class="hand-cards hand-cards-front" :data-zone="element.name">
        <template v-if="visibleChildren.length > 0">
          <ElementRenderer
            v-for="(child, index) in frontRowCards"
            :key="child.id"
            :element="child"
            :depth="depth + 1"
            class="hand-card"
            :style="{ '--card-index': index, '--card-count': frontRowCards.length, '--row': 'front' }"
          />
        </template>
        <template v-else-if="element.childCount">
          <div
            v-for="i in (handNeedsTwoRows ? Math.floor(element.childCount / 2) : element.childCount)"
            :key="i"
            class="hand-card card-back-small"
            :class="{ 'has-image': !!childBackImage }"
            :style="{ '--card-index': i - 1, '--card-count': handNeedsTwoRows ? Math.floor(element.childCount / 2) : element.childCount, '--row': 'front' }"
          >
            <img v-if="childBackImage?.type === 'url'" :src="childBackImage.src" class="card-image" alt="Card back" />
            <div
              v-else-if="childBackImage?.type === 'sprite'"
              class="card-image card-sprite"
              :style="getSpriteStyle(childBackImage)"
            ></div>
          </div>
        </template>
        <div v-if="!visibleChildren.length && !element.childCount" class="empty-hand">No cards</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Container baseline — fluid card token (IA-05) */
.hand-container {
  --card-w: clamp(44px, 14cqw, 84px);
  --card-h: calc(var(--card-w) * 1.4);
  background: var(--bsg-surface);
  border-radius: var(--bsg-r-md);
  padding: var(--bsg-s4);
  transition: all var(--bsg-dur-base) var(--bsg-ease);
  overflow: visible;
  position: relative;
}

/* Selection states */
.hand-container.is-selectable {
  cursor: pointer;
}

.hand-container.is-selectable:hover {
  transform: translateY(-2px);
  box-shadow: var(--bsg-shadow-sm);
}

.hand-container.is-selected {
  outline: 3px solid var(--bsg-accent);
  outline-offset: 2px;
  box-shadow: var(--bsg-ring);
}

/* Whole-hand action-selectable — Slate dashed outline (THEME-02: outline not border) */
.hand-container.action-selectable {
  cursor: pointer;
  outline: 2px dashed var(--bsg-accent);
  outline-offset: 4px;
  background: var(--bsg-selectable);
  animation: pulse-hand 2s ease-in-out infinite;
}

.hand-container.action-selectable:hover {
  outline-color: var(--bsg-accent-2);
  background: color-mix(in srgb, var(--bsg-accent) 22%, transparent);
  transform: translateY(-2px);
  box-shadow: var(--bsg-shadow-sm);
}

@keyframes pulse-hand {
  0%, 100% {
    outline-color: var(--bsg-accent);
  }
  50% {
    outline-color: var(--bsg-accent-2);
  }
}

/* Board interaction highlights */
.hand-container.is-board-highlighted {
  background: var(--bsg-selectable);
}

.hand-container.is-board-selected {
  background: color-mix(in srgb, var(--bsg-selected) 20%, transparent);
}

/* Drop target — hand zones can receive dragged elements (Go Fish target) */
.hand-container.is-drop-target {
  background: var(--bsg-droptarget);
  outline: 1px dotted var(--bsg-accent-2);
  outline-offset: 2px;
}

.hand-container.is-drop-target:hover {
  background: var(--bsg-droptarget-hover);
}

/* Disabled state */
.hand-container.is-disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.hand-container.is-disabled:hover {
  transform: none;
  box-shadow: none;
}

/* Header */
.hand-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--bsg-s3);
}

.hand-label {
  font-weight: bold;
  color: var(--bsg-ink);
}

.hand-count {
  color: var(--bsg-ink-3);
  font-size: var(--bsg-text-sm);
}

/* Cards wrapper */
.hand-cards-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
}

/* Two-row mode: back row peeks above front row */
.hand-cards-wrapper.two-rows .hand-cards-back {
  margin-bottom: -50px;
  z-index: 1;
}

.hand-cards-wrapper.two-rows .hand-cards-front {
  z-index: 2;
}

/* Base hand-cards row */
.hand-cards {
  display: flex;
  min-height: 90px;
  flex-direction: var(--layout-direction, row);
  align-items: flex-end;
  justify-content: center;
  gap: var(--bsg-s2);
  flex-wrap: wrap;
}

/* Fan mode: add padding to contain rotated cards */
.hand-cards-wrapper.has-fan .hand-cards {
  padding: 20px 30px 10px 30px;
  gap: 0;
  flex-wrap: nowrap;
}

/* Overlap mode */
.hand-cards-wrapper.has-overlap .hand-cards {
  gap: 0;
}

/* Individual card slot */
.hand-card {
  flex-shrink: 0;
  transition: transform var(--bsg-dur-base) var(--bsg-ease), z-index 0s;
}

.hand-card:hover {
  z-index: 100 !important;
}

/* Non-fan cards lift on hover */
.hand-cards-wrapper:not(.has-fan) .hand-card:hover {
  transform: translateY(-8px);
}

/* Overlap layout */
.hand-cards-wrapper.has-overlap .hand-card {
  margin-right: -10px;
}

.hand-cards-wrapper.has-overlap .hand-card:last-child {
  margin-right: 0;
}

/* Fan layout — rotate around bottom center */
.hand-cards-wrapper.has-fan .hand-card {
  --fan-angle: var(--layout-fan-angle, 30deg);
  --half-count: calc((var(--card-count, 1) - 1) / 2);
  --angle-step: calc(var(--fan-angle) / max(var(--card-count, 1) - 1, 1));
  --rotation: calc((var(--card-index, 0) - var(--half-count)) * var(--angle-step));
  transform: rotate(var(--rotation));
  transform-origin: center bottom;
}

/* Fan cards lift and un-rotate on hover */
.hand-cards-wrapper.has-fan .hand-card:hover {
  transform: rotate(0deg) translateY(-15px) scale(1.05);
  z-index: 100 !important;
}

/* Hidden card placeholder — shared card-back token (THEME-05) */
.card-back-small {
  width: var(--card-w);
  height: var(--card-h);
  background: var(--bsg-card-back);
  border-radius: var(--bsg-r-sm);
  border: 1px solid var(--bsg-line-2);
  box-shadow: var(--bsg-shadow-sm);
  flex-shrink: 0;
}

.card-back-small.has-image {
  background: transparent;
  border: none;
}

.card-image {
  width: var(--card-w);
  height: var(--card-h);
  border-radius: var(--bsg-r-sm);
  box-shadow: var(--bsg-shadow-sm);
  flex-shrink: 0;
  object-fit: contain;
}

.card-sprite {
  width: var(--card-w);
  height: var(--card-h);
  border-radius: var(--bsg-r-sm);
  box-shadow: var(--bsg-shadow-sm);
  flex-shrink: 0;
  background-repeat: no-repeat;
}

.empty-hand {
  color: var(--bsg-ink-3);
  font-style: italic;
  display: flex;
  align-items: center;
  min-height: 90px;
}
</style>
