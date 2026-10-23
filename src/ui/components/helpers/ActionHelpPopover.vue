<script setup lang="ts">
/**
 * ActionHelpPopover — shared reveal surface for action help text and disabled reasons.
 *
 * Renders a circled "?" trigger button that opens a Teleport-to-body fixed-positioned
 * popover on mouse hover, or on click, tap or Enter. A click on help a hover opened keeps
 * it open, and the next click closes it (#1451). The same popover also surfaces the
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
 *  - Dismiss: outside mousedown, Escape key, the mouse leaving the trigger and the popover
 *  - Help taller than the room scrolls inside the popover: by mouse over it, by
 *    arrow and Page keys on the trigger (#1454)
 *  - Reduced motion: `.bs-reduce-motion` → transition: none
 */

import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { computePopoverPosition, type PopoverPosition } from './popover-position.js';
import { syncReducedMotionClass } from '../../composables/reducedMotion.js';

syncReducedMotionClass();

// ── Props ─────────────────────────────────────────────────────────────────────

const props = defineProps<{
  /** Used to build id="${actionName}-help-tip" on the tooltip element. */
  actionName: string;
  /** From ActionMetadata.help (Plan 01). Display-only; never a predicate. */
  helpText?: string;
  /** From disabledActions[name]. Rendered under the "Why it's disabled:" label. */
  disabledReason?: string;
  /** The action prompt/display name — aria-label "Help for {triggerLabel}". */
  triggerLabel: string;
}>();

// ── State ─────────────────────────────────────────────────────────────────────

const isOpen = ref(false);
/** Open because the mouse is over the trigger, so the click that follows keeps it open. */
let openedByHover = false;
const triggerRef = ref<HTMLButtonElement | null>(null);
const popoverRef = ref<HTMLDivElement | null>(null);
const scrollRef = ref<HTMLDivElement | null>(null);

// ── Position ──────────────────────────────────────────────────────────────────

/**
 * Conservative fallback height used when offsetHeight is unavailable (e.g. jsdom).
 * 220 px covers a dual-section popover (help text + divider + disabled reason).
 */
const POPOVER_FALLBACK_HEIGHT = 220;
const POPOVER_MAX_WIDTH = 240;

const position = ref<PopoverPosition>({ top: 0, left: 0, caretSide: 'top', caretLeft: POPOVER_MAX_WIDTH / 2, maxHeight: 0 });

const popoverStyle = computed(() => ({
  position: 'fixed' as const,
  top: `${position.value.top}px`,
  left: `${position.value.left}px`,
  maxHeight: `${position.value.maxHeight}px`,
  zIndex: '60',
}));

// ── Open/close ────────────────────────────────────────────────────────────────

async function show() {
  const el = triggerRef.value;
  if (!el) return;
  // Phase 1: place popover at an initial position so the element mounts and can be measured.
  // Capped only at the window, which is taller than the room on either side, so the measure decides the side.
  const rect = el.getBoundingClientRect();
  position.value = { top: rect.bottom + 4, left: rect.left, caretSide: 'top', caretLeft: rect.width / 2, maxHeight: window.innerHeight };
  isOpen.value = true;
  // Phase 2: after Vue renders the teleported element, measure its actual rendered size and
  // place it with the shared maths the disabled-reason tooltip uses, so the two flip and clamp
  // identically (WR-01). Stale position on scroll is accepted (RESEARCH.md Pitfall 4).
  await nextTick();
  if (!isOpen.value) return; // hide() was called during the async tick
  const box = popoverRef.value;
  position.value = computePopoverPosition(
    el.getBoundingClientRect(),
    box?.offsetHeight ?? POPOVER_FALLBACK_HEIGHT,
    box?.offsetWidth ?? POPOVER_MAX_WIDTH,
  );
}

function hide() {
  isOpen.value = false;
  openedByHover = false;
}

function toggle(event: MouseEvent) {
  // detail 0 is Enter or Space: the key toggles even while the mouse rests on the trigger.
  if (openedByHover && event.detail > 0) {
    openedByHover = false;
  } else if (isOpen.value) {
    hide();
  } else {
    show();
  }
}

