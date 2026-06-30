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
import Toast from '../../ui/components/Toast.vue';
import { useToast } from '../../ui/composables/useToast.js';
import { applyTheme } from '../../ui/theme.js';

const props = defineProps<{ config: DevHostConfig }>();
const cfg = props.config;

// The dev chrome is a single always-visible thin bar (no collapse) — everything
// fits on the one "Dev" line; overflow goes to the … menu on narrow screens.

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

// ── Destructive restart confirm (DEV-07) ──────────────────────────────────────
const toast = useToast();
/** True while the "Confirm restart?" prompt is showing (first click armed it). */
const restartConfirming = ref(false);
let restartConfirmTimer: ReturnType<typeof setTimeout> | null = null;
/** Set to true by newGame() before sending restart; cleared when game_state arrives. */
const pendingRestart = ref(false);

/**
 * Two-click guard for the destructive "New game" action (CLAUDE.md:
 * always_confirm_destructive). First click arms a 5-second confirm window;
 * second click within the window executes the restart. The window auto-cancels
 * after 5 s so an accidental first click does no harm.
 */
function handleNewGameClick(): void {
  if (!restartConfirming.value) {
    restartConfirming.value = true;
    restartConfirmTimer = setTimeout(() => {
      restartConfirming.value = false;
      restartConfirmTimer = null;
    }, 5000);
  } else {
    if (restartConfirmTimer !== null) {
      clearTimeout(restartConfirmTimer);
      restartConfirmTimer = null;
    }
    restartConfirming.value = false;
    newGame();
  }
}

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
      postToGame({ type: 'init', seat: msg.seat, teachingDisabled: cfg.teachingDisabled === true });
      break;
    case 'game_state':
      lastGameState = {
        type: 'game_state',
        view: msg.view,
        isComplete: msg.isComplete,
        winners: msg.winners,
      };
      postToGame(lastGameState);
      if (pendingRestart.value) {
        pendingRestart.value = false;
        toast.info('Game restarted');
      }
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

// Dev heartbeat: production hosts send a periodic {source,type:'heartbeat'} so the
// game's connection-health dot reads 'connected' (and hides). The dev host must do
// the same, otherwise the dot is stuck on 'connecting' forever and reads as a mystery
// speck over the board. Interval (3s) stays well under the game's 10s stale timeout.
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function onIframeLoad(): void {
  postToGame({ type: 'heartbeat' });
  if (heartbeatTimer === null) {
    heartbeatTimer = setInterval(() => postToGame({ type: 'heartbeat' }), 3000);
  }
  if (lastInitSeat != null) postToGame({ type: 'init', seat: lastInitSeat, teachingDisabled: cfg.teachingDisabled === true });
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
  // Retry: GameShell's AutoUI retry button asks the host to re-send the
  // last cached state so the iframe can recover without a full reload.
  if (data.type === 'request-state') {
    if (lastInitSeat != null) postToGame({ type: 'init', seat: lastInitSeat, teachingDisabled: cfg.teachingDisabled === true });
    if (lastGameState) postToGame(lastGameState);
    return;
  }
  // The game's DebugPanel reports its open state (toggled here, via its ✕, or
  // Ctrl/Cmd+D inside the iframe) so the header Debug button stays in sync.
  if (data.type === 'dev-debug-state') {
    debugOpen.value = !!data.open;
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
  pendingRestart.value = true;
  wsSend({ type: 'restart' });
}
function toggleFollow(): void {
  wsSend({ type: 'follow', enabled: !followActive.value });
}
function onUiSelect(): void {
  postToGame({ type: 'dev-ui-select', name: selectedUi.value });
}

function seatLabel(seat: SeatInfo): string {
  if (!seat.clientId) return `Seat ${seat.seat}`;
  return seat.name + (seat.connected ? '' : ' (away)');
}

// ── Seat switcher ─────────────────────────────────────────────────────────────
const seatSwitcherOpen = ref(false);
const seatSwitcherRef = ref<HTMLElement | null>(null);

// ── Table setup panel (read-only config display — DEV-04) ─────────────────────
const tableSetupOpen = ref(false);

// ── Debug panel toggle: the DebugPanel lives inside the game iframe, but its
// trigger belongs in the Dev header so all dev controls are together. We post a
// toggle to the iframe and mirror the panel's reported open state for the button.
const debugOpen = ref(false);
function toggleDebug(): void {
  postToGame({ type: 'dev-debug-toggle' });
}

// ── Dismissal: Escape key closes both disclosure widgets; document click
// closes the seat switcher when clicking outside its container (WR-02).
function handleChromeKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  seatSwitcherOpen.value = false;
  tableSetupOpen.value = false;
}

