<script setup lang="ts">
/**
 * The button that opens one level of the Action Panel's menu: a group of actions
 * (#228) or a category of a pick's choices (#1439). It only navigates; the
 * caller's click handler changes which level is drawn and submits nothing.
 */
defineProps<{
  label: string;
  /** What is behind it, for a screen reader, such as "submenu, 3 actions". */
  contents: string;
}>();
</script>

<template>
  <button type="button">
    {{ label }}
    <span aria-hidden="true" class="chevron">&rsaquo;</span>
    <span class="sr-only">{{ contents }}</span>
  </button>
</template>

<style scoped src="../sr-only.css"></style>
<style scoped>
/* The button keeps its caller's plate, so a level reads as one row; the chevron carries the difference. */
.chevron {
  margin-left: 6px;
  opacity: 0.75;
}
</style>
