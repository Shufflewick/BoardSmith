<script setup lang="ts">
/**
 * AssetImage — the one sanctioned way to render game art.
 *
 * A missing, unresolved, or broken `src` always leaves the caller's drawn,
 * game-semantic fallback visible; a broken `<img>` never reaches a player. The
 * real image overlays the fallback only after `@load` fires, and `@error`
 * reverts to the fallback. Fallback and `<img>` share one aspect-ratio input, so
 * swapping in the real asset causes zero layout change.
 *
 * The fallback is the caller's DEFAULT SLOT, because the placeholder that reads
 * correctly is always the game's own drawn face (a card's rank and suit, a
 * part's name and roll condition, a piece's glyph), never something this
 * component could guess at. The slot content owns its own presentation; the
 * fallback layer here is a bare `position: absolute; inset: 0` box.
 *
 * The wrapper takes the caller's class, so a game rounds its corners, crops its
 * art, or otherwise skins one of these from its own scoped stylesheet:
 *
 * ```vue
 * <AssetImage class="card-art" :src="artSrc" aspect-ratio="2 / 3" :alt="label">
 *   <div class="card-drawn">...</div>
 * </AssetImage>
 * ```
 */
import { ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    /** The resolved asset URL, or null when there is no art (yet) for this thing. */
    src?: string | null;
    /**
     * The box both the fallback and the image fill, e.g. `'2 / 3'`. Required
     * rather than defaulted: reserving the right box is what makes a later
     * asset swap a zero-layout-change edit, and only the caller knows the box.
     * Pass `'auto'` when an ancestor already sizes the art.
     */
    aspectRatio: string;
    /**
     * Alt text for the image. Required rather than defaulted so every call site
     * makes the decision; pass `''` when the fallback slot already carries the
     * same words as visible text.
     */
    alt: string;
  }>(),
  {
    src: null,
  },
);

const loaded = ref(false);

// Reset when the resolved src changes so an AssetImage reused for a different
// asset re-guards — otherwise a stale loaded=true would flash the previous (or a
// new, still-unresolved) image at full opacity before its own load/error fires.
watch(
  () => props.src,
  () => {
    loaded.value = false;
  },
);

function onLoad() {
  loaded.value = true;
}

function onError() {
  // Never leave a broken <img> visible — revert to the drawn fallback.
  loaded.value = false;
}
</script>

<template>
  <div class="asset-image" :style="{ aspectRatio: props.aspectRatio }">
    <div class="asset-image-fallback">
      <slot />
    </div>
    <!--
      `decoding="async"` denies any engine a synchronous main-thread decode of
      what are typically many large card scans on screen at once. It is safe here
      precisely BECAUSE of the cross-fade below: the one thing async decoding
      costs is that a frame may paint before the bitmap is ready, and this <img>
      starts at `opacity: 0`, so an undecoded frame lands inside a fade that is
      still showing the drawn fallback underneath.

      No intrinsic width/height, deliberately: this <img> is absolutely
      positioned to fill the wrapper's aspect-ratio box, so CSS wins and the
      attributes could not affect layout. There is no CLS to prevent — the
      wrapper already reserves the box.
    -->
    <img
      v-if="props.src"
      class="asset-image-img"
      :class="{ 'is-loaded': loaded }"
      :src="props.src"
      :alt="props.alt"
      decoding="async"
      @load="onLoad"
      @error="onError"
    />
  </div>
</template>

<style scoped>
.asset-image {
  position: relative;
  width: 100%;
  overflow: hidden;
}

.asset-image-fallback {
  position: absolute;
  inset: 0;
}

.asset-image-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity var(--bsg-dur-base) var(--bsg-ease);
}

.asset-image-img.is-loaded {
  opacity: 1;
}

/* Reduced motion: the state change (fallback to real art) still happens, it just
   arrives without the cross-fade. */
@media (prefers-reduced-motion: reduce) {
  .asset-image-img {
    transition: none;
  }
}
</style>
