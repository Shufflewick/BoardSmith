<script setup lang="ts">
/**
 * HeatmapOverlay — per-cell MCTS evaluation chips (AI-03).
 *
 * Renders via `<Teleport to="body">` as a `position:fixed; inset:0` layer at
 * z-index 15 (below TutorialOverlay/HintOverlay at z-20).
 *
 * Reads `gameState.state.heatmap` — renders chips only when `visible === true`
 * and `entries` is non-empty. Each chip is centered on the resolved cell's
 * `getBoundingClientRect` center and displays a numeric `%` badge (primary
 * non-color signal) plus an intensity-tinted background (secondary).
 *
 * Parity: resolves cell anchors via `buildSelector` (shared overlay-utils) so
 * both custom UI and AutoUI board elements are found via the same
 * `data-bs-el-*` attribute selectors — no renderer coupling (project hard-rule).
 *
 * Security:
 *  - T-107-08: chip text rendered via Vue text interpolation (never v-html).
 *  - T-107-09: overlay root + chips are pointer-events:none.
 *
 * Accessibility (107-UI-SPEC §4, WCAG 2.2 AA):
 *  - Chips are aria-hidden="true" — decorative; numeric % badge is the
 *    meaningful signal but is communicated via the ControlsMenu label.
 *  - Non-color cues: shape (circle), numeric badge, 2px solid border on isBest.
 *  - Reduced motion: instant display, no animation.
 */

import {
  ref,
  computed,
  inject,
  onMounted,
  onUnmounted,
  watchEffect,
  nextTick,
  type Ref,
} from 'vue';
import type { HeatmapEntry } from '../../../session/types.js';
import { buildSelector } from './overlay-utils.js';

// ── Inject ────────────────────────────────────────────────────────────────────

const gameState = inject('gameState') as
  | Ref<{ state: { heatmap?: { visible: boolean; entries: HeatmapEntry[] } } }>
  | undefined;

// ── Derived content ───────────────────────────────────────────────────────────

const entries = computed<HeatmapEntry[]>(
  () =>
    gameState?.value?.state?.heatmap?.visible
      ? (gameState.value.state.heatmap.entries ?? [])
      : [],
);

const hasContent = computed(() => entries.value.length > 0);

// ── Resolved chip positions ───────────────────────────────────────────────────

interface ResolvedChip {
  entry: HeatmapEntry;
  cx: number;
  cy: number;
  size: number;
}

const overlayRoot = ref<HTMLElement | null>(null);
const resolvedChips = ref<ResolvedChip[]>([]);

function measure() {
  const chips: ResolvedChip[] = [];
  for (const entry of entries.value) {
    const selector = buildSelector({ kind: 'element', ref: entry.cellRef });
    if (!selector) continue;
    const el = document.querySelector(selector);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    const size = Math.max(24, Math.min(Math.floor(Math.min(rect.width, rect.height) * 0.68), 52));
    chips.push({
      entry,
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2,
      size,
    });
  }
  resolvedChips.value = chips;
}

// ── Chip visual helpers ───────────────────────────────────────────────────────

/**
 * Chip intensity: 15 + round(normalizedValue × 70), range 15–85.
 * Used for background tint and border transparency.
 */
function chipIntensity(normalizedValue: number): number {
  return 15 + Math.round(normalizedValue * 70);
}

/**
 * Chip background: color-mix tint of --bsg-accent at computed intensity %.
 */
function chipBackground(normalizedValue: number): string {
  const pct = chipIntensity(normalizedValue);
  return `color-mix(in srgb, var(--bsg-accent) ${pct}%, transparent)`;
}

/**
 * Chip border: 2px solid accent for best-move; 1px semi-transparent otherwise.
 */
function chipBorder(entry: HeatmapEntry): string {
  if (entry.isBest) {
    return '2px solid var(--bsg-accent)';
  }
  const pct = chipIntensity(entry.normalizedValue) + 15;
  return `1px solid color-mix(in srgb, var(--bsg-accent) ${pct}%, transparent)`;
}

/**
 * Chip text color: --bsg-accent-ink when intensity >= 55, else --bsg-ink.
 * (107-UI-SPEC: WCAG 2.2 AA contrast on both tint levels.)
 */
