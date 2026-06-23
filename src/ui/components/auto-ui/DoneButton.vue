<script setup lang="ts">
/**
 * DoneButton - Reusable confirmation button for ActionPanel
 *
 * Used for:
 * - Multi-select confirmation
 * - Number input submission
 * - Text input submission
 */
defineProps<{
  disabled?: boolean;
  label?: string;
}>();

const emit = defineEmits<{
  (e: 'click'): void;
}>();
</script>

<template>
  <button
    class="done-button"
    :disabled="disabled"
    @click="emit('click')"
  >
    {{ label || 'Done' }}
  </button>
</template>

<style scoped>
.done-button {
  padding: 8px 20px;
  background: var(--bsg-accent);
  color: var(--bsg-accent-ink);
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}

.done-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: var(--bsg-shadow-sm);
}

.done-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--bsg-surface-3);
}
</style>
