<script setup lang="ts">
/**
 * TutorialOverlay — single annotation layer for tutorial highlights.
 *
 * Mounts as an `position: absolute; inset: 0` sibling inside `.boardregion`
 * and reads `state.tutorial.content` to render:
 *   - A **ring** (3px accent stroke + glow + non-color marker chip) drawn over
 *     the measured rect of the resolved anchor element.
 *   - A **BoardMessage annotation bubble** (prose card, caret toward ring) near
 *     the ring or in fallback placement when no target is resolved.
 *
 * Targets are resolved ONLY through the shared `data-bs-*` attribute set
 * placed by Plan 02 (`anchorAttrs` / `useBoardInteraction`):
 *   - element: `[data-bs-el-id]` > `[data-bs-el-notation]` > `[data-bs-el-name]`
 *   - action:  `[data-bs-action="<name>"]`
 *   - panel:   `[data-bs-panel]`
 *
 * The overlay NEVER queries renderer-specific selectors — parity is structural
 * (UI-SPEC §5). Custom UIs and AutoUI share the anchor layer and get annotations
 * automatically.
 *
 * Security:
 *  - T-105-05: annotation text rendered via Vue text interpolation only (never raw HTML).
 *  - T-105-06: attribute selectors built via CSS.escape(); queries scoped to .boardregion.
 *  - T-105-07: ring is pointer-events:none — decorative, never intercepts input.
 *
 * Accessibility (UI-SPEC §4):
 *  - Ring + marker chip are aria-hidden (decorative visual).
 *  - Bubble uses BoardMessage's role=status / aria-live=polite.
 *  - No focus steal, no key handlers — lifecycle is Phase 104/106.
 *
 * Z-index: 20 (above turn prompt z-5, below modal/game-over z-50 — UI-SPEC §3).
 *
 * Motion: fade + one-shot emphasis on appear; 2-iteration glow breathe; full
 * prefers-reduced-motion path (instant, no animation).
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
import type {
  Annotation,
  AnnotationTarget,
} from '../../../engine/tutorial/types.js';

// ── CSS.escape polyfill ───────────────────────────────────────────────────────
// jsdom and some environments don't expose CSS.escape. Provide a minimal
// fallback that escapes characters which could break an attribute selector.
// In production browsers CSS.escape is universally available.
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  // Minimal fallback: escape characters that would break an attribute selector.
  return value.replace(/["\\]/g, '\\$&');
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ResolvedRing {
  /** Absolute position + size covering the target rect, offset 3px outside. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** border-radius from the target element's computed style, else --bsg-r-md. */
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
  | Ref<{ state: { tutorial?: { content?: Annotation[] } } }>
  | undefined;

// ── Derived content ───────────────────────────────────────────────────────────

const annotations = computed<Annotation[]>(
  () => gameState?.value?.state?.tutorial?.content ?? [],
);

const hasContent = computed(() => annotations.value.length > 0);

// ── DOM measurement ───────────────────────────────────────────────────────────

const overlayRoot = ref<HTMLElement | null>(null);

/** Build an attribute selector for an AnnotationTarget, using CSS.escape. */
function buildSelector(target: AnnotationTarget): string {
  switch (target.kind) {
    case 'element': {
      const { ref: elRef } = target;
      if (elRef.id !== undefined) {
        return `[data-bs-el-id="${cssEscape(String(elRef.id))}"]`;
      }
      if (elRef.notation !== undefined) {
        return `[data-bs-el-notation="${cssEscape(elRef.notation)}"]`;
      }
      if (elRef.name !== undefined) {
        return `[data-bs-el-name="${cssEscape(elRef.name)}"]`;
      }
      return '';
    }
    case 'action':
      return `[data-bs-action="${cssEscape(target.actionName)}"]`;
    case 'panel':
      return '[data-bs-panel]';
  }
}

/** Read border-radius from a target element, falling back to the token variable. */
function readRadius(el: Element): string {
  const computed = window.getComputedStyle(el).borderRadius;
  return computed && computed !== '0px' ? computed : 'var(--bsg-r-md)';
}

const resolvedAnnotations = ref<ResolvedAnnotation[]>([]);

function measure() {
  // Locate .boardregion: walk up from the overlay's own root so we don't
  // accidentally match a stale or duplicate element in the document.
  const boardRegion: Element | null =
    overlayRoot.value?.closest('.boardregion') ??
    document.querySelector('.boardregion');

  if (!boardRegion) {
    resolvedAnnotations.value = [];
    return;
  }

  const boardRect = boardRegion.getBoundingClientRect();

  resolvedAnnotations.value = annotations.value.map((ann) => {
    let ring: ResolvedRing | null = null;
    let caretSide: 'top' | 'bottom' | undefined;
    let anchorStyle: Record<string, string> = {};

    // ── Resolve target ───────────────────────────────────────────────────────
    if (ann.target) {
      const selector = buildSelector(ann.target);
      const targetEl = selector
        ? boardRegion.querySelector(selector)
        : null;

      if (targetEl) {
        const rect = targetEl.getBoundingClientRect();
        const OFFSET = 3; // px outside the target rect

        ring = {
          left: rect.left - boardRect.left - OFFSET,
          top: rect.top - boardRect.top - OFFSET,
          width: rect.width + OFFSET * 2,
          height: rect.height + OFFSET * 2,
          radius: readRadius(targetEl),
        };

        // ── Bubble placement (auto) ──────────────────────────────────────────
        if (!ann.placement || ann.placement === 'auto') {
          const GAP = 8; // var(--bsg-s2)
          const BUBBLE_HEIGHT_ESTIMATE = 80; // conservative estimate

          const preferredTop =
            rect.top - boardRect.top + rect.height + GAP;
          const fitsBelow =
            preferredTop + BUBBLE_HEIGHT_ESTIMATE <= boardRect.height;

          if (fitsBelow) {
            caretSide = 'top';
            anchorStyle = {
              left: `${Math.max(0, rect.left - boardRect.left + rect.width / 2)}px`,
              top: `${preferredTop}px`,
              transform: 'translateX(-50%)',
            };
          } else {
            // Flip above
            caretSide = 'bottom';
            anchorStyle = {
              left: `${Math.max(0, rect.left - boardRect.left + rect.width / 2)}px`,
              top: `${Math.max(0, rect.top - boardRect.top - GAP - BUBBLE_HEIGHT_ESTIMATE)}px`,
              transform: 'translateX(-50%)',
            };
          }
        }
      } else {
        // Null target → bubble-only fallback (top of board region)
        anchorStyle = {
          left: '50%',
          top: 'var(--bsg-s3)',
          transform: 'translateX(-50%)',
        };
      }
    } else {
      // No target at all → bubble only, position prop handles placement
      anchorStyle = {};
    }

    return {
      text: ann.text,
      ring,
      bubble: { anchorStyle, caretSide },
    };
  });
}

