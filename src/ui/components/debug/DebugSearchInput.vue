<script setup lang="ts">
/**
 * THE DEBUG PANEL'S SEARCH BOX (#157).
 *
 * Three tabs -- State, Elements and Decks -- each wrote the same input against
 * rules in the panel's shared stylesheet. Same reasoning as `DebugButton`: the
 * rules travel with the control so a per-tab component does not have to carry a
 * copy of them.
 *
 * The `search-input` class name stays: the panel's tests address the box by it.
 */
defineProps<{
  modelValue: string;
  placeholder?: string;
  ariaLabel?: string;
}>();

defineEmits<{ 'update:modelValue': [value: string] }>();
</script>

<template>
  <input
    type="text"
    class="search-input"
    :value="modelValue"
    :placeholder="placeholder"
    :aria-label="ariaLabel"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>

<style scoped>
.search-input {
  width: 100%;
  padding: 8px 12px;
  background: var(--bsg-surface-3);
  border: 1px solid var(--bsg-line);
  border-radius: 6px;
  color: var(--bsg-ink);
  font-size: 12px;
}

.search-input:focus {
  outline: none;
  border-color: var(--bsg-accent-2);
}

.search-input::placeholder {
  color: var(--bsg-ink-3);
}
</style>
