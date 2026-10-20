<script setup lang="ts">
/**
 * GrantedCards — the cards a concealed zone's view carries after its own
 * children: granted to this seat from inside a hidden child (#961, #1208).
 * They are not among the zone's cards, so the zone draws them apart (#1292).
 */
import { computed } from 'vue';
import ElementRenderer from './ElementRenderer.vue';
import { directChildren } from '../../../composables/useGameViewHelpers.js';
import type { GameElement } from '../auto-ui-helpers.js';

const props = defineProps<{
  element: GameElement;
}>();

const granted = computed(() => (props.element.children ?? []).slice(directChildren(props.element).length));
</script>

<template>
  <div v-if="granted.length > 0" class="granted-cards">
    <ElementRenderer v-for="child in granted" :key="child.id" :element="child" />
  </div>
</template>

<style scoped>
.granted-cards {
  display: flex;
  flex-wrap: wrap;
  gap: var(--bsg-s2);
  margin-top: var(--bsg-s2);
}
</style>
