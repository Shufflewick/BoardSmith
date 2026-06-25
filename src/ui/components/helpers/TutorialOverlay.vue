<script setup lang="ts">
/**
 * TutorialOverlay — single annotation layer for tutorial highlights.
 *
 * Renders via `<Teleport to="body">` as a `position:fixed; inset:0` layer over
 * the entire viewport. This escapes `.boardregion`'s `overflow:hidden` clip and
 * the sibling-boundary between `.boardregion` and `.actionbar`, so ALL three
 * `AnnotationTarget` kinds resolve correctly:
 *
 *   - element: `[data-bs-el-id]` > `[data-bs-el-notation]` > `[data-bs-el-name]`
 *     (emitted by anchorAttrs / useSelectable inside .boardregion)
 *   - action:  `[data-bs-action="<name>"]`
 *     (emitted by ActionPanel inside .actionbar — SIBLING of .boardregion)
 *   - panel:   `[data-bs-panel]`
 *     (emitted by ActionPanel inside .actionbar — SIBLING of .boardregion)
 *
 * Target resolution uses `document.querySelector` (not a `.boardregion`-scoped
 * query) so action/panel targets in .actionbar are found (BL-01 fix).
 *
 * Ring + bubble coordinates are viewport-relative (`getBoundingClientRect()`
 * minus nothing — the fixed overlay starts at (0,0) viewport). This also fixes
 * the bubble-clip issue (WR-03) since the overlay has no `overflow:hidden`.
 *
 * The overlay NEVER queries renderer-specific selectors — parity is structural
 * (UI-SPEC §5). Custom UIs and AutoUI share the anchor layer and get annotations
 * automatically.
 *
 * Security:
 *  - T-105-05: annotation text rendered via Vue text interpolation only (never raw HTML).
 *  - T-105-06: attribute selectors built via CSS.escape(); queries scoped to document.
 *  - T-105-07: ring is pointer-events:none — decorative, never intercepts input.
 *
 * Accessibility (UI-SPEC §4):
 *  - Ring + marker chip are aria-hidden (decorative visual).
 *  - Overlay root has NO aria-hidden so the bubble's role=status / aria-live=polite
 *    is announced (CR-01 fix — aria-hidden on root silenced all descendants).
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
  /** Viewport-fixed position + size covering the target rect, offset 3px outside. */
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

/**
 * Compute viewport-fixed position for an untargeted or explicit-placement bubble.
 *
 * Uses boardRegion's viewport rect so the bubble appears over the board area.
 * Falls back to window dimensions when no boardRegion is available.
 *
 * This fixes WR-01: untargeted bubbles previously had anchorStyle={} (0,0).
 */
function bubbleFallbackStyle(
  placement: Annotation['placement'],
  boardRect: DOMRect | null,
): Record<string, string> {
  const GAP = 8; // var(--bsg-s2)
  const BUBBLE_HEIGHT_ESTIMATE = 80;

  // Compute fallback bounds from boardRect or full viewport
  const left = boardRect ? boardRect.left + boardRect.width / 2 : window.innerWidth / 2;
  const top = boardRect?.top ?? 0;
  const bottom = boardRect ? boardRect.top + boardRect.height : window.innerHeight;

  if (placement === 'center') {
    return {
      left: `${left}px`,
      top: `${top + (bottom - top) / 2}px`,
      transform: 'translate(-50%, -50%)',
    };
  }
  if (placement === 'bottom') {
    return {
      left: `${left}px`,
      top: `${Math.max(top, bottom - BUBBLE_HEIGHT_ESTIMATE - GAP)}px`,
      transform: 'translateX(-50%)',
    };
  }
  // 'top' or default (no placement / 'auto' with no target)
  return {
    left: `${left}px`,
    top: `${top + GAP}px`,
    transform: 'translateX(-50%)',
  };
}

