<script setup lang="ts">
/**
 * DeckRenderer — Per-element renderer for deck elements ($type='deck').
 *
 * Renders a stacked visual (up to 3 offset cards) with a 20px bold name and
 * count. Shows italic "Empty" when childCount/children length is 0.
 * Children are rendered via ElementRenderer.
 */

import { computed, inject, type Ref } from 'vue';
import { tryUseBoardInteraction } from '../../../composables/useBoardInteraction.js';
import { useSelectable } from '../../../composables/useSelectable.js';
import ElementRenderer from './ElementRenderer.vue';

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

const props = defineProps<{
  element: GameElement;
  depth: number;
}>();

// ---------------------------------------------------------------------------
// Inject context — exact keys provided by AutoRenderer.vue
// ---------------------------------------------------------------------------
const selectableElements = inject<Ref<Set<number>>>('selectableElements');
const selectedElements = inject<Ref<Set<number>>>('selectedElements');

// ---------------------------------------------------------------------------
// Board interaction
// ---------------------------------------------------------------------------
const boardInteraction = tryUseBoardInteraction();

// ---------------------------------------------------------------------------
// Selectable / selected state
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
// Board state computeds — defensive guard (all six required states)
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

const isDisabled = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isDisabledElement(elementIdentity()) !== false;
});

// ---------------------------------------------------------------------------
// Display values
// ---------------------------------------------------------------------------
const displayLabel = computed(() => props.element.name || props.element.className);

const childCount = computed(() => {
  if (props.element.childCount !== undefined) return props.element.childCount;
  return (props.element.children ?? []).length;
});

// Stack visual: up to 3 cards from children
const stackCards = computed(() =>
  (props.element.children ?? []).slice(0, 3).map((card, i) => ({ card, stackIndex: i })),
);

const isEmpty = computed(() => childCount.value === 0);

// aria-label: deck name + card count + current interaction state
const ariaLabel = computed(() => {
  const name = props.element.name || props.element.className;
  const countPart = childCount.value > 0 ? `, ${childCount.value} cards` : '';
  const label = `${name}${countPart}`;
  if (isDisabled.value) return `${label}, unavailable`;
  if (isSelected.value || isBoardSelected.value) return `${label}, selected`;
  if (isActionSelectable.value) return `${label}, selectable`;
  return label;
});

// ---------------------------------------------------------------------------
// Keyboard + click wiring — single composable is the ONLY activation point
// ---------------------------------------------------------------------------
const { attrs: selectableAttrs, onActivate, onKeydown } =
  useSelectable(elementIdentity, boardInteraction, isActionSelectable, isDisabled);
</script>

<template>
  <div
    :class="[
      'deck-container',
      {
        'is-selectable': isSelectable,
        'is-selected': isSelected,
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
    :aria-selected="(isSelected || isBoardSelected) || undefined"
    @click="onActivate"
    @keydown="onKeydown"
  >
    <!-- Header: name left (display font, 20px bold), count right (secondary ink) -->
    <div class="deck-header">
      <span class="deck-label">{{ displayLabel }}</span>
      <span v-if="childCount" class="deck-count">{{ childCount }} cards</span>
    </div>

    <!-- Stack visual: up to 3 offset cards -->
    <div v-if="!isEmpty" class="deck-stack">
      <ElementRenderer
        v-for="{ card, stackIndex } in stackCards"
        :key="card.id"
        :element="card"
        :depth="depth + 1"
        class="deck-card"
        :style="{ '--stack-index': stackIndex }"
      />
    </div>

    <!-- Empty state: italic "Empty" -->
    <div v-else class="deck-empty">
      <span class="empty-text">Empty</span>
    </div>
  </div>
</template>

<style scoped>
/* Container baseline — fluid card token (IA-05) */
.deck-container {
  --card-w: clamp(44px, 14cqw, 84px);
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

/* Selection states — outline never border; dashed = selectable, solid = selected */
.deck-container.is-selectable {
  cursor: pointer;
  outline: 2px dashed var(--bsg-accent);
  outline-offset: 2px;
  background: var(--bsg-selectable);
}

.deck-container.is-selectable:hover {
  transform: translateY(-2px);
  box-shadow: var(--bsg-shadow-sm);
}

.deck-container.is-selected {
  outline: 2px solid var(--bsg-accent);
  outline-offset: 2px;
  background: var(--bsg-selected);
  transform: scale(1.02);
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
.deck-container.is-selected .deck-label,
.deck-container.is-selected .deck-count,
.deck-container.is-board-selected .deck-label,
.deck-container.is-board-selected .deck-count {
  color: var(--bsg-accent-ink);
}

/* Disabled state */
.deck-container.is-disabled {
  opacity: 0.35;
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
