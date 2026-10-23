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
 * Z-index 31: above the action bar (z-30) (#1341), below game modals and the
 * game-over scrim (z-32), which cover bubbles about the board. An annotation
 * whose target is inside an open game modal is drawn in a second layer at 33, so
 * its ring shows over the modal while the rest stay under it (#1346).
 * Always below the mobile scrim (z-45) and modals (z-50).
 */

import { computed, ref, toRef, type ComponentPublicInstance } from 'vue';
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
  /** The target is inside an open game modal (#bs-game-modal). */
  inModal: boolean;
}

const GAP = 8; // var(--bsg-s2)
const BUBBLE_HEIGHT_ESTIMATE = 80;
const RING_OFFSET = 3; // px outside the target rect
const EDGE_MARGIN = 8; // var(--bsg-s2): clearance from the layer's left and right edges
const CARET_INSET = 12; // keeps the caret off the card's rounded corner

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
  layer: LayerSize,
): Record<string, string> {
  const left = `${boardRect ? boardRect.left + boardRect.width / 2 : layer.width / 2}px`;
  const top = boardRect?.top ?? 0;
  const bottom = boardRect?.bottom ?? layer.height;
  if (placement === 'center') {
    return { left, top: `${(top + bottom) / 2}px`, transform: 'translate(-50%, -50%)' };
  }
  return { left, top: `${boardTop(placement, top, bottom, layer.height)}px`, transform: 'translateX(-50%)' };
}

function boardTop(placement: Annotation['placement'], top: number, bottom: number, layerHeight: number): number {
  if (placement === 'bottom') return Math.max(top, bottom - BUBBLE_HEIGHT_ESTIMATE - GAP);
  if (placement === 'top' || props.untargeted === 'board-top') return top + GAP;
  // Below the board so the bubble never covers squares the player needs to read;
  // clamped so a very tall board cannot push it off-screen.
  return Math.min(bottom + GAP, layerHeight - 56);
}

/** The layer is fixed to the screen, so its size leaves out the scrollbars the window's size counts (#1300). */
interface LayerSize { width: number; height: number }

function resolve(ann: Annotation, boardRect: DOMRect | null, layer: LayerSize): ResolvedAnnotation {
  const selector = ann.target ? buildSelector(ann.target) : '';
  const targetEl = selector ? document.querySelector(selector) : null;
  if (!targetEl) {
    return { text: ann.text, ring: null, inModal: false, anchorStyle: boardStyle(ann.placement, boardRect, layer) };
  }

  const rect = targetEl.getBoundingClientRect();
  const inModal = targetEl.closest('#bs-game-modal') !== null;
  const ring = {
    left: `${rect.left - RING_OFFSET}px`,
    top: `${rect.top - RING_OFFSET}px`,
    width: `${rect.width + RING_OFFSET * 2}px`,
    height: `${rect.height + RING_OFFSET * 2}px`,
    borderRadius: readRadius(targetEl),
  };
  if (ann.placement && ann.placement !== 'auto') {
    return { text: ann.text, ring, inModal, anchorStyle: boardStyle(ann.placement, boardRect, layer) };
  }

  // Next to the target: below it, or above when it would run off the bottom.
  // Only CSS knows the bubble's width, so CSS clamps the shift that centres it (#907, #1180).
  const centre = rect.left + rect.width / 2;
  const left = `${centre}px`;
  const roomLeft = centre - EDGE_MARGIN;
  const roomRight = layer.width - EDGE_MARGIN - centre;
  const shifted = {
    // Right edge kept in first; the left bound wins on a bubble wider than the layer.
    '--bsg-bubble-shift': `max(${-roomLeft}px, min(-50%, calc(${roomRight}px - 100%)))`,
    transform: 'translateX(var(--bsg-bubble-shift))',
    // The caret is the bubble's child: undoing the shift keeps it pointing at the target.
    '--caret-left': `clamp(${CARET_INSET}px, calc(-1 * var(--bsg-bubble-shift)), calc(100% - ${CARET_INSET}px))`,
  };
  const below = rect.top + rect.height + GAP;
  if (below + BUBBLE_HEIGHT_ESTIMATE <= layer.height) {
    return { text: ann.text, ring, inModal, caretSide: 'top', anchorStyle: { left, top: `${below}px`, ...shifted } };
  }
  // Only CSS knows the bubble's height: lift it by that height, but never past the layer's top (#1331).
  const above = rect.top - GAP;
  const lifted = { ...shifted, transform: `translate(var(--bsg-bubble-shift), max(-100%, ${-above}px))` };
  return { text: ann.text, ring, inModal, caretSide: 'bottom', anchorStyle: { left, top: `${above}px`, ...lifted } };
}

/** The base layer, and the one over game modals while it has something to show; none with nothing to annotate. */
const layers = computed(() => {
  if (props.annotations.length === 0) return [];
  const base = { overModal: false, items: resolvedAnnotations.value.filter((r) => !r.inModal) };
  const overModal = { overModal: true, items: resolvedAnnotations.value.filter((r) => r.inModal) };
  return overModal.items.length > 0 ? [base, overModal] : [base];
});

/** The base layer is the one measured and tracked. */
function setRoot(el: Element | ComponentPublicInstance | null, overModal: boolean) {
  if (!overModal) overlayRoot.value = el as HTMLElement | null;
}

useOverlayTracking({
  root: overlayRoot,
  content: toRef(props, 'annotations'),
  targetOf: (ann) => ann.target,
  measure: (boardRect) => {
    const layer = overlayRoot.value;
    // Without the layer nothing is shown, so there is nothing to place.
    const size = layer && { width: layer.clientWidth, height: layer.clientHeight };
    resolvedAnnotations.value = size ? props.annotations.map((ann) => resolve(ann, boardRect, size)) : [];
  },
});
</script>

<template>
  <Teleport to="body">
    <div
      v-for="layer in layers"
      :key="String(layer.overModal)"
      :ref="(el) => setRoot(el, layer.overModal)"
      class="bsg-annotation-layer"
      :class="[overlayClass, { 'bsg-annotation-layer--over-modal': layer.overModal }]"
    >
      <template v-for="(resolved, i) in layer.items" :key="i">
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
  z-index: 31;
  pointer-events: none;
  overflow: visible;
}

.bsg-annotation-layer--over-modal {
  z-index: 33;
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

.bs-reduce-motion .bsg-tutorial-ring {
  animation: none;
}
</style>
