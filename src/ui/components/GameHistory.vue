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
}

const props = withDefaults(defineProps<GameHistoryProps>(), {
  collapsed: false,
});

const emit = defineEmits<{
  'update:collapsed': [value: boolean];
}>();

// Local state
const isCollapsed = ref(props.collapsed);
const messagesContainer = ref<HTMLElement | null>(null);

// Process messages into display format
const processedMessages = ref<GameMessage[]>([]);
let messageCounter = 0;

watch(
  () => props.messages,
  (newMessages) => {
    // Only add new messages (compare length)
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

      // Auto-scroll to bottom
      nextTick(() => {
        if (messagesContainer.value) {
          messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
        }
      });
    }
  },
  { immediate: true, deep: true }
);

// Toggle collapsed state
function toggleCollapsed() {
  isCollapsed.value = !isCollapsed.value;
  emit('update:collapsed', isCollapsed.value);
}

// Sync with prop
watch(() => props.collapsed, (val) => {
  isCollapsed.value = val;
});

// Format timestamp
function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

// Clear history (local only)
function clearHistory() {
  processedMessages.value = [];
  messageCounter = 0;
}

// Copy history to clipboard as text log
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
  <div class="game-history" :class="{ collapsed: isCollapsed }">
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
      <!-- Messages -->
      <div ref="messagesContainer" class="messages-container">
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
.game-history {
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.4);
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  height: 100%;
  transition: width 0.2s ease;
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
  background: rgba(0, 217, 255, 0.1);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
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
  color: #00d9ff;
  font-size: 10px;
}

.header-title {
  font-weight: 600;
  font-size: 13px;
  color: #fff;
}

.message-count {
  color: #666;
  font-size: 12px;
}

.header-buttons {
  display: flex;
  gap: 6px;
}

.header-btn {
  padding: 3px 8px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  color: #888;
  font-size: 10px;
  cursor: pointer;
  transition: all 0.2s;
}

.header-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.copy-btn:hover:not(:disabled) {
  border-color: #00d9ff;
  color: #00d9ff;
}

.copy-btn.copied {
  border-color: #2ecc71;
  color: #2ecc71;
}

.clear-btn:hover {
  border-color: #e74c3c;
  color: #e74c3c;
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
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
  border-left: 3px solid #00d9ff;
  font-size: 12px;
}

.message.system {
  border-left-color: #f39c12;
}

.message.error {
  border-left-color: #e74c3c;
  background: rgba(231, 76, 60, 0.1);
}

.timestamp {
  display: block;
  color: #666;
  font-size: 10px;
  font-family: monospace;
  margin-bottom: 4px;
}

.text {
  color: #ccc;
  line-height: 1.4;
}

.no-messages {
  text-align: center;
  color: #666;
  font-style: italic;
  padding: 30px 10px;
}

/* Collapsed state */
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
  color: #666;
  font-size: 11px;
  letter-spacing: 1px;
}

.badge {
  background: rgba(0, 217, 255, 0.2);
  color: #00d9ff;
  font-size: 10px;
  padding: 4px 6px;
  border-radius: 10px;
  min-width: 20px;
  text-align: center;
}

/* Scrollbar styling */
.messages-container::-webkit-scrollbar {
  width: 6px;
}

.messages-container::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.2);
}

.messages-container::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

.messages-container::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}
</style>
