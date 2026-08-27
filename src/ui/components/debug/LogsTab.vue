<script setup lang="ts">
/**
 * THE LOGS TAB (#157).
 *
 * Server-side errors and warnings the session captured, which is the only place
 * a developer can see something that went wrong on the host rather than in this
 * browser.
 *
 * It shares the entry-list look with the History tab through
 * `debug-entry-list.css` -- same shape, same class names -- and owns only what
 * is genuinely its own: severity.
 *
 * Presentational: the panel owns the fetch and its staleness policy.
 */
import { formatTimestamp } from './debug-format.js';
import type { LogEntry } from '../../composables/useDebugBridge.js';
import DebugButton from './DebugButton.vue';

defineProps<{
  logEntries: LogEntry[];
  logsLoading: boolean;
  logsError: string | null;
}>();

const emit = defineEmits<{ refresh: [] }>();
</script>

<template>
  <div
    id="debug-panel-logs"
    role="tabpanel"
    aria-labelledby="debug-tab-logs"
    class="tab-content logs-tab"
  >
        <div class="history-header">
          <span class="history-count">{{ logEntries.length }} entries</span>
          <DebugButton @click="emit('refresh')" size="small" :disabled="logsLoading">
            {{ logsLoading ? 'Loading...' : 'Refresh' }}
          </DebugButton>
        </div>

        <div v-if="logsError" class="history-error">
          {{ logsError }}
        </div>

        <div v-else-if="logsLoading && logEntries.length === 0" class="history-loading">
          Loading logs...
        </div>

        <div v-else-if="logEntries.length === 0" class="history-empty">
          No captured server-side errors or warnings
        </div>

        <div v-else class="history-list log-list">
          <div
            v-for="(entry, index) in logEntries"
            :key="index"
            class="history-item log-entry"
            :class="`log-severity-${entry.severity}`"
          >
            <div class="history-item-header">
              <span class="log-severity-badge" :class="`log-severity-${entry.severity}`">
                {{ entry.severity }}
              </span>
              <span class="history-action-name">{{ entry.source }}</span>
              <span class="history-time">{{ formatTimestamp(entry.timestamp) }}</span>
            </div>
            <div class="history-item-args">{{ entry.message }}</div>
          </div>
        </div>
  </div>
</template>

<style scoped src="./debug-entry-list.css"></style>

<style scoped>
/* Logs Tab (ERR-04) */
.logs-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.log-entry.log-severity-error {
  border-left-color: var(--bsg-danger);
}
.log-entry.log-severity-warning {
  border-left-color: var(--bsg-warn);
}
.log-severity-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
}
.log-severity-badge.log-severity-error {
  background: color-mix(in srgb, var(--bsg-danger) 20%, transparent);
  color: var(--bsg-danger);
}
.log-severity-badge.log-severity-warning {
  background: color-mix(in srgb, var(--bsg-warn) 20%, transparent);
  color: var(--bsg-warn);
}
.log-severity-badge.log-severity-info {
  background: var(--bsg-surface-3);
  color: var(--bsg-ink-2);
}
</style>
