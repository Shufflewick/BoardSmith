<script setup lang="ts">
/**
 * AnnotationLayer — the ring + bubble layer behind TutorialOverlay and HintOverlay.
 *
 * Renders via `<Teleport to="body">` as a `position:fixed; inset:0` layer over
 * the viewport. That escapes `.boardregion`'s `overflow:hidden` clip and the
 * sibling boundary between `.boardregion` and `.actionbar`, so all three
 * `AnnotationTarget` kinds resolve: element anchors in the board, and action
 * and panel anchors in the action bar (BL-01). Targets are found through the
 * shared `data-bs-*` anchors via `buildSelector`, never renderer-specific
 * selectors, so custom UIs and AutoUI are found identically (parity).
 *
 * Bubble placement: an explicit `placement` ('top' | 'bottom' | 'center') puts
 * the bubble at that spot on the board. 'auto' (or none) puts it next to the
 * target when one is found; with no target found it goes where `untargeted` says.
 *
 * Security: annotation text is rendered by text interpolation only (never v-html);
 * the layer and ring are pointer-events:none, so they never intercept input.
 *
 * Accessibility: the ring and its marker chip are aria-hidden (decorative). The
 * root has NO aria-hidden, so the bubble's role=status / aria-live=polite is
 * announced. Reduced motion: no ring animation.
 *
 * Z-index 20: above the turn prompt (z-5), below modal/game-over (z-50).
 */

import { ref, toRef } from 'vue';
import BoardMessage from './BoardMessage.vue';
import type { Annotation } from '../../../engine/tutorial/types.js';
import { buildSelector } from './overlay-utils.js';
import { useOverlayTracking } from '../../composables/useOverlayTracking.js';

const props = defineProps<{
  annotations: readonly Annotation[];
  /** Class on the layer root, naming which overlay this is. */
  overlayClass: string;
  /** Where an 'auto' bubble with no found target goes: the top of the board, or just below it. */
  untargeted: 'board-top' | 'below-board';
}>();

interface ResolvedAnnotation {
  text: string;
  ring: Record<string, string> | null;
  anchorStyle: Record<string, string>;
  caretSide?: 'top' | 'bottom';
}

const GAP = 8; // var(--bsg-s2)
const BUBBLE_HEIGHT_ESTIMATE = 80;
const RING_OFFSET = 3; // px outside the target rect

const overlayRoot = ref<HTMLElement | null>(null);
const resolvedAnnotations = ref<ResolvedAnnotation[]>([]);

function readRadius(el: Element): string {
  const radius = window.getComputedStyle(el).borderRadius;
  return radius && radius !== '0px' ? radius : 'var(--bsg-r-md)';
}

/** Board-level bubble position, so a bubble never renders at (0,0) (WR-01). */
function boardStyle(
  placement: Annotation['placement'],
  boardRect: DOMRect | null,
): Record<string, string> {
  const left = `${boardRect ? boardRect.left + boardRect.width / 2 : window.innerWidth / 2}px`;
  const top = boardRect?.top ?? 0;
  const bottom = boardRect?.bottom ?? window.innerHeight;
  if (placement === 'center') {
    return { left, top: `${(top + bottom) / 2}px`, transform: 'translate(-50%, -50%)' };
  }
  return { left, top: `${boardTop(placement, top, bottom)}px`, transform: 'translateX(-50%)' };
}

function boardTop(placement: Annotation['placement'], top: number, bottom: number): number {
  if (placement === 'bottom') return Math.max(top, bottom - BUBBLE_HEIGHT_ESTIMATE - GAP);
  if (placement === 'top' || props.untargeted === 'board-top') return top + GAP;
  // Below the board so the bubble never covers squares the player needs to read;
  // clamped so a very tall board cannot push it off-screen.
  return Math.min(bottom + GAP, window.innerHeight - 56);
}

function resolve(ann: Annotation, boardRect: DOMRect | null): ResolvedAnnotation {
  const selector = ann.target ? buildSelector(ann.target) : '';
  const targetEl = selector ? document.querySelector(selector) : null;
  if (!targetEl) {
    return { text: ann.text, ring: null, anchorStyle: boardStyle(ann.placement, boardRect) };
  }

  const rect = targetEl.getBoundingClientRect();
  const ring = {
    left: `${rect.left - RING_OFFSET}px`,
    top: `${rect.top - RING_OFFSET}px`,
    width: `${rect.width + RING_OFFSET * 2}px`,
    height: `${rect.height + RING_OFFSET * 2}px`,
    borderRadius: readRadius(targetEl),
  };
  if (ann.placement && ann.placement !== 'auto') {
    return { text: ann.text, ring, anchorStyle: boardStyle(ann.placement, boardRect) };
  }

  // Next to the target: below it, or above when it would run off the bottom.
  const left = `${Math.max(0, rect.left + rect.width / 2)}px`;
  const below = rect.top + rect.height + GAP;
  if (below + BUBBLE_HEIGHT_ESTIMATE <= window.innerHeight) {
    return { text: ann.text, ring, caretSide: 'top', anchorStyle: { left, top: `${below}px`, transform: 'translateX(-50%)' } };
  }
  const above = Math.max(0, rect.top - GAP - BUBBLE_HEIGHT_ESTIMATE);
  return { text: ann.text, ring, caretSide: 'bottom', anchorStyle: { left, top: `${above}px`, transform: 'translateX(-50%)' } };
}

useOverlayTracking({
  root: overlayRoot,
  content: toRef(props, 'annotations'),
  targetOf: (ann) => ann.target,
  measure: (boardRect) => {
    resolvedAnnotations.value = props.annotations.map((ann) => resolve(ann, boardRect));
  },
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="annotations.length > 0"
      ref="overlayRoot"
      class="bsg-annotation-layer"
      :class="overlayClass"
    >
      <template v-for="(resolved, i) in resolvedAnnotations" :key="i">
        <div
          v-if="resolved.ring"
          class="bsg-tutorial-ring"
          :style="resolved.ring"
          aria-hidden="true"
        >
          <!-- Non-color cue (WCAG 2.2 AA 1.4.1): an "i" chip pinned to the ring corner. -->
          <span class="bsg-tutorial-ring__chip" aria-hidden="true">i</span>
        </div>
        <BoardMessage
          v-if="resolved.text"
          variant="annotation"
          :visible="true"
          :anchor-style="resolved.anchorStyle"
          :caret-side="resolved.caretSide"
        >{{ resolved.text }}</BoardMessage>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.bsg-annotation-layer {
  /* Teleported out of the shell root, so it does not inherit the shell's font (#451). */
  font-family: var(--bsg-font);
  position: fixed;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  overflow: visible;
}

.bsg-tutorial-ring {
  position: absolute;
  /* 3px: wider than the 2px selection outline, so the ring out-ranks selection chrome. */
  border: 3px solid var(--bsg-accent);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--bsg-accent) 35%, transparent),
    0 0 16px color-mix(in srgb, var(--bsg-accent-2) 30%, transparent);
  pointer-events: none;
  animation:
    bsg-ring-in var(--bsg-dur-base) var(--bsg-ease) both,
    bsg-ring-pulse var(--bsg-dur-slow) var(--bsg-ease) 2 var(--bsg-dur-base);
}

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

@media (prefers-reduced-motion: reduce) {
  .bsg-tutorial-ring {
    animation: none;
  }
}
</style>
