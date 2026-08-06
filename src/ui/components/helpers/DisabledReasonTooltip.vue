<script setup lang="ts">
/**
 * DisabledReasonTooltip — the single tooltip that explains every dimmed control.
 *
 * Rendered ONCE by GameShell. Controls do not render their own; they mark
 * themselves with `v-disabled-reason` and this borrows their anchor rect.
 *
 * Why not the native `title` attribute, which this replaces:
 *  - it does nothing on touch, where there is no hover — so on a phone the
 *    reason was simply unavailable
 *  - it waits about a second before appearing
 *  - it cannot be themed and truncates long text, and game-authored reasons are
 *    sentences ("A ravine blocks your way, and beyond it, nothing but the dead
 *    lands.")
 *
 * Security: the reason is game-authored text, rendered by Vue interpolation
 * only — never `v-html`. Mirrors the rule in ActionHelpPopover / TutorialOverlay.
 *
 * Accessibility: `role="tooltip"` with a stable id; the directive points the
 * described control at it with `aria-describedby` while it is open.
 */
import { computed, ref, watch, nextTick } from 'vue';
import {
  useDisabledReasonTooltip,
  DISABLED_TOOLTIP_ID,
  DISABLED_TOOLTIP_MAX_WIDTH,
} from '../../composables/useDisabledReasonTooltip.js';
import { computePopoverPosition, type PopoverPosition } from './popover-position.js';

const { text, anchor, showCount } = useDisabledReasonTooltip();

const box = ref<HTMLDivElement | null>(null);
const position = ref<PopoverPosition>({
  top: 0,
  left: 0,
  caretSide: 'top',
  caretLeft: DISABLED_TOOLTIP_MAX_WIDTH / 2,
});

/**
 * Height used for flip detection before the box has rendered. Two lines of
 * body text plus padding; the real height replaces it on the next tick.
 */
const FALLBACK_HEIGHT = 64;

// Place in two passes: mount at a provisional spot so the box can be measured,
// then re-place using its ACTUAL height. Flip detection on a guessed height is
// what lets a tall tooltip run off the bottom of a short window.
watch([showCount, anchor], async () => {
  const el = anchor.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  position.value = computePopoverPosition(rect, FALLBACK_HEIGHT, DISABLED_TOOLTIP_MAX_WIDTH);
  await nextTick();
  if (anchor.value !== el) return; // moved to another control mid-tick
  position.value = computePopoverPosition(
    el.getBoundingClientRect(),
    box.value?.offsetHeight ?? FALLBACK_HEIGHT,
    DISABLED_TOOLTIP_MAX_WIDTH,
  );
});

const style = computed(() => ({
  position: 'fixed' as const,
  top: `${position.value.top}px`,
  left: `${position.value.left}px`,
  maxWidth: `${DISABLED_TOOLTIP_MAX_WIDTH}px`,
  zIndex: '70',
}));
</script>

<template>
  <!-- Teleported to body: the action bar clips its overflow, and a tooltip that
       is cut off by the bar it sits in is worse than none. z-index above the
       help popover (60) — a dimmed control's reason is the more urgent message. -->
  <Teleport to="body">
    <Transition name="bs-disabled-tip">
      <div
        v-if="text"
        ref="box"
        :id="DISABLED_TOOLTIP_ID"
        role="tooltip"
        class="bs-disabled-tip"
        :style="style"
      >
        <span
          class="bs-disabled-tip__caret"
          :class="`bs-disabled-tip__caret--${position.caretSide}`"
          :style="{ '--tip-caret-left': `${position.caretLeft}px` }"
          aria-hidden="true"
        ></span>
        {{ text }}
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.bs-disabled-tip {
  width: max-content;
  min-width: 80px;
  padding: var(--bsg-s2) var(--bsg-s3);
  background: var(--bsg-surface-3);
  border: 1px solid var(--bsg-line-2);
  border-radius: var(--bsg-r-md);
  box-shadow: var(--bsg-shadow-sm);
  color: var(--bsg-ink-2);
  font-size: var(--bsg-text-sm);
  line-height: var(--bsg-line-normal);
  /* The tooltip must never eat the pointer: it can open directly under the
     cursor, and a tooltip that swallows the next click is its own bug. */
  pointer-events: none;
}

/* Caret — border trick, mirrors ActionHelpPopover. */
.bs-disabled-tip__caret {
  position: absolute;
  width: 0;
  height: 0;
}

.bs-disabled-tip__caret--top {
  top: -8px;
  left: var(--tip-caret-left, 50%);
  transform: translateX(-50%);
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-bottom: 8px solid var(--bsg-line-2);
}

.bs-disabled-tip__caret--top::after {
  content: '';
  position: absolute;
  top: 2px;
  left: -7px;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-bottom: 7px solid var(--bsg-surface-3);
}

.bs-disabled-tip__caret--bottom {
  bottom: -8px;
  left: var(--tip-caret-left, 50%);
  transform: translateX(-50%);
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-top: 8px solid var(--bsg-line-2);
}

.bs-disabled-tip__caret--bottom::after {
  content: '';
  position: absolute;
  bottom: 2px;
  left: -7px;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-top: 7px solid var(--bsg-surface-3);
}

.bs-disabled-tip-enter-active,
.bs-disabled-tip-leave-active {
  transition: opacity var(--bsg-dur-fast) var(--bsg-ease);
}

.bs-disabled-tip-enter-from,
.bs-disabled-tip-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .bs-disabled-tip-enter-active,
  .bs-disabled-tip-leave-active {
    transition: none;
  }
}
</style>
