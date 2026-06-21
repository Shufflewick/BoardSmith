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

// Board interaction for selectable state
const boardInteraction = tryUseBoardInteraction();

const isBoardSelected = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isSelected({ id: props.element.id, name: props.element.name });
});

const isActionSelectable = computed(() => {
  if (!boardInteraction) return false;
  if (isBoardSelected.value) return false;
  const elementRef = { id: props.element.id, name: props.element.name };
  if (boardInteraction.isSelectableElement(elementRef)) return true;
  if (boardInteraction.isDraggableSelectedElement(elementRef)) return true;
  return false;
});

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
</script>

<template>
  <div
    class="die-container"
    :class="{ 'action-selectable': isActionSelectable }"
    :data-element-id="element.id"
    :data-animatable="true"
    :data-die-preview="JSON.stringify(dieProps)"
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
  border-radius: 8px;
  transition: all 0.2s ease;
}

.die-container.action-selectable {
  cursor: pointer;
  background: rgba(46, 204, 113, 0.1);
  outline: 2px solid rgba(46, 204, 113, 0.6);
  animation: pulse-die 2s ease-in-out infinite;
}

.die-container.action-selectable:hover {
  background: rgba(46, 204, 113, 0.2);
  outline-color: rgba(46, 204, 113, 1);
  transform: scale(1.05);
}

@keyframes pulse-die {
  0%, 100% {
    outline-color: rgba(46, 204, 113, 0.6);
  }
  50% {
    outline-color: rgba(46, 204, 113, 1);
  }
}

.die-label {
  font-size: 0.75rem;
  color: #888;
  text-transform: uppercase;
}
</style>
