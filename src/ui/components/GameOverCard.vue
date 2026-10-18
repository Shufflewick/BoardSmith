<script setup lang="ts">
/**
 * GameOverCard — Slate result overlay (IA-07, D10)
 *
 * Overlays the board inside .boardregion behind a Slate scrim when the game
 * is complete. Shows winners from the validated winnerSeats × players list;
 * a genuine draw (isDraw=true) labels "Draw"; winner data that is merely
 * unavailable (dev-WS degrade, isDraw=false with no seats) stays "Game Over".
 * The card never renders winner tokens when there are no winners (D10).
 *
 * Scrim is positioned absolute inside .boardregion — it cannot cover browser
 * chrome or the .actionbar (which is a sibling of .stage, not a child).
 *
 * Focus is trapped inside the card on mount (A11Y-07). The card is dismissable
 * (D10): a close button and Escape both emit 'dismiss'. Dismissing does not
 * leave the game — the caller (GameShell) hides the card and returns focus to
 * the board. It offers no New Game or Rematch: a deployed host has no restart
 * op (#902).
 */
import { ref, computed, onMounted } from 'vue';
import { useFocusTrap } from '../composables/useFocusTrap';
import PlayerToken from './PlayerToken.vue';
import { seatDisplay } from '../seat-display.js';

export interface Player {
  seat: number;
  name: string;
  color?: string;
}

const props = withDefaults(defineProps<{
  /** Validated seat indices of the winners ([] in dev-WS degrade or a draw). */
  winnerSeats: number[];
  /** All players in the game — used for name lookup. */
  players: Player[];
  /**
   * Explicit signal that the game ended with zero winners (a genuine draw),
   * as opposed to winner data merely being unavailable. Sourced from the
   * session (isComplete && winners.length === 0) — never inferred from a
   * bare empty winnerSeats array, which also occurs on the dev-WS degrade.
   */
  isDraw?: boolean;
}>(), {
  isDraw: false,
});

const emit = defineEmits<{
  /** Card dismissed via close button or Escape. Does not leave the game. */
  dismiss: [];
}>();

const cardRef = ref<HTMLElement | null>(null);

const { open: openTrap, handleKeydown } = useFocusTrap(cardRef, {
  escapeToClose: true,
  onClose: () => emit('dismiss'),
});

onMounted(() => openTrap());

/** The winners, shown as every other surface shows their seat. */
const winners = computed(() => props.winnerSeats.map((seat) => seatDisplay(props.players, seat)));

/**
 * h2 title text — a pure function of winners + isDraw (UI-SPEC §1):
 *   1 winner    → "{name} wins"
 *   >1 winners  → "{names} win"
 *   0 winners, isDraw   → "Draw"
 *   0 winners, !isDraw  → "Game Over" (winner data unavailable, e.g. dev-WS degrade)
 */
const titleText = computed(() => {
  if (winners.value.length === 1) return `${winners.value[0].name} wins`;
  if (winners.value.length > 1) {
    const names = winners.value.map(p => p.name).join(' & ');
    return `${names} win`;
  }
  return props.isDraw ? 'Draw' : 'Game Over';
});
</script>

<template>
  <div class="game-over-scrim">
    <div
      ref="cardRef"
      class="game-over-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-over-title"
      @keydown="handleKeydown"
    >
      <button
        type="button"
        class="goc-close"
        aria-label="Close"
        @click="emit('dismiss')"
      >&times;</button>
      <h2 id="game-over-title" class="game-over-title">{{ titleText }}</h2>

      <!-- Winner tokens: only when winners are known (not in dev-WS degrade) -->
      <div v-if="winners.length > 0" class="winners" aria-label="Winners">
        <div
          v-for="player in winners"
          :key="player.seat"
          class="winner-row"
        >
          <PlayerToken :name="player.name" :seat="player.seat" :color="player.color" :size="32" />
          <span class="winner-name">{{ player.name }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Scrim: absolute inside .boardregion so it overlays the board but cannot
   reach the .actionbar (sibling of .stage) or browser chrome (T-100-06-02). */
.game-over-scrim {
  position: absolute;
  inset: 0;
  z-index: 30;
  /* Dark theme: rgba equivalent of --bsg-bg at 66% opacity.
     Light theme: a lighter scrim — same opacity ratio, lighter base.
     color-mix lets us derive both from existing tokens without hex.    */
  background: color-mix(in srgb, var(--bsg-bg) 66%, transparent);
  display: grid;
  place-items: center;
}

.game-over-card {
  position: relative;
  background: var(--bsg-surface);
  border: 1px solid var(--bsg-line-2);
  border-radius: var(--bsg-r-lg);
  box-shadow: var(--bsg-shadow);
  --goc-pad-x: var(--bsg-s5);
  --goc-close: 44px;
  padding: var(--bsg-s6) var(--goc-pad-x);
  min-width: 280px;
  max-width: min(480px, 90cqw);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--bsg-s4);
  text-align: center;
}

/* Close (dismiss) affordance — top-right, 44x44 CSS px min hit target (UI-SPEC §2). */
.goc-close {
  position: absolute;
  top: 0;
  right: 0;
  width: var(--goc-close);
  height: var(--goc-close);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--bsg-ink);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  border-radius: var(--bsg-r-sm);
}

.goc-close:hover {
  background: color-mix(in srgb, var(--bsg-ink) 10%, transparent);
}

.game-over-title {
  font-size: 1.75rem;
  font-weight: 800;
  color: var(--bsg-ink);
  margin: 0;
  line-height: 1.2;
  /* #1061: room for the corner Close button on both sides keeps the title centred and clear of it. */
  padding-inline: calc(var(--goc-close) + var(--bsg-s2) - var(--goc-pad-x));
  overflow-wrap: anywhere;
}

/* Winner list */
.winners {
  display: flex;
  flex-direction: column;
  gap: var(--bsg-s2);
  width: 100%;
  align-items: center;
}

.winner-row {
  display: flex;
  align-items: center;
  gap: var(--bsg-s3);
}

.winner-name {
  font-size: 1rem;
  font-weight: 600;
  color: var(--bsg-ink);
}
</style>
