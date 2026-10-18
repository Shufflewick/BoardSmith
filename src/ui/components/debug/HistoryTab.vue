<script setup lang="ts">
/**
 * THE HISTORY TAB (#157).
 *
 * The action history, a timeline you can scrub, and the rewind that permanently
 * discards everything after a point. Rewind is guarded by an in-panel
 * confirmation naming exactly how many actions it would discard, because a
 * native browser confirm inside an iframe is refused or suppressed by the host
 * and would turn the guard into a silent no-op.
 *
 * Presentational: `useDebugTimeline` in the panel owns where the panel is
 * pointed in the history and what a rewind sends, and its tests cover both. This
 * renders what it is handed and emits what a click means.
 */
import { computed } from 'vue';
import type { HistoryEntry } from '../../composables/useDebugBridge.js';
import { formatHistoryEntry, formatActionArgs, formatTimestamp } from './debug-format.js';
import { seatInk, type ContrastInk } from '../../utils/color-contrast.js';
import DebugButton from './DebugButton.vue';
import DebugDialog from './DebugDialog.vue';

const props = defineProps<{
  actionHistory: HistoryEntry[];
  /** Which action the first entry is: the game dropped those before it (#997). */
  actionHistoryBase: number;
  /**
   * The game's players, from the same state the player cards read. A badge
   * is filled with its seat's `color` and inked by `seatInk`, as the cards
   * are; a player with none gets the cards' accent fill and white ink.
   */
  players: ReadonlyArray<{ seat: number; color?: string }>;
  historyLoading: boolean;
  historyError: string | null;
  selectedActionIndex: number | null;
  isViewingHistory: boolean;
  pendingRewindIndex: number | null;
  pendingRewindDiscardCount: number;
  rewindLoading: boolean;
  rewindError: string | null;
}>();

/** Every action the game has played, dropped ones included: the indices the panel sends count them. */
const actionCount = computed(() => props.actionHistoryBase + props.actionHistory.length);

function badgeStyle(seat: number): { '--badge-seat': string | undefined; color: ContrastInk['ink'] } {
  const color = props.players.find((player) => player.seat === seat)?.color;
  return { '--badge-seat': color, color: seatInk(color, 'HistoryTab').ink };
}

const emit = defineEmits<{
  refresh: [];
  'select-action': [index: number];
  'back-to-live': [];
  rewind: [index: number | null];
  'confirm-rewind': [];
  'cancel-rewind': [];
}>();
</script>