function handleChromeClick(e: MouseEvent) {
  if (
    seatSwitcherOpen.value &&
    seatSwitcherRef.value &&
    !seatSwitcherRef.value.contains(e.target as Node)
  ) {
    seatSwitcherOpen.value = false;
  }
}

/** Resolve the display label for an option's default value. */
function optionDefaultLabel(opt: { default?: unknown; choices?: Array<{ value: unknown; label?: string }> }): string {
  if (opt.default === undefined || opt.default === null) return '—';
  if (opt.choices) {
    const match = opt.choices.find((c) => c.value === opt.default);
    if (match) return match.label ?? String(match.value);
  }
  return String(opt.default);
}

/**
 * Switch to a different seat: send follow-disable if follow is active, then
 * leave the current seat and take the target. The host (multiplayer-host.ts)
 * is authoritative — it will reject taking a seat held by a connected client,
 * so canTake() here is a courtesy guard only.
 *
 * Follow auto-disable on manual switch: if the dev is following the active
 * seat and manually picks a new seat, following no longer makes sense (they
 * have a specific seat they want to be in). We disable it automatically so the
 * dev is not surprised by immediate seat jumping after the switch.
 */
function switchSeat(target: number): void {
  if (target === mySeat.value) return;
  const targetInfo = seats.value.find((s) => s.seat === target);
  if (targetInfo && !canTake(targetInfo)) return;

  // Auto-disable follow when manually switching seats
  if (followActive.value) {
    wsSend({ type: 'follow', enabled: false });
  }

  leaveSeat();
  takeSeat(target);
}

onMounted(() => {
  // Install the Slate --bsg-* token stylesheet on THIS (dev-host) document.
  // The game runs in a platform-mode iframe that calls applyTheme itself, but the
  // outer dev page needs the tokens too — otherwise every var(--bsg-*) resolves to
  // nothing and the dev chrome falls back to an unstyled white page.
  applyTheme();
  window.addEventListener('message', onWindowMessage);
  document.addEventListener('keydown', handleChromeKeydown);
  document.addEventListener('click', handleChromeClick);
  connect();
});

onUnmounted(() => {
  window.removeEventListener('message', onWindowMessage);
  document.removeEventListener('keydown', handleChromeKeydown);
  document.removeEventListener('click', handleChromeClick);
  closedByUs = true;
  if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (restartConfirmTimer !== null) clearTimeout(restartConfirmTimer);
  ws?.close();
});
</script>

