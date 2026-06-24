<script setup lang="ts">
/**
 * BoardMessage - Transient/ephemeral message anchored to the game board.
 *
 * Renders as a NON-REFLOWING overlay: it is absolutely positioned inside the
 * nearest `position: relative` ancestor (your board wrapper), so showing or
 * hiding it NEVER changes layout and NEVER moves the board. This is the
 * standard primitive every game should use for short-lived board indicators
 * (e.g. "Select a target cell", "Captures are mandatory").
 *
 * Distinct from `Toast`: Toast is for global, app-level notifications that
 * stack at the viewport edge; BoardMessage is anchored to the board content
 * area and follows the board's positioning context.
 *
 * ## Usage
 *
 * The parent board wrapper must establish a positioning context:
 *
 * ```vue
 * <template>
 *   <div class="board-wrapper"> <!-- position: relative -->
 *     <svg class="board">...</svg>
 *     <BoardMessage :visible="isMyTurn">
 *       Select a target cell
 *     </BoardMessage>
 *   </div>
 * </template>
 *
 * <style scoped>
 * .board-wrapper { position: relative; }
 * </style>
 * ```
 *
 * Accessibility: the message is a `role="status"` `aria-live="polite"` region
 * so screen readers announce it when it appears. The fade transition is
 * disabled under `prefers-reduced-motion: reduce`.
 */
withDefaults(
  defineProps<{
    /**
     * Whether the message is shown. Toggling this fades the message in/out
     * without ever reflowing the board.
     */
    visible?: boolean;
    /** Anchor position within the board container. Defaults to 'bottom'. */
    position?: 'bottom' | 'top' | 'center';
  }>(),
  {
    visible: true,
    position: 'bottom',
  },
);
</script>

<template>
  <div class="bsg-board-message" :class="`bsg-board-message--${position}`">
    <Transition name="bsg-board-message-fade">
      <div
        v-if="visible"
        class="bsg-board-message__content"
        role="status"
        aria-live="polite"
      >
        <slot />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* Out-of-flow anchor: absolutely positioned so show/hide never reflows the
   board. The thin wrapper spans the board width and centers its content; only
   the inner pill is interactive/visible. */
.bsg-board-message {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  pointer-events: none;
  z-index: 5;
}

.bsg-board-message--bottom {
  bottom: var(--bsg-s3);
}

.bsg-board-message--top {
  top: var(--bsg-s3);
}

.bsg-board-message--center {
  top: 0;
  bottom: 0;
  align-items: center;
}

.bsg-board-message__content {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: var(--bsg-s2);
  max-width: 90%;
  padding: var(--bsg-s2) var(--bsg-s4);
  background: var(--bsg-surface-2);
  border: 1px solid var(--bsg-line-2);
  border-radius: var(--bsg-r-pill);
  color: var(--bsg-ink);
  font-family: var(--bsg-font);
  font-size: var(--bsg-text-sm);
  line-height: var(--bsg-line-tight);
  text-align: center;
  box-shadow: var(--bsg-shadow-sm);
}

/* Fade transition — disabled under reduced-motion. */
.bsg-board-message-fade-enter-active,
.bsg-board-message-fade-leave-active {
  transition: opacity var(--bsg-dur-base) var(--bsg-ease);
}

.bsg-board-message-fade-enter-from,
.bsg-board-message-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .bsg-board-message-fade-enter-active,
  .bsg-board-message-fade-leave-active {
    transition: none;
  }
}
</style>
