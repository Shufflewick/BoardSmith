<script setup lang="ts">
/**
 * A game's own player preferences (#1440) as controls menu items: an on/off
 * one is a checkbox item, a pick-from-list one a group of radio items. The
 * `.mi`, `.r` and `.toggle` styles come from ControlsMenu.
 */
import { computed, useId } from 'vue';
import type { PlayerPreferences } from '../player-preferences.js';

const props = defineProps<{ preferences: PlayerPreferences }>();

const idPrefix = `bs-pref-${useId()}`;
const preferenceItems = computed(() => Object.entries(props.preferences.declarations).map(([key, d]) => ({
  key,
  label: d.label,
  descriptionId: d.description ? `${idPrefix}-${key}` : undefined,
  description: d.description,
  options: 'options' in d ? d.options : undefined,
  value: props.preferences.use(key),
})));
</script>

<template>
  <template v-for="item in preferenceItems" :key="item.key">
    <div v-if="item.options" class="pref-choice" role="group" :aria-label="item.label" :aria-describedby="item.descriptionId">
      <div class="pref-label">{{ item.label }}</div>
      <div class="pref-options">
        <button
          v-for="option in item.options"
          :key="option.value"
          class="pref-option"
          type="button"
          role="menuitemradio"
          :aria-checked="item.value.value === option.value"
          @click="item.value.value = option.value"
        >
          {{ option.label }}
        </button>
      </div>
    </div>
    <button
      v-else
      class="mi pref-toggle"
      type="button"
      role="menuitemcheckbox"
      :aria-checked="item.value.value === true"
      :aria-describedby="item.descriptionId"
      @click="item.value.value = !item.value.value"
    >
      {{ item.label }}
      <span class="r">
        <span class="toggle" :class="{ on: item.value.value === true }"></span>
      </span>
    </button>
    <div v-if="item.description" :id="item.descriptionId" class="pref-desc">{{ item.description }}</div>
  </template>
</template>

<style scoped>
/* No icon, so indent to line up with the labels of items that have one
   (10px padding + 18px icon + 11px gap); ControlsMenu indents .pref-toggle. */
.pref-choice {
  padding: 10px 10px 4px 39px;
  font-size: var(--bsg-text-sm);
  color: var(--bsg-ink);
}
.pref-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.pref-option {
  border: 1px solid var(--bsg-line-2);
  border-radius: var(--bsg-r-pill);
  background: none;
  color: var(--bsg-ink-2);
  font: inherit;
  font-size: var(--bsg-text-xs);
  padding: 4px 12px;
  cursor: pointer;
}
.pref-option[aria-checked="true"] {
  background: var(--bsg-accent);
  border-color: var(--bsg-accent);
  color: var(--bsg-accent-ink);
}
.pref-desc {
  padding: 0 10px 8px 39px;
  margin-top: -4px;
  font-size: var(--bsg-text-xs);
  color: var(--bsg-ink-3);
}
</style>
