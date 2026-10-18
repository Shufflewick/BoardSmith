<!--
  Catches an error the game's board throws, so it cannot break the shell (#1149).

  Unhandled, Vue rethrows a render error out of the patch in dev, which leaves
  the shell's vnode tree half-patched and every later update failing: the
  Action Panel froze until a reload. Here the board is replaced by a message,
  the error is logged once, and the board is mounted afresh when `state` or
  `board` changes, so the next move (or another board) draws if it no longer throws.
-->
<template>
  <div v-if="failure !== null" class="bs-board-error" role="alert" data-testid="bs-board-error">
    <p>The board hit an error and could not be drawn. It will try again when the game changes.</p>
    <p v-if="isDev" class="bs-board-error__detail">
      Board error: {{ failure }}. The full error is in the browser console.
    </p>
  </div>
  <slot v-else />
</template>

<script setup lang="ts">
import { computed, onErrorCaptured, ref, watch } from 'vue';

const props = defineProps<{
  /** The state the board draws; a new one gives a failed board another try. */
  state: unknown;
  /** The board component; switching to another one gives it a try too. */
  board: unknown;
}>();

const isDev = import.meta.env.DEV;
const failure = ref<string | null>(null);

onErrorCaptured((error) => {
  if (failure.value === null) console.error('The game board threw an error and was replaced by a message:', error);
  failure.value = error instanceof Error ? error.message : String(error);
  // Handled here: propagating it is what breaks the shell's patch.
  return false;
});

watch([() => props.state, () => props.board], () => {
  failure.value = null;
});

/** True while the message stands in for the board; the shell's zoom fit never measures the message (#1154). */
defineExpose({ failed: computed(() => failure.value !== null) });
</script>

<style scoped>
.bs-board-error {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.5rem;
  box-sizing: border-box;
  /* The board area sizes to its content and zooms it to fit, so the message sets its own width. */
  width: min(32rem, 90vw);
  min-height: 300px;
  padding: 2rem;
  color: var(--bsg-ink);
  background: var(--bsg-field);
  border: 1px solid var(--bsg-danger);
  border-radius: 12px;
  text-align: center;
}

.bs-board-error__detail {
  color: var(--bsg-ink-2);
  font-family: monospace;
  overflow-wrap: anywhere;
}
</style>
