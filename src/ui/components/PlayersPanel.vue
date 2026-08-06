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
import { computed, ref, watch } from 'vue';
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

const props = withDefaults(defineProps<{
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
  /**
   * Render the shell's turn-status sentence ("Your move" / "{name} is playing")
   * on the active seat's card. Default true.
   *
   * Set false when the game's own `#player-stats` content already states turn
   * state for the seat — the sentence is then a second, redundant line on the
   * tallest card in the list, and per-seat vertical cost is the binding
   * constraint in a game with many players.
   */
  showTurnStatus?: boolean;
}>(), {
  // Vue CASTS an absent Boolean prop to `false`, not `undefined` — so an
  // opt-OUT flag silently defaults to opted-out unless the default is stated
  // here. Every consumer that omits the prop must get the sentence.
  showTurnStatus: true,
});

/**
 * Bumped whenever the set of active seats changes — i.e. on every turn change.
 *
 * Keying the pulse overlay on this remounts it, which restarts its CSS
 * animation; a class toggled on a timer would have to be cleared by hand and
 * would drift out of step with a fast rotation. The tick is the change signal
 * itself, so the cue cannot outlive the turn it belongs to.
 */
const turnTick = ref(0);
watch(
  () => [props.currentPlayerSeat ?? -1, ...(props.awaitingPlayerSeats ?? [])].join(','),
  () => { turnTick.value++; },
);

// Token identity (color + shape + letter) is rendered by the shared PlayerToken
// component — SEAT → shape keeps players distinct even when they share an
// initial (see collision-note in the Slate mockup). Pass `player.seat`, never
// the v-for index: this list is ordered by turn order, so an index-derived
// shape would disagree with every seat-ordered consumer of the same token.

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

defineSlots<{
  /** Custom stats for each player — rendered at the end of the info column. */
  'player-stats'(props: { player: Player }): any;
  /**
   * Custom content directly BENEATH the identity token, in the card's narrow
   * first column (a character portrait, a rank pip — anything that reads as
   * part of the seat's identity rather than its stats). Keeps per-seat height
   * down: content here sits beside the name row instead of stacking under it.
   */
  'player-token-extra'(props: { player: Player }): any;
}>();
</script>

<template>
  <!-- ── Seat Strip: compact one-line for phone compact tier (IA-06) ───────── -->
  <div v-if="seatStrip" class="players-panel seat-strip" role="status" aria-label="Players">
    <!-- All player tokens inline -->
    <div class="strip-tokens" aria-hidden="true">
      <span
        v-for="player in players"
        :key="player.seat"
        class="pt"
        :class="{ 'strip-active': isPlayerActive(player.seat) }"
        :title="player.name"
      >
        <PlayerToken
          :name="player.name"
          :seat="player.seat"
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
      v-for="player in players"
      :key="player.seat"
      class="player-card"
      :class="{ current: isPlayerActive(player.seat) }"
      role="listitem"
      :aria-current="isPlayerActive(player.seat) ? 'true' : undefined"
    >
      <!-- Turn-change attention pulse: a one-shot ring, remounted by turnTick so
           it replays on each turn change. Animated on transform+opacity only
           (see the PERF note on .turn-indicator-dot) and one-shot rather than a
           loop — a permanently animating border on a tall list is noise, and a
           seat that acts for a long time would never stop pulsing. -->
      <span
        v-if="isPlayerActive(player.seat)"
        :key="`pulse-${player.seat}-${turnTick}`"
        class="turn-pulse"
        aria-hidden="true"
      ></span>

      <!-- Player identity token: color + shape + letter (IA-06) -->
      <div class="player-token-wrap">
        <PlayerToken :name="player.name" :seat="player.seat" :color="player.color" :size="38" />
        <slot name="player-token-extra" :player="player"></slot>
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
        <!-- Turn-status sentence: active player only (IA-02 reconciliation),
             and only when the game hasn't said its own slot content covers it. -->
        <div v-if="showTurnStatus && isPlayerActive(player.seat)" class="turn-status">
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
  position: relative;
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

/* The card's narrow first column. Height is content-driven, not pinned to the
   token: #player-token-extra content (a portrait, a rank pip) stacks under the
   token here rather than being forced into the info column, where it would add
   its full height below the name row on every seat. */
.player-token-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  width: 38px;
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
  position: relative;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--bsg-accent);
  flex-shrink: 0;
}

/* PERF: the pulsing ring is a pseudo-element animated on transform + opacity
   ONLY — the two properties the compositor can run off the main thread. The ring
   itself (box-shadow) is painted once and never animated.

   Animating box-shadow directly here, as this did, is a paint property: it
   invalidated style and repainted on every frame of an infinite animation, so a
   completely idle board burned ~700 ms of main-thread time and ~1,800 style
   recalcs per 15 s (~4.6% busy) for one 9px dot. Keep any future change to this
   cue on transform/opacity. */
.turn-indicator-dot::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--bsg-accent) 22%, transparent);
  animation: breathe 2.1s ease-in-out infinite;
}

@keyframes breathe {
  0%, 100% { transform: scale(0.55); opacity: 0; }
  50% { transform: scale(1); opacity: 1; }
}

/* Turn-change attention pulse (B12): the panel's only turn cue used to be a
   static few-percent background shift on one card, which players miss in a tall
   7-seat column. This is a single expanding ring on the card that just became
   active — enough motion to catch the eye at the edge of vision, gone before it
   becomes noise.

   Same PERF constraint as .turn-indicator-dot: transform + opacity ONLY, the
   two properties the compositor runs off the main thread. Do not animate the
   card's own border/background here — that is a paint property on a full-width
   element, and this list can be seven of them. */
.turn-pulse {
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  border: 2px solid var(--bsg-accent);
  pointer-events: none;
  opacity: 0;
  animation: turn-attention 900ms var(--bsg-ease, ease-out) 1 both;
}

@keyframes turn-attention {
  0%   { opacity: 0;    transform: scale(1); }
  18%  { opacity: 0.95; transform: scale(1); }
  100% { opacity: 0;    transform: scale(1.04); }
}

/* A11Y-08: reduced-motion — stop breathe animation AND provide a static
   high-contrast border so the active-player turn cue remains visible
   (does not simply vanish under reduced-motion preference). The ring's
   unanimated resting state is the full-size, fully-opaque ring, so the cue
   stays visible rather than vanishing. */
@media (prefers-reduced-motion: reduce) {
  .turn-indicator-dot::after {
    animation: none;
  }
  .player-card.current {
    border: 2px solid var(--bsg-accent);
  }
  /* The pulse is pure attention-motion with no state of its own, so under
     reduced motion it is simply removed — the static high-contrast border above
     is the standing cue for which seat is active, and it does not vanish. */
  .turn-pulse {
    display: none;
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
