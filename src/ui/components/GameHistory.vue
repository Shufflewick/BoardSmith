<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';

interface GameMessage {
  id: number;
  text: string;
  timestamp: Date;
  type?: 'action' | 'system' | 'error';
}

interface GameHistoryProps {
  /** Array of messages from game state */
  messages: Array<string | { text: string; type?: string }>;
}

const props = defineProps<GameHistoryProps>();

const messagesContainer = ref<HTMLElement | null>(null);

const processedMessages = ref<GameMessage[]>([]);
let messageCounter = 0;
// Tracks how many source messages have been processed. Never reset on clear —
// that is the fix for the silent un-clear bug: the watcher always starts from
// this index so pre-clear messages are never re-added when new ones arrive.
let lastProcessedSourceIndex = 0;

watch(
  () => props.messages,
  (newMessages) => {
    if (newMessages.length > lastProcessedSourceIndex) {
      for (let i = lastProcessedSourceIndex; i < newMessages.length; i++) {
        const msg = newMessages[i];
        const text = typeof msg === 'string' ? msg : msg.text;
        const type = typeof msg === 'object' && msg.type
          ? (msg.type as 'action' | 'system' | 'error')
          : 'action';

        if (text) {
          processedMessages.value.push({
            id: messageCounter++,
            text,
            timestamp: new Date(),
            type,
          });
        }
      }
      lastProcessedSourceIndex = newMessages.length;

      nextTick(() => {
        if (messagesContainer.value) {
          messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
        }
      });
    }
  },
  { immediate: true, deep: true }
);

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function clearHistory() {
  processedMessages.value = [];
  // Do NOT reset lastProcessedSourceIndex — resetting it would cause the
  // watcher to re-add all pre-clear messages on the next state update.
  // messageCounter stays monotonic so message IDs remain unique after clear.
}

const copyStatus = ref<'idle' | 'copied'>('idle');

async function copyHistory() {
  if (processedMessages.value.length === 0) return;

  const lines = processedMessages.value.map(msg => {
    const timestamp = msg.timestamp.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    return `[${timestamp}] ${msg.text}`;
  });

  const text = lines.join('\n');

  try {
    await navigator.clipboard.writeText(text);
    copyStatus.value = 'copied';
    setTimeout(() => {
      copyStatus.value = 'idle';
    }, 2000);
  } catch (err) {
    console.error('Failed to copy log:', err);
  }
}

// Exposed so GameShell (on behalf of DebugPanel) can drive copy/clear and
// disable the Copy button when the log is empty. The timestamped messages
// remain owned here — only the trigger moves to DebugPanel (single source
// of truth, DEV-06).
const hasMessages = computed(() => processedMessages.value.length > 0);
defineExpose({ clearHistory, copyHistory, hasMessages });
</script>

<template>
  <!-- Standing inline log inside the players panel. Always shown (no collapse);
       hide it by collapsing the sidebar rail / mobile strip. -->
  <div class="game-history">
    <!-- Header: minimal Slate seclabel (uppercase mono) + copy-entire-log button -->
    <div class="history-header">
      <span class="header-title">Log</span>
      <span class="message-count">{{ processedMessages.length }}</span>
      <button
        type="button"
        class="history-copy"
        :disabled="!hasMessages"
        :title="copyStatus === 'copied' ? 'Copied!' : 'Copy log'"
        :aria-label="copyStatus === 'copied' ? 'Log copied' : 'Copy entire log'"
        @click="copyHistory"
      >
        <svg v-if="copyStatus === 'copied'" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    <!-- Messages: role=log so screen readers announce new entries as they arrive -->
    <div ref="messagesContainer" class="messages-container" role="log" aria-live="polite" aria-relevant="additions">
      <div
        v-for="msg in processedMessages"
        :key="msg.id"
        class="message"
        :class="msg.type"
      >
        <span class="timestamp">{{ formatTime(msg.timestamp) }}</span>
        <span class="text">{{ msg.text }}</span>
      </div>
      <div v-if="processedMessages.length === 0" class="no-messages">
        No activity yet
      </div>
    </div>
  </div>
</template>

<style scoped>
.game-history {
  display: flex;
  flex-direction: column;
  background: var(--bsg-surface);
  min-height: 0;
}

/* Minimal Slate seclabel: uppercase mono label + count, plus a copy button */
.history-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 2px;
  font-family: var(--bsg-mono);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--bsg-ink-3);
}

.header-title {
  color: inherit;
}

.message-count {
  color: var(--bsg-ink-3);
}

/* Copy-entire-log button */
.history-copy {
  flex: none;
  margin-left: auto;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  min-height: 24px;
  padding: 0;
  background: none;
  border: none;
  border-radius: var(--bsg-r-sm);
  color: var(--bsg-ink-3);
  cursor: pointer;
}

.history-copy:hover:not(:disabled) {
  color: var(--bsg-ink);
  background: var(--bsg-field);
}

.history-copy:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.history-copy svg {
  width: 14px;
  height: 14px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
}

.messages-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 2px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

/* Log entry: one flat line — inline mono timestamp + text. No card/box
   (matches the Slate mockup .log .e). */
.message {
  display: flex;
  gap: 9px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--bsg-ink-2);
}

.message.error .text {
  color: var(--bsg-danger);
}

.timestamp {
  color: var(--bsg-ink-3);
  font-size: 11px;
  line-height: 1.5;
  font-family: var(--bsg-mono);
  font-variant-numeric: tabular-nums;
  flex: none;
}

.text {
  color: var(--bsg-ink-2);
  line-height: 1.4;
}

.message.system .text {
  color: var(--bsg-ink);
}

.no-messages {
  text-align: center;
  color: var(--bsg-ink-3);
  font-style: italic;
  padding: 30px 10px;
}

.messages-container::-webkit-scrollbar {
  width: 6px;
}

.messages-container::-webkit-scrollbar-track {
  background: var(--bsg-bg);
}

.messages-container::-webkit-scrollbar-thumb {
  background: var(--bsg-line-2);
  border-radius: 3px;
}
</style>
