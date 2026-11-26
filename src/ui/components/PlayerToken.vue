<script setup lang="ts">
/**
 * PlayerToken — the canonical player identity glyph: color + SHAPE + letter.
 *
 * Single source of truth for the token used in the players panel, the rail,
 * and the action-bar turn indicator (IA-06). Seat → shape keeps players
 * visually distinct even when two share an initial. Sizes via the `size` prop
 * (px); the letter scales with it.
 *
 * The shape is derived from the player's SEAT — a stable identity that no
 * consumer can reorder — never from a render position. Deriving it from a
 * v-for index made a player's shape a function of whichever array happened to
 * be rendering: the players panel iterates turn order while the action panel's
 * turn indicator looks up seat order, so the same player was drawn as two
 * different shapes at once, and a player's shape changed mid-game whenever the
 * running order rotated. Shape is meant to be the identity that survives
 * colour-blindness and colourless games; it cannot also be positional.
 *
 * Glyph ink (LIBX-03/D30) is luminance-adaptive: black on light seat colors,
 * white on dark, via `seatInk`. The `text-shadow` halo is derived
 * opposite the chosen ink so it never fights legibility. The same ink edges
 * the shape, so a token stands off a ground as light or dark as itself.
 */
import { computed } from 'vue';
import { seatInk } from '../utils/color-contrast';
import { syncReducedMotionClass } from '../composables/reducedMotion.js';

syncReducedMotionClass();

interface Shape {
  name: string;
  /** Outline in a 100x100 box. */
  d: string;
  /** Glyph centre, % from the top: the centre of the largest circle that fits the shape (the heart's is set by eye). */
  glyphY?: number;
}

/** Seat N (1-12) draws the shape with N sides, so the shape itself says the seat; later seats share the rounded square. */
const SHAPES_BY_SEAT: readonly Shape[] = [
  { name: 'circle', d: 'M50 0A50 50 0 0 1 50 100A50 50 0 0 1 50 0Z' },
  { name: 'heart', d: 'M50 27.3 50 26.9 50.3 25.5 50.8 23.4 51.9 20.7 53.6 17.7 56 14.6 59.1 11.7 62.7 9.3 67 7.5 71.6 6.7 76.4 6.8 81.2 7.8 85.7 9.9 89.8 12.8 93.3 16.5 95.8 20.8 97.5 25.4 98 30.3 97.5 35.3 95.8 40.3 93.3 45.2 89.8 49.9 85.7 54.5 81.2 58.8 76.4 63.1 71.6 67.2 67 71.2 62.7 75 59.1 78.7 56 82.1 53.6 85.3 51.9 88 50.8 90.3 50.3 91.9 50 93 50 93.3 50 93 49.7 91.9 49.2 90.3 48.1 88 46.4 85.3 44 82.1 40.9 78.7 37.3 75 33 71.2 28.4 67.2 23.6 63.1 18.8 58.8 14.3 54.5 10.2 49.9 6.7 45.2 4.2 40.3 2.5 35.3 2 30.3 2.5 25.4 4.2 20.8 6.7 16.5 10.2 12.8 14.3 9.9 18.8 7.8 23.6 6.8 28.4 6.7 33 7.5 37.3 9.3 40.9 11.7 44 14.6 46.4 17.7 48.1 20.7 49.2 23.4 49.7 25.5 50 26.9Z', glyphY: 41 },
  { name: 'triangle', d: 'M50 8.4 98 91.6 2 91.6Z', glyphY: 64 },
  { name: 'diamond', d: 'M50 1 99 50 50 99 1 50Z' },
  { name: 'pentagon', d: 'M50 2 98 39 80 98 20 98 2 39Z', glyphY: 54.5 },
  { name: 'hexagon', d: 'M25 5 75 5 100 50 75 95 25 95 0 50Z' },
  { name: 'shield', d: 'M32 3 68 3 95 14 90 63 50 99 10 63 5 14Z', glyphY: 44 },
  { name: 'octagon', d: 'M31 3 69 3 97 31 97 69 69 97 31 97 3 69 3 31Z' },
  { name: 'triarm', d: 'M65.3 98 34.7 98 23.5 59.1 3.9 23.6 25.5 2 50 19.4 74.5 2 96.1 23.6 76.5 59.1Z', glyphY: 50.5 },
  { name: 'star', d: 'M50 4.3 66.3 32.4 98 39.2 76.4 63.4 79.7 95.7 50 82.6 20.3 95.7 23.6 63.4 2 39.2 33.7 32.4Z', glyphY: 55 },
  { name: 'hendecagon', d: 'M50 2.5 76.2 10.2 94.1 30.8 98 57.9 86.6 82.7 63.7 97.5 36.3 97.5 13.4 82.7 2 57.9 5.9 30.8 23.8 10.2Z', glyphY: 51 },
  { name: 'plus', d: 'M26 2 74 2 74 26 98 26 98 74 74 74 74 98 26 98 26 74 2 74 2 26 26 26Z' },
];
const ROUNDED_SQUARE: Shape = { name: 'square', d: 'M29 3H71A26 26 0 0 1 97 29V71A26 26 0 0 1 71 97H29A26 26 0 0 1 3 71V29A26 26 0 0 1 29 3Z' };

