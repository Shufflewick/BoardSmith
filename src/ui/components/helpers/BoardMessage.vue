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
 * ## Annotation variant
 *
 * Pass `variant="annotation"` with `:anchor-style` (absolute CSS position computed
 * by TutorialOverlay after measuring target rects) and optionally `:caret-side` to
 * render a prose card (--bsg-r-md, --bsg-shadow, left-aligned) with a connector
 * caret pointing toward the highlighted target ring.
 *
 * The default (no variant) renders byte-identical to the prior pill form —
 * turn-prompt consumers are unaffected.
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
    /**
     * Rendering variant.
     *
     * - `'default'` (default): pill chip centered in the board — the turn-prompt form.
     * - `'annotation'`: left-aligned prose card (--bsg-r-md, --bsg-shadow, caret)
     *   for tutorial annotation bubbles. Requires `anchorStyle` to position the card.
     * - `'narration'`: centered card anchored top of the board area for AI demo
     *   pre-move announcements (z-10, --bsg-surface-3, --bsg-r-md card shape).
     *   Renders text as plain interpolation only (T-107-08).
     */
    variant?: 'default' | 'annotation' | 'narration';
    /**
     * Absolute CSS position overrides for the annotation variant.
     *
     * The caller (TutorialOverlay) computes `left`/`top` after measuring target
     * rects. Pass `{ left: '…px', top: '…px', transform: '…' }`. Ignored in the
     * default variant.
     */
    anchorStyle?: Record<string, string>;
    /**
     * Which side of the bubble the connector caret appears on (annotation variant
     * only). Set by TutorialOverlay based on placement (bubble below target →
     * `'top'`; bubble above target → `'bottom'`). Omit when no target is resolved
     * so no caret is drawn.
     */
    caretSide?: 'top' | 'bottom' | 'left' | 'right';
  }>(),
  {
    visible: true,
    position: 'bottom',
    variant: 'default',
  },
);
</script>

<template>
  <div
    class="bsg-board-message"
    :class="
      variant === 'annotation'
        ? 'bsg-board-message--annotation'
        : variant === 'narration'
          ? 'bsg-board-message--narration'
          : `bsg-board-message--${position}`
    "
    :style="variant === 'annotation' ? anchorStyle : undefined"
  >
    <Transition name="bsg-board-message-fade">
      <div
        v-if="visible"
        class="bsg-board-message__content"
        :class="variant === 'annotation'
          ? 'bsg-board-message__content--annotation'
          : variant === 'narration'
            ? 'bsg-board-message__content--narration'
            : undefined"
        role="status"
        aria-live="polite"
      >
        <!--
          Connector caret — annotation variant only, when a target is resolved.
          Drawn as a CSS triangle (border trick) with --bsg-surface-2 fill and
          --bsg-line-2 edge so it matches the bubble border. aria-hidden because
          the visual caret is decorative; the bubble text is the accessible description.
        -->
        <span
          v-if="variant === 'annotation' && caretSide"
          class="bsg-board-message__caret"
          :class="`bsg-board-message__caret--${caretSide}`"
          aria-hidden="true"
        />
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

/* ── Annotation variant: absolutely positioned card (TutorialOverlay) ──────── */
/*
 * Override the full-width stretch from the base class so the inline
 * anchorStyle left/top values have full control of positioning.
 * The content card is auto-sized to its text (max-width capped below).
 */