function measure() {
  // Locate .boardregion for scroll/resize observation and fallback bubble placement.
  // With Teleport, overlayRoot is in <body> so .closest('.boardregion') returns null;
  // fall back to document.querySelector('.boardregion').
  const boardRegion: Element | null =
    overlayRoot.value?.closest('.boardregion') ??
    document.querySelector('.boardregion');

  const boardRect = boardRegion?.getBoundingClientRect() ?? null;

  resolvedAnnotations.value = annotations.value.map((ann) => {
    let ring: ResolvedRing | null = null;
    let caretSide: 'top' | 'bottom' | undefined;
    let anchorStyle: Record<string, string> = {};

    // ── Resolve target ───────────────────────────────────────────────────────
    if (ann.target) {
      const selector = buildSelector(ann.target);
      // BL-01 fix: query the entire document, not just .boardregion.
      // action/panel targets live in .actionbar (sibling of .boardregion);
      // element targets still live in .boardregion — document query finds both.
      const targetEl = selector ? document.querySelector(selector) : null;

      if (targetEl) {
        const rect = targetEl.getBoundingClientRect();
        const OFFSET = 3; // px outside the target rect

        // Ring coordinates are viewport-fixed (overlay is position:fixed inset:0).
        ring = {
          left: rect.left - OFFSET,
          top: rect.top - OFFSET,
          width: rect.width + OFFSET * 2,
          height: rect.height + OFFSET * 2,
          radius: readRadius(targetEl),
        };

        // ── Bubble placement ─────────────────────────────────────────────────
        if (ann.placement && ann.placement !== 'auto') {
          // Explicit placement: position bubble at board-level named position.
          anchorStyle = bubbleFallbackStyle(ann.placement, boardRect);
        } else {
          // Auto-placement: bubble near the target, flip if too close to bottom.
          const GAP = 8; // var(--bsg-s2)
          const BUBBLE_HEIGHT_ESTIMATE = 80; // conservative estimate

          const preferredTop = rect.top + rect.height + GAP;
          const fitsBelow =
            preferredTop + BUBBLE_HEIGHT_ESTIMATE <= window.innerHeight;

          if (fitsBelow) {
            caretSide = 'top';
            anchorStyle = {
              left: `${Math.max(0, rect.left + rect.width / 2)}px`,
              top: `${preferredTop}px`,
              transform: 'translateX(-50%)',
            };
          } else {
            // Flip above
            caretSide = 'bottom';
            anchorStyle = {
              left: `${Math.max(0, rect.left + rect.width / 2)}px`,
              top: `${Math.max(0, rect.top - GAP - BUBBLE_HEIGHT_ESTIMATE)}px`,
              transform: 'translateX(-50%)',
            };
          }
        }
      } else {
        // Null target → bubble-only fallback at top of board area.
        anchorStyle = bubbleFallbackStyle('top', boardRect);
      }
    } else {
      // No target → floating bubble; honor placement (WR-01 fix).
      // Previously: anchorStyle = {} → bubble rendered at (0,0).
      anchorStyle = bubbleFallbackStyle(ann.placement, boardRect);
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

  // With Teleport, overlayRoot is in <body>; closest() returns null, fall back.
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

    // Observe each resolved target (BL-01: use document.querySelector)
    for (const ann of annotations.value) {
      if (!ann.target) continue;
      const selector = buildSelector(ann.target);
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
  <!--
    Teleport to body: renders the overlay as a fixed viewport layer.

    This escapes .boardregion's overflow:hidden clip and the sibling-boundary
    so action/panel targets in .actionbar resolve correctly (BL-01 fix). Ring and
    bubble positions are viewport-fixed (getBoundingClientRect coords, no offset
    subtraction). Bubble clip (WR-03) is also resolved — no overflow:hidden here.

    The root div has NO aria-hidden: the bubble (BoardMessage / role=status) must
    be announced by screen readers (CR-01 fix — aria-hidden on root silenced all
    descendants including the aria-live region). Only the decorative ring elements
    carry aria-hidden="true".
  -->
  <Teleport to="body">
    <div
      v-if="hasContent"
      ref="overlayRoot"
      class="bsg-tutorial-overlay"
    >
      <template v-for="(resolved, i) in resolvedAnnotations" :key="i">
        <!--
          Highlight ring — drawn at the target's viewport-fixed rect.
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

          CR-01 fix: no aria-hidden="true" on this element or any ancestor (the
          overlay root no longer carries aria-hidden). The bubble is announced by
          screen readers. Only the ring above is aria-hidden (decorative).

          WR-01 fix: anchorStyle is always set to a non-empty object so the bubble
          never renders at (0,0). Untargeted and explicit-placement bubbles use
          board-relative viewport coords computed by bubbleFallbackStyle().
        -->
        <BoardMessage
          v-if="resolved.text"
          variant="annotation"
          :visible="true"
          :anchor-style="resolved.bubble.anchorStyle"
          :caret-side="resolved.bubble.caretSide"
        >{{ resolved.text }}</BoardMessage>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
/* ── Overlay root ─────────────────────────────────────────────────────────── */
/*
 * Fixed viewport layer via <Teleport to="body">.
 *
 * position:fixed + inset:0 makes the overlay cover the full viewport so that
 * ring/bubble children positioned with position:absolute use viewport coords
 * (matching getBoundingClientRect() output). This is required for action/panel
 * targets in .actionbar (outside .boardregion) — the old position:absolute
 * inside .boardregion could not reach them (BL-01 fix).
 *
 * overflow:visible (no longer hidden): rings that extend slightly outside the
 * board edge remain visible (WR-03 fix). Viewport edge clipping is handled
 * naturally by the browser.
 *
 * z-index 20: above BoardMessage turn prompt (z-5), below modal/game-over (z-50).
 * pointer-events:none on the root; the bubble re-enables them on its content box.
 */
.bsg-tutorial-overlay {
  position: fixed;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  overflow: visible;
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