<template>
  <div class="dev-host">
    <!-- Toast notifications (Teleports to body; must live here since DevHost is the outer page) -->
    <Toast />

    <!-- Decorative Slate material layers: fixed, pointer-events:none, behind all content -->
    <!-- DEV-08: low-opacity SVG fractalNoise grain replaces bare flat background -->
    <div class="dev-grain" aria-hidden="true"></div>
    <!-- DEV-08: radial vignette darkens edges so the board iframe remains the hero -->
    <div class="dev-vignette" aria-hidden="true"></div>

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
              :aria-label="`Take seat ${seat.seat}`"
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
        <!-- Single thin bar: everything lives on the one "Dev" line; controls that
             don't fit on narrow screens collapse into the … overflow menu. -->
        <div class="dev-chrome__bar">
          <span class="dev-chrome__brand">Dev</span>
          <div class="dev-chrome__toggle">
            <!-- Seat switcher: click to open a menu listing all seats -->
            <div class="dev-chrome__seat-switcher" ref="seatSwitcherRef">
              <button
                type="button"
                class="dev-chrome__badge dev-chrome__badge--btn"
                aria-haspopup="true"
                :aria-expanded="seatSwitcherOpen"
                @click="seatSwitcherOpen = !seatSwitcherOpen"
              >
                {{ followActive ? 'Following' : `Seat ${mySeat}` }} ▾
              </button>
              <div v-if="seatSwitcherOpen" class="seat-switcher-menu">
                <!-- Follow active seat: first option in the seat selector -->
                <button
                  type="button"
                  class="seat-switcher-menu__item"
                  :class="{ 'seat-switcher-menu__item--current': followActive }"
                  @click="seatSwitcherOpen = false; toggleFollow()"
                >
                  <span class="dev-chrome__btn-icon" aria-hidden="true">{{ followActive ? '◉' : '○' }}</span>
                  Follow active seat
                </button>
                <div class="seat-switcher-menu__sep"></div>
                <button
                  v-for="seat in seats"
                  :key="seat.seat"
                  type="button"
                  class="seat-switcher-menu__item"
                  :class="{
                    'seat-switcher-menu__item--current': seat.seat === mySeat,
                    'seat-switcher-menu__item--disabled': !canTake(seat) && seat.seat !== mySeat,
                  }"
                  :disabled="!canTake(seat) && seat.seat !== mySeat"
                  @click="seatSwitcherOpen = false; switchSeat(seat.seat)"
                >
                  <span class="seat-switcher-menu__dot"
                    :class="seat.connected ? 'is-online' : 'is-offline'"
                  ></span>
                  {{ seat.name || `Seat ${seat.seat}` }}
                  <span v-if="cfg.aiSeats.includes(seat.seat)" class="seat-switcher-menu__ai">AI</span>
                  <span v-if="seat.seat === mySeat" class="seat-switcher-menu__current-label"> (you)</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Player list + turn live in the game's own players panel; the seat
               selector (with per-seat connection dots) covers dev presence, so no
               separate presence strip here. -->
          <div class="dev-chrome__bar-actions">
            <!-- Primary controls (always visible in bar) -->
            <label
              v-if="uiOptions.length > 1"
              class="dev-chrome__ui-switch"
              title="Dev only — switch which UI renders this game. Production builds ship the chosen UI only."
            >
              <span class="dev-chrome__label dev-chrome__label--icon-only" aria-hidden="true">UI</span>
              <select v-model="selectedUi" class="dev-chrome__select" @change="onUiSelect">
                <option v-for="name in uiOptions" :key="name" :value="name">{{ name }}</option>
              </select>
            </label>
            <!-- Secondary controls — always visible on wide screens; overflow to … on narrow -->
            <details class="dev-chrome__overflow">
              <summary class="dev-chrome__overflow-trigger btn" aria-label="More dev controls">…</summary>
              <div class="dev-chrome__overflow-menu">
                <button
                  type="button"
                  class="btn btn--start"
                  :class="{ 'btn--confirming': restartConfirming }"
                  @click="handleNewGameClick"
                >
                  <span class="dev-chrome__btn-icon" aria-hidden="true">↺</span>
                  <span class="dev-chrome__btn-label">{{ restartConfirming ? 'Confirm restart?' : 'New game' }}</span>
                </button>
                <button
                  type="button"
                  class="btn"
                  :class="{ 'btn--on': tableSetupOpen }"
                  :aria-expanded="tableSetupOpen"
                  @click="tableSetupOpen = !tableSetupOpen"
                >
                  <span class="dev-chrome__btn-icon" aria-hidden="true">⚙</span>
                  <span class="dev-chrome__btn-label">Table setup</span>
                </button>
                <button
                  type="button"
                  class="btn"
                  :class="{ 'btn--on': debugOpen }"
                  :aria-pressed="debugOpen"
                  @click="toggleDebug"
                >
                  <span class="dev-chrome__btn-icon" aria-hidden="true">⟨⟩</span>
                  <span class="dev-chrome__btn-label">Debug</span>
                </button>
              </div>
            </details>
            <!-- Wide-screen inline controls (hidden at narrow via CSS) -->
            <div class="dev-chrome__bar-wide">
              <button
                type="button"
                class="btn btn--start"
                :class="{ 'btn--confirming': restartConfirming }"
                @click="handleNewGameClick"
              >{{ restartConfirming ? 'Confirm restart?' : 'New game' }}</button>
              <button
                type="button"
                class="btn"
                :class="{ 'btn--on': tableSetupOpen }"
                :aria-expanded="tableSetupOpen"
                @click="tableSetupOpen = !tableSetupOpen"
              >
                Table setup
              </button>
              <button
                type="button"
                class="btn"
                :class="{ 'btn--on': debugOpen }"
                :aria-pressed="debugOpen"
                @click="toggleDebug"
              >
                Debug
              </button>
            </div>
          </div>
        </div>
        <!-- Table setup panel — read-only summary of injected config (DEV-04) -->
        <div v-if="tableSetupOpen" class="table-setup">
          <dl class="table-setup__dl">
            <div class="table-setup__row">
              <dt>Players</dt>
              <dd>{{ cfg.playerCount }}</dd>
            </div>
            <div class="table-setup__row">
              <dt>AI seats</dt>
              <dd>{{ cfg.aiSeats.length ? cfg.aiSeats.join(', ') : 'none' }}</dd>
            </div>
            <div class="table-setup__row">
              <dt>AI level</dt>
              <dd>{{ cfg.aiLevel || '—' }}</dd>
            </div>
            <template v-if="cfg.gameOptions.length">
              <div class="table-setup__group-header">Game options</div>
              <div
                v-for="opt in cfg.gameOptions"
                :key="opt.id"
                class="table-setup__row"
              >
                <dt>{{ opt.label || opt.id }}</dt>
                <dd>{{ optionDefaultLabel(opt) }}</dd>
              </div>
            </template>
            <template v-if="cfg.playerOptions.length">
              <div class="table-setup__group-header">Player options</div>
              <div
                v-for="opt in cfg.playerOptions"
                :key="opt.id"
                class="table-setup__row"
              >
                <dt>{{ opt.label || opt.id }}</dt>
                <dd>{{ optionDefaultLabel(opt) }}</dd>
              </div>
            </template>
          </dl>
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