// Mouse only: a tap also sends enter and leave, and opening on those would race the tap's click.
function hoverOpen(event: PointerEvent) {
  if (event.pointerType !== 'mouse' || isOpen.value) return;
  openedByHover = true;
  show();
}

// Moving between the trigger and the popover keeps it open, so the mouse can scroll the popover.
function hoverClose(event: PointerEvent) {
  const to = event.relatedTarget as Node | null;
  if (event.pointerType !== 'mouse' || triggerRef.value?.contains(to) || popoverRef.value?.contains(to)) return;
  hide();
}

const SCROLL_KEYS: Record<string, (page: number) => number> = {
  ArrowDown: () => 40,
  ArrowUp: () => -40,
  PageDown: (page) => page,
  PageUp: (page) => -page,
};

// The popover is teleported out of the tab order, so its scroll keys work from the trigger.
function scrollPopover(event: KeyboardEvent) {
  const scroller = scrollRef.value;
  const step = SCROLL_KEYS[event.key];
  if (!scroller || !step || scroller.scrollHeight <= scroller.clientHeight) return;
  event.preventDefault();
  scroller.scrollBy({ top: step(scroller.clientHeight) });
}

// ── Outside-click + Escape dismiss ───────────────────────────────────────────
// Pattern from ControlsMenu.vue lines 102-118.

function handleOutsideClick(event: MouseEvent) {
  const target = event.target as Node;
  const trigger = triggerRef.value;
  // If the click is inside the trigger button, let the @click handler manage state
  if (trigger && trigger.contains(target)) return;
  // A press inside the popover is a drag on its scrollbar.
  if (popoverRef.value?.contains(target)) return;
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
    @pointerenter="hoverOpen"
    @pointerleave="hoverClose"
    @keydown="scrollPopover"
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
    z-index 60 keeps it above all action bar content (z-15 heatmap, z-31 tutorial).
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
        :class="`action-help-popover--caret-${position.caretSide}`"
        :style="popoverStyle"
        @pointerleave="hoverClose"
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

        <div ref="scrollRef" class="ahp-scroll">
        <!-- Help text section — text interpolation only (T-108-03, no raw HTML binding) -->
        <p v-if="helpText" class="ahp-help-body">{{ helpText }}</p>

        <!-- Divider — only when BOTH sections exist (UI-SPEC "Content layout") -->
        <hr v-if="helpText && disabledReason" class="help-divider" aria-hidden="true" />

        <!-- Disabled-reason section — text interpolation only (T-108-03).
             The label may assert non-functionality: a `disabledActions` entry now
             genuinely disables the button (ActionPanel binds the same reason to
             aria-disabled and blocks the click), so the popover and the UI state
             agree. This supersedes WR-03, which chose the vaguer "Note:" back when
             a gated action's button stayed clickable. -->
        <template v-if="disabledReason">
          <span class="ahp-disabled-label">Why it's disabled:</span>
          <p class="ahp-disabled-body">{{ disabledReason }}</p>
        </template>
        </div>
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
  /* Teleported out of the shell root, so it does not inherit the shell's font (#451). */
  font-family: var(--bsg-font);
  /* position: fixed provided via inline :style binding (computed from trigger rect) */
  z-index: 60;
  max-width: 240px;
  min-width: 120px;
  width: max-content;

  background: var(--bsg-surface-3);
  border: 1px solid var(--bsg-line-2);
  border-radius: var(--bsg-r-md);
  box-shadow: var(--bsg-shadow-sm);

  /* The inline max-height is the room beside the trigger; .ahp-scroll shrinks into it and scrolls (#1454). */
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

/* The scroller lives inside the box so the caret, which sits outside the box, is not clipped. */
.ahp-scroll {
  min-height: 0;
  overflow-y: auto;
  padding: var(--bsg-s2) var(--bsg-s3); /* 8px 12px (UI-SPEC) */
}

/* Bridges the gap to the trigger, so the mouse never leaves both on its way into the popover. */
.action-help-popover::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 6px;
}

.action-help-popover--caret-top::before {
  top: -6px;
}

.action-help-popover--caret-bottom::before {
  bottom: -6px;
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
.bs-reduce-motion .action-help-popover-enter-active,
.bs-reduce-motion .action-help-popover-leave-active {
  transition: none;
}
</style>