.bsg-board-message--annotation {
  left: auto;
  right: auto;
  width: max-content;
  justify-content: flex-start;
  /* z-index is inherited from the TutorialOverlay stacking context (z-20);
     we intentionally do not set it here so it does not create a new context. */
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

/* Annotation card: left-aligned prose, card radius, heavier shadow */
.bsg-board-message__content--annotation {
  display: block;
  text-align: left;
  padding: var(--bsg-s3) var(--bsg-s4);
  max-width: min(320px, 90vw);
  border-radius: var(--bsg-r-md);
  line-height: var(--bsg-line-normal);
  box-shadow: var(--bsg-shadow);
  position: relative; /* anchors the caret pseudo-element / span */
}

/* ── Narration variant: centered AI demo announcement card ────────────────── */
/*
 * Displays the pre-move announcement during the AI demo (AI-02). Sits at the
 * top of the board area, horizontally centered, above turn-prompt (z-5) but
 * below heatmap (z-15) and tutorial ring (z-20).
 *
 * The wrapper position here is relative to the overlay stacking context (the
 * HintOverlay/TutorialOverlay teleport that mounts it at the board top).
 */
.bsg-board-message--narration {
  position: fixed;
  top: var(--bsg-s3);
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  pointer-events: none;
  z-index: 10;
}

/* Narration card — more prominent surface than the default pill */
.bsg-board-message__content--narration {
  display: block;
  text-align: left;
  padding: var(--bsg-s2) var(--bsg-s4);
  /* Wide enough for a readable one-line move narration ("Player 1: move c5 → a3
     (capture)") without wrapping awkwardly; still clamped to the viewport. */
  max-width: min(440px, 92vw);
  white-space: normal;
  overflow-wrap: anywhere;
  background: var(--bsg-surface-3);
  border: 1px solid var(--bsg-line-2);
  border-radius: var(--bsg-r-md);
  line-height: var(--bsg-line-normal);
  box-shadow: var(--bsg-shadow-sm);
  position: relative;
}

/* ── Connector caret (CSS border triangle) ────────────────────────────────── */
/*
 * Two-layer technique: the outer span is the border-colored triangle;
 * the ::after pseudo-element is the fill-colored triangle placed 1px inside.
 * Result: a shape that appears to have a --bsg-surface-2 fill with a
 * --bsg-line-2 border on the exposed edge — matching the bubble border.
 *
 * Caret is 8 × 8 px and positioned on the relevant side of the card.
 * Centered horizontally (top/bottom carets) or vertically (left/right carets).
 */
.bsg-board-message__caret {
  position: absolute;
  width: 0;
  height: 0;
  pointer-events: none;
}

/* Caret on top: bubble sits BELOW the target → caret points upward */
.bsg-board-message__caret--top {
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-bottom: 8px solid var(--bsg-line-2);
}

.bsg-board-message__caret--top::after {
  content: '';
  position: absolute;
  top: 2px;
  left: -7px;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-bottom: 7px solid var(--bsg-surface-2);
}

/* Caret on bottom: bubble sits ABOVE the target → caret points downward */
.bsg-board-message__caret--bottom {
  bottom: -8px;
  left: 50%;
  transform: translateX(-50%);
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-top: 8px solid var(--bsg-line-2);
}

.bsg-board-message__caret--bottom::after {
  content: '';
  position: absolute;
  bottom: 2px;
  left: -7px;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-top: 7px solid var(--bsg-surface-2);
}

/* Caret on left: bubble sits to the RIGHT of the target → caret points left */
.bsg-board-message__caret--left {
  left: -8px;
  top: 50%;
  transform: translateY(-50%);
  border-top: 8px solid transparent;
  border-bottom: 8px solid transparent;
  border-right: 8px solid var(--bsg-line-2);
}

.bsg-board-message__caret--left::after {
  content: '';
  position: absolute;
  left: 2px;
  top: -7px;
  border-top: 7px solid transparent;
  border-bottom: 7px solid transparent;
  border-right: 7px solid var(--bsg-surface-2);
}

/* Caret on right: bubble sits to the LEFT of the target → caret points right */
.bsg-board-message__caret--right {
  right: -8px;
  top: 50%;
  transform: translateY(-50%);
  border-top: 8px solid transparent;
  border-bottom: 8px solid transparent;
  border-left: 8px solid var(--bsg-line-2);
}

.bsg-board-message__caret--right::after {
  content: '';
  position: absolute;
  right: 2px;
  top: -7px;
  border-top: 7px solid transparent;
  border-bottom: 7px solid transparent;
  border-left: 7px solid var(--bsg-surface-2);
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
