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
// Dev-only UI switcher: peek the built-in auto-UI against the game's chosen UI
// (handled inside GameShell, gated to dev builds; no effect in production).
const showAutoUi = ref(false);

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
  // Re-assert the UI mode so a (re)mounted game iframe keeps the chosen view.
  if (showAutoUi.value) postToGame({ type: 'dev-ui-mode', mode: 'auto' });
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
function toggleAutoUi(): void {
  showAutoUi.value = !showAutoUi.value;
  postToGame({ type: 'dev-ui-mode', mode: showAutoUi.value ? 'auto' : 'custom' });
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
            <button
              type="button"
              class="btn"
              :class="{ 'btn--on': showAutoUi }"
              :aria-pressed="showAutoUi"
              title="Dev only — peek the built-in auto-UI against this game's UI. Production builds ship the chosen UI only."
              @click="toggleAutoUi"
            >
              {{ showAutoUi ? 'Showing auto-UI' : 'Show auto-UI' }}
            </button>
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
  background: #0f1020;
  color: #e8e8f0;
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
  background: #1a1b33;
  border: 1px solid rgba(255, 255, 255, 0.08);
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
  color: #9aa;
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
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: #0f1020;
}

.seat-card--mine {
  border-color: #00d9ff;
}

.seat-card__num {
  font-size: 0.8rem;
  color: #9aa;
  min-width: 54px;
}

.seat-card__swatch {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.seat-card__name {
  flex: 1 1 auto;
  font-size: 0.9rem;
}

.seat-card--open .seat-card__name {
  color: #778;
  font-style: italic;
}

.seat-card__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.seat-card__dot.is-online {
  background: #2ecc71;
}

.seat-card__dot.is-offline {
  background: #888;
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
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: 2px solid transparent;
  cursor: pointer;
}

.color-swatch--on {
  border-color: #fff;
}

.color-swatch--taken {
  opacity: 0.4;
}

/* ── Buttons ── */
.btn {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: #0f1020;
  color: #e8e8f0;
  cursor: pointer;
}

.btn--start {
  border: none;
  background: #2ecc71;
  color: #021;
  font-weight: 600;
}

.btn--start:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn--on {
  border-color: #00d9ff;
  background: rgba(0, 217, 255, 0.15);
  color: #00d9ff;
}

/* ── In-game chrome ── */
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
  background: rgba(0, 217, 255, 0.15);
  color: #00d9ff;
}

.dev-chrome__label {
  font-size: 0.8rem;
  color: #9aa;
}

.dev-chrome input {
  background: #0f1020;
  color: #e8e8f0;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  padding: 4px 8px;
}

.lobby__claim input {
  background: #0f1020;
  color: #e8e8f0;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  padding: 4px 8px;
  margin-left: 6px;
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