<template>
  <div
    id="debug-panel-history"
    role="tabpanel"
    aria-labelledby="debug-tab-history"
    class="tab-content history-tab"
  >
        <div class="history-header">
          <span class="history-count">{{ actionCount }} actions<template v-if="actionHistoryBase > 0">, the first {{ actionHistoryBase }} not kept</template></span>
          <DebugButton @click="emit('refresh')" size="small" :disabled="historyLoading">
            {{ historyLoading ? 'Loading...' : 'Refresh' }}
          </DebugButton>
        </div>

        <div v-if="historyError" class="history-error">
          {{ historyError }}
        </div>

        <div v-else-if="historyLoading && actionHistory.length === 0" class="history-loading">
          Loading history...
        </div>

        <div v-else-if="actionHistory.length === 0" class="history-empty">
          No actions yet
        </div>

        <!-- Timeline slider -->
        <div v-if="actionHistory.length > 0" class="timeline-controls">
          <DebugButton size="small" :disabled="selectedActionIndex !== null && selectedActionIndex <= actionHistoryBase" @click="emit('select-action', (selectedActionIndex ?? actionCount) - 1)" >
            &lt;
          </DebugButton>
          <input
            type="range"
            :min="actionHistoryBase"
            :max="actionCount"
            :value="selectedActionIndex ?? actionCount"
            @input="emit('select-action', parseInt(($event.target as HTMLInputElement).value))"
            class="timeline-slider"
          />
          <DebugButton size="small" :disabled="selectedActionIndex === null || selectedActionIndex >= actionCount"
            @click="emit('select-action', (selectedActionIndex ?? actionCount - 1) + 1)"
          >
            &gt;
          </DebugButton>
          <span class="timeline-position">
            {{ selectedActionIndex ?? actionCount }} / {{ actionCount }}
          </span>
          <DebugButton v-if="isViewingHistory" size="small" class="live-btn" @click="emit('back-to-live')" >
            Live
          </DebugButton>
          <DebugButton v-if="isViewingHistory && selectedActionIndex !== null && selectedActionIndex < actionCount" size="small" class="rewind-btn" :disabled="rewindLoading" @click="emit('rewind', selectedActionIndex)" title="Permanently rewind game to this action" >
            {{ rewindLoading ? 'Rewinding...' : 'Rewind Here' }}
          </DebugButton>
        </div>
        <!-- Rewind confirmation. In-panel, NOT window.confirm — see
             `pendingRewindIndex` for the three ways the native dialog broke
             this control (page freeze, silent no-op inside the platform
             iframe, and Chrome's suppress-dialogs box). -->
        <DebugDialog
          v-if="pendingRewindIndex !== null"
          :title="`Rewind to action ${pendingRewindIndex}?`"
          modal
          close-label="Cancel rewind"
          @close="emit('cancel-rewind')"
        >
          <p>
            This permanently discards
            {{ pendingRewindDiscardCount }}
            action{{ pendingRewindDiscardCount === 1 ? '' : 's' }} and cannot be undone.
          </p>
          <template #footer>
            <DebugButton @click="emit('cancel-rewind')">Cancel</DebugButton>
            <DebugButton tone="primary" :disabled="rewindLoading" @click="emit('confirm-rewind')">
              {{ rewindLoading ? 'Rewinding...' : 'Rewind' }}
            </DebugButton>
          </template>
        </DebugDialog>
        <div v-if="rewindError" class="rewind-error">
          {{ rewindError }}
        </div>

        <!-- Action list -->
        <div v-if="actionHistory.length > 0" class="history-list">
          <div
            v-for="(action, index) in actionHistory"
            :key="index"
            class="history-item"
            :class="{
              current: index === actionHistory.length - 1 && !isViewingHistory,
              selected: selectedActionIndex === actionHistoryBase + index + 1
            }"
            @click="emit('select-action', actionHistoryBase + index + 1)"
          >
            <div class="history-item-header">
              <span class="history-index">{{ actionHistoryBase + index + 1 }}</span>
              <span class="history-player" :style="badgeStyle(action.player)">
                P{{ action.player }}
              </span>
              <span class="history-action-name">{{ formatHistoryEntry(action) }}</span>
              <span v-if="action.timestamp" class="history-time">
                {{ formatTimestamp(action.timestamp) }}
              </span>
            </div>
            <div v-if="'args' in action && formatActionArgs(action.args)" class="history-item-args">
              {{ formatActionArgs(action.args) }}
            </div>
          </div>
        </div>
  </div>
</template>

<style scoped src="./debug-entry-list.css"></style>

<style scoped>
/* Timeline Controls */
.timeline-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--bsg-line);
  margin-bottom: 8px;
}
.timeline-slider {
  flex: 1;
  height: 6px;
  -webkit-appearance: none;
  background: var(--bsg-surface-3);
  border-radius: 3px;
  cursor: pointer;
}
.timeline-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  background: var(--bsg-accent-2);
  border-radius: 50%;
  cursor: pointer;
}
.timeline-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  background: var(--bsg-accent-2);
  border-radius: 50%;
  cursor: pointer;
  border: none;
}
.timeline-position {
  font-size: 11px;
  color: var(--bsg-ink-2);
  min-width: 50px;
  text-align: center;
}
.live-btn {
  background: color-mix(in srgb, var(--bsg-ok) 20%, transparent) !important;
  border-color: var(--bsg-ok) !important;
  color: var(--bsg-ok) !important;
}
.rewind-btn {
  background: color-mix(in srgb, var(--bsg-warn) 20%, transparent) !important;
  border-color: var(--bsg-warn) !important;
  color: var(--bsg-warn) !important;
}
.rewind-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--bsg-warn) 40%, transparent) !important;
}
.rewind-btn:disabled {
  background: var(--bsg-disabled-surface) !important;
  border-color: var(--bsg-line) !important;
  color: var(--bsg-disabled-ink) !important;
  cursor: not-allowed;
}
.rewind-error {
  background: color-mix(in srgb, var(--bsg-danger) 20%, transparent);
  border: 1px solid var(--bsg-danger);
  color: var(--bsg-danger);
  padding: 8px 12px;
  border-radius: 4px;
  margin-bottom: 8px;
  font-size: 12px;
}
</style>
