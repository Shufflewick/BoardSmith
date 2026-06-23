<script setup lang="ts">
/**
 * DevHost — the `boardsmith dev` main-window page. It is a WebSocket CLIENT of
 * the Node-side host (the local stand-in for ShufflewickPub's game Durable
 * Object), which owns the authoritative SnapshotSessionHost in the CLI process.
 *
 * Every browser that opens this page is a real player: it connects over WS,
 * claims a seat in the seat-picker lobby, then renders its seat via the embedded
 * GameShell <iframe> in PLATFORM mode (the EXACT code production runs). This page
 * just bridges the WS transport to the iframe's postMessage protocol — so dev is
 * inherently multiplayer (open another browser / another computer to join).
 */
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { DevHostConfig } from './config-types.js';

const props = defineProps<{ config: DevHostConfig }>();
const cfg = props.config;

// ── Persistent client identity (so a reload reclaims the same seat) ──────────
const CLIENT_KEY = 'boardsmith:dev-client-id';
function loadClientId(): string {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) {
    id = `c-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}
const clientId = loadClientId();

// ── Lobby / game state (driven by the host over WS) ──────────────────────────
interface SeatInfo {
  seat: number;
  clientId: string | null;
  name: string;
  color?: string;
  connected: boolean;
}
// The game is always live on the host: this client is in the game once it holds a
// seat (mySeat). The first client to connect is auto-seated by the host and lands
// straight in the game; later clients arrive unseated and see the seat-picker.
const connected = ref(false);
const seats = ref<SeatInfo[]>([]);
const mySeat = ref<number | null>(null);
const errorMsg = ref<string | null>(null);
const followActive = ref(false);
// Dev-only UI switcher: the list of UIs the game offers (sent by GameShell) and
// the currently-selected one. Handled inside GameShell; no effect in production.
const uiOptions = ref<string[]>([]);
const selectedUi = ref('');

const nameInput = ref('');
const colorInput = ref<string | undefined>(undefined);

/** Seats this client may take: open, or held by an away (disconnected) player. */
function canTake(seat: SeatInfo): boolean {
  return !(seat.clientId && seat.connected);
}
const takenColors = computed(
  () => new Set(seats.value.filter((s) => s.color).map((s) => s.color as string)),
);

// ── WebSocket transport to the Node host ─────────────────────────────────────
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let closedByUs = false;
// Cache the latest init/state so a (re)mounted iframe can be re-fed on @load.
let lastInitSeat: number | null = null;
let lastGameState: Record<string, unknown> | null = null;

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/__boardsmith/ws`;
}

function wsSend(message: Record<string, unknown>): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function connect(): void {
  ws = new WebSocket(wsUrl());
  ws.addEventListener('open', () => wsSend({ type: 'hello', clientId }));
  ws.addEventListener('message', (ev) => {
    try {
      onHostMessage(JSON.parse(ev.data as string));
    } catch {
      /* ignore malformed frames */
    }
  });
  ws.addEventListener('close', () => {
    if (closedByUs) return;
    connected.value = false;
    reconnectTimer = setTimeout(connect, 1000);
  });
}

function onHostMessage(msg: Record<string, unknown>): void {
  connected.value = true;
  switch (msg.type) {
    case 'lobby': {
      seats.value = msg.seats as SeatInfo[];
      const mine = (msg.seats as SeatInfo[]).find((s) => s.clientId === clientId);
      // Don't clear an already-known seat from a lobby broadcast (init is authoritative).
      if (mine) mySeat.value = mine.seat;
      break;
    }
    case 'joined':
      mySeat.value = msg.seat as number;
      errorMsg.value = null;
      break;
    case 'error':
      errorMsg.value = msg.message as string;
      break;
    case 'init':
      lastInitSeat = msg.seat as number;
      mySeat.value = msg.seat as number;
      postToGame({ type: 'init', seat: msg.seat });
      break;
    case 'game_state':
      lastGameState = {
        type: 'game_state',
        view: msg.view,
        isComplete: msg.isComplete,
        winners: msg.winners,
      };
      postToGame(lastGameState);
      break;
    case 'server_response':
      postToGame({ type: 'server_response', requestId: msg.requestId, result: msg.result });
      break;
    case 'follow':
      followActive.value = msg.enabled as boolean;
      break;
  }
}

// ── Iframe bridge (WS ↔ postMessage), identical contract to production ────────
const iframeRef = ref<HTMLIFrameElement | null>(null);

function postToGame(message: Record<string, unknown>): void {
  const win = iframeRef.value?.contentWindow;
  if (!win) return;
  // JSON round-trip reproduces exactly what prod delivers over the wire (plain
  // data, no class instances) — structured clone would throw on live elements.
  const payload = JSON.parse(JSON.stringify({ source: 'shufflewick', ...message }));
  win.postMessage(payload, '*');
}

