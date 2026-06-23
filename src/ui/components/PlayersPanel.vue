<script setup lang="ts">
/**
 * PlayersPanel - Displays the list of players with their stats.
 *
 * Each player is identified by a color + shape + letter token (IA-06).
 * The active player shows a natural turn-status sentence (IA-02 reconciliation).
 * In seat-strip mode a compact one-line variant carries the turn status for
 * phones (IA-06 compact tier).
 *
 * A11Y-04: active player's listitem carries aria-current="true".
 * A11Y-08: under prefers-reduced-motion the breathe becomes a static
 *   high-contrast border instead of disappearing.
 */
import { computed } from 'vue';

export interface Player {
  seat: number;
  name: string;
  color?: string;
}

const props = defineProps<{
  /** Array of players in the game */
  players: Player[];
  /** Current player's seat (the viewer) */
  playerSeat: number;
  /** Seat of the player whose turn it is */
  currentPlayerSeat?: number;
  /** Whether color selection is enabled (controls color indicator display) */
  colorSelectionEnabled?: boolean;
  /** Seats of players currently awaiting action during simultaneous steps */
  awaitingPlayerSeats?: number[];
  /** Compact one-line seat-strip mode for phones (IA-06) */
  seatStrip?: boolean;
}>();

// ---------------------------------------------------------------------------
// Shape set (IA-06): 8 clip-path shapes from the canonical Slate mockup.
// Seat index → shape keeps per-player identity visually distinct even when
// two players share the same initial letter (see collision-note in mockup).
// ---------------------------------------------------------------------------
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

function playerShape(index: number): string {
  return SHAPES[index % SHAPES.length];
}

function playerInitial(name: string): string {
  const trimmed = name.trim();
  // Default seat names ("Player 1", "Player 2") all start with "P" — useless as an
  // identity glyph. Use the trailing number so the tokens read 1 / 2 / 3 and stay
  // distinguishable. Real names ("Alice") fall through to their first letter.
  const generic = trimmed.match(/^player\s*(\d+)$/i);
  if (generic) return generic[1];
  return (trimmed[0] ?? '?').toUpperCase();
}

function isPlayerActive(seat: number): boolean {
  if (seat === props.currentPlayerSeat) return true;
  if (props.awaitingPlayerSeats?.includes(seat)) return true;
  return false;
}

/**
 * Natural turn-status sentence for the active player.
 * No "your turn" literal — the token icon already identifies who.
 * Local player gets an affirmative ("Your move");
 * other player gets a descriptive ("{name} is playing").
 * Returns '' for inactive players.
 */
function turnStatus(player: Player): string {
  if (!isPlayerActive(player.seat)) return '';
  const isYou = player.seat === props.playerSeat;
  return isYou ? 'Your move' : `${player.name} is playing`;
}

/** The currently-active player (for seat-strip headline). */
const activePlayer = computed(() =>
  props.players.find(p => isPlayerActive(p.seat)) ?? null
);

/** Index of the active player (for seat-strip token shape). */
const activePlayerIndex = computed(() =>
  props.players.findIndex(p => isPlayerActive(p.seat))
);

defineSlots<{
  /** Custom stats for each player */
  'player-stats'(props: { player: Player }): any;
}>();
</script>

