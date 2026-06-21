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

// ---------------------------------------------------------------------------
// Local GameElement interface — do NOT import from engine (module is dependency-free)
// Mirrors auto-ui-helpers.ts lines 12-19.
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
  hexPieceSize?: number;
}>();

const rendererComponent = computed(() => resolveRenderer(props.element));
</script>

<template>
  <component
    v-if="rendererComponent"
    :is="rendererComponent"
    :element="element"
    :depth="depth"
    :hex-piece-size="hexPieceSize"
  />
  <!-- null = registry empty or no match; built-in registration (93-06) guarantees a match at runtime -->
</template>
