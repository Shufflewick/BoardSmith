<script setup lang="ts">
/**
 * The control that sets one declared game option, as the lobby and Table setup's deal show it
 * (#1684). Each choice carries its value, so the smoke walk can pick the one a deal names.
 */
import type { DevOptionDef } from './config-types.js';

defineProps<{ opt: DevOptionDef; testid: string }>();
const value = defineModel<unknown>();
</script>

<template>
  <select v-if="opt.choices" v-model="value" class="dev-chrome__select" :data-testid="testid">
    <option v-for="c in opt.choices" :key="c.value" :value="c.value" :data-value="c.value">
      {{ c.label }}
    </option>
  </select>
  <!-- WR-03: a real checkbox for `boolean`, so `v-model` gives a genuine boolean, never "true"/"false" text. -->
  <input v-else-if="opt.type === 'boolean'" v-model="value" type="checkbox" :data-testid="testid" />
  <!-- With no declared step the host takes any number, so the field must not refuse a fraction. -->
  <input
    v-else-if="opt.type === 'number'"
    v-model.number="value"
    type="number"
    :min="opt.min"
    :max="opt.max"
    :step="opt.step ?? 'any'"
    :data-testid="testid"
  />
  <input v-else v-model="value" type="text" :data-testid="testid" />
</template>