// ── Observers & lifecycle ─────────────────────────────────────────────────────

let resizeObserver: ResizeObserver | null = null;
let observedElements: Element[] = [];

function rebuildObservers() {
  if (!overlayRoot.value) return;

  const boardRegion =
    overlayRoot.value.closest('.boardregion') ??
    document.querySelector('.boardregion');

  // Disconnect previous observers
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

    // Observe each resolved target
    for (const ann of annotations.value) {
      if (!ann.target) continue;
      const selector = buildSelector(ann.target);
      if (!selector) continue;
      const el = boardRegion.querySelector(selector);
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

// Watch annotations; re-measure and rebuild observers when they change.
watchEffect(() => {
  // Access annotations.value to establish the reactive dependency.
  const _ = annotations.value;
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
  <!-- Overlay root: zero markup when no tutorial content (v-if guard). -->
  <div
    v-if="hasContent"
    ref="overlayRoot"
    class="bsg-tutorial-overlay"
    aria-hidden="true"
  >
    <template v-for="(resolved, i) in resolvedAnnotations" :key="i">
      <!--
        Highlight ring — drawn over the measured target rect.
        pointer-events:none so it never intercepts the underlying control (T-105-07).
        aria-hidden: ring is decorative; the bubble text is the accessible description.
      -->
      <div
        v-if="resolved.ring"
        class="bsg-tutorial-ring"
        :style="ringStyle(resolved.ring)"
        aria-hidden="true"
      >
        <!--
          Non-color cue marker chip (WCAG 2.2 AA 1.4.1 — UI-SPEC §2).
          An "i" glyph in an --bsg-accent chip pinned to the ring corner
          identifies the ring as a tutorial highlight independent of hue.
        -->
        <span class="bsg-tutorial-ring__chip" aria-hidden="true">i</span>
      </div>

      <!--
        Annotation bubble — reuses BoardMessage for role=status / aria-live=polite /
        reduced-motion for free (UI-SPEC §1, §4).
        aria-hidden on the outer overlay is lifted here: the bubble carries real
        accessible text and must be announced. We wrap it outside the aria-hidden
        root by rendering it as a sibling of the ring — but since it's inside the
        overlay div (which is aria-hidden), we explicitly undo that on the bubble.
      -->
      <BoardMessage
        v-if="resolved.text"
        variant="annotation"
        :visible="true"
        :anchor-style="resolved.bubble.anchorStyle"
        :caret-side="resolved.bubble.caretSide"
        aria-hidden="false"
      >{{ resolved.text }}</BoardMessage>
    </template>
  </div>
</template>

<style scoped>
/* ── Overlay root ─────────────────────────────────────────────────────────── */
/*
 * Covers the full .boardregion without affecting layout.
 * z-index 20: above BoardMessage turn prompt (z-5), below modal/game-over (z-50).
 * pointer-events:none on the root; the bubble re-enables them on its content box.
 */
.bsg-tutorial-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  /* overflow:hidden clips rings that extend beyond the board edge; the bubble
     is position:absolute too but clamped by TutorialOverlay logic (UI-SPEC §3). */
  overflow: hidden;
}

/* ── Highlight ring ──────────────────────────────────────────────────────── */
.bsg-tutorial-ring {
  position: absolute;
  /* 3px stroke — wider than 2px selection outline so tutorial ring out-ranks
     ambient selection chrome (UI-SPEC §2). */
  border: 3px solid var(--bsg-accent);
  /* Glow: outer ring shadow + spread (UI-SPEC §2 glow spec). */
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--bsg-accent) 35%, transparent),
    0 0 16px color-mix(in srgb, var(--bsg-accent-2) 30%, transparent);
  pointer-events: none;
  /* Appear animation: fade + subtle scale-in (UI-SPEC §3). */
  animation:
    bsg-ring-in var(--bsg-dur-base) var(--bsg-ease) both,
    bsg-ring-pulse var(--bsg-dur-slow) var(--bsg-ease) 2 var(--bsg-dur-base);
}

/* Non-color marker chip (UI-SPEC §2 — shape-based non-color cue). */
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

@keyframes bsg-ring-in {
  from {
    opacity: 0;
    transform: scale(1.05);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes bsg-ring-pulse {
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

/* prefers-reduced-motion: no animation, no pulse (UI-SPEC §3). */
@media (prefers-reduced-motion: reduce) {
  .bsg-tutorial-ring {
    animation: none;
  }
}
</style>