function onIframeLoad(): void {
  if (lastInitSeat != null) postToGame({ type: 'init', seat: lastInitSeat });
  if (lastGameState) postToGame(lastGameState);
  // Re-request the UI list and re-assert the selection so a (re)mounted game
  // iframe rebuilds the dropdown and keeps the chosen view.
  postToGame({ type: 'dev-ui-list-request' });
  if (selectedUi.value) postToGame({ type: 'dev-ui-select', name: selectedUi.value });
}

function onWindowMessage(event: MessageEvent): void {
  const data = event.data;
  if (!data || data.source !== 'shufflewick-game') return;
  if (data.type === 'server_request') {
    wsSend({
      type: 'server_request',
      requestId: data.requestId,
      op: data.op,
      payload: data.payload ?? {},
    });
    return;
  }
  // The game advertises its available UIs; populate the switcher dropdown.
  if (data.type === 'dev-ui-list' && Array.isArray(data.uis)) {
    // If the iframe is running a different game than this outer page was built
    // for, the page is stale (dev server restarted with another game on the same
    // port). The chrome would show the old game's identity wrapping the new game.
    // Force a full reload so the whole page reflects the running game.
    if (data.gameType && cfg.gameType && data.gameType !== cfg.gameType) {
      window.location.reload();
      return;
    }
    uiOptions.value = data.uis as string[];
    // Keep the current selection if still offered; otherwise default to the first
    // and tell the game, so the host dropdown and GameShell's internal selection
    // can't silently diverge (host shows A while the game still renders B).
    if (!uiOptions.value.includes(selectedUi.value)) {
      selectedUi.value = uiOptions.value[0] ?? '';
      postToGame({ type: 'dev-ui-select', name: selectedUi.value });
    }
  }
}

// ── Lobby actions ────────────────────────────────────────────────────────────
function takeSeat(seat: number): void {
  errorMsg.value = null;
  wsSend({ type: 'join', seat, name: nameInput.value.trim() || undefined, color: colorInput.value });
}
function leaveSeat(): void {
  wsSend({ type: 'leave' });
  mySeat.value = null;
}
function newGame(): void {
  wsSend({ type: 'restart' });
}
function toggleFollow(): void {
  wsSend({ type: 'follow', enabled: !followActive.value });
}
function onUiSelect(): void {
  postToGame({ type: 'dev-ui-select', name: selectedUi.value });
}

function seatLabel(seat: SeatInfo): string {
  if (!seat.clientId) return 'Open';
  return seat.name + (seat.connected ? '' : ' (away)');
}

onMounted(() => {
  window.addEventListener('message', onWindowMessage);
  connect();
});

onUnmounted(() => {
  window.removeEventListener('message', onWindowMessage);
  closedByUs = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ws?.close();
});
</script>

<template>
  <div class="dev-host">
    <!-- Connecting -->
    <div v-if="!connected" class="dev-host__center">
      <p>Connecting to the dev host…</p>
    </div>

    <!-- Seat-picker — only additional players see this; the dev is auto-seated. -->
    <div v-else-if="mySeat === null" class="dev-host__center">
      <div class="lobby">
        <header class="lobby__head">
          <strong>{{ cfg.displayName }}</strong>
          <span class="dev-chrome__badge">join · pick a seat</span>
        </header>

        <p class="lobby__hint">
          This game is in progress — pick an open seat to join. Open seats are played by AI
          until someone takes them.
        </p>

        <div class="lobby__seats">
          <div
            v-for="seat in seats"
            :key="seat.seat"
            class="seat-card"
            :class="{ 'seat-card--mine': seat.seat === mySeat, 'seat-card--open': canTake(seat) }"
          >
            <span class="seat-card__num">Seat {{ seat.seat }}</span>
            <span
              v-if="seat.color"
              class="seat-card__swatch"
              :style="{ background: seat.color }"
            ></span>
            <span class="seat-card__name">{{ seatLabel(seat) }}</span>
            <span
              v-if="seat.clientId"
              class="seat-card__dot"
              :class="seat.connected ? 'is-online' : 'is-offline'"
            ></span>
            <button
              v-if="canTake(seat)"
              type="button"
              class="btn"
              @click="takeSeat(seat.seat)"
            >
              Take seat
            </button>
          </div>
        </div>

        <div class="lobby__claim">
          <label>
            Name
            <input v-model="nameInput" type="text" placeholder="optional" />
          </label>
          <div v-if="cfg.colorPalette.length" class="lobby__colors">
            <span class="dev-chrome__label">Color</span>
            <button
              v-for="c in cfg.colorPalette"
              :key="c.value"
              type="button"
              class="color-swatch"
              :class="{
                'color-swatch--on': colorInput === c.value,
                'color-swatch--taken': takenColors.has(c.value) && colorInput !== c.value,
              }"
              :style="{ background: c.value }"
              :title="c.label"
              :aria-label="c.label"
              :aria-pressed="colorInput === c.value"
              @click="colorInput = c.value"
            ></button>
          </div>
        </div>

        <div v-if="errorMsg" class="dev-chrome__error">{{ errorMsg }}</div>
      </div>
    </div>

    <!-- In game -->
    <template v-else>
      <header class="dev-chrome">
        <div class="dev-chrome__bar">
          <div class="dev-chrome__toggle">
            <strong>{{ cfg.displayName }}</strong>
            <span class="dev-chrome__badge">seat {{ mySeat }}</span>
          </div>
          <div class="dev-chrome__bar-actions">
            <label
              v-if="uiOptions.length > 1"
              class="dev-chrome__ui-switch"
              title="Dev only — switch which UI renders this game. Production builds ship the chosen UI only."
            >
              <span class="dev-chrome__label">UI</span>
              <select v-model="selectedUi" class="dev-chrome__select" @change="onUiSelect">
                <option v-for="name in uiOptions" :key="name" :value="name">{{ name }}</option>
              </select>
            </label>
            <button
              type="button"
              class="btn"
              :class="{ 'btn--on': followActive }"
              :aria-pressed="followActive"
              @click="toggleFollow"
            >
              {{ followActive ? 'Following active seat' : 'Follow active seat' }}
            </button>
            <button type="button" class="btn btn--start" @click="newGame">New game</button>
          </div>
        </div>
        <div v-if="errorMsg" class="dev-chrome__error">{{ errorMsg }}</div>
      </header>

      <main class="dev-host__stage">
        <iframe
          ref="iframeRef"
          class="dev-host__frame"
          :src="cfg.gameUrl"
          title="BoardSmith game"
          @load="onIframeLoad"
        ></iframe>
      </main>
    </template>
  </div>
