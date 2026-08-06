<script setup lang="ts">
/**
 * DoneButton - Reusable confirmation button for ActionPanel
 *
 * Used for:
 * - Multi-select confirmation
 * - Number input submission
 * - Text input submission
 *
 * Disabling requires a reason (`disabledReason`), which the player reads on
 * hover/focus — "Select at least 2 cards." rather than a dead grey button.
 * See `../helpers/disabled-reason.ts` for the contract.
 */
import { computed } from 'vue';
import { disabledAttrs, runIfEnabled, type DisabledReason } from '../helpers/disabled-reason.js';

const props = defineProps<{
  /** Why the button cannot be pressed yet, or `false`/omitted when it can. */
  disabledReason?: DisabledReason;
  label?: string;
}>();

const emit = defineEmits<{
  (e: 'click'): void;
}>();

const stateAttrs = computed(() => disabledAttrs(props.disabledReason));
</script>

<template>
  <button
    class="done-button"
    v-bind="stateAttrs"
    @click="runIfEnabled(props.disabledReason, () => emit('click'))"
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

.done-button:hover:not([aria-disabled='true']) {
  transform: translateY(-1px);
  box-shadow: var(--bsg-shadow-sm);
}

.done-button[aria-disabled='true'] {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--bsg-surface-3);
}
</style>
