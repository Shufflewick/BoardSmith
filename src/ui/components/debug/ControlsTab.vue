<script setup lang="ts">
/**
 * THE CONTROLS TAB (#157).
 *
 * The switches: whose seat the panel renders the game as, restarting, copying or
 * clearing the player-facing message log, and the panel's own settings.
 *
 * Restart is a two-click guard rather than a confirm dialog -- the confirming
 * state lives in the panel, because it also owns the timeout that cancels it --
 * so this renders the state it is handed and reports the click.
 */
import DebugButton from './DebugButton.vue';

defineProps<{
  playerSeat: number;
  playerCount: number;
  /** True while the restart button is armed and awaiting its second click. */
  restartConfirming: boolean;
  /** Whether the game log holds anything to copy or clear. */
  historyHasMessages: boolean;
  showRawState: boolean;
}>();

const emit = defineEmits<{
  'switch-player': [position: number];
  'restart-click': [];
  'copy-history': [];
  'clear-history': [];
  'update:showRawState': [value: boolean];
}>();
</script>

<template>
  <div
    id="debug-panel-controls"
    role="tabpanel"
    aria-labelledby="debug-tab-controls"
    class="tab-content controls-tab"
  >
        <!-- Player Perspective -->
        <div class="action-group">
          <h4>Player Perspective</h4>
          <div class="player-buttons">
            <DebugButton v-for="i in playerCount" :key="i - 1" @click="emit('switch-player', i - 1)" :class="{ active: playerSeat === i - 1 }" >
              Player {{ i }}
            </DebugButton>
          </div>
          <p class="hint">Switch to view the game as a different player</p>
        </div>

        <!-- Game Controls -->
        <div class="action-group">
          <h4>Game Controls</h4>
          <DebugButton @click="emit('restart-click')" :class="restartConfirming ? 'restart-confirming' : 'danger'" >
            {{ restartConfirming ? 'Confirm restart?' : 'Restart game' }}
          </DebugButton>
          <p class="hint">
            {{ restartConfirming ? 'Click again to confirm — auto-cancels in 5 s' : 'Start a new game (current progress will be lost)' }}
          </p>
        </div>

        <!-- Game History — copy/clear the player-visible message log.
             Buttons emit events; GameShell drives the live GameHistory ref. -->
        <div class="action-group">
          <h4>Game history</h4>
          <div class="player-buttons">
            <DebugButton size="small" :disabled="!historyHasMessages" @click="emit('copy-history')">
              Copy
            </DebugButton>
            <DebugButton size="small" tone="danger" @click="emit('clear-history')">
              Clear
            </DebugButton>
          </div>
          <p class="hint">Copy or clear the player-facing game message log</p>
        </div>

        <!-- Settings -->
        <div class="action-group">
          <h4>Settings</h4>
          <label class="setting-item">
            <input type="checkbox" :checked="showRawState"
                @change="emit('update:showRawState', ($event.target as HTMLInputElement).checked)" />
            Show raw JSON by default
          </label>
        </div>

        <!-- Connection Info -->
        <div class="action-group">
          <h4>Connection</h4>
          <div class="state-item">
            <span class="label">Transport:</span>
            <span class="value monospace">host bridge (dev)</span>
          </div>
          <div class="state-item">
            <span class="label">Seat:</span>
            <span class="value monospace">{{ playerSeat }} / {{ playerCount }}</span>
          </div>
          <div class="shortcut-hint">
            <kbd>Ctrl/Cmd+D</kbd> Toggle debug panel
          </div>
        </div>
  </div>
</template>

<style scoped>
.player-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* Actions Tab */
.action-group {
  margin-bottom: 20px;
}
.action-group h4 {
  color: var(--bsg-ink);
  font-size: 12px;
  text-transform: uppercase;
  margin-bottom: 10px;
  letter-spacing: 0.5px;
}
.action-group .hint {
  color: var(--bsg-ink-3);
  font-size: 11px;
  margin-top: 8px;
}
.setting-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--bsg-ink-2);
  cursor: pointer;
}
.shortcut-hint kbd {
  display: inline-block;
  padding: 4px 8px;
  background: var(--bsg-surface-3);
  border: 1px solid var(--bsg-line-2);
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
  color: var(--bsg-accent-2);
}
.shortcut-hint {
  margin-top: 8px;
  font-size: 11px;
  color: var(--bsg-ink-2);
}
.state-item {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid var(--bsg-line);
}
.state-item:last-child {
  border-bottom: none;
}
.state-item .label {
  color: var(--bsg-ink-2);
}
.state-item .value {
  color: var(--bsg-accent-2);
  font-weight: 500;
}
.state-item .value.monospace {
  font-family: monospace;
  font-size: 11px;
}
</style>
