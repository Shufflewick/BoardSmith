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

import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';

// ── Props ─────────────────────────────────────────────────────────────────────

const props = defineProps<{
  /** Used to build id="${actionName}-help-tip" on the tooltip element. */
  actionName: string;
  /** From ActionMetadata.help (Plan 01). Display-only; never a predicate. */
  helpText?: string;
  /** From disabledActions[name]. Rendered under "Note:" label. */
  disabledReason?: string;
  /** The action prompt/display name — aria-label "Help for {triggerLabel}". */
  triggerLabel: string;
}>();

// ── State ─────────────────────────────────────────────────────────────────────

const isOpen = ref(false);
const triggerRef = ref<HTMLButtonElement | null>(null);
const popoverRef = ref<HTMLDivElement | null>(null);

// ── Position ──────────────────────────────────────────────────────────────────

interface PopoverPosition {
  top: number;
  left: number;
  caretSide: 'top' | 'bottom';
  /** Horizontal center of caret relative to the popover left edge (px). */
  caretLeft: number;
}

/**
 * Conservative fallback height used when offsetHeight is unavailable (e.g. jsdom).
 * 220 px covers a dual-section popover (help text + divider + disabled reason).
 */
const POPOVER_FALLBACK_HEIGHT = 220;
const POPOVER_MAX_WIDTH = 240;

const position = ref<PopoverPosition>({ top: 0, left: 0, caretSide: 'top', caretLeft: POPOVER_MAX_WIDTH / 2 });

/**
 * Compute fixed position for popover anchored below (or above) the trigger button.
 * Mirrors HeatmapOverlay / TutorialOverlay getBoundingClientRect pattern.
 * Stale position on scroll/resize is acceptable per RESEARCH.md Pitfall 4.
 *
 * @param actualHeight - The rendered height of the popover element in px. Used for
 *   flip detection and above-placement offset so the popover sits fully above the
 *   trigger when flipped (WR-01). Pass POPOVER_FALLBACK_HEIGHT when the DOM element
 *   is not yet available.
 */
function computePosition(actualHeight: number): PopoverPosition {
  const el = triggerRef.value;
  if (!el) return { top: 0, left: 0, caretSide: 'top', caretLeft: POPOVER_MAX_WIDTH / 2 };

  const rect = el.getBoundingClientRect();
  // FLIP_THRESHOLD: min clearance between popover bottom edge and viewport bottom before flip triggers.
  // Spec: --bsg-s4 = 16px (UI-SPEC §Spacing, "Min space above/below popover before flip threshold").
  const FLIP_THRESHOLD = 16;
  // EDGE_MARGIN: horizontal clearance between popover right edge and viewport right edge.
  // Spec: --bsg-s2 = 8px (correct at 8; named constant to distinguish from FLIP_THRESHOLD).
  const EDGE_MARGIN = 8;

  let top = rect.bottom + 4;
  let left = rect.left;
  let caretSide: 'top' | 'bottom' = 'top';

  // Flip above if the popover's bottom edge would fall within FLIP_THRESHOLD px of viewport bottom.
  // Uses actualHeight so a tall dual-section popover flips at the correct trigger position (WR-01).
  if (top + actualHeight > window.innerHeight - FLIP_THRESHOLD) {
    top = rect.top - actualHeight - 4;
    caretSide = 'bottom';
  }

  // Right-edge constraint: shift left if popover would overflow the viewport right edge.
  if (left + POPOVER_MAX_WIDTH > window.innerWidth - EDGE_MARGIN) {
    left = window.innerWidth - POPOVER_MAX_WIDTH - EDGE_MARGIN;
  }

  // WR-02: Track the trigger's horizontal center relative to the (possibly clamped) popover
  // left edge so the caret still points at the "?" button after right-edge shifting.
  const triggerMidX = rect.left + rect.width / 2;
  const caretLeft = Math.min(POPOVER_MAX_WIDTH - 12, Math.max(12, triggerMidX - left));

  return { top, left, caretSide, caretLeft };
}

const popoverStyle = computed(() => ({
  position: 'fixed' as const,
  top: `${position.value.top}px`,
  left: `${position.value.left}px`,
  zIndex: '60',
}));

// ── Open/close ────────────────────────────────────────────────────────────────

async function show() {
  const el = triggerRef.value;
  if (!el) return;
  // Phase 1: place popover at an initial position so the element mounts and can be measured.
  const rect = el.getBoundingClientRect();
  position.value = { top: rect.bottom + 4, left: rect.left, caretSide: 'top', caretLeft: rect.width / 2 };
  isOpen.value = true;
  // Phase 2: after Vue renders the teleported element, measure its actual rendered height
  // and recompute — this prevents viewport overflow for tall dual-section popovers (WR-01).
  await nextTick();
  if (!isOpen.value) return; // hide() was called during the async tick
  const actualHeight = popoverRef.value?.offsetHeight ?? POPOVER_FALLBACK_HEIGHT;
  position.value = computePosition(actualHeight);
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
        ref="popoverRef"
        v-if="isOpen"
        :id="`${actionName}-help-tip`"
        role="tooltip"
        aria-live="polite"
        class="action-help-popover"
        :style="popoverStyle"
      >
        <!-- Caret: points toward trigger (upward when popover is below, downward when above).
             --ahp-caret-left tracks the trigger's horizontal center relative to the
             (possibly right-edge-clamped) popover box so the caret always points at the
             "?" button even when the popover has been shifted left (WR-02). -->
        <span
          class="ahp-caret"
          :class="`ahp-caret--${position.caretSide}`"
          :style="{ '--ahp-caret-left': `${position.caretLeft}px` }"
          aria-hidden="true"
        ></span>

        <!-- Help text section — text interpolation only (T-108-03, no raw HTML binding) -->
        <p v-if="helpText" class="ahp-help-body">{{ helpText }}</p>

        <!-- Divider — only when BOTH sections exist (UI-SPEC "Content layout") -->
        <hr v-if="helpText && disabledReason" class="help-divider" aria-hidden="true" />

        <!-- Disabled-reason section — text interpolation only (T-108-03).
             Label is "Note:" rather than "Why disabled:" because the action button
             may still be clickable (tutorial-gated actions remain in availableActions);
             the label must not assert non-functionality that doesn't match the UI state (WR-03). -->
        <template v-if="disabledReason">
          <span class="ahp-disabled-label">Note:</span>
          <p class="ahp-disabled-body">{{ disabledReason }}</p>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ── "?" affordance trigger button ───────────────────────────────────────── */
/* Self-contained styles so the button is correctly sized and positioned when
   ActionHelpPopover is used in both ActionPanel (AutoUI) and custom UI slots
   (IN-02 parity fix). The button uses position:absolute so it must be placed
   inside a position:relative container (e.g. .action-btn-group in ActionPanel). */
.action-help-btn {
  position: absolute;
  top: 0;
  right: 0;
  min-width: 24px;
  min-height: 24px;
  padding: 4px 5px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--bsg-ink-3);
  line-height: 1;
  z-index: 1;
}

.action-help-btn:hover {
  color: var(--bsg-ink-2);
}

.action-help-btn[aria-expanded="true"] {
  color: var(--bsg-accent);
}

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
  left: var(--ahp-caret-left, 50%);
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
  left: var(--ahp-caret-left, 50%);
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