/* ── Slate material layer (DEV-08) ── */
/*
 * Both layers are position:fixed so they cover the viewport regardless of
 * content height and do NOT scroll with page content. pointer-events:none
 * ensures they never intercept clicks. z-index 0/1 keeps them behind the
 * flex children (which get z-index:2 via position:relative on their wrappers).
 *
 * No background-attachment:fixed (causes compositing jank on mobile).
 * No rgba/hex literals — color-mix with --bsg-bg for theme-awareness.
 */

/* Low-opacity SVG fractalNoise grain — neutral/graphite, not warm-tinted */
.dev-grain {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: 0.07;
  /* URL-encoded SVG feTurbulence fractalNoise (# → %23, < → %3C, > → %3E) */
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E");
  background-repeat: repeat;
  background-size: 200px 200px;
}

/* Radial vignette: transparent center → token-mixed edge (no raw hex) */
.dev-vignette {
  position: fixed;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background-image: radial-gradient(
    ellipse at center,
    transparent 35%,
    color-mix(in srgb, var(--bsg-bg) 70%, transparent) 100%
  );
}

/* ── Content stacking above decorative layers ── */
/* All direct-content wrappers get position:relative + z-index:2 to sit above
   the fixed grain/vignette layers (z-index 0 and 1). */
.dev-host__center {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  position: relative;
  z-index: 2;
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

/* Thin buttons inside the single-line dev chrome bar (keep the whole bar slim). */
.dev-chrome__bar .btn {
  padding: 3px 10px;
  font-size: 0.78rem;
  line-height: 1.3;
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

/* Confirm state: subtle danger tint — no accent CTA fill (CLAUDE.md: always_confirm_destructive) */
.btn--start.btn--confirming {
  border-color: color-mix(in srgb, var(--bsg-danger) 60%, transparent);
  color: var(--bsg-danger);
}

.btn--start.btn--confirming:hover {
  background: color-mix(in srgb, var(--bsg-danger) 10%, transparent);
}

.btn--on {
  border-color: var(--bsg-accent);
  background: color-mix(in srgb, var(--bsg-accent) 15%, transparent);
  color: var(--bsg-accent-2);
}

/* ── Focus ring (outer page — does not inherit GameShell's non-scoped rule) ── */
:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--bsg-bg), 0 0 0 4px var(--bsg-accent);
  border-radius: var(--bsg-r-sm, 4px);
}

/* ── In-game chrome ── */
.dev-chrome {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  background: var(--bsg-surface);
  border-bottom: 1px solid var(--bsg-line);
  position: relative;
  /* Above .dev-host__stage (z-index 2) so the chrome's dropdowns (seat switcher,
     overflow menu) paint OVER the game iframe instead of being clipped behind it. */
  z-index: 30;
}

/* "Dev" wordmark at the start of the bar (replaces the old pull-tab). */
.dev-chrome__brand {
  flex: none;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--bsg-ink-3);
}

/* ── Overflow menu (… button + dropdown for secondary controls) ── */
.dev-chrome__overflow {
  position: relative;
  display: none; /* hidden on wide screens — wide controls used instead */
}

