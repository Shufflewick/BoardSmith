<script setup lang="ts">
/**
 * GameOverCard — Slate result overlay (IA-07)
 *
 * Overlays the board inside .boardregion behind a Slate scrim when the game
 * is complete. Shows winners from the validated winnerSeats × players list,
 * or "Game Over" without names when no winners are known (dev-WS degrade).
 *
 * Scrim is positioned absolute inside .boardregion — it cannot cover browser
 * chrome or the .actionbar (which is a sibling of .stage, not a child).
 *
 * Focus is trapped inside the card on mount (A11Y-07). Escape does NOT close:
 * the game is over and there is no dismiss — the user must click Rematch or New Game.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useFocusTrap } from '../composables/useFocusTrap';

export interface Player {
  seat: number;
  name: string;
  color?: string;
}

const props = defineProps<{
  /** Validated seat indices of the winners ([] in dev-WS degrade). */
  winnerSeats: number[];
  /** All players in the game — used for name lookup. */
  players: Player[];
}>();

const emit = defineEmits<{
  rematch: [];
  'new-game': [];
}>();

const cardRef = ref<HTMLElement | null>(null);

const { open: openTrap, close: closeTrap, handleKeydown } = useFocusTrap(cardRef, {
  escapeToClose: false,
});

onMounted(() => openTrap());
onBeforeUnmount(() => closeTrap());

// ---------------------------------------------------------------------------
// Shape set (mirrors PlayersPanel.vue, IA-06): seat index → shape class.
// Keeps player identity tokens visually consistent across the shell.
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
  return (name.trim()[0] ?? '?').toUpperCase();
}

/** Players whose seat number appears in winnerSeats. */
const winners = computed(() =>
  props.winnerSeats
    .map(seat => props.players.find(p => p.seat === seat))
    .filter((p): p is Player => p !== undefined)
);

/** h2 title text. */
const titleText = computed(() => {
  if (winners.value.length === 0) return 'Game Over';
  if (winners.value.length === 1) return `${winners.value[0].name} wins`;
  const names = winners.value.map(p => p.name).join(' & ');
  return `${names} win`;
});
</script>

<template>
  <div class="game-over-scrim" aria-modal="true">
    <div
      ref="cardRef"
      class="game-over-card"
      role="dialog"
      aria-labelledby="game-over-title"
      @keydown="handleKeydown"
    >
      <h2 id="game-over-title" class="game-over-title">{{ titleText }}</h2>

      <!-- Winner tokens: only when winners are known (not in dev-WS degrade) -->
      <div v-if="winners.length > 0" class="winners" aria-label="Winners">
        <div
          v-for="player in winners"
          :key="player.seat"
          class="winner-row"
        >
          <span
            class="tok"
            :class="playerShape(players.findIndex(p => p.seat === player.seat))"
            :style="player.color ? { '--tc': player.color } : {}"
          >
            <span class="shape"></span>
            <span class="ini">{{ playerInitial(player.name) }}</span>
          </span>
          <span class="winner-name">{{ player.name }}</span>
        </div>
      </div>

      <div class="game-over-actions">
        <button class="goc-btn goc-btn--primary" @click="emit('new-game')">New Game</button>
        <button class="goc-btn goc-btn--ghost" @click="emit('rematch')">Rematch</button>
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
  background: var(--bsg-surface);
  border: 1px solid var(--bsg-line-2);
  border-radius: var(--bsg-r-lg);
  box-shadow: var(--bsg-shadow);
  padding: var(--bsg-s6) var(--bsg-s5);
  min-width: 280px;
  max-width: min(480px, 90cqw);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--bsg-s4);
  text-align: center;
}

.game-over-title {
  font-size: 1.75rem;
  font-weight: 800;
  color: var(--bsg-ink);
  margin: 0;
  line-height: 1.2;
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

/* Player identity token (mirrors PlayersPanel.vue) */
.tok {
  position: relative;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  --tc: var(--bsg-accent);
}

.tok .shape {
  position: absolute;
  inset: 0;
  background: var(--tc);
  opacity: 0.85;
}

.tok .ini {
  position: relative;
  font-size: 13px;
  font-weight: 700;
  color: var(--bsg-bg);
  line-height: 1;
  z-index: 1;
}

/* Shape clip-paths (same set as PlayersPanel.vue) */
.sh-circle .shape { border-radius: 50%; }
.sh-square .shape { border-radius: var(--bsg-r-sm); }
.sh-hexagon .shape { clip-path: polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%); }
.sh-octagon .shape { clip-path: polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%); }
.sh-diamond .shape { clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%); }
.sh-pentagon .shape { clip-path: polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%); }
.sh-shield .shape { clip-path: polygon(50% 0%, 100% 25%, 100% 65%, 50% 100%, 0% 65%, 0% 25%); }
.sh-plus .shape { clip-path: polygon(33% 0%, 67% 0%, 67% 33%, 100% 33%, 100% 67%, 67% 67%, 67% 100%, 33% 100%, 33% 67%, 0% 67%, 0% 33%, 33% 33%); }

/* Action buttons */
.game-over-actions {
  display: flex;
  gap: var(--bsg-s3);
  flex-wrap: wrap;
  justify-content: center;
}

.goc-btn {
  height: 46px;
  padding: 0 var(--bsg-s5);
  border-radius: var(--bsg-r-sm);
  cursor: pointer;
  font-size: 14px;
  font-weight: 700;
  font-family: inherit;
  border: 1px solid transparent;
  display: inline-flex;
  align-items: center;
  gap: var(--bsg-s2);
  transition: 0.13s ease;
  white-space: nowrap;
}

.goc-btn--primary {
  background: var(--bsg-accent);
  color: var(--bsg-accent-ink);
  border-color: color-mix(in srgb, var(--bsg-accent) 70%, black);
}

.goc-btn--primary:hover {
  filter: brightness(1.06);
  transform: translateY(-1px);
}

.goc-btn--ghost {
  background: transparent;
  color: var(--bsg-ink-2);
  border-color: var(--bsg-line);
}

.goc-btn--ghost:hover {
  color: var(--bsg-ink);
  border-color: var(--bsg-line-2);
}
</style>
