<template>
  <!-- <img src="/cards/old-back.svg" /> -->
  <div class="commented-img">
    <img :src="cardImage" :alt="label" />
  </div>
</template>

<script setup lang="ts">
// <img src="/cards/deprecated.svg" />
defineProps<{ cardImage: string; label: string }>();

/* <img src="/cards/inline-block.svg" /> */

/*
 * Legacy note: this used to render
 * <img src="/cards/legacy.svg" />
 * before AssetImage existed.
 */
</script>