.dev-chrome__overflow-trigger {
  list-style: none;
  cursor: pointer;
}

.dev-chrome__overflow-trigger::-webkit-details-marker {
  display: none;
}

.dev-chrome__overflow-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  background: var(--bsg-surface);
  border: 1px solid var(--bsg-line);
  border-radius: 6px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 10;
  min-width: 200px;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--bsg-bg) 60%, transparent);
}

.dev-chrome__bar-wide {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* One thin line: brand + seat on the left, actions pushed to the right. No wrap —
   anything that doesn't fit collapses into the … overflow on narrow screens. */
.dev-chrome__bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: nowrap;
  padding: 4px 12px;
  min-height: 34px;
}

.dev-chrome__toggle {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.dev-chrome__bar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
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
  padding: 2px 6px;
  font-size: 0.78rem;
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
  position: relative;
  z-index: 2;
}

.dev-host__frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}

/* ── Seat switcher ── */
.dev-chrome__seat-switcher {
  position: relative;
}

.dev-chrome__badge--btn {
  background: color-mix(in srgb, var(--bsg-accent) 15%, transparent);
  color: var(--bsg-accent-2);
  border: 1px solid color-mix(in srgb, var(--bsg-accent) 30%, transparent);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: pointer;
}

.dev-chrome__badge--btn:hover {
  background: color-mix(in srgb, var(--bsg-accent) 25%, transparent);
}

.seat-switcher-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  background: var(--bsg-surface);
  border: 1px solid var(--bsg-line);
  border-radius: 6px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 20;
  min-width: 160px;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--bsg-bg) 50%, transparent);
}

.seat-switcher-menu__item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--bsg-ink);
  cursor: pointer;
  font-size: 0.85rem;
  text-align: left;
  width: 100%;
}

.seat-switcher-menu__item:hover:not(:disabled) {
  background: color-mix(in srgb, var(--bsg-accent) 10%, transparent);
}

.seat-switcher-menu__item--current {
  color: var(--bsg-accent-2);
}

.seat-switcher-menu__item--disabled,
.seat-switcher-menu__item:disabled {
  opacity: 0.45;
  cursor: default;
}

.seat-switcher-menu__sep {
  height: 1px;
  background: var(--bsg-line);
  margin: 4px 2px;
}

.seat-switcher-menu__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.seat-switcher-menu__dot.is-online {
  background: var(--bsg-ok);
}

.seat-switcher-menu__dot.is-offline {
  background: var(--bsg-away);
}

.seat-switcher-menu__ai {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--bsg-ink-3);
  background: var(--bsg-field);
  padding: 1px 4px;
  border-radius: 3px;
}

.seat-switcher-menu__current-label {
  color: var(--bsg-ink-3);
  font-size: 0.8em;
}

/* ── Table setup panel (read-only) ── */
.table-setup {
  padding: 10px 16px 12px;
  border-top: 1px solid var(--bsg-line);
  background: var(--bsg-surface);
}

.table-setup__dl {
  display: grid;
  grid-template-columns: auto;
  gap: 0;
  margin: 0;
  padding: 0;
}

.table-setup__group-header {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--bsg-ink-3);
  padding: 8px 0 4px;
  grid-column: 1 / -1;
  border-top: 1px solid var(--bsg-line-2);
  margin-top: 6px;
}

.table-setup__group-header:first-child {
  border-top: none;
  margin-top: 0;
}

.table-setup__row {
  display: flex;
  gap: 12px;
  align-items: baseline;
  padding: 3px 0;
}

.table-setup__row dt {
  font-size: 0.8rem;
  color: var(--bsg-ink-3);
  min-width: 100px;
  flex-shrink: 0;
}

.table-setup__row dd {
  font-size: 0.85rem;
  color: var(--bsg-ink);
  margin: 0;
  font-variant-numeric: tabular-nums;
}

/* ── Phone layout: icon-only controls, … overflow for secondary ── */
@media (max-width: 639px) {
  .dev-chrome__bar-wide {
    display: none; /* hide inline secondary controls */
  }

  .dev-chrome__overflow {
    display: block; /* show the … overflow button instead */
  }

  .dev-chrome__btn-label {
    /* kept visible inside the dropdown even on mobile */
  }

  .dev-chrome__label--icon-only {
    /* "UI" label stays visible — it's already short */
  }

  .dev-chrome__bar-actions {
    gap: 8px;
  }
}
</style>
