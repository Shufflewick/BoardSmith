<script setup lang="ts">
/**
 * DevHost — the `boardsmith dev` main-window page. It is the local stand-in for
 * ShufflewickPub's host:
 *   - instantiates an in-process SnapshotSessionHost bound to the author's
 *     gameDefinition (via the pure `executeOp` adapter — no sandbox needed),
 *   - embeds the game UI in an <iframe> that renders GameShell in PLATFORM mode
 *     (the EXACT code production runs),
 *   - bridges the postMessage protocol (init / game_state / server_response),
 *   - exposes minimal dev chrome: player count, AI seats, game options, and a
 *     seat switcher.
 * There is no stateful in-process game server; this is the only way dev runs a game.
 */
import { ref, reactive, onMounted, onUnmounted, nextTick } from 'vue';
import { executeOp, type Op } from '../../session/index.js';
import { createDevSession, type DevSession } from './bridge.js';
import type { DevHostConfig, DevOptionDef } from './config-types.js';

const props = defineProps<{
  gameDefinition: {
    gameClass: new (...args: unknown[]) => unknown;
    gameType: string;
    minPlayers?: number;
    maxPlayers?: number;
  };
  config: DevHostConfig;
}>();

const cfg = props.config;
const def = {
  gameClass: props.gameDefinition.gameClass,
  gameType: props.gameDefinition.gameType,
  minPlayers: props.gameDefinition.minPlayers ?? cfg.minPlayers,
  maxPlayers: props.gameDefinition.maxPlayers ?? cfg.maxPlayers,
};

// ── Chrome state ────────────────────────────────────────────────────────────
const playerCount = ref(Math.min(Math.max(cfg.playerCount, def.minPlayers), def.maxPlayers));
const aiLevel = ref(cfg.aiLevel);
const aiSeatSet = reactive(new Set<number>(cfg.aiSeats));
const gameOptionValues = reactive<Record<string, unknown>>(
  Object.fromEntries(cfg.gameOptions.map((o) => [o.id, o.default])),
);
const currentSeat = ref(1);

// ── Collapsible dev chrome ──────────────────────────────────────────────────
// Keep the bar slim when you just want screen space, while the live controls
// (New game / View seat) stay reachable. Persist the choice so it sticks across
// reloads and game restarts.
const COLLAPSE_KEY = 'boardsmith:dev-chrome-collapsed';
const collapsed = ref(localStorage.getItem(COLLAPSE_KEY) === '1');
function toggleCollapsed(): void {
  collapsed.value = !collapsed.value;
  localStorage.setItem(COLLAPSE_KEY, collapsed.value ? '1' : '0');
}

// ── Session + iframe wiring ─────────────────────────────────────────────────
const iframeRef = ref<HTMLIFrameElement | null>(null);
const iframeKey = ref(0);
let session: DevSession | null = null;

function gameWindow(): Window | null {
  return iframeRef.value?.contentWindow ?? null;
}

function postToGame(message: Record<string, unknown>): void {
  const win = gameWindow();
  if (!win) return;
  // Emulate the production transport boundary. In prod the host sends views and
  // op results to the iframe as JSON (over a WebSocket); the embedded GameShell
  // receives plain JSON. postMessage's structured clone, by contrast, throws on
  // the live GameElement class instances a player view holds. Round-tripping
  // through JSON reproduces EXACTLY what prod delivers — same data, no methods,
  // no prototypes — so dev and prod hand the UI identical state.
  const payload = JSON.parse(JSON.stringify({ source: 'shufflewick', ...message }));
  win.postMessage(payload, '*');
}

/** Resolve the seat (1-indexed) that holds an exclusive option by default. */
function exclusiveDefaultSeat(rawDefault: unknown, count: number): number {
  if (count === 0) return 1;
  if (rawDefault === 'last') return count;
  if (rawDefault === 'first' || rawDefault === '' || rawDefault == null) return 1;
  const n = typeof rawDefault === 'number' ? rawDefault : Number(rawDefault);
  if (!Number.isInteger(n)) return 1;
  return Math.min(Math.max(n, 1), count);
}

/**
 * Build the per-seat playerOptions array the `start` op carries, mirroring the
 * production host's defaults: distinct palette colors per seat, the default
 * value for each non-exclusive option, and each exclusive option assigned to its
 * resolved default seat.
 */
function buildPerSeatOptions(count: number): Array<Record<string, unknown>> {
  const perSeat: Array<Record<string, unknown>> = Array.from({ length: count }, () => ({}));

  for (let i = 0; i < count; i++) {
    const color = cfg.colorPalette[i]?.value;
    if (color !== undefined) perSeat[i].color = color;
  }

  for (const opt of cfg.playerOptions) {
    if (opt.id === 'color') continue; // handled by palette above
    const firstChoice = opt.choices?.[0]?.value;
    if (opt.type === 'exclusive') {
      if (firstChoice === undefined) continue;
      const seat = exclusiveDefaultSeat(opt.default, count);
      perSeat[seat - 1][opt.id] = firstChoice;
    } else if (opt.default !== undefined) {
      for (const seatOpts of perSeat) seatOpts[opt.id] = opt.default;
    }
  }

  return perSeat;
}

