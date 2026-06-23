<script setup lang="ts">
/**
 * DieRenderer — Delegates die rendering entirely to the Die3D component.
 *
 * No new die visual logic here — Die3D owns all 3D rendering, animation,
 * and face-label logic. This component maps element attributes to Die3D props
 * and forwards board interaction state.
 */

import { computed } from 'vue';
import { Die3D } from '../../dice/index.js';
import { tryUseBoardInteraction } from '../../../composables/useBoardInteraction.js';
import { useSelectable } from '../../../composables/useSelectable.js';

// ---------------------------------------------------------------------------
// Local GameElement interface — do NOT import from engine (module is dependency-free)
// ---------------------------------------------------------------------------
interface GameElement {
  id: number;
  name?: string;
  className: string;
  attributes?: Record<string, unknown>;
  children?: GameElement[];
  childCount?: number;
}

const props = defineProps<{
  element: GameElement;
  depth: number;
}>();

// Board interaction for all six required states
const boardInteraction = tryUseBoardInteraction();

// Element identity helper — passes notation from attributes (Pitfall 6)
function elementIdentity() {
  return {
    id: props.element.id,
    name: props.element.name,
    notation: props.element.attributes?.notation as string | undefined,
  };
}

const isBoardSelected = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isSelected(elementIdentity());
});

const isActionSelectable = computed(() => {
  if (!boardInteraction) return false;
  if (isBoardSelected.value) return false;
  if (boardInteraction.isSelectableElement(elementIdentity())) return true;
  if (boardInteraction.isDraggableSelectedElement(elementIdentity())) return true;
  return false;
});

const isBoardHighlighted = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isHighlighted(elementIdentity());
});

const isDisabled = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isDisabledElement(elementIdentity()) !== false;
});

// useSelectable — keyboard + click wiring (A11Y-01)
const { onActivate: onClick, onKeydown, attrs: selectableAttrs } = useSelectable(
  elementIdentity,
  boardInteraction ?? null,
  isActionSelectable,
  isDisabled,
);

// Map element attributes to Die3D props
const dieProps = computed(() => {
  const attrs = props.element.attributes ?? {};
  return {
    sides: ((attrs.sides as number) ?? 6) as 4 | 6 | 8 | 10 | 12 | 20,
    value: (attrs.value as number) ?? 1,
    color: attrs.color as string | undefined,
    rolling: (attrs.rolling as boolean) ?? false,
    rollCount: (attrs.rollCount as number) ?? 0,
    faceLabels: attrs.faceLabels as string[] | undefined,
    faceImages: attrs.faceImages as string[] | undefined,
  };
});

const displayLabel = computed(() => props.element.name || props.element.className);

// ARIA label: die name + current face value + state
const ariaLabel = computed(() => {
  const name = displayLabel.value;
  const value = (props.element.attributes?.value as number | undefined) ?? 1;
  const sides = (props.element.attributes?.sides as number | undefined) ?? 6;
  const base = `${name}, showing ${value} on a d${sides}`;
  if (isDisabled.value) return `${base}, unavailable`;
  if (isBoardSelected.value) return `${base}, selected`;
  if (isActionSelectable.value) return `${base}, selectable`;
  return base;
});
</script>

<template>
  <div
    v-bind="selectableAttrs"
    :aria-label="ariaLabel"
    :aria-pressed="isBoardSelected || undefined"
    :aria-disabled="isDisabled || undefined"
    class="die-container"
    :class="{
      'action-selectable': isActionSelectable,
      'is-board-highlighted': isBoardHighlighted,
      'is-board-selected': isBoardSelected,
      'is-disabled': isDisabled,
    }"
    :data-element-id="element.id"
    :data-animatable="true"
    :data-die-preview="JSON.stringify(dieProps)"
    @click="onClick"
    @keydown="onKeydown"
  >
    <Die3D
      :sides="dieProps.sides"
      :value="dieProps.value"
      :color="dieProps.color"
      :roll-count="dieProps.rollCount"
      :die-id="element.id"
      :face-labels="dieProps.faceLabels"
      :face-images="dieProps.faceImages"
      :size="60"
    />
    <span class="die-label">{{ displayLabel }}</span>
  </div>
</template>

<style scoped>
.die-container {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: var(--bsg-r-sm);
  transition: all var(--bsg-dur-base) var(--bsg-ease);
}

/* action-selectable: dashed accent outline + selectable fill */
.die-container.action-selectable {
  cursor: pointer;
  background: var(--bsg-selectable);
  outline: 2px dashed var(--bsg-accent);
  outline-offset: 2px;
}

.die-container.action-selectable:hover {
  background: var(--bsg-selectable);
  outline-style: solid;
  transform: scale(1.05);
}

/* Board interaction highlights — dashed = highlighted, solid = selected */
.die-container.is-board-highlighted {
  background: var(--bsg-selectable);
  outline: 2px dashed var(--bsg-accent);
  outline-offset: 2px;
}

.die-container.is-board-selected {
  background: var(--bsg-selected);
  outline: 2px solid var(--bsg-accent);
  outline-offset: 2px;
  box-shadow: var(--bsg-ring);
}

/* Selected fill is solid accent — pin label ink to accent-ink so the name stays legible in both themes */
.die-container.is-board-selected .die-label {
  color: var(--bsg-accent-ink);
}

/* Disabled state — hatch pattern (A11Y-09: non-color cue, not opacity alone) */
.die-container.is-disabled {
  background-image: repeating-linear-gradient(45deg, var(--bsg-cell), var(--bsg-cell) 5px, transparent 5px, transparent 10px);
  opacity: 0.6;
  cursor: not-allowed;
}

.die-container.is-disabled:hover {
  transform: none;
}

.die-label {
  font-size: 0.75rem;
  color: var(--bsg-ink-2);
  text-transform: uppercase;
}
</style>
