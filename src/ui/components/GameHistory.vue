<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';

interface GameMessage {
  id: number;
  text: string;
  timestamp: Date;
  /**
   * The game's own classification of this line (#21), or `'action'` when the
   * game did not classify it.
   *
   * An OPEN string, not a fixed union: the taxonomy belongs to the game
   * ('notice', 'alert', 'event', 'advancement', 'shout', 'mail', ...), and this
   * component only guarantees to put it on the element so CSS can reach it.
   */
  type: string;
}

interface GameHistoryProps {
  /** Array of messages from game state */
  messages: Array<string | { text: string; type?: string }>;
}

/**
 * The class a line's type becomes. Namespaced so a game's own type name can
 * never collide with this component's layout classes, and slugified so an
 * arbitrary game-supplied string is always a usable class name.
 */
function typeClass(type: string): string {
  return `log-type-${type.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase()}`;
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
        const type = typeof msg === 'object' && msg.type ? msg.type : 'action';

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

type CopyStatus = 'idle' | 'copied' | 'failed';

const copyStatus = ref<CopyStatus>('idle');

const COPY_TITLES: Record<CopyStatus, string> = {
  idle: 'Copy log',
  copied: 'Copied!',
  failed: 'Copy failed — your browser blocked clipboard access',
};
const COPY_LABELS: Record<CopyStatus, string> = {
  idle: 'Copy entire log',
  copied: 'Log copied',
  failed: 'Copy failed — your browser blocked clipboard access',
};
const COPY_ANNOUNCE: Record<CopyStatus, string> = {
  idle: '',
  copied: 'Log copied to clipboard',
  failed: 'Copying the log failed — your browser blocked clipboard access',
};

/**
 * Copy via a hidden textarea + `document.execCommand('copy')`.
 *
 * This is tried BEFORE `navigator.clipboard`, which reads as backwards until you
 * see where this component actually runs: inside a cross-origin iframe on the
 * platform. WebKit does not implement Permissions Policy delegation for the
 * clipboard, so `allow="clipboard-write"` on the host iframe buys nothing there
 * and the async API rejects outright — "NotAllowedError: The request is not
 * allowed by the user agent or the platform in the current context". This path
 * is not permission-gated; it only needs the user gesture that just fired.
 *
 * It also has to run FIRST rather than as a catch handler: it is synchronous, so
 * it still holds the click's user activation. Awaiting the async API's rejection
 * first would resume in a microtask, where WebKit no longer considers the
 * gesture live, and the fallback would fail too.
 */
function copyViaSelection(text: string): boolean {
  if (typeof document.execCommand !== 'function') return false;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  // Off-screen but still rendered: `display:none` / `visibility:hidden` cannot
  // hold a selection, and without a selection there is nothing to copy.
  textarea.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:none;opacity:0;';
  document.body.appendChild(textarea);

  // Preserve whatever the player had selected — copying must not steal it.
  const selection = document.getSelection();
  const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  let copied = false;
  try {
    textarea.select();
    textarea.setSelectionRange(0, text.length); // iOS Safari ignores select() alone
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }

  textarea.remove();
  if (previousRange && selection) {
    selection.removeAllRanges();
    selection.addRange(previousRange);
  }
  return copied;
}

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

  // Synchronous path first (see copyViaSelection): it keeps the click's user
  // activation and is the only one WebKit allows in a cross-origin iframe.
  let copied = copyViaSelection(text);

  // Modern API as the fallback, for anywhere the selection path is unavailable
  // (a locked-down execCommand, a non-DOM host) but the permission is granted.
  if (!copied) {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch (err) {
      console.error('Failed to copy log:', err);
    }
  }

  // Always report the outcome. A silent failure is indistinguishable from a
  // dead button — which is exactly how this surfaced: the player clicked, the
  // clipboard write was refused, and nothing on screen changed.
  copyStatus.value = copied ? 'copied' : 'failed';
  setTimeout(() => {
    copyStatus.value = 'idle';
  }, 2000);
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
        :class="{ 'history-copy--failed': copyStatus === 'failed' }"
        :disabled="!hasMessages"
        :title="COPY_TITLES[copyStatus]"
        :aria-label="COPY_LABELS[copyStatus]"
        @click="copyHistory"
      >
        <svg v-if="copyStatus === 'copied'" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <!-- Copy was refused by the platform: say so rather than sit silent. -->
        <svg v-else-if="copyStatus === 'failed'" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
        </svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke-linecap="round" />
        </svg>
      </button>
      <!-- Announced to assistive tech; the icon alone is not an outcome report. -->
      <span class="sr-only" role="status" aria-live="polite">{{ COPY_ANNOUNCE[copyStatus] }}</span>
    </div>

    <!-- Messages: role=log so screen readers announce new entries as they arrive -->
    <div ref="messagesContainer" class="messages-container" role="log" aria-live="polite" aria-relevant="additions">
      <div
        v-for="msg in processedMessages"
        :key="msg.id"
        class="message"
        :class="[msg.type, typeClass(msg.type)]"
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

/* Copy was refused by the platform — colour the outcome, don't just swap glyphs. */
.history-copy--failed {
  color: var(--bsg-danger);
}

/* Screen-reader only (mirrors AutoRenderer's helper; scoped styles don't share). */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
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

/* Built-in emphasis for the few type names the shell itself understands. A
   game's own taxonomy reaches CSS through the namespaced `.log-type-<name>`
   class on the same element, so it can style its own without patching this. */
.message.error .text,
.message.log-type-error .text,
.message.log-type-alert .text {
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

.message.system .text,
.message.log-type-system .text {
  color: var(--bsg-ink);
}

.message.log-type-notice .text {
  color: var(--bsg-ink-3);
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
