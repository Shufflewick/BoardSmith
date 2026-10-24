<template>
  <!-- Always mounted, never v-if: a screen reader registers a live region only if it exists before its text arrives. -->
  <p class="live-region" role="status" aria-live="polite" data-bs-live-region="polite">{{ polite }}</p>
  <p class="live-region" role="alert" aria-live="assertive" data-bs-live-region="assertive">{{ assertive }}</p>
</template>

<script setup lang="ts">
/** A shell's two screen-reader live regions, written by the seat's announcer (`createLiveRegion`). */
defineProps<{ polite: string; assertive: string }>();
</script>

<style scoped>
/* Visually hidden but kept in the accessibility tree, which display:none would remove it from. */
.live-region {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