function aiSeatList(): Array<{ seat: number; level?: string }> {
  return [...aiSeatSet]
    .filter((s) => s >= 1 && s <= playerCount.value)
    .sort((a, b) => a - b)
    .map((seat) => ({ seat, level: aiLevel.value }));
}

/** Build a fresh in-process session for the current chrome configuration. */
function buildSession(): DevSession {
  const count = playerCount.value;
  const startGameOptions: Record<string, unknown> = {
    playerCount: count,
    seed: String(Math.floor(Math.random() * 0xffffffff)),
    ...gameOptionValues,
    playerOptions: buildPerSeatOptions(count),
    playerIsAI: Array.from({ length: count }, (_, i) => aiSeatSet.has(i + 1)),
  };

  return createDevSession({
    playerCount: count,
    aiSeats: aiSeatList(),
    executeOp: (snapshot, pendingState, op: Op) =>
      executeOp(def, op.type === 'start' ? startGameOptions : { playerCount: count }, snapshot, pendingState, op),
    postGameState: (seat, view, meta) => {
      if (seat !== currentSeat.value) return;
      postToGame({ type: 'game_state', view, isComplete: meta.isComplete, winners: meta.winners });
    },
    postServerResponse: (seat, requestId, result) => {
      if (seat !== currentSeat.value) return;
      postToGame({ type: 'server_response', requestId, result });
    },
  });
}

const starting = ref(false);
const startError = ref<string | null>(null);

/** (Re)create the session, start the game, and reload the iframe to render it. */
async function restart(): Promise<void> {
  if (currentSeat.value > playerCount.value) currentSeat.value = 1;
  startError.value = null;
  starting.value = true;
  session = buildSession();
  iframeKey.value++; // remount the iframe → its @load posts init + current state
  try {
    await session.start();
  } catch (err) {
    startError.value = err instanceof Error ? err.message : String(err);
  } finally {
    starting.value = false;
  }
}

/** Switch which seat the iframe represents (reload so GameShell re-inits). */
function switchSeat(seat: number): void {
  if (seat === currentSeat.value) return;
  currentSeat.value = seat;
  iframeKey.value++;
}

function toggleAISeat(seat: number): void {
  if (aiSeatSet.has(seat)) aiSeatSet.delete(seat);
  else aiSeatSet.add(seat);
}

// On iframe (re)load, hand the embedded GameShell its seat + the latest state.
function onIframeLoad(): void {
  if (!session) return;
  postToGame({ type: 'init', seat: currentSeat.value });
  const view = session.viewForSeat(currentSeat.value);
  if (view) {
    const meta = session.meta();
    postToGame({ type: 'game_state', view, isComplete: meta.isComplete, winners: meta.winners });
  }
}

// Relay server_request frames from the embedded GameShell to the host.
function onMessage(event: MessageEvent): void {
  const data = event.data;
  if (!data || data.source !== 'shufflewick-game') return;
  if (data.type !== 'server_request' || !session) return;

  const requestId = typeof data.requestId === 'string' ? data.requestId : null;
  const op = typeof data.op === 'string' ? data.op : '';
  const payload = (data.payload as Record<string, unknown>) ?? {};

  // Host-chrome debug ops drive the dev host itself (the local stand-in for the
  // platform host), not the game session — restart rebuilds the game, switch-seat
  // changes which seat the iframe renders. Ack first; both may remount the iframe.
  if (op === 'debug:restart') {
    postToGame({ type: 'server_response', requestId, result: { success: true } });
    void restart();
    return;
  }
  if (op === 'debug:switch-seat') {
    postToGame({ type: 'server_response', requestId, result: { success: true } });
    const seat = Number(payload.seat);
    if (Number.isInteger(seat)) switchSeat(seat);
    return;
  }

  void session.handleServerRequest(currentSeat.value, requestId, op, payload);
}

onMounted(async () => {
  window.addEventListener('message', onMessage);
  await nextTick();
  await restart();
});

onUnmounted(() => {
  window.removeEventListener('message', onMessage);
});

function optionInputType(opt: DevOptionDef): 'number' | 'boolean' | 'select' | 'text' {
  if (opt.type === 'number') return 'number';
  if (opt.type === 'boolean') return 'boolean';
  if (opt.choices?.length) return 'select';
  return 'text';
}
</script>

