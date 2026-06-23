<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';

interface GameMessage {
  id: number;
  text: string;
  timestamp: Date;
  type?: 'action' | 'system' | 'error';
}

interface GameHistoryProps {
  /** Array of messages from game state */
  messages: Array<string | { text: string; type?: string }>;
  /** Whether the panel is collapsed */
  collapsed?: boolean;
  /** Bottom-sheet mode for compact/phone viewports (IA-06).
   *  When true, renders as an on-demand overlay that slides up from the
   *  bottom of .stage instead of a standing aside. Starts closed. */
  sheet?: boolean;
}

const props = withDefaults(defineProps<GameHistoryProps>(), {
  collapsed: false,
  sheet: false,
});

const emit = defineEmits<{
  'update:collapsed': [value: boolean];
}>();

// In sheet mode the panel starts closed (collapsed=true); in sidebar mode it
// respects the collapsed prop directly. Reuses the same isCollapsed mechanism
// for open/close in both modes (plan requirement: reuse collapse pattern).
const isCollapsed = ref(props.sheet ? true : props.collapsed);
const messagesContainer = ref<HTMLElement | null>(null);

const processedMessages = ref<GameMessage[]>([]);
let messageCounter = 0;

watch(
  () => props.messages,
  (newMessages) => {
    const startIndex = processedMessages.value.length;
    if (newMessages.length > startIndex) {
      for (let i = startIndex; i < newMessages.length; i++) {
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

      nextTick(() => {
        if (messagesContainer.value) {
          messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
        }
      });
    }
  },
  { immediate: true, deep: true }
);

function toggleCollapsed() {
  isCollapsed.value = !isCollapsed.value;
  emit('update:collapsed', isCollapsed.value);
}

watch(() => props.collapsed, (val) => {
  // In sheet mode, ignore external collapsed prop (sheet manages its own open state)
  if (!props.sheet) isCollapsed.value = val;
});

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function clearHistory() {
  processedMessages.value = [];
  messageCounter = 0;
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
    console.error('Failed to copy history:', err);
  }
}
</script>

<template>
  <!-- ── Bottom-sheet mode: on-demand overlay from the bottom of .stage (IA-06) ── -->
  <div v-if="sheet" class="history-sheet-wrap">
    <!-- Slide-up panel (open when !isCollapsed) -->
    <div v-if="!isCollapsed" class="history-sheet-panel">
      <div class="sheet-panel-header">
        <span class="sheet-panel-title">History</span>
        <span class="sheet-panel-count">({{ processedMessages.length }})</span>
        <button class="sheet-panel-close" @click="toggleCollapsed" title="Close history">✕</button>
      </div>
      <div ref="messagesContainer" class="messages-container sheet-messages">
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
    <!-- Toggle pill: always visible at the bottom of .stage -->
    <button class="sheet-trigger" @click="toggleCollapsed" :aria-expanded="!isCollapsed">
      <span class="sheet-trigger-icon">{{ isCollapsed ? '▲' : '▼' }}</span>
      History
      <span v-if="processedMessages.length > 0" class="sheet-trigger-badge">{{ processedMessages.length }}</span>
    </button>
  </div>

  <!-- ── Sidebar mode: standing inline history (medium/wide breakpoints) ─────── -->
  <div v-else class="game-history" :class="{ collapsed: isCollapsed }">
    <!-- Header -->
    <div class="history-header">
      <div class="header-left" @click="toggleCollapsed">
        <span class="header-icon">{{ isCollapsed ? '►' : '◄' }}</span>
        <span v-if="!isCollapsed" class="header-title">Game History</span>
        <span v-if="!isCollapsed" class="message-count">({{ processedMessages.length }})</span>
      </div>
      <div v-if="!isCollapsed" class="header-buttons">
        <button
          @click.stop="copyHistory"
          class="header-btn copy-btn"
          :class="{ copied: copyStatus === 'copied' }"
          :disabled="processedMessages.length === 0"
          :title="copyStatus === 'copied' ? 'Copied!' : 'Copy history to clipboard'"
        >
          {{ copyStatus === 'copied' ? 'Copied!' : 'Copy' }}
        </button>
        <button @click.stop="clearHistory" class="header-btn clear-btn" title="Clear history">
          Clear
        </button>
      </div>
    </div>

    <!-- Content (when not collapsed) -->
    <div v-if="!isCollapsed" class="history-content">
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

    <!-- Collapsed indicator -->
    <div v-if="isCollapsed" class="collapsed-indicator">
      <span class="vertical-text">History</span>
      <span class="badge">{{ processedMessages.length }}</span>
    </div>
  </div>
</template>

<style scoped>
/* ── Bottom-sheet mode (IA-06) ─────────────────────────────────────────────
   .history-sheet-wrap is rendered inside .stage (absolute-positioned child)
   so it can never cover the .actionbar sibling below .stage.
   ─────────────────────────────────────────────────────────────────────────── */
.history-sheet-wrap {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none; /* let through clicks except on children */
}
.history-sheet-wrap > * {
  pointer-events: auto;
}

