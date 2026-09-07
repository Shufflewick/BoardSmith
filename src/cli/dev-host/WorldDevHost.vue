<script setup lang="ts">
/// <reference types="vite/client" />
/**
 * THE `boardsmith dev` WORLD CHROME — the main window for a persistent world.
 *
 * `DevHost.vue`'s sibling and built to feel like it: a thin always-visible dev
 * bar over an iframe that renders the game's own surface, with the outer page
 * doing nothing but bridging a WebSocket to that frame's postMessage protocol.
 * It is a SIBLING rather than a mode, because the two protocols share no
 * message: a table frame carries a turn, a flow position and an action table
 * (`GameShell`), and a world frame carries a view, a seat and a command table
 * (`WorldShell`). Feeding one into the other would put buttons on screen for
 * actions the world refuses.
 *
 * WHAT THE BAR ADDS BEYOND THE TABLE'S, and why each one is a world's:
 *
 *   SEAT SWITCHER   the table host has one, and a world needs it more: a world
 *                   is a place several people are in at once, and one author
 *                   testing it has to be able to be two of them.
 *   FIRE DUE NOW    a world's third actor is the clock. Waiting ten real
 *                   minutes to see a tick is not a test loop.
 *   WAKE FROM PARKED  a world's residency model is the half of it that a single
 *                   long-lived process never exercises. This drops it.
 *   THE QUEUE       what is scheduled and when, because an event nobody can see
 *                   is an event nobody can debug.
 */
import { ref, computed, onMounted, onUnmounted, shallowRef } from 'vue';
import type { WorldDevConfig } from './world-config-types.js';
import { WORLD_HOST_SOURCE, WORLD_UI_SOURCE } from '../../ui/world/worldProtocol.js';
import { loadDevClientId, WORLD_CLIENT_KEY } from './dev-client-id.js';

const props = defineProps<{ config: WorldDevConfig }>();
const cfg = props.config;

// ── Persistent client identity, so a reload reclaims the same seat ───────────
// A world seat matters more than a table one: it is where a player's holdings
// are, and seats are never handed on. `dev-client-id.ts` carries the reasoning.
const clientId = loadDevClientId(WORLD_CLIENT_KEY, 'w');

interface PendingEvent {
  id: string;
  due: number;
  command: string;
  owner: string;
  everyMs?: number;
}
interface WorldStatus {
  seatCount: number;
  seats: Array<{ player: string; seat: number }>;
  presence: number[];
  resident: string[];
  dirty: string[];
  pending: PendingEvent[];
  nextDue: number | null;
  worldNow: number;
  clockSkewMs: number;
  storePath: string;
  completed: boolean;
}

const connected = ref(false);
const mySeat = ref<number | null>(null);
const status = ref<WorldStatus | null>(null);
const notices = ref<string[]>([]);
const worldName = ref(cfg.displayName);

/** `shallowRef`: the last state frame is replaced wholesale and re-posted into
 *  the frame on every remount, never walked. */
const lastState = shallowRef<Record<string, unknown> | null>(null);

function note(message: string): void {
  notices.value = [...notices.value.slice(-4), message];
}

// ── WebSocket transport to the Node host ─────────────────────────────────────
const WS_PATH = '/__boardsmith/world';
let ws: WebSocket | null = null;

