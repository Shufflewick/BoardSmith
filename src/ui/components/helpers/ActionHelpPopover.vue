<script setup lang="ts">
/**
 * ActionHelpPopover — shared reveal surface for action help text and disabled reasons.
 *
 * Renders a circled "?" trigger button that opens a Teleport-to-body fixed-positioned
 * popover on hover (pointer) or tap (touch). The same popover also surfaces the
 * previously-dead `disabledActions` reason, closing the v2.8 "why disabled" friction loop.
 *
 * Parity: this single shared component is used by both ActionPanel (AutoUI) and custom
 * UI slots — identical rendering from the same props (project hard-rule: no per-UI branching).
 *
 * Security:
 *  - T-108-03: helpText and disabledReason rendered via Vue text interpolation only.
 *    Only text interpolation, never raw HTML binding. Mirrors TutorialOverlay T-105-05 rule.
 *
 * Accessibility:
 *  - trigger: role=button, aria-label="Help for {triggerLabel}", aria-expanded, aria-controls
 *  - aria-describedby applied to trigger ONLY when popover is mounted (Pitfall 3)
 *  - popover: role=tooltip, aria-live=polite
 *  - Dismiss: outside mousedown, Escape key, mouseleave (pointer)
 *  - Reduced motion: @media (prefers-reduced-motion: reduce) → transition: none
 */

import { ref, computed, onMounted, onUnmounted } from 'vue';

// ── Props ─────────────────────────────────────────────────────────────────────

const props = defineProps<{
  /** Used to build id="${actionName}-help-tip" on the tooltip element. */
  actionName: string;
  /** From ActionMetadata.help (Plan 01). Display-only; never a predicate. */
  helpText?: string;
  /** From disabledActions[name]. Rendered under "Why disabled:" label. */
  disabledReason?: string;
  /** The action prompt/display name — aria-label "Help for {triggerLabel}". */
  triggerLabel: string;
}>();

// ── State ─────────────────────────────────────────────────────────────────────

const isOpen = ref(false);
const triggerRef = ref<HTMLButtonElement | null>(null);

// ── Position ──────────────────────────────────────────────────────────────────

interface PopoverPosition {
  top: number;
  left: number;
  caretSide: 'top' | 'bottom';
}

const position = ref<PopoverPosition>({ top: 0, left: 0, caretSide: 'top' });

/**
 * Compute fixed position for popover anchored below (or above) the trigger button.
 * Mirrors HeatmapOverlay / TutorialOverlay getBoundingClientRect pattern.
 * Stale position on scroll/resize is acceptable per RESEARCH.md Pitfall 4.
 */
function computePosition(): PopoverPosition {
  const el = triggerRef.value;
  if (!el) return { top: 0, left: 0, caretSide: 'top' };

  const rect = el.getBoundingClientRect();
  const FLIP_THRESHOLD = 8;
  const POPOVER_ESTIMATED_HEIGHT = 80;
  const POPOVER_MAX_WIDTH = 240;

  let top = rect.bottom + 4;
  let left = rect.left;
  let caretSide: 'top' | 'bottom' = 'top';

  // Flip above if too close to viewport bottom
  if (top + POPOVER_ESTIMATED_HEIGHT > window.innerHeight - FLIP_THRESHOLD) {
    top = rect.top - POPOVER_ESTIMATED_HEIGHT - 4;
    caretSide = 'bottom';
  }

  // Right-edge constraint: shift left if popover would overflow
  if (left + POPOVER_MAX_WIDTH > window.innerWidth - 8) {
    left = window.innerWidth - POPOVER_MAX_WIDTH - 8;
  }

  return { top, left, caretSide };
}

const popoverStyle = computed(() => ({
  position: 'fixed' as const,
  top: `${position.value.top}px`,
  left: `${position.value.left}px`,
  zIndex: '60',
}));

// ── Open/close ────────────────────────────────────────────────────────────────

function show() {
  position.value = computePosition();
  isOpen.value = true;
}

function hide() {
  isOpen.value = false;
}

function toggle() {
  if (isOpen.value) {
    hide();
  } else {
    show();
  }
}

// ── Outside-click + Escape dismiss ───────────────────────────────────────────
// Pattern from ControlsMenu.vue lines 102-118.

