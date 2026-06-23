<script setup lang="ts">
/**
 * ControlsMenu — ⋯ controls popover mounted in the sidebar .side-head (IA-01).
 *
 * Provides a single trigger button (aria-haspopup="menu") plus a role="menu" popover
 * containing game-control items: Auto end turn, Undo, zoom magnifier, New game, Leave.
 *
 * Bridge contract: New game and Leave game emit 'menu-item-click' with the item id so
 * GameShell.handleMenuItemClick can also post the bridge message to the host — do not
 * strand these controls or call leaveGame directly here (that is GameShell's job).
 *
 * Phase 102 adds the Appearance and Debug panel items.
 */
import { ref, nextTick, onMounted, onUnmounted } from 'vue';
import { useFocusTrap } from '../composables/useFocusTrap';

const props = defineProps<{
  /** Current auto-end-turn state */
  autoEndTurn: boolean;
  /** Current zoom level (0.5–2.0) */
  zoom: number;
  /** Whether the undo action is currently available */
  canUndo: boolean;
}>();

const emit = defineEmits<{
  'update:autoEndTurn': [value: boolean];
  'update:zoom': [value: number];
  'undo': [];
  'menu-item-click': [id: string];
}>();

const isOpen = ref(false);
const menuRoot = ref<HTMLElement | null>(null);
const menuRef = ref<HTMLElement | null>(null);

const { open: openTrap, close: closeTrap, handleKeydown: trapKeydown } = useFocusTrap(menuRef, {
  escapeToClose: true,
  onClose: close,
});

function toggle() {
  if (isOpen.value) {
    close();
  } else {
    isOpen.value = true;
    nextTick(() => openTrap());
  }
}

function close() {
  closeTrap();
  isOpen.value = false;
}

function handleOutsideClick(event: MouseEvent) {
  const root = menuRoot.value;
  if (root && !root.contains(event.target as Node)) {
    close();
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleOutsideClick);
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleOutsideClick);
});

function handleZoomInput(event: Event) {
  const value = parseFloat((event.target as HTMLInputElement).value);
  emit('update:zoom', value);
}

function handleUndo() {
  emit('undo');
  close();
}

function handleNewGame() {
  emit('menu-item-click', 'new-game');
  close();
}

function handleLeave() {
  emit('menu-item-click', 'leave');
  close();
}
</script>

<template>
  <div ref="menuRoot" class="controls-menu">
    <button
      class="menubtn"
      type="button"
      aria-label="Game controls"
      aria-haspopup="menu"
      :aria-expanded="isOpen"
      @click="toggle"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true">
        <circle cx="12" cy="5" r="1.6"/>
        <circle cx="12" cy="12" r="1.6"/>
        <circle cx="12" cy="19" r="1.6"/>
      </svg>
    </button>

    <div v-if="isOpen" ref="menuRef" role="menu" aria-label="Game controls" class="menu" @keydown="trapKeydown">
      <div class="grouplabel">Play</div>

      <!-- Auto end turn -->
      <button
        class="mi"
        type="button"
        role="menuitemcheckbox"
        :aria-checked="autoEndTurn"
        @click="emit('update:autoEndTurn', !autoEndTurn)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Auto end turn
        <span class="r">
          <span class="toggle" :class="{ on: autoEndTurn }"></span>
        </span>
      </button>

      <!-- Undo -->
      <button
        class="mi"
        type="button"
        role="menuitem"
        :disabled="!canUndo"
        :aria-disabled="!canUndo"
        @click="handleUndo"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Undo last action
      </button>

      <!-- Zoom (accessibility magnifier — not the fit strategy) -->
      <div class="mi zoom-mi" role="menuitem">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6M21 21l-4-4" stroke-linecap="round"/></svg>
        Fit board
        <span class="r">
          <input
            type="range"
            class="zoom-range"
            min="0.5"
            max="2"
            step="0.1"
            :value="zoom"
            aria-label="Zoom"
            @input="handleZoomInput"
          />
        </span>
      </div>

      <div class="sep"></div>
      <div class="grouplabel">Session</div>

      <!-- New game -->
      <button
        class="mi"
        type="button"
        role="menuitem"
        @click="handleNewGame"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v16H4zM14 8l4 4-4 4M9 12h9" stroke-linecap="round" stroke-linejoin="round"/></svg>
        New game
      </button>

      <!-- Leave game -->
      <button
        class="mi danger"
        type="button"
        role="menuitem"
        @click="handleLeave"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h5v16h-5M9 8l-4 4 4 4M5 12h9" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Leave game
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Wrapper: pushes itself to the right end of .side-head via margin-left:auto */
.controls-menu {
  position: relative;
  margin-left: auto;
  flex: none;
}

/* ⋯ trigger button — same dimensions/style as the GameShell .menubtn placeholder */
.menubtn {
  height: 38px;
  width: 38px;
  min-height: 44px;
  min-width: 44px;
  display: grid;
  place-items: center;
  border-radius: var(--bsg-r-sm);
  background: transparent;
  border: 1px solid var(--bsg-line);
  color: var(--bsg-ink-2);
  cursor: pointer;
}
.menubtn:hover {
  color: var(--bsg-ink);
  border-color: var(--bsg-line-2);
}

/* Popover — drops downward from the trigger */
.menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 70;
  width: 300px;
  background: var(--bsg-surface);
  border: 1px solid var(--bsg-line);
  border-radius: var(--bsg-r-lg);
  box-shadow: var(--bsg-shadow);
  padding: 8px;
  animation: pop var(--bsg-dur-fast) var(--bsg-ease);
}

@keyframes pop {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: none; }
}

/* Section label */
.grouplabel {
  font-family: var(--bsg-mono);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--bsg-ink-3);
  padding: 10px 10px 5px;
}

/* Menu item button */
.mi {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: 10px;
  border-radius: var(--bsg-r-sm);
  background: none;
  border: none;
  color: var(--bsg-ink);
  font-family: var(--bsg-font);
  font-size: var(--bsg-text-sm);
  cursor: pointer;
  text-align: left;
}
.mi:hover {
  background: var(--bsg-surface-2);
}
.mi:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.mi svg {
  width: 18px;
  height: 18px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.8;
  color: var(--bsg-ink-2);
  flex: none;
}
/* Right-aligned slot (toggle, zoom input) */
.mi .r {
  margin-left: auto;
  color: var(--bsg-ink-3);
  font-size: var(--bsg-text-xs);
  display: flex;
  align-items: center;
  gap: 8px;
}
.mi.danger {
  color: var(--bsg-danger);
}
.mi.danger svg {
  color: var(--bsg-danger);
}

/* Zoom magnifier row — label semantics via <div role="menuitem">, not <button> */
.zoom-mi {
  cursor: default;
}
.zoom-range {
  accent-color: var(--bsg-accent);
  width: 84px;
}

/* Section separator */
.sep {
  height: 1px;
  background: var(--bsg-line);
  margin: 6px 8px;
}

/* Toggle pill */
.toggle {
  width: 38px;
  height: 22px;
  border-radius: var(--bsg-r-pill);
  background: var(--bsg-line-2);
  position: relative;
  transition: background var(--bsg-dur-fast);
  flex: none;
}
.toggle::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.95);
  transition: left var(--bsg-dur-fast);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
.toggle.on {
  background: var(--bsg-accent);
}
.toggle.on::after {
  left: 18px;
}
</style>