<template>
  <!-- ── Seat Strip: compact one-line for phone compact tier (IA-06) ───────── -->
  <div v-if="seatStrip" class="players-panel seat-strip" role="status" aria-label="Players">
    <!-- All player tokens inline -->
    <div class="strip-tokens" aria-hidden="true">
      <span
        v-for="(player, idx) in players"
        :key="player.seat"
        class="pt"
        :class="{ 'strip-active': isPlayerActive(player.seat) }"
        :title="player.name"
      >
        <span
          class="tok"
          :class="playerShape(idx)"
          :style="player.color ? { '--tc': player.color } : {}"
        >
          <span class="shape"></span>
          <span class="ini">{{ playerInitial(player.name) }}</span>
        </span>
      </span>
    </div>
    <!-- Active-player turn-status sentence -->
    <span v-if="activePlayer" class="strip-status">
      {{ turnStatus(activePlayer) }}
    </span>
  </div>

  <!-- ── Standard mode: full per-player cards ──────────────────────────────── -->
  <div v-else class="players-panel" role="list" aria-label="Players">
    <div
      v-for="(player, idx) in players"
      :key="player.seat"
      class="player-card"
      :class="{ current: isPlayerActive(player.seat) }"
      role="listitem"
      :aria-current="isPlayerActive(player.seat) ? 'true' : undefined"
    >
      <!-- Player identity token: color + shape + letter (IA-06) -->
      <div class="player-token-wrap">
        <span
          class="tok"
          :class="playerShape(idx)"
          :style="player.color ? { '--tc': player.color } : {}"
        >
          <span class="shape"></span>
          <span class="ini">{{ playerInitial(player.name) }}</span>
        </span>
      </div>

      <!-- Player info: name row + turn-status sentence + stats slot -->
      <div class="player-info">
        <div class="player-name-row">
          <span v-if="isPlayerActive(player.seat)" class="turn-indicator-dot"></span>
          <span class="player-name">{{ player.name }}</span>
          <span v-if="player.seat === playerSeat" class="you-badge">(You)</span>
          <span v-if="colorSelectionEnabled && player.color" class="player-color" :style="{ backgroundColor: player.color }"></span>
        </div>
        <!-- Turn-status sentence: active player only (IA-02 reconciliation) -->
        <div v-if="isPlayerActive(player.seat)" class="turn-status">
          {{ turnStatus(player) }}
        </div>
        <slot name="player-stats" :player="player"></slot>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Token: color + SHAPE + letter ─────────────────────────────────────────
   All shapes are clip-path based and hold a centered glyph (letter-friendly).
   --tc CSS custom property carries the player's color (set via inline style).
   ─────────────────────────────────────────────────────────────────────────── */
.tok {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
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
  font-size: 13px;
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

/* ── Standard mode: player cards ──────────────────────────────────────────── */
.players-panel {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.player-card {
  display: grid;
  grid-template-columns: 38px 1fr;
  gap: 11px;
  align-items: start;
  padding: 9px;
  border-radius: var(--bsg-r-md);
  border: 1px solid transparent;
  background: var(--bsg-field);
}

.player-card.current {
  background: color-mix(in srgb, var(--bsg-accent) 12%, transparent);
  border-color: color-mix(in srgb, var(--bsg-accent) 35%, transparent);
}

.player-token-wrap {
  width: 38px;
  height: 38px;
  flex: none;
}

.player-info {
  min-width: 0;
}

.player-name-row {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}

.player-name {
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.player-color {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 22%, transparent);
}

.you-badge {
  color: var(--bsg-accent);
  font-size: 0.8rem;
  margin-left: 4px;
}

/* Turn-status sentence: natural language, no "your turn" literal */
.turn-status {
  font-size: 12px;
  color: var(--bsg-accent);
  font-weight: 600;
  margin-top: 3px;
}

.turn-indicator-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--bsg-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--bsg-accent) 22%, transparent);
  animation: breathe 2.1s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes breathe {
  0%, 100% { box-shadow: 0 0 0 0 transparent; }
  50% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--bsg-accent) 22%, transparent); }
}

/* A11Y-08: reduced-motion — stop breathe animation AND provide a static
   high-contrast border so the active-player turn cue remains visible
   (does not simply vanish under reduced-motion preference). */
@media (prefers-reduced-motion: reduce) {
  .turn-indicator-dot {
    animation: none;
  }
  .player-card.current {
    border: 2px solid var(--bsg-accent);
  }
}

/* ── Seat strip: compact one-line for phone compact tier (IA-06) ─────────── */
.seat-strip {
  flex-direction: row;
  align-items: center;
  gap: var(--bsg-s2);
  flex-wrap: wrap;
}

.strip-tokens {
  display: flex;
  gap: 5px;
  align-items: center;
}

.strip-tokens .pt {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  opacity: 0.6;
  transition: opacity var(--bsg-dur-fast), width var(--bsg-dur-fast), height var(--bsg-dur-fast);
}

.strip-tokens .pt.strip-active {
  width: 30px;
  height: 30px;
  opacity: 1;
}

.strip-status {
  font-size: 13px;
  font-weight: 600;
  color: var(--bsg-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}
</style>
