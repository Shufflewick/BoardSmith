<script setup lang="ts">
/**
 * ElementRenderer — Registry-dispatch wrapper component.
 *
 * Resolves the highest-priority registered renderer for the given element
 * and renders it via `<component :is="...">`. When resolveRenderer returns
 * null (registry empty or no entry matches), nothing is rendered.
 *
 * Note: Built-in renderer registration (plan 93-06) guarantees a match at
 * runtime. No fallback render here — null means "no renderer registered yet,"
 * which is intentional during the renderer rebuild phase.
 */

import { computed } from 'vue';
import { resolveRenderer } from '../renderer-registry.js';
import type { GameElement } from '../auto-ui-helpers.js';

const props = defineProps<{
  element: GameElement;
}>();

const rendererComponent = computed(() => resolveRenderer(props.element));
</script>

<template>
  <component
    v-if="rendererComponent"
    :is="rendererComponent"
    :element="element"
  />
  <!-- null = registry empty or no match; built-in registration (93-06) guarantees a match at runtime -->
</template>
