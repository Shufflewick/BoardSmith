<script setup lang="ts">
/**
 * SpaceRenderer — Generic container renderer.
 *
 * Renders child elements via ElementRenderer (registry dispatch, not direct recursion).
 * Drives layout via CSS custom properties on .space-children derived from element
 * attributes ($direction, $gap, $fan, $fanAngle, $overlap, $align).
 *
 * Never-blank guarantee: min-height 60px ensures an empty space is always visible.
 *
 * Text content uses {{ }} interpolation only — no v-html (T-93-11 mitigation).
 */

import { computed } from 'vue';
import { tryUseBoardInteraction } from '../../../composables/useBoardInteraction.js';
import ElementRenderer from './ElementRenderer.vue';

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

// Board interaction for all six required states + drop-target (zone renderer)
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

const isDropTarget = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isDropTarget(elementIdentity());
});

const isDisabled = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isDisabledElement(elementIdentity()) !== false;
});

// Drop handlers — space zones are valid drop targets
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

// Click handler — dispatch board action when space is selectable
function handleClick(event: MouseEvent) {
  event.stopPropagation();
  if (!boardInteraction || !isActionSelectable.value) return;
  if (isDisabled.value) return;
  boardInteraction.triggerElementSelect(elementIdentity());
}

// Layout CSS vars derived from element attributes
const layoutStyles = computed(() => {
  const attrs = props.element.attributes ?? {};
  const styles: Record<string, string> = {};

  const direction = attrs.$direction as string | undefined;
  if (direction) {
    styles['--layout-direction'] = direction === 'vertical' ? 'column' : 'row';
  }

  const gap = attrs.$gap as string | undefined;
  if (gap) {
    styles['--layout-gap'] = gap;
  }

  const overlap = attrs.$overlap as number | undefined;
  if (overlap !== undefined) {
    const overlapPercent = Math.round(overlap * 100);
    styles['--layout-overlap'] = `${overlapPercent}%`;
  }

  const fan = attrs.$fan as boolean | undefined;
  const fanAngle = attrs.$fanAngle as number | undefined;
  if (fan) {
    styles['--layout-fan'] = '1';
    styles['--layout-fan-angle'] = `${fanAngle ?? 30}deg`;
  }

  const align = attrs.$align as string | undefined;
  if (align) {
    const alignMap: Record<string, string> = {
      start: 'flex-start',
      center: 'center',
      end: 'flex-end',
      stretch: 'stretch',
    };
    styles['--layout-align'] = alignMap[align] || 'center';
  }

  return styles;
});

const children = computed(() => props.element.children ?? []);

const childCountDisplay = computed(() => {
  if (children.value.length > 0) return children.value.length;
  return props.element.childCount ?? 0;
});

const hasOverlap = computed(() => props.element.attributes?.$overlap !== undefined);
const hasFan = computed(() => props.element.attributes?.$fan === true);
</script>

<template>
  <div
    class="space-container"
    :class="{
      'action-selectable': isActionSelectable,
      'is-board-highlighted': isBoardHighlighted,
      'is-board-selected': isBoardSelected,
      'is-drop-target': isDropTarget,
      'is-disabled': isDisabled,
    }"
    :style="layoutStyles"
    :data-element-id="element.id"
    @click="handleClick"
    @dragover="handleDragOver"
    @drop="handleDrop"
  >
    <!-- Optional header — only shown when element has a name -->
    <div v-if="element.name" class="space-header">
      <span class="space-label">{{ element.name }}</span>
      <span v-if="childCountDisplay > 0" class="space-count">({{ childCountDisplay }})</span>
    </div>

    <!-- Children dispatched via ElementRenderer (registry-based, not direct recursion) -->
    <div
      class="space-children"
      :class="{ 'has-overlap': hasOverlap, 'has-fan': hasFan }"
    >
      <ElementRenderer
        v-for="(child, index) in children"
        :key="child.id"
        :element="child"
        :depth="depth + 1"
        :style="{ '--card-index': index, '--card-count': children.length }"
      />
    </div>
  </div>
</template>

<style scoped>
.space-container {
  background: var(--bsg-surface);
  border: 1px solid var(--bsg-line);
  border-radius: 8px;
  padding: 12px;
  min-height: 60px;
  transition: all 0.2s ease;
}

.space-container.action-selectable {
  cursor: pointer;
  outline: 2px dashed var(--bsg-accent);
  outline-offset: 2px;
  background: var(--bsg-selectable);
}

.space-container.action-selectable:hover {
  background: var(--bsg-selectable);
}

.space-container.is-board-highlighted {
  background: var(--bsg-selectable);
  outline: 1px solid var(--bsg-accent);
  outline-offset: 2px;
}

.space-container.is-board-selected {
  background: var(--bsg-selected);
  outline: 2px solid var(--bsg-accent);
  outline-offset: 2px;
  box-shadow: var(--bsg-ring);
  transform: scale(1.02);
}

.space-container.is-drop-target {
  background: var(--bsg-droptarget);
  outline: 2px dotted var(--bsg-accent-2);
  outline-offset: 2px;
}

.space-container.is-drop-target:hover {
  background: var(--bsg-droptarget-hover);
}

.space-container.is-disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.space-container.is-disabled:hover {
  background: var(--bsg-surface);
}

.space-header {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.space-label {
  font-weight: bold;
  color: var(--bsg-ink-2);
  font-size: 16px;
}

.space-count {
  color: var(--bsg-ink-3);
  font-size: 13px;
}

.space-children {
  display: flex;
  flex-wrap: wrap;
  gap: var(--layout-gap, 8px);
  flex-direction: var(--layout-direction, row);
  align-items: var(--layout-align, flex-start);
  justify-content: var(--layout-align, flex-start);
}

/* Overlap layout */
.space-children.has-overlap > * {
  margin-right: calc(-1 * var(--layout-overlap, 50%) * 70px);
}

.space-children.has-overlap > *:last-child {
  margin-right: 0;
}

/* Fan layout */
.space-children.has-fan > * {
  --fan-angle: var(--layout-fan-angle, 30deg);
  --half-count: calc((var(--card-count, 1) - 1) / 2);
  --angle-step: calc(var(--fan-angle) / max(var(--card-count, 1) - 1, 1));
  --rotation: calc((var(--card-index, 0) - var(--half-count)) * var(--angle-step));
  transform: rotate(var(--rotation));
  transform-origin: center 150%;
}
</style>
