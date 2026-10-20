<script setup lang="ts">
/**
 * DeckRenderer — Per-element renderer for deck elements ($type='deck').
 *
 * Renders a stacked visual (up to 3 offset cards) with a 20px bold name and
 * count. Children are rendered via ElementRenderer; a deck whose cards were not
 * sent is drawn as card backs. Shows italic "Empty" only when the deck is known
 * to be empty.
 */

import { computed, inject, ref, type Ref } from 'vue';
import { useElementBoardState } from '../../../composables/useElementBoardState.js';
import { useSelectable } from '../../../composables/useSelectable.js';
import { parseImageInfo, type ImageInfo } from '../../../utils/image.js';
import ElementRenderer from './ElementRenderer.vue';
import CardBack from './CardBack.vue';
import type { GameElement } from '../auto-ui-helpers.js';

interface DeckElement extends GameElement {
  zoneVisibility?: { mode: string };
}

const props = defineProps<{
  element: DeckElement;
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
  isActionSelectable,
  isDisabled,
} = useElementBoardState(() => props.element);

// ---------------------------------------------------------------------------
// Display values
// ---------------------------------------------------------------------------
const displayLabel = computed(() => props.element.name || props.element.className);

const childCount = computed(() => {
  if (props.element.childCount !== undefined) return props.element.childCount;
  return (props.element.children ?? []).length;
});

// Stack visual: up to 3 cards from children. children[0] is the top card (#893),
// so it is raised highest while staying first in reading order.
const stackCards = computed(() => {
  const top = (props.element.children ?? []).slice(0, 3);
  return top.map((card, i) => ({ card, stackIndex: top.length - 1 - i }));
});

// A 'hidden' zone sends neither its cards nor their count (#1056): its size is unknown, not 0.
const isSizeHidden = computed(
  () => props.element.childCount === undefined && props.element.zoneVisibility?.mode === 'hidden',
);

const isEmpty = computed(() => !isSizeHidden.value && childCount.value === 0);

const countText = computed(() => {
  if (isSizeHidden.value) return 'Size hidden';
  return childCount.value > 0 ? `${childCount.value} cards` : '';
});

const backImage = computed(
  () => parseImageInfo((props.element.attributes?.$images as Record<string, unknown> | undefined)?.back) ?? defaultBackImage.value,
);

// aria-label: deck name + card count + current interaction state
const ariaLabel = computed(() => {
  const name = props.element.name || props.element.className;
  const label = countText.value ? `${name}, ${countText.value.toLowerCase()}` : name;
  if (isDisabled.value) return `${label}, unavailable`;
  if (isBoardSelected.value) return `${label}, selected`;
  if (isActionSelectable.value) return `${label}, selectable`;
  return label;
});

// ---------------------------------------------------------------------------
// Keyboard + click wiring — single composable is the ONLY activation point
// ---------------------------------------------------------------------------
const { attrs: selectableAttrs, onActivate, onKeydown } =
  useSelectable(elementIdentity, boardInteraction, isActionSelectable, isDisabled, 'deck');
</script>

<template>
  <div
    :class="[
      'deck-container',
      {
        'action-selectable': isActionSelectable,
        'is-board-highlighted': isBoardHighlighted,
        'is-board-selected': isBoardSelected,
        'is-disabled': isDisabled,
      },
    ]"
    :data-zone="element.name"
    :data-zone-id="element.id"
    v-bind="selectableAttrs"
    :aria-label="ariaLabel"
    :aria-pressed="isBoardSelected || undefined"
    @click="onActivate"
    @keydown="onKeydown"
  >
    <!-- Header: name left (display font, 20px bold), count right (secondary ink) -->
    <div class="deck-header">
      <span class="deck-label">{{ displayLabel }}</span>{{ ' ' }}<span v-if="countText" class="deck-count">{{ countText }}</span>
    </div>

    <!-- Stack visual: up to 3 offset cards, or 3 backs when the cards were not sent -->
    <div v-if="!isEmpty" class="deck-stack">
      <template v-if="stackCards.length">
        <ElementRenderer
          v-for="{ card, stackIndex } in stackCards"
          :key="card.id"
          :element="card"
          class="deck-card"
          :style="{ '--stack-index': stackIndex, zIndex: stackIndex }"
        />
      </template>
      <CardBack
        v-for="stackIndex in [2, 1, 0]"
        v-else
        :key="stackIndex"
        :image="backImage"
        class="deck-card"
        :style="{ '--stack-index': stackIndex, zIndex: stackIndex }"
      />
    </div>

    <!-- Empty state: italic "Empty" -->
    <div v-else class="deck-empty">
      <span class="empty-text">Empty</span>
    </div>
  </div>
</template>

<style scoped>
/* Container baseline — natural card token (IA-05) */
.deck-container {
  --card-w: var(--bsg-card-w);
  --card-h: calc(var(--card-w) * 1.4);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--bsg-surface);
  border: 1px solid var(--bsg-line);
  border-radius: 12px;
  transition: all var(--bsg-dur-base) var(--bsg-ease);
}

/* action-selectable: dashed accent outline + selectable fill */
.deck-container.action-selectable {
  cursor: pointer;
  outline: 2px dashed var(--bsg-accent);
  outline-offset: 2px;
  background: var(--bsg-selectable);
}

.deck-container.action-selectable:hover {
  outline-style: solid;
  transform: translateY(-2px);
  box-shadow: var(--bsg-shadow-sm);
}

/* Board interaction highlights */
.deck-container.is-board-highlighted {
  outline: 2px dashed var(--bsg-accent);
  outline-offset: 2px;
  background: var(--bsg-selectable);
}

.deck-container.is-board-selected {
  outline: 2px solid var(--bsg-accent);
  outline-offset: 2px;
  background: var(--bsg-selected);
}

/* Selected fill is solid accent — pin label/count ink to accent-ink so text stays legible in both themes */
.deck-container.is-board-selected .deck-label,
.deck-container.is-board-selected .deck-count {
  color: var(--bsg-accent-ink);
}

/* Disabled state — hatch pattern (A11Y-09: non-color cue, not opacity alone) */
.deck-container.is-disabled {
  background-image: repeating-linear-gradient(45deg, var(--bsg-cell), var(--bsg-cell) 5px, transparent 5px, transparent 10px);
  opacity: 0.6;
  cursor: not-allowed;
}

.deck-container.is-disabled:hover {
  transform: none;
  box-shadow: none;
}

/* Header */
.deck-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

/* Name: 20px bold display type */
.deck-label {
  font-size: 20px;
  font-weight: bold;
  color: var(--bsg-ink);
  font-family: var(--bsg-display);
  text-shadow: 0 1px 2px rgba(0,0,0,.25);
}

/* Count: secondary ink */
.deck-count {
  font-size: 13px;
  color: var(--bsg-ink-2);
}

/* Stack visual: fluid card-w relative container for absolute-positioned cards (IA-05) */
.deck-stack {
  position: relative;
  isolation: isolate;
  width: var(--card-w);
  height: var(--card-h);
  align-self: flex-start;
}

/* Each card in the stack: absolute, offset by stackIndex for depth illusion */
.deck-card {
  position: absolute;
  top: calc(var(--stack-index, 0) * -2px);
  left: calc(var(--stack-index, 0) * 1px);
}

/* Empty state */
.deck-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
}

.empty-text {
  font-style: italic;
  color: var(--bsg-ink-3);
}
</style>