const props = withDefaults(
  defineProps<{
    /** Player display name — drives the centered letter. */
    name: string;
    /**
     * The player's SEAT — drives the shape. Must be a stable per-player
     * identity, never a position in whichever array is being rendered: a seat's
     * shape has to be invariant under reordering (see the component docstring).
     */
    seat: number;
    /** Player color (CSS color). Falls back to the accent token. */
    color?: string;
    /** Token size in px (square). Letter scales from this. */
    size?: number;
    /** Draws a throbbing outline in the token's own shape, so a glance finds whose turn it is. */
    acting?: boolean;
  }>(),
  { size: 38, acting: false },
);

const shape = computed(() => SHAPES_BY_SEAT[props.seat - 1] ?? ROUNDED_SQUARE);

function initial(): string {
  const trimmed = props.name.trim();
  // Default seat names (table "Player N", world "Seat N") all share a first
  // letter, useless as an identity glyph. Use the trailing number so tokens
  // read 1 / 2 / 3. Real names ("Alice") fall through to their first letter.
  const generic = trimmed.match(/^(?:player|seat)\s*(\d+)$/i);
  if (generic) return generic[1];
  return (trimmed[0] ?? '?').toUpperCase();
}

const ink = computed(() => seatInk(props.color, 'PlayerToken'));
</script>

<template>
  <span
    class="tok"
    :class="`sh-${shape.name}`"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${Math.round(size * 0.42)}px`,
      '--tok-edge': ink.ink,
      ...(color ? { '--tc': color } : {}),
    }"
    aria-hidden="true"
  >
    <svg v-if="acting" class="ring" viewBox="0 0 100 100"><path :d="shape.d" /></svg>
    <svg class="shape" viewBox="0 0 100 100"><path :d="shape.d" /></svg>
    <span
      class="ini"
      :style="{ color: ink.ink, textShadow: ink.textShadow, top: `${shape.glyphY ?? 50}%` }"
    >{{ initial() }}</span>
  </span>
</template>

<style scoped>
.tok {
  position: relative;
  display: grid;
  place-items: center;
  flex: none;
  /* Its own stacking context, so the outline sits behind the token rather than behind its container. */
  isolation: isolate;
}
/* Edge and outline are strokes, not scaled copies, so they keep their width in the star's and heart's inner corners. */
.tok svg {
  position: absolute;
  inset: 1px;
  overflow: visible;
}
.tok path {
  vector-effect: non-scaling-stroke;
  stroke-linejoin: round;
  paint-order: stroke;
}
/* A 1px edge in the glyph's ink, opposite the seat colour, so a token reads on any ground (#1723). */
.tok .shape path {
  fill: var(--tc, var(--bsg-accent));
  stroke: var(--tok-edge);
  stroke-width: 2px;
}
/* 3px past the edge. Same PERF constraint as .turn-indicator-dot: transform + opacity ONLY. */
.tok .ring {
  z-index: -1;
  pointer-events: none;
  animation: tok-throb 1.6s ease-in-out infinite;
}
.tok .ring path {
  fill: var(--bsg-accent);
  stroke: var(--bsg-accent);
  stroke-width: 8px;
}
/* Throbs inward, so the outline never reaches past its resting 3px onto what sits beside the token. */
@keyframes tok-throb {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(0.92); opacity: 0.35; }
}
/* Reduced motion keeps the outline, still at its resting full-size, opaque state. */
.bs-reduce-motion .tok .ring {
  animation: none;
}
.tok .ini {
  position: absolute;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: inherit;
  font-weight: 800;
  line-height: 1;
  font-family: var(--bsg-font);
}
</style>
