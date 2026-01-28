<script setup lang="ts">
/**
 * GameOverlay - Modal overlay constrained to the game content area
 *
 * This overlay renders in-place (no Teleport) and uses `position: fixed`.
 * When rendered inside GameShell's zoom-container (which has `contain: layout`),
 * the fixed positioning is trapped within that container. This keeps the
 * header and ActionPanel accessible while the overlay is shown.
 *
 * ## Usage
 *
 * ```vue
 * <template>
 *   <GameOverlay :active="showModal" @click="closeModal">
 *     <div class="my-modal-content" @click.stop>
 *       <!-- Modal content here -->
 *       <button @click="closeModal">Close</button>
 *     </div>
 *   </GameOverlay>
 * </template>
 * ```
 *
 * ## Styling the content
 *
 * For best results, use these styles on your modal content:
 *
 * ```css
 * .my-modal-content {
 *   position: sticky;
 *   top: 10px;
 *   margin: 0 auto;
 *   max-height: calc(100vh - 150px);
 *   overflow: auto;
 * }
 * ```
 *
 * The `position: sticky` keeps the content visible in the viewport,
 * and `max-height` with `overflow: auto` handles tall content.
 *
 * ## Important
 *
 * - Must be rendered inside a container with `contain: layout` (like GameShell)
 * - Use `@click.stop` on content to prevent backdrop clicks from closing
 * - The `@click` event fires when clicking the backdrop (outside content)
 */
import { computed } from 'vue';

interface Props {
  /** Whether the overlay is active/visible */
  active: boolean;
  /** Enable backdrop blur effect (default: true) */
  backdrop?: boolean;
  /** Backdrop opacity 0-1 (default: 0.85) */
  backdropOpacity?: number;
}

const props = withDefaults(defineProps<Props>(), {
  backdrop: true,
  backdropOpacity: 0.85,
});

defineEmits<{
  (e: 'click'): void;
}>();

// Computed style for backdrop
const backdropStyle = computed(() => ({
  background: `rgba(0, 0, 0, ${props.backdropOpacity})`,
  backdropFilter: props.backdrop ? 'blur(4px)' : 'none',
}));
</script>

<template>
  <Transition name="game-overlay">
    <div
      v-if="active"
      class="game-overlay"
      :style="backdropStyle"
      @click="$emit('click')"
    >
      <slot />
    </div>
  </Transition>
</template>

<style scoped>
.game-overlay {
  /*
   * Renders in-place (no Teleport). When inside a container with `contain: layout`,
   * position: fixed is trapped within that container instead of covering the viewport.
   * This keeps header and ActionPanel accessible.
   */
  position: fixed;
  inset: 0;
  z-index: 50;
  overflow: auto;
  padding: 10px 0;
}

/* Transitions */
.game-overlay-enter-active,
.game-overlay-leave-active {
  transition: opacity 0.3s ease;
}

.game-overlay-enter-from,
.game-overlay-leave-to {
  opacity: 0;
}
</style>
