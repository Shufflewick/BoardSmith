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

import { computed, provide } from 'vue';
import { resolveRenderer } from '../renderer-registry.js';
import { STANDS_ON_KEY, type GameElement } from '../auto-ui-helpers.js';
import type { ElementRef } from '../../../composables/useBoardInteraction.js';

const props = defineProps<{
  element: GameElement;
  /** The grid cell this element stands on, if any. */
  standsOn?: ElementRef;
}>();

// Provided even when absent, so an element never inherits a cell from further up.
provide(STANDS_ON_KEY, () => props.standsOn);

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