function wsSend(message: Record<string, unknown>): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function connect(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}${WS_PATH}`);
  ws.addEventListener('open', () => {
    connected.value = true;
    wsSend({ type: 'hello', clientId });
  });
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data as string) as Record<string, unknown>;
    onHostMessage(message);
  });
  ws.addEventListener('close', () => {
    connected.value = false;
    // THE FRAME IS TOLD, and keeps its last view marked as no longer live.
    // Taking the board away would tell the player nothing the banner does not.
    if (lastState.value !== null) {
      postToWorld({ ...lastState.value, phase: 'lost', notice: 'The dev host stopped answering.' });
    }
  });
}

function onHostMessage(message: Record<string, unknown>): void {
  switch (message.type) {
    case 'world_state':
      mySeat.value = (message.seat as number | null) ?? null;
      worldName.value = (message.worldName as string | null) ?? cfg.displayName;
      lastState.value = message;
      postToWorld(message);
      return;
    case 'world_events':
    case 'world_response':
      postToWorld(message);
      return;
    case 'world_status':
      status.value = message as unknown as WorldStatus;
      return;
    case 'world_notice':
      note(message.message as string);
      return;
  }
}

// ── Iframe bridge (WS ↔ postMessage), the production world contract ──────────
const frameRef = ref<HTMLIFrameElement | null>(null);

function postToWorld(message: Record<string, unknown>): void {
  const win = frameRef.value?.contentWindow;
  if (!win) return;
  win.postMessage({ ...message, source: WORLD_HOST_SOURCE }, '*');
}

function onFrameLoad(): void {
  // A frame that mounted after the host already held a view would sit blank
  // until the world next moved, which in a quiet world is never.
  if (lastState.value !== null) postToWorld(lastState.value);
}

function onWindowMessage(event: MessageEvent): void {
  const data = event.data as { source?: string; type?: string; [key: string]: unknown } | undefined;
  if (!data || data.source !== WORLD_UI_SOURCE) return;
  if (data.type === 'world_ready') {
    if (lastState.value !== null) postToWorld(lastState.value);
    return;
  }
  if (data.type === 'world_command') {
    wsSend({
      type: 'action',
      requestId: data.requestId as string,
      // THE ORDER'S DURABLE IDENTITY (#195), relayed untouched: this bridge
      // carries what the frame sent and invents nothing.
      order: data.order,
      action: data.action as string,
      args: (data.args as Record<string, unknown>) ?? {},
    });
  }
}

// ── The dev controls ─────────────────────────────────────────────────────────
const seats = computed(() => Array.from({ length: cfg.seatCount }, (_, i) => i + 1));
const seatMenuOpen = ref(false);

function takeSeat(seat: number): void {
  seatMenuOpen.value = false;
  if (seat === mySeat.value) return;
  wsSend({ type: 'attach', seat });
}

function fireDue(): void {
  wsSend({ type: 'fire_due' });
}

function wake(): void {
  wsSend({ type: 'wake' });
}

const nextDueIn = computed(() => {
  const s = status.value;
  if (!s || s.nextDue === null) return null;
  return Math.max(0, s.nextDue - s.worldNow);
});

function humanMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

onMounted(() => {
  window.addEventListener('message', onWindowMessage);
  connect();
});
onUnmounted(() => {
  window.removeEventListener('message', onWindowMessage);
  ws?.close();
});
</script>

<template>
  <div class="world-dev">
    <header class="world-dev__bar">
      <span class="world-dev__brand">World</span>
      <span class="world-dev__name">{{ worldName }}</span>

      <span class="world-dev__dot" :class="{ 'world-dev__dot--on': connected }" />

      <!-- SEAT SWITCHER: one person, several seats. -->
      <div class="world-dev__seat">
        <button type="button" @click="seatMenuOpen = !seatMenuOpen">
          Seat {{ mySeat ?? '—' }} ▾
        </button>
        <ul v-if="seatMenuOpen" class="world-dev__menu">
          <li v-for="seat in seats" :key="seat">
            <button type="button" :aria-current="seat === mySeat" @click="takeSeat(seat)">
              Seat {{ seat }}
              <em v-if="status?.presence.includes(seat)">here</em>
            </button>
          </li>
        </ul>
      </div>

      <!-- PRESENCE: the seats this host has open, which is what the running
           command is handed. -->
      <span class="world-dev__field" title="Seats with an open connection to this world">
        Present: {{ status?.presence.join(', ') || 'nobody' }}
      </span>

      <!-- THE CLOCK, and the control that moves it. -->
      <span class="world-dev__field">
        Queue: {{ status?.pending.length ?? 0 }}
        <template v-if="nextDueIn !== null">(next in {{ humanMs(nextDueIn) }})</template>
      </span>
      <button type="button" :disabled="!status?.pending.length" @click="fireDue">
        Fire due events now
      </button>
      <span v-if="status && status.clockSkewMs > 0" class="world-dev__field world-dev__skew">
        clock +{{ humanMs(status.clockSkewMs) }}
      </span>

      <!-- RESIDENCY, and the control that drops it. -->
      <button type="button" title="Drop everything resident and rehydrate from the store" @click="wake">
        Wake from parked
      </button>
      <span class="world-dev__field">Resident: {{ status?.resident.length ?? 0 }}</span>
    </header>

    <p v-for="(line, i) in notices" :key="i" class="world-dev__notice" role="status">{{ line }}</p>

    <iframe
      ref="frameRef"
      class="world-dev__frame"
      :src="cfg.worldUrl"
      title="World surface"
      @load="onFrameLoad"
    />

    <footer class="world-dev__foot">
      <span>{{ cfg.storePath }}</span>
      <span v-if="status?.dirty.length">· {{ status.dirty.length }} not yet durable</span>
      <span v-if="status?.completed">· this world reports it is complete</span>
    </footer>
  </div>
</template>

<style scoped>
.world-dev {
  display: flex;
  flex-direction: column;
  height: 100%;
  font: 13px/1.4 system-ui, -apple-system, sans-serif;
  background: #14161a;
  color: #e6e8ec;
}
.world-dev__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  padding: 0.4rem 0.75rem;
  background: #1d2027;
  border-bottom: 1px solid #2c313a;
}
.world-dev__brand {
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 11px;
  color: #8d97a8;
}
.world-dev__name { font-weight: 600; }
.world-dev__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #7a3030;
}
.world-dev__dot--on { background: #2f9e5f; }
.world-dev__field { color: #9aa3b2; }
.world-dev__skew { color: #d9b45f; }
.world-dev__generic { color: #d9b45f; }
.world-dev button {
  font: inherit;
  color: inherit;
  background: #2a2f38;
  border: 1px solid #3a4150;
  border-radius: 4px;
  padding: 0.2rem 0.55rem;
  cursor: pointer;
}
.world-dev button:disabled { opacity: 0.45; cursor: default; }
.world-dev__seat { position: relative; }
.world-dev__menu {
  position: absolute;
  z-index: 5;
  top: 100%;
  left: 0;
  margin-top: 0.25rem;
  list-style: none;
  background: #1d2027;
  border: 1px solid #3a4150;
  border-radius: 4px;
  max-height: 16rem;
  overflow-y: auto;
  min-width: 9rem;
}
.world-dev__menu button {
  width: 100%;
  text-align: left;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.world-dev__menu button[aria-current='true'] { background: #34506b; }
.world-dev__menu em { color: #6fbf8f; font-style: normal; float: right; }
.world-dev__notice {
  margin: 0;
  padding: 0.4rem 0.75rem;
  background: #2c2a19;
  color: #f0e0b0;
  border-bottom: 1px solid #3d3a22;
}
.world-dev__frame {
  flex: 1 1 auto;
  width: 100%;
  border: 0;
  background: #fff;
}
.world-dev__foot {
  display: flex;
  gap: 0.5rem;
  padding: 0.3rem 0.75rem;
  font-size: 11px;
  color: #6f7887;
  background: #1d2027;
  border-top: 1px solid #2c313a;
}
</style>
