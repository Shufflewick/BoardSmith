<script setup lang="ts">
/**
 * The player's Sound switch and Volume slider as controls menu items (#1528).
 * They set audioService, the one source of those settings, which saves them
 * for every BoardSmith game in this browser. Item styles come from ControlsMenu.
 */
import { ref, onMounted, onUnmounted } from 'vue';
import { audioService } from '../../client/audio.js';

// Copies for the template, refreshed from audioService on every change, the game's own included.
const soundOn = ref(audioService.isEnabled());
const volume = ref(audioService.getVolume());
let offChange = () => {};

onMounted(() => {
  offChange = audioService.onChange(() => {
    soundOn.value = audioService.isEnabled();
    volume.value = audioService.getVolume();
  });
});
onUnmounted(() => offChange());
</script>

<template>
  <button
    class="mi"
    type="button"
    role="menuitemcheckbox"
    :aria-checked="soundOn"
    @click="audioService.setEnabled(!soundOn)"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" stroke-linejoin="round"/><path v-if="soundOn" d="M16.5 8.5a5 5 0 0 1 0 7" stroke-linecap="round"/><path v-else d="M17 9l5 6M22 9l-5 6" stroke-linecap="round"/></svg>
    Sound
    <span class="r">
      <span class="toggle" :class="{ on: soundOn }"></span>
    </span>
  </button>
  <!-- A group like Zoom, so the slider keeps its arrow keys. -->
  <div class="mi" role="group" aria-label="Volume">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16" stroke-linecap="round"/><circle cx="14" cy="12" r="2.5"/></svg>
    Volume
    <span class="r">
      <!-- step matches the 1% aria-valuetext, since a browser snaps the value to the step. -->
      <input
        type="range"
        class="volume-range"
        min="0"
        max="1"
        step="0.01"
        :value="volume"
        aria-label="Volume"
        :aria-valuetext="Math.round(volume * 100) + '%'"
        @input="audioService.setVolume(parseFloat(($event.target as HTMLInputElement).value))"
      />
    </span>
  </div>
</template>

<style scoped>
.volume-range {
  accent-color: var(--bsg-accent);
  width: 84px;
}
</style>
