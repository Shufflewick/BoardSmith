<script setup lang="ts">
/**
 * HintOverlay — single-annotation ring + bubble for AI move hints.
 *
 * Renders via `<Teleport to="body">` as a `position:fixed; inset:0` layer.
 * Reuses the TutorialOverlay infrastructure (measure, ResizeObserver, scroll,
 * ring CSS, BoardMessage annotation variant). The only difference is that it
 * reads a single `Annotation` from `gameState.state.hint?.annotation` rather
 * than an array from `tutorial.content`.
 *
 * Parity: resolves targets via `buildSelector` (shared with TutorialOverlay) so
 * the same `data-bs-el-*` anchors used by custom UIs and AutoUI are both found
 * identically — no renderer-specific branching (project hard-rule).
 *
 * Security:
 *  - T-107-08: annotation text rendered via Vue text interpolation only (never v-html).
 *  - T-107-09: overlay root + ring are pointer-events:none — never intercept input.
 *
 * Accessibility (107-UI-SPEC):
 *  - Ring + marker chip are aria-hidden (decorative visual).
 *  - Overlay root has NO aria-hidden so the bubble's role=status / aria-live=polite is announced.
 *  - Reduced motion: no animation (instant display).
 *
 * Z-index: 20 — same stratum as TutorialOverlay; both may coexist.
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
import BoardMessage from './BoardMessage.vue';
import type { Annotation } from '../../../engine/tutorial/types.js';
import { buildSelector } from './overlay-utils.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface ResolvedRing {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: string;
}

interface ResolvedBubble {
  anchorStyle: Record<string, string>;
  caretSide?: 'top' | 'bottom' | 'left' | 'right';
}

interface ResolvedAnnotation {
  text: string;
  ring: ResolvedRing | null;
  bubble: ResolvedBubble;
}

// ── Inject ────────────────────────────────────────────────────────────────────

const gameState = inject('gameState') as
  | Ref<{ state: { hint?: { annotation: Annotation } } }>
  | undefined;

// ── Derived content ───────────────────────────────────────────────────────────

const annotation = computed<Annotation | null>(
  () => gameState?.value?.state?.hint?.annotation ?? null,
);

const hasContent = computed(() => annotation.value !== null);

// ── DOM measurement ───────────────────────────────────────────────────────────

const overlayRoot = ref<HTMLElement | null>(null);

function readRadius(el: Element): string {
  const computed = window.getComputedStyle(el).borderRadius;
  return computed && computed !== '0px' ? computed : 'var(--bsg-r-md)';
}

const resolved = ref<ResolvedAnnotation | null>(null);

function bubbleFallbackStyle(
  boardRect: DOMRect | null,
): Record<string, string> {
  const GAP = 8;
  const left = boardRect ? boardRect.left + boardRect.width / 2 : window.innerWidth / 2;
  // Position the bubble BELOW the board (not at its top) so it never covers the
  // squares the player needs to read. Used when there is no resolvable target ring;
  // the descriptive text ("Suggested: c5 → a3") makes the bubble useful on its own.
  // Clamp into the viewport so a very tall board can't push it off-screen.
  const below = boardRect ? boardRect.bottom + GAP : window.innerHeight / 2;
  const top = Math.min(below, window.innerHeight - 56);
  return {
    left: `${left}px`,
    top: `${top}px`,
    transform: 'translateX(-50%)',
  };
}

function measure() {
  const ann = annotation.value;
  if (!ann) {
    resolved.value = null;
    return;
  }

  const boardRegion: Element | null =
    overlayRoot.value?.closest('.boardregion') ??
    document.querySelector('.boardregion');
  const boardRect = boardRegion?.getBoundingClientRect() ?? null;

  let ring: ResolvedRing | null = null;
  let caretSide: 'top' | 'bottom' | undefined;
  let anchorStyle: Record<string, string> = {};

  if (ann.target) {
    const selector = buildSelector(ann.target);
    const targetEl = selector ? document.querySelector(selector) : null;

    if (targetEl) {
      const rect = targetEl.getBoundingClientRect();
      const OFFSET = 3;

      ring = {
        left: rect.left - OFFSET,
        top: rect.top - OFFSET,
        width: rect.width + OFFSET * 2,
        height: rect.height + OFFSET * 2,
        radius: readRadius(targetEl),
      };

      const GAP = 8;
      const BUBBLE_HEIGHT_ESTIMATE = 80;
      const preferredTop = rect.top + rect.height + GAP;
      const fitsBelow = preferredTop + BUBBLE_HEIGHT_ESTIMATE <= window.innerHeight;

      if (fitsBelow) {
        caretSide = 'top';
        anchorStyle = {
          left: `${Math.max(0, rect.left + rect.width / 2)}px`,
          top: `${preferredTop}px`,
          transform: 'translateX(-50%)',
        };
      } else {
        caretSide = 'bottom';
        anchorStyle = {
          left: `${Math.max(0, rect.left + rect.width / 2)}px`,
          top: `${Math.max(0, rect.top - GAP - BUBBLE_HEIGHT_ESTIMATE)}px`,
          transform: 'translateX(-50%)',
        };
      }
    } else {
      anchorStyle = bubbleFallbackStyle(boardRect);
    }
  } else {
    anchorStyle = bubbleFallbackStyle(boardRect);
  }

  resolved.value = {
    text: ann.text,
    ring,
    bubble: { anchorStyle, caretSide },
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

    const ann = annotation.value;
    if (ann?.target) {
      const selector = buildSelector(ann.target);
      if (selector) {
        const el = document.querySelector(selector);
        if (el && !observedElements.includes(el)) {
          resizeObserver.observe(el);
          observedElements.push(el);
        }
      }
    }

    boardRegion.addEventListener('scroll', onScroll, { passive: true });
  }
}

function onScroll() {
  void nextTick(measure);
}

watchEffect(() => {
  const _ = annotation.value;
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

// ── Ring style helper ─────────────────────────────────────────────────────────

function ringStyle(ring: ResolvedRing): Record<string, string> {
  return {
    left: `${ring.left}px`,
    top: `${ring.top}px`,
    width: `${ring.width}px`,
    height: `${ring.height}px`,
    borderRadius: ring.radius,
  };
}
</script>

<template>
  <!--
    Teleport to body: renders the overlay as a fixed viewport layer.
    Same rationale as TutorialOverlay: escapes .boardregion overflow:hidden
    and finds action/panel targets in .actionbar siblings (BL-01 pattern).

    Root has NO aria-hidden so the bubble's role=status / aria-live=polite
    is announced by screen readers. Only the decorative ring carries aria-hidden.
  -->
  <Teleport to="body">
    <div
      v-if="hasContent"
      ref="overlayRoot"
      class="bsg-hint-overlay"
    >
      <!--
        Highlight ring — drawn at the target's viewport-fixed rect.
        pointer-events:none (T-107-09). aria-hidden: decorative.
      -->
      <div
        v-if="resolved?.ring"
        class="bsg-tutorial-ring"
        :style="ringStyle(resolved.ring)"
        aria-hidden="true"
      >
        <!--
          Non-color cue marker chip (WCAG 2.2 AA 1.4.1).
          "i" glyph identifies this as an AI hint suggestion.
        -->
        <span class="bsg-tutorial-ring__chip" aria-hidden="true">i</span>
      </div>

      <!--
        Annotation bubble — BoardMessage provides role=status / aria-live=polite.
        Text rendered via slot interpolation (never v-html — T-107-08).
      -->
      <BoardMessage
        v-if="resolved?.text"
        variant="annotation"
        :visible="true"
        :anchor-style="resolved.bubble.anchorStyle"
        :caret-side="resolved.bubble.caretSide"
      >{{ resolved.text }}</BoardMessage>
    </div>
  </Teleport>
</template>

<style scoped>
/* ── Overlay root ─────────────────────────────────────────────────────────── */
.bsg-hint-overlay {
  position: fixed;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  overflow: visible;
}