function handleOutsideClick(event: MouseEvent) {
  const target = event.target as Node;
  const trigger = triggerRef.value;
  // If the click is inside the trigger button, let the @click handler manage state
  if (trigger && trigger.contains(target)) return;
  if (isOpen.value) {
    hide();
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && isOpen.value) {
    hide();
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleOutsideClick);
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleOutsideClick);
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <!--
    .action-help-btn — the "?" affordance trigger.
    aria-describedby only when popover is mounted (RESEARCH Pitfall 3).
    Inline SVG: circled question mark, 14×14px, aria-hidden (decorative).
  -->
  <button
    ref="triggerRef"
    type="button"
    class="action-help-btn"
    :aria-label="`Help for ${triggerLabel}`"
    :aria-expanded="isOpen"
    :aria-controls="`${actionName}-help-tip`"
    :aria-describedby="isOpen ? `${actionName}-help-tip` : undefined"
    @click="toggle"
    @mouseenter="show"
    @mouseleave="hide"
  >
    <!-- Circled question mark — 14×14 viewBox (UI-SPEC §2) -->
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="6" />
      <path
        d="M7 9V8.5c0-.5.3-.9.7-1.1C8.3 7 9 6.3 9 5.5a2 2 0 0 0-4 0"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx="7" cy="11" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  </button>

  <!--
    Teleport to body: escapes .actionbar overflow clipping (same pattern as
    HeatmapOverlay, TutorialOverlay, ControlsMenu).
    z-index 60 keeps it above all dock content (z-15 heatmap, z-20 tutorial).
  -->
  <Teleport to="body">
    <Transition name="action-help-popover">
      <div
        v-if="isOpen"
        :id="`${actionName}-help-tip`"
        role="tooltip"
        aria-live="polite"
        class="action-help-popover"
        :style="popoverStyle"
      >
        <!-- Caret: points toward trigger (upward when popover is below, downward when above) -->
        <span
          class="ahp-caret"
          :class="`ahp-caret--${position.caretSide}`"
          aria-hidden="true"
        ></span>

        <!-- Help text section — text interpolation only (T-108-03, no raw HTML binding) -->
        <p v-if="helpText" class="ahp-help-body">{{ helpText }}</p>

        <!-- Divider — only when BOTH sections exist (UI-SPEC "Content layout") -->
        <hr v-if="helpText && disabledReason" class="help-divider" aria-hidden="true" />

        <!-- Disabled-reason section — text interpolation only (T-108-03) -->
        <template v-if="disabledReason">
          <span class="ahp-disabled-label">Why disabled:</span>
          <p class="ahp-disabled-body">{{ disabledReason }}</p>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ── Popover container ────────────────────────────────────────────────────── */
.action-help-popover {
  /* position: fixed provided via inline :style binding (computed from trigger rect) */
  z-index: 60;
  max-width: 240px;
  min-width: 120px;
  width: max-content;

  background: var(--bsg-surface-3);
  border: 1px solid var(--bsg-line-2);
  border-radius: var(--bsg-r-md);
  box-shadow: var(--bsg-shadow-sm);
  padding: var(--bsg-s2) var(--bsg-s3); /* 8px 12px (UI-SPEC) */
}

/* ── Caret (border-trick, mirrors BoardMessage.vue lines 258-308) ────────── */
/* ActionHelpPopover uses var(--bsg-surface-3) fill (UI-SPEC), not surface-2. */
.ahp-caret {
  position: absolute;
  width: 0;
  height: 0;
}

/* caret--top: popover is BELOW the trigger, caret points UP */
.ahp-caret--top {
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-bottom: 8px solid var(--bsg-line-2);
}

.ahp-caret--top::after {
  content: '';
  position: absolute;
  top: 2px;
  left: -7px;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-bottom: 7px solid var(--bsg-surface-3);
}

/* caret--bottom: popover is ABOVE the trigger, caret points DOWN */
.ahp-caret--bottom {
  bottom: -8px;
  left: 50%;
  transform: translateX(-50%);
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-top: 8px solid var(--bsg-line-2);
}

.ahp-caret--bottom::after {
  content: '';
  position: absolute;
  bottom: 2px;
  left: -7px;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-top: 7px solid var(--bsg-surface-3);
}

/* ── Help text body ───────────────────────────────────────────────────────── */
.ahp-help-body {
  font-size: var(--bsg-text-sm); /* 14px */
  color: var(--bsg-ink-2);
  line-height: var(--bsg-line-normal); /* 1.5 */
  margin: 0;
}

/* ── Divider (both sections) ──────────────────────────────────────────────── */
.help-divider {
  border: none;
  border-top: 1px solid var(--bsg-line-2);
  margin: var(--bsg-s2) calc(-1 * var(--bsg-s3)); /* 8px -12px, full-bleed */
}

/* ── Disabled-reason section ──────────────────────────────────────────────── */
.ahp-disabled-label {
  display: block;
  font-size: var(--bsg-text-xs); /* 12px */
  color: var(--bsg-ink-3);
  line-height: var(--bsg-line-normal);
  margin-bottom: 2px;
}

.ahp-disabled-body {
  font-size: var(--bsg-text-sm); /* 14px */
  color: var(--bsg-ink-2);
  line-height: var(--bsg-line-normal);
  margin: 0;
}

/* ── Enter/leave transition ───────────────────────────────────────────────── */
.action-help-popover-enter-active,
.action-help-popover-leave-active {
  transition: opacity var(--bsg-dur-fast) var(--bsg-ease),
              transform var(--bsg-dur-fast) var(--bsg-ease);
}

.action-help-popover-enter-from,
.action-help-popover-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

/* Reduced motion: instant show/hide, no animation (UI-SPEC §3, mirrors BoardMessage) */
@media (prefers-reduced-motion: reduce) {
  .action-help-popover-enter-active,
  .action-help-popover-leave-active {
    transition: none;
  }
}
</style>