/* Slide-up panel */
.history-sheet-panel {
  width: 100%;
  max-height: min(50dvh, 320px);
  background: var(--bsg-surface);
  border-top: 1px solid var(--bsg-line);
  box-shadow: 0 -4px 20px rgba(0, 0, 0, .22);
  display: flex;
  flex-direction: column;
}

.sheet-panel-header {
  display: flex;
  align-items: center;
  gap: var(--bsg-s2);
  padding: 8px var(--bsg-s3);
  border-bottom: 1px solid var(--bsg-line);
  background: var(--bsg-surface-2);
  flex: none;
}

.sheet-panel-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--bsg-ink);
}

.sheet-panel-count {
  color: var(--bsg-ink-3);
  font-size: 12px;
}

.sheet-panel-close {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--bsg-ink-3);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--bsg-r-sm);
}
.sheet-panel-close:hover {
  color: var(--bsg-ink);
  background: var(--bsg-field);
}

.sheet-messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--bsg-s2) var(--bsg-s3);
}

/* Toggle pill trigger */
.sheet-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  margin-bottom: var(--bsg-s2);
  background: var(--bsg-surface);
  border: 1px solid var(--bsg-line-2);
  border-radius: var(--bsg-r-pill);
  box-shadow: var(--bsg-shadow-sm);
  cursor: pointer;
  color: var(--bsg-ink-2);
  font-size: 12px;
  font-weight: 600;
  font-family: var(--bsg-font);
  transition: all var(--bsg-dur-fast);
}
.sheet-trigger:hover {
  color: var(--bsg-ink);
  border-color: var(--bsg-line-2);
  background: var(--bsg-surface-2);
}

.sheet-trigger-icon {
  font-size: 9px;
  color: var(--bsg-accent);
}

.sheet-trigger-badge {
  background: color-mix(in srgb, var(--bsg-accent) 20%, transparent);
  color: var(--bsg-accent);
  font-size: 10px;
  padding: 2px 5px;
  border-radius: var(--bsg-r-pill);
  font-family: var(--bsg-mono);
  min-width: 18px;
  text-align: center;
}

/* ── Sidebar mode (unchanged) ───────────────────────────────────────────── */
.game-history {
  display: flex;
  flex-direction: column;
  background: var(--bsg-surface);
  border-right: 1px solid var(--bsg-line);
  height: 100%;
  transition: width var(--bsg-dur-base) ease;
  width: 280px;
  min-width: 280px;
}

.game-history.collapsed {
  width: 40px;
  min-width: 40px;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--bsg-surface-2);
  border-bottom: 1px solid var(--bsg-line);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  flex: 1;
}

.header-left:hover {
  opacity: 0.8;
}

.header-icon {
  color: var(--bsg-accent);
  font-size: 10px;
}

.header-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--bsg-ink);
}

.message-count {
  color: var(--bsg-ink-3);
  font-size: 12px;
}

.header-buttons {
  display: flex;
  gap: 6px;
}

.header-btn {
  padding: 3px 8px;
  background: transparent;
  border: 1px solid var(--bsg-line-2);
  border-radius: 4px;
  color: var(--bsg-ink-2);
  font-size: 10px;
  cursor: pointer;
  transition: all var(--bsg-dur-fast);
}

.header-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.copy-btn:hover:not(:disabled) {
  border-color: var(--bsg-accent);
  color: var(--bsg-accent);
}

.copy-btn.copied {
  border-color: var(--bsg-ok);
  color: var(--bsg-ok);
}

.clear-btn:hover {
  border-color: var(--bsg-danger);
  color: var(--bsg-danger);
}

.history-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.message {
  padding: 8px 10px;
  margin-bottom: 6px;
  background: var(--bsg-field);
  border-radius: 6px;
  border-left: 3px solid var(--bsg-accent);
  font-size: 12px;
}

.message.system {
  border-left-color: var(--bsg-warn);
}

.message.error {
  border-left-color: var(--bsg-danger);
  background: color-mix(in srgb, var(--bsg-danger) 10%, transparent);
}

.timestamp {
  display: block;
  color: var(--bsg-ink-3);
  font-size: 10px;
  font-family: monospace;
  margin-bottom: 4px;
}

.text {
  color: var(--bsg-ink-2);
  line-height: 1.4;
}

.no-messages {
  text-align: center;
  color: var(--bsg-ink-3);
  font-style: italic;
  padding: 30px 10px;
}

.collapsed-indicator {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 20px;
  gap: 10px;
}

.vertical-text {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  color: var(--bsg-ink-3);
  font-size: 11px;
  letter-spacing: 1px;
}

.badge {
  background: color-mix(in srgb, var(--bsg-accent) 20%, transparent);
  color: var(--bsg-accent);
  font-size: 10px;
  padding: 4px 6px;
  border-radius: 10px;
  min-width: 20px;
  text-align: center;
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

.messages-container::-webkit-scrollbar-thumb:hover {
  background: var(--bsg-line-2);
}
</style>
