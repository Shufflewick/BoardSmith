<script setup lang="ts">
/**
 * PlayerToken — the canonical player identity glyph: color + SHAPE + letter.
 *
 * Single source of truth for the token used in the players panel, the rail,
 * and the action-bar turn indicator (IA-06). Seat index → shape keeps players
 * visually distinct even when two share an initial. Sizes via the `size` prop
 * (px); the letter scales with it.
 */
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
    /** Player index in the players array — drives the shape. */
    index: number;
    /** Player color (CSS color). Falls back to the accent token. */
    color?: string;
    /** Token size in px (square). Letter scales from this. */
    size?: number;
  }>(),
  { size: 38 },
);

function shape(): string {
  return SHAPES[props.index % SHAPES.length];
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
</script>

<template>
  <span
    class="tok"
    :class="shape()"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${Math.round(size * 0.42)}px`,
      ...(color ? { '--tc': color } : {}),
    }"
    aria-hidden="true"
  >
    <span class="shape"></span>
    <span class="ini">{{ initial() }}</span>
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
}
.tok .ini {
  position: relative;
  z-index: 1;
  font-size: inherit;
  font-weight: 800;
  line-height: 1;
  color: rgba(255, 255, 255, .95);
  text-shadow: 0 1px 2px rgba(0, 0, 0, .5);
  font-family: var(--bsg-font);
}

/* Letter-friendly shape set (every one centers a glyph) */
.sh-circle .shape    { clip-path: circle(50%); }
.sh-square .shape    { clip-path: inset(3% round 26%); }
.sh-hexagon .shape   { clip-path: polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0 50%); }
.sh-octagon .shape   { clip-path: polygon(31% 3%, 69% 3%, 97% 31%, 97% 69%, 69% 97%, 31% 97%, 3% 69%, 3% 31%); }
.sh-diamond .shape   { clip-path: polygon(50% 1%, 99% 50%, 50% 99%, 1% 50%); }
.sh-pentagon .shape  { clip-path: polygon(50% 2%, 98% 39%, 80% 98%, 20% 98%, 2% 39%); }
.sh-shield .shape    { clip-path: polygon(50% 1%, 95% 15%, 90% 63%, 50% 99%, 10% 63%, 5% 15%); }
.sh-plus .shape      { clip-path: polygon(36% 2%, 64% 2%, 64% 36%, 98% 36%, 98% 64%, 64% 64%, 64% 98%, 36% 98%, 36% 64%, 2% 64%, 2% 36%, 36% 36%); }
</style>
