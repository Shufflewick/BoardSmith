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

/** Seat N (1-12) draws the shape with N sides, so the shape itself says the seat; later seats share the rounded square. */
const SHAPES_BY_SEAT = [
  'sh-circle',
  'sh-heart',
  'sh-triangle',
  'sh-diamond',
  'sh-pentagon',
  'sh-hexagon',
  'sh-shield',
  'sh-octagon',
  'sh-triarm',
  'sh-star',
  'sh-hendecagon',
  'sh-plus',
] as const;

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
  }>(),
  { size: 38 },
);

function shape(): string {
  return SHAPES_BY_SEAT[props.seat - 1] ?? 'sh-square';
}

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
    :class="shape()"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${Math.round(size * 0.42)}px`,
      '--tok-edge': ink.ink,
      ...(color ? { '--tc': color } : {}),
    }"
    aria-hidden="true"
  >
    <span class="shape"></span>
    <span
      class="ini"
      :style="{ color: ink.ink, textShadow: ink.textShadow }"
    >{{ initial() }}</span>
  </span>
</template>

<style scoped>
.tok {
  position: relative;
  display: grid;
  place-items: center;
  flex: none;
}
/* A 1px edge in the glyph's ink, opposite the seat colour, so a token reads on any ground (#1723). */
.tok::before {
  content: '';
  position: absolute;
  inset: 0;
  clip-path: var(--tok-shape);
  background: var(--tok-edge);
}
.tok .shape {
  position: absolute;
  inset: 1px;
  background: var(--tc, var(--bsg-accent));
}
.tok .ini {
  position: absolute;
  left: 50%;
  top: var(--tok-ini-y, 50%);
  transform: translate(-50%, -50%);
  z-index: 1;
  font-size: inherit;
  font-weight: 800;
  line-height: 1;
  font-family: var(--bsg-font);
}

/* Seat shapes. On the token, so an outline drawn round it can take its shape.
   --tok-ini-y puts the glyph where the shape has the most room (the centre of its largest inscribed circle; the heart's is set by eye). */
.sh-circle     { --tok-shape: circle(50%); }
.sh-heart      { --tok-shape: polygon(50% 27.3%, 50% 26.9%, 50.3% 25.5%, 50.8% 23.4%, 51.9% 20.7%, 53.6% 17.7%, 56% 14.6%, 59.1% 11.7%, 62.7% 9.3%, 67% 7.5%, 71.6% 6.7%, 76.4% 6.8%, 81.2% 7.8%, 85.7% 9.9%, 89.8% 12.8%, 93.3% 16.5%, 95.8% 20.8%, 97.5% 25.4%, 98% 30.3%, 97.5% 35.3%, 95.8% 40.3%, 93.3% 45.2%, 89.8% 49.9%, 85.7% 54.5%, 81.2% 58.8%, 76.4% 63.1%, 71.6% 67.2%, 67% 71.2%, 62.7% 75%, 59.1% 78.7%, 56% 82.1%, 53.6% 85.3%, 51.9% 88%, 50.8% 90.3%, 50.3% 91.9%, 50% 93%, 50% 93.3%, 50% 93%, 49.7% 91.9%, 49.2% 90.3%, 48.1% 88%, 46.4% 85.3%, 44% 82.1%, 40.9% 78.7%, 37.3% 75%, 33% 71.2%, 28.4% 67.2%, 23.6% 63.1%, 18.8% 58.8%, 14.3% 54.5%, 10.2% 49.9%, 6.7% 45.2%, 4.2% 40.3%, 2.5% 35.3%, 2% 30.3%, 2.5% 25.4%, 4.2% 20.8%, 6.7% 16.5%, 10.2% 12.8%, 14.3% 9.9%, 18.8% 7.8%, 23.6% 6.8%, 28.4% 6.7%, 33% 7.5%, 37.3% 9.3%, 40.9% 11.7%, 44% 14.6%, 46.4% 17.7%, 48.1% 20.7%, 49.2% 23.4%, 49.7% 25.5%, 50% 26.9%); --tok-ini-y: 41%; }
.sh-triangle   { --tok-shape: polygon(50% 8.4%, 98% 91.6%, 2% 91.6%); --tok-ini-y: 64%; }
.sh-diamond    { --tok-shape: polygon(50% 1%, 99% 50%, 50% 99%, 1% 50%); }
.sh-pentagon   { --tok-shape: polygon(50% 2%, 98% 39%, 80% 98%, 20% 98%, 2% 39%); --tok-ini-y: 54.5%; }
.sh-hexagon    { --tok-shape: polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0 50%); }
.sh-shield     { --tok-shape: polygon(32% 3%, 68% 3%, 95% 14%, 90% 63%, 50% 99%, 10% 63%, 5% 14%); --tok-ini-y: 44%; }
.sh-octagon    { --tok-shape: polygon(31% 3%, 69% 3%, 97% 31%, 97% 69%, 69% 97%, 31% 97%, 3% 69%, 3% 31%); }
.sh-triarm     { --tok-shape: polygon(65.3% 98%, 34.7% 98%, 23.5% 59.1%, 3.9% 23.6%, 25.5% 2%, 50% 19.4%, 74.5% 2%, 96.1% 23.6%, 76.5% 59.1%); --tok-ini-y: 50.5%; }
.sh-star       { --tok-shape: polygon(50% 4.3%, 66.3% 32.4%, 98% 39.2%, 76.4% 63.4%, 79.7% 95.7%, 50% 82.6%, 20.3% 95.7%, 23.6% 63.4%, 2% 39.2%, 33.7% 32.4%); --tok-ini-y: 55%; }
.sh-hendecagon { --tok-shape: polygon(50% 2.5%, 76.2% 10.2%, 94.1% 30.8%, 98% 57.9%, 86.6% 82.7%, 63.7% 97.5%, 36.3% 97.5%, 13.4% 82.7%, 2% 57.9%, 5.9% 30.8%, 23.8% 10.2%); --tok-ini-y: 51%; }
.sh-plus       { --tok-shape: polygon(26% 2%, 74% 2%, 74% 26%, 98% 26%, 98% 74%, 74% 74%, 74% 98%, 26% 98%, 26% 74%, 2% 74%, 2% 26%, 26% 26%); }
.sh-square     { --tok-shape: inset(3% round 26%); }
.tok .shape  { clip-path: var(--tok-shape); }
</style>