/* ── Highlight ring — identical to TutorialOverlay ring ──────────────────── */
.bsg-tutorial-ring {
  position: absolute;
  border: 3px solid var(--bsg-accent);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--bsg-accent) 35%, transparent),
    0 0 16px color-mix(in srgb, var(--bsg-accent-2) 30%, transparent);
  pointer-events: none;
  animation:
    bsg-hint-ring-in var(--bsg-dur-base) var(--bsg-ease) both,
    bsg-hint-ring-pulse var(--bsg-dur-slow) var(--bsg-ease) 2 var(--bsg-dur-base);
}

/* Non-color marker chip */
.bsg-tutorial-ring__chip {
  position: absolute;
  top: -10px;
  left: -10px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--bsg-r-pill);
  background: var(--bsg-accent);
  color: var(--bsg-accent-ink);
  font-family: var(--bsg-font);
  font-size: var(--bsg-text-sm);
  font-weight: 600;
  line-height: 1;
  pointer-events: none;
}

/* ── Appear animation ────────────────────────────────────────────────────── */

@keyframes bsg-hint-ring-in {
  from {
    opacity: 0;
    transform: scale(1.05);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes bsg-hint-ring-pulse {
  0%,
  100% {
    box-shadow:
      0 0 0 3px color-mix(in srgb, var(--bsg-accent) 35%, transparent),
      0 0 16px color-mix(in srgb, var(--bsg-accent-2) 30%, transparent);
  }
  50% {
    box-shadow:
      0 0 0 5px color-mix(in srgb, var(--bsg-accent) 50%, transparent),
      0 0 24px color-mix(in srgb, var(--bsg-accent-2) 50%, transparent);
  }
}

/* prefers-reduced-motion: no animation (107-UI-SPEC). */
@media (prefers-reduced-motion: reduce) {
  .bsg-tutorial-ring {
    animation: none;
  }
}
</style>
