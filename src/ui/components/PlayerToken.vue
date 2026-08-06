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
 * white on dark, via `contrastInk`. The `text-shadow` halo is derived
 * opposite the chosen ink so it never fights legibility.
 */
import { computed } from 'vue';
import { contrastInk } from '../utils/color-contrast';
import { devWarn } from '../../utils/dev.js';

const SHAPES = [
  'sh-circle',
  'sh-square',
  'sh-hexagon',
  'sh-octagon',
  'sh-diamond',
  'sh-pentagon',
  'sh-shield',
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
    /**
     * Draw an emphasis ring around the token, in the token's OWN silhouette.
     *
     * What the ring MEANS is the caller's to say (the action bar uses it for
     * "this is you"); this prop only says "stand this one out". It lives here
     * rather than in the caller's CSS because only this component knows which
     * silhouette it drew — a ring drawn from outside has to guess, and a
     * hardcoded `border-radius: 50%` matches exactly one seat in eight.
     */
    emphasis?: boolean;
  }>(),
  { size: 38 },
);

function shape(): string {
  return SHAPES[props.seat % SHAPES.length];
}

function initial(): string {
  const trimmed = props.name.trim();
  // Default seat names ("Player 1", "Player 2") all start with "P" — useless as
  // an identity glyph. Use the trailing number so tokens read 1 / 2 / 3. Real
  // names ("Alice") fall through to their first letter.
  const generic = trimmed.match(/^player\s*(\d+)$/i);
  if (generic) return generic[1];
  return (trimmed[0] ?? '?').toUpperCase();
}

// Safe default when `color` is absent (falls back to the accent token, whose
// exact rendered value we don't have here to measure contrast against) —
// matches the previous hardcoded white-ink appearance. Never call the
// throwing parser with an undefined/unknown value (Pit of Success: only fail
// loud on a color we were actually given).
const DEFAULT_INK = { ink: '#ffffff', textShadow: '0 1px 2px rgba(0,0,0,.5)' } as const;

// CR-02: `contrastInk()` is deliberately fail-loud for a color it can't parse
// (see its own docstring), but `props.color` is a plain `string` at the
// public `createColorOption()` API boundary — no format is enforced there, so
// any legal CSS color contrastInk doesn't recognize would otherwise throw
// INSIDE this computed, crashing the whole players panel/rail/turn indicator
// render, not just degrading contrast. Render paths must fail visible, not
// fatal: catch the throw, degrade to DEFAULT_INK, and warn once (per
// offending color string) so the game author sees an actionable diagnostic
// instead of a silent wrong-contrast guess.
const ink = computed(() => {
  if (!props.color) return DEFAULT_INK;
  try {
    return contrastInk(props.color);
  } catch (err) {
    devWarn(
      `player-token-unparseable-color:${props.color}`,
      `PlayerToken received a color ("${props.color}") that contrastInk() can't parse — ` +
        `falling back to the default ink instead of crashing. ` +
        `${err instanceof Error ? err.message : String(err)}`
    );
    return DEFAULT_INK;
  }
});
</script>

<template>
  <span
    class="tok"
    :class="[shape(), { 'is-emphasized': emphasis }]"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${Math.round(size * 0.42)}px`,
      ...(color ? { '--tc': color } : {}),
    }"
    aria-hidden="true"
  >
    <!-- Emphasis ring: the SAME silhouette, drawn larger and behind the glyph,
         so the band that shows around the edge is the token's own outline. -->
    <span v-if="emphasis" class="halo"></span>
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
.tok .shape {
  position: absolute;
  inset: 0;
  background: var(--tc, var(--bsg-accent));
  box-shadow: 0 2px 4px rgba(0, 0, 0, .35);
  clip-path: var(--tok-clip);
}

/* Emphasis ring. Same `--tok-clip` as the glyph, drawn one band larger and
   underneath it, so what shows around the edge is the token's own outline —
   a hexagon gets a hexagonal ring, a plus gets a plus-shaped one.
   `clip-path` cannot be stroked, hence a filled shape behind rather than a
   border; the opaque `.shape` on top is what turns it into a ring.

   Deriving both from one variable is the point: a ring drawn from a separate
   rule (the old caller-side `border-radius: 50%`) matched one seat in eight and
   silently went wrong for the rest, and would drift again the moment the shape
   set changed. The glyph itself is NOT dimmed — emphasis that de-emphasises the
   thing it points at is self-defeating; the ring alone carries it. */
.tok .halo {
  position: absolute;
  inset: calc(-1 * var(--tok-ring, 3px));
  background: color-mix(in srgb, var(--bsg-accent) 70%, transparent);
  clip-path: var(--tok-clip);
}

/* Reserve the ring's width so an emphasized token does not grow into its
   neighbours (the halo is drawn outside the token's own box). */
.tok.is-emphasized {
  margin: var(--tok-ring, 3px);
}
.tok .ini {
  position: relative;
  z-index: 1;
  font-size: inherit;
  font-weight: 800;
  line-height: 1;
  font-family: var(--bsg-font);
}

/* Letter-friendly shape set (every one centers a glyph).
   ONE definition per shape, as a variable: the glyph and the emphasis ring both
   read `--tok-clip`, so they cannot disagree about what shape this token is.
   Percentages are relative to each element's own box, so the larger halo box
   yields the same silhouette, scaled — no second set of coordinates to keep in
   step. Adding a shape here is all that a new shape needs. */
.sh-circle    { --tok-clip: circle(50%); }
.sh-square    { --tok-clip: inset(3% round 26%); }
.sh-hexagon   { --tok-clip: polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0 50%); }
.sh-octagon   { --tok-clip: polygon(31% 3%, 69% 3%, 97% 31%, 97% 69%, 69% 97%, 31% 97%, 3% 69%, 3% 31%); }
.sh-diamond   { --tok-clip: polygon(50% 1%, 99% 50%, 50% 99%, 1% 50%); }
.sh-pentagon  { --tok-clip: polygon(50% 2%, 98% 39%, 80% 98%, 20% 98%, 2% 39%); }
.sh-shield    { --tok-clip: polygon(50% 1%, 95% 15%, 90% 63%, 50% 99%, 10% 63%, 5% 15%); }
.sh-plus      { --tok-clip: polygon(36% 2%, 64% 2%, 64% 36%, 98% 36%, 98% 64%, 64% 64%, 64% 98%, 36% 98%, 36% 64%, 2% 64%, 2% 36%, 36% 36%); }
</style>