<template>
  <div class="dev-host">
    <header class="dev-chrome" :class="{ 'dev-chrome--collapsed': collapsed }">
      <div class="dev-chrome__bar">
        <button
          type="button"
          class="dev-chrome__toggle"
          :aria-expanded="!collapsed"
          :title="collapsed ? 'Expand dev controls' : 'Collapse dev controls'"
          @click="toggleCollapsed"
        >
          <span
            class="dev-chrome__chevron"
            :class="{ 'dev-chrome__chevron--open': !collapsed }"
            aria-hidden="true"
            >▸</span
          >
          <strong>{{ cfg.displayName }}</strong>
          <span class="dev-chrome__badge">boardsmith dev</span>
        </button>

        <div class="dev-chrome__bar-actions">
          <button type="button" class="dev-chrome__restart" :disabled="starting" @click="restart">
            {{ starting ? 'Starting…' : 'New game' }}
          </button>

          <div class="dev-chrome__seats">
            <span class="dev-chrome__label">View seat</span>
            <button
              v-for="seat in playerCount"
              :key="`view-${seat}`"
              type="button"
              class="seat-toggle"
              :class="{ 'seat-toggle--on': currentSeat === seat }"
              @click="switchSeat(seat)"
            >
              {{ seat }}<span v-if="aiSeatSet.has(seat)" class="seat-toggle__ai">AI</span>
            </button>
          </div>
        </div>
      </div>

      <div v-show="!collapsed" class="dev-chrome__config">
        <div class="dev-chrome__row">
          <label>
            Players
            <input
              type="number"
              :min="def.minPlayers"
              :max="def.maxPlayers"
              v-model.number="playerCount"
            />
          </label>

          <div class="dev-chrome__seats">
            <span class="dev-chrome__label">AI seats</span>
            <button
              v-for="seat in playerCount"
              :key="`ai-${seat}`"
              type="button"
              class="seat-toggle"
              :class="{ 'seat-toggle--on': aiSeatSet.has(seat) }"
              @click="toggleAISeat(seat)"
            >
              {{ seat }}
            </button>
          </div>

          <label>
            AI level
            <select v-model="aiLevel">
              <option value="easy">easy</option>
              <option value="medium">medium</option>
              <option value="hard">hard</option>
              <option value="expert">expert</option>
            </select>
          </label>
        </div>

        <div v-if="cfg.gameOptions.length" class="dev-chrome__row">
          <span class="dev-chrome__label">Options</span>
          <label v-for="opt in cfg.gameOptions" :key="opt.id">
            {{ opt.label || opt.id }}
            <input
              v-if="optionInputType(opt) === 'number'"
              type="number"
              :min="opt.min"
              :max="opt.max"
              v-model.number="gameOptionValues[opt.id]"
            />
            <input
              v-else-if="optionInputType(opt) === 'boolean'"
              type="checkbox"
              v-model="gameOptionValues[opt.id]"
            />
            <select
              v-else-if="optionInputType(opt) === 'select'"
              v-model="gameOptionValues[opt.id]"
            >
              <option v-for="c in opt.choices" :key="String(c.value)" :value="c.value">
                {{ c.label || String(c.value) }}
              </option>
            </select>
            <input v-else type="text" v-model="gameOptionValues[opt.id]" />
          </label>
        </div>
      </div>

      <div v-if="startError" class="dev-chrome__error">Failed to start: {{ startError }}</div>
    </header>

    <main class="dev-host__stage">
      <iframe
        :key="iframeKey"
        ref="iframeRef"
        class="dev-host__frame"
        :src="cfg.gameUrl"
        title="BoardSmith game"
        @load="onIframeLoad"
      ></iframe>
    </main>
  </div>
</template>

<style scoped>
.dev-host {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #0f1020;
  color: #e8e8f0;
  font-family: system-ui, -apple-system, sans-serif;
}

.dev-chrome {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 16px;
  background: #1a1b33;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.dev-chrome__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.dev-chrome__toggle {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 0;
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  font-size: 1.05rem;
  cursor: pointer;
}

.dev-chrome__chevron {
  display: inline-block;
  font-size: 0.8rem;
  color: #9aa;
  transition: transform 0.15s ease;
}

.dev-chrome__chevron--open {
  transform: rotate(90deg);
}

.dev-chrome__bar-actions {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.dev-chrome__config {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dev-chrome__badge {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(0, 217, 255, 0.15);
  color: #00d9ff;
}

.dev-chrome__row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.dev-chrome__label {
  font-size: 0.8rem;
  color: #9aa;
}

.dev-chrome label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  color: #ccd;
}

.dev-chrome input[type='number'] {
  width: 56px;
}

.dev-chrome input,
.dev-chrome select {
  background: #0f1020;
  color: #e8e8f0;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  padding: 3px 6px;
}

.dev-chrome__seats {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.seat-toggle {
  position: relative;
  min-width: 30px;
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: #0f1020;
  color: #ccd;
  cursor: pointer;
}

.seat-toggle--on {
  background: #00d9ff;
  color: #021;
  border-color: #00d9ff;
}

.seat-toggle__ai {
  font-size: 0.55rem;
  margin-left: 3px;
  vertical-align: super;
  opacity: 0.8;
}

.dev-chrome__restart {
  padding: 6px 14px;
  border-radius: 6px;
  border: none;
  background: #2ecc71;
  color: #021;
  font-weight: 600;
  cursor: pointer;
}

.dev-chrome__restart:disabled {
  opacity: 0.6;
  cursor: default;
}

.dev-chrome__error {
  color: #ff6b6b;
  font-size: 0.85rem;
}

.dev-host__stage {
  flex: 1 1 auto;
  min-height: 0;
}

.dev-host__frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}
</style>
