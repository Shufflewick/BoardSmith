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
import PlayerToken from './PlayerToken.vue';

export interface Player {
  seat: number;
  name: string;
  color?: string;
  /**
   * Live WebSocket connection status (humans only). `undefined` means unknown —
   * e.g. AI slots or modes with no lobby — in which case no indicator is shown
   * (presence is never fabricated).
   */
  connected?: boolean;
}

const props = defineProps<{
  /** Array of players in the game */
  players: Player[];
  /** Current player's seat (the viewer) */
  playerSeat: number;
  /** Seat of the player whose turn it is */
  currentPlayerSeat?: number;
  /** Seats of players currently awaiting action during simultaneous steps */
  awaitingPlayerSeats?: number[];
  /** Compact one-line seat-strip mode for phones (IA-06) */
  seatStrip?: boolean;
}>();

// Token identity (color + shape + letter) is rendered by the shared PlayerToken
// component — seat index → shape keeps players distinct even when they share an
// initial (see collision-note in the Slate mockup).

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
        <PlayerToken
          :name="player.name"
          :index="idx"
          :color="player.color"
          :size="isPlayerActive(player.seat) ? 34 : 28"
        />
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
        <PlayerToken :name="player.name" :index="idx" :color="player.color" :size="38" />
      </div>

      <!-- Player info: name row + turn-status sentence + stats slot -->
      <div class="player-info">
        <div class="player-name-row">
          <span v-if="isPlayerActive(player.seat)" class="turn-indicator-dot"></span>
          <span class="player-name">{{ player.name }}</span>
          <span v-if="player.seat === playerSeat" class="you-badge">(You)</span>
          <!-- Per-player connection indicator (A11Y: distinguished by SHAPE — filled
               dot vs hollow ring — not color alone, plus an accessible label). Only
               rendered when connection status is actually known. -->
          <span
            v-if="player.connected !== undefined"
            class="conn-status"
            :class="player.connected ? 'is-online' : 'is-offline'"
            role="img"
            :aria-label="player.connected ? `${player.name} connected` : `${player.name} disconnected`"
          ></span>
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
/* Token identity (color + shape + letter) lives in the shared PlayerToken
   component — see PlayerToken.vue. */

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

.you-badge {
  color: var(--bsg-accent);
  font-size: 0.8rem;
  margin-left: 4px;
}

/* Per-player connection dot — pushed to the row end. Online = filled green dot;
   offline = hollow grey ring (shape differs so meaning isn't color-only, SC 1.4.1). */
.conn-status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  margin-left: auto;
}
.conn-status.is-online {
  background: var(--bsg-ok);
}
.conn-status.is-offline {
  background: transparent;
  border: 1.5px solid var(--bsg-away);
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

/* ── Seat strip: the compact icon-only representation (IA-06). Used in two places:
   the desktop rail (a ~64px column → row+wrap collapses to a vertical stack) and the
   mobile top strip (a wide bar → stays a horizontal row). The turn-status sentence is
   hidden — the active token is emphasized instead. */
.seat-strip {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--bsg-s2);
}

.strip-tokens {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  align-items: center;
  justify-content: center;
}

.strip-tokens .pt {
  display: grid;
  place-items: center;
  opacity: 0.6;
  transition: opacity var(--bsg-dur-fast);
}

.strip-tokens .pt.strip-active {
  opacity: 1;
}

.strip-status {
  display: none;
}
</style>
