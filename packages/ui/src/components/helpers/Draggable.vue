<script setup lang="ts">
import { ref, computed } from 'vue';

interface DraggableProps {
  /** The element data being dragged */
  element: unknown;
  /** Whether dragging is disabled */
  disabled?: boolean;
  /** CSS class applied while dragging */
  draggingClass?: string;
  /** Data type for drag/drop matching */
  dataType?: string;
}

const props = withDefaults(defineProps<DraggableProps>(), {
  disabled: false,
  draggingClass: 'dragging',
  dataType: 'boardsmith/element',
});

const emit = defineEmits<{
  dragStart: [element: unknown, event: DragEvent];
  dragEnd: [element: unknown, event: DragEvent];
  drop: [droppedElement: unknown, targetElement: unknown, event: DragEvent];
}>();

const isDragging = ref(false);
const isDropTarget = ref(false);

const classes = computed(() => ({
  'bs-draggable': true,
  'bs-draggable--disabled': props.disabled,
  [props.draggingClass]: isDragging.value,
  'bs-draggable--drop-target': isDropTarget.value,
}));

function onDragStart(event: DragEvent) {
  if (props.disabled) {
    event.preventDefault();
    return;
  }

  isDragging.value = true;

  // Serialize element data for transfer
  event.dataTransfer?.setData(props.dataType, JSON.stringify(props.element));
  event.dataTransfer!.effectAllowed = 'move';

  emit('dragStart', props.element, event);
}

function onDragEnd(event: DragEvent) {
  isDragging.value = false;
  emit('dragEnd', props.element, event);
}

function onDragOver(event: DragEvent) {
  if (props.disabled) return;

  // Check if the data type matches
  if (event.dataTransfer?.types.includes(props.dataType)) {
    event.preventDefault();
    isDropTarget.value = true;
  }
}

function onDragLeave() {
  isDropTarget.value = false;
}

function onDrop(event: DragEvent) {
  event.preventDefault();
  isDropTarget.value = false;

  const data = event.dataTransfer?.getData(props.dataType);
  if (data) {
    try {
      const droppedElement = JSON.parse(data);
      emit('drop', droppedElement, props.element, event);
    } catch {
      // Invalid data
    }
  }
}
</script>

<template>
  <div
    :class="classes"
    :draggable="!disabled"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <slot />
  </div>
</template>

<style scoped>
.bs-draggable {
  cursor: grab;
  transition: transform 0.15s ease, opacity 0.15s ease;
}

.bs-draggable--disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.bs-draggable.dragging {
  opacity: 0.5;
  transform: scale(1.05);
  cursor: grabbing;
}

.bs-draggable--drop-target {
  outline: 2px dashed #4a90d9;
  outline-offset: 4px;
}
</style>