</template>

<style scoped>
.dev-host {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  background: var(--bsg-bg);
  color: var(--bsg-ink);
  font-family: system-ui, -apple-system, sans-serif;
}

.dev-host__center {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

/* ── Lobby ── */
.lobby {
  width: 100%;
  max-width: 520px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  background: var(--bsg-surface);
  border: 1px solid var(--bsg-line);
  border-radius: 12px;
}

.lobby__head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.15rem;
}

.lobby__hint {
  font-size: 0.85rem;
  color: var(--bsg-ink-3);
  line-height: 1.4;
}

.lobby__seats {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.seat-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--bsg-line-2);
  background: var(--bsg-bg);
}

.seat-card--mine {
  border-color: var(--bsg-accent-2);
}

.seat-card__num {
  font-size: 0.8rem;
  color: var(--bsg-ink-3);
  min-width: 54px;
}

.seat-card__swatch {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1px solid var(--bsg-line-2);
}

.seat-card__name {
  flex: 1 1 auto;
  font-size: 0.9rem;
}

.seat-card--open .seat-card__name {
  color: var(--bsg-ink-3);
  font-style: italic;
}

.seat-card__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.seat-card__dot.is-online {
  background: var(--bsg-ok);
}

.seat-card__dot.is-offline {
  background: var(--bsg-away);
}

.lobby__claim {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.lobby__colors {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.color-swatch {
  min-width: 24px;
  min-height: 24px;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: 2px solid transparent;
  cursor: pointer;
}

.color-swatch--on {
  border-color: var(--bsg-ink);
}

.color-swatch--taken {
  opacity: 0.4;
}

/* ── Buttons ── */
.btn {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid var(--bsg-line-2);
  background: var(--bsg-bg);
  color: var(--bsg-ink);
  cursor: pointer;
}

.btn--start {
  border: 1px solid var(--bsg-line-2);
  background: transparent;
  color: var(--bsg-ink-2);
}

.btn--start:hover {
  background: var(--bsg-field);
  border-color: var(--bsg-line-2);
}

.btn--start:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn--on {
  border-color: var(--bsg-accent);
  background: color-mix(in srgb, var(--bsg-accent) 15%, transparent);
  color: var(--bsg-accent-2);
}

/* ── In-game chrome ── */
.dev-chrome {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 16px;
  background: var(--bsg-surface);
  border-bottom: 1px solid var(--bsg-line);
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
  font-size: 1.05rem;
}

.dev-chrome__bar-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.dev-chrome__badge {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 2px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--bsg-accent) 15%, transparent);
  color: var(--bsg-accent-2);
}

.dev-chrome__label {
  font-size: 0.8rem;
  color: var(--bsg-ink-3);
}

.dev-chrome__ui-switch {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dev-chrome__select {
  background: var(--bsg-surface);
  color: var(--bsg-ink);
  border: 1px solid var(--bsg-line-2);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 0.85rem;
  cursor: pointer;
}

.dev-chrome__select:hover {
  border-color: var(--bsg-accent);
}

.dev-chrome input {
  background: var(--bsg-field);
  color: var(--bsg-ink);
  border: 1px solid var(--bsg-line-2);
  border-radius: 4px;
  padding: 4px 8px;
}

.lobby__claim input {
  background: var(--bsg-field);
  color: var(--bsg-ink);
  border: 1px solid var(--bsg-line-2);
  border-radius: 4px;
  padding: 4px 8px;
  margin-left: 6px;
}

.dev-chrome__error {
  color: var(--bsg-danger);
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