function chipTextColor(normalizedValue: number): string {
  return chipIntensity(normalizedValue) >= 55
    ? 'var(--bsg-accent-ink)'
    : 'var(--bsg-ink)';
}

/**
 * Badge text: round(normalizedValue × 100) + "%"
 */
function chipBadge(normalizedValue: number): string {
  return `${Math.round(normalizedValue * 100)}%`;
}

/**
 * Inline style for a chip, positioned via fixed coords + translate(-50%,-50%).
 */
function chipStyle(chip: ResolvedChip): Record<string, string> {
  const { entry, cx, cy, size } = chip;
  return {
    position: 'absolute',
    left: `${cx}px`,
    top: `${cy}px`,
    transform: 'translate(-50%, -50%)',
    width: `${size}px`,
    height: `${size}px`,
    background: chipBackground(entry.normalizedValue),
    border: chipBorder(entry),
    color: chipTextColor(entry.normalizedValue),
    borderRadius: 'var(--bsg-r-pill)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'var(--bsg-font)',
    fontSize: 'var(--bsg-text-xs)',
    fontWeight: '600',
    lineHeight: 'var(--bsg-line-tight)',
    pointerEvents: 'none',
    animation: 'bsg-chip-in var(--bsg-dur-base) var(--bsg-ease) both',
  };
}

// ── Observers & lifecycle ─────────────────────────────────────────────────────

let resizeObserver: ResizeObserver | null = null;
let observedElements: Element[] = [];

function rebuildObservers() {
  if (!overlayRoot.value) return;

  const boardRegion =
    overlayRoot.value.closest('.boardregion') ??
    document.querySelector('.boardregion');

  if (resizeObserver) {
    resizeObserver.disconnect();
    observedElements = [];
  }

  resizeObserver = new ResizeObserver(() => {
    void nextTick(measure);
  });

  if (boardRegion) {
    resizeObserver.observe(boardRegion);
    observedElements.push(boardRegion);

    for (const entry of entries.value) {
      const selector = buildSelector({ kind: 'element', ref: entry.cellRef });
      if (!selector) continue;
      const el = document.querySelector(selector);
      if (el && !observedElements.includes(el)) {
        resizeObserver.observe(el);
        observedElements.push(el);
      }
    }

    boardRegion.addEventListener('scroll', onScroll, { passive: true });
  }
}

function onScroll() {
  void nextTick(measure);
}

watchEffect(() => {
  const _ = entries.value;
  void nextTick(() => {
    measure();
    rebuildObservers();
  });
});

onMounted(() => {
  measure();
  rebuildObservers();
});

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  const boardRegion =
    overlayRoot.value?.closest('.boardregion') ??
    document.querySelector('.boardregion');
  if (boardRegion) {
    boardRegion.removeEventListener('scroll', onScroll);
  }
  observedElements = [];
});
</script>

<template>
  <!--
    Teleport to body: fixed viewport layer.
    z-index 15 — below TutorialOverlay/HintOverlay (z-20), above turn-prompt (z-5).
    pointer-events:none — chips never intercept board input (T-107-09).
  -->
  <Teleport to="body">
    <div
      v-if="hasContent"
      ref="overlayRoot"
      class="bsg-heatmap-overlay"
    >
      <!--
        Per-cell evaluation chip.
        aria-hidden="true" — decorative layer; the numeric badge conveys the value
        but chip positions are not keyboard-accessible (WCAG 2.2 AA 1.4.1).
      -->
      <div
        v-for="(chip, i) in resolvedChips"
        :key="i"
        :style="chipStyle(chip)"
        aria-hidden="true"
      >{{ chipBadge(chip.entry.normalizedValue) }}</div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ── Overlay root ─────────────────────────────────────────────────────────── */
.bsg-heatmap-overlay {
  position: fixed;
  inset: 0;
  z-index: 15;
  pointer-events: none;
  overflow: visible;
}

/* ── Chip appear animation ───────────────────────────────────────────────── */
@keyframes bsg-chip-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* prefers-reduced-motion: instant display, no animation (107-UI-SPEC). */
@media (prefers-reduced-motion: reduce) {
  .bsg-heatmap-overlay > * {
    animation: none !important;
  }
}
</style>
