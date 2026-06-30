<script setup lang="ts">
/**
 * ControlsMenu — ⋯ controls popover anchored at the far-left of the action bar.
 *
 * Provides a single trigger button (aria-haspopup="menu") plus a role="menu" popover
 * containing game-control items: Auto end turn, Undo, zoom magnifier, New game, Leave.
 * The popover is teleported to <body> with fixed positioning (openUp/align props) so
 * the action bar's overflow:auto can't clip it.
 *
 * Bridge contract: New game and Leave game emit 'menu-item-click' with the item id so
 * GameShell.handleMenuItemClick can also post the bridge message to the host — do not
 * strand these controls or call leaveGame directly here (that is GameShell's job).
 *
 * Phase 102 adds the Appearance and Debug panel items.
 */
import { ref, nextTick, onMounted, onUnmounted } from 'vue';
import { useFocusTrap } from '../composables/useFocusTrap';

const props = withDefaults(defineProps<{
  /** Current auto-end-turn state */
  autoEndTurn: boolean;
  /** Current zoom level (0.5–2.0) */
  zoom: number;
  /** Whether the undo action is currently available */
  canUndo: boolean;
  /** Open the popover upward (for a bottom-anchored trigger, e.g. the action bar). */
  openUp?: boolean;
  /** Horizontal edge the popover aligns to. */
  align?: 'left' | 'right';
  /**
   * When defined (true), renders the Teaching group. When undefined, the
   * Teaching group is hidden entirely (game has no AI / AI not configured).
   * Pass `true` when the session has an AI player; omit otherwise.
   */
  showHint?: boolean;
  /** Disable the "Get a hint" item when the local player is not at a decision point. */
  hintDisabled?: boolean;
  /** Whether an AI demo is currently running (toggles "Watch AI demo" / "Stop demo"). */
  isDemoRunning?: boolean;
  /** Whether the move quality heatmap overlay is currently visible (drives aria-checked). */
  isHeatmapVisible?: boolean;
  /**
   * Whether the game has a spatial board (grid/hex) where a per-cell move-quality
   * heatmap is meaningful. When false — e.g. gridless card games like Go Fish,
   * where every move anchors to the same rank group and the chips collide — the
   * "Show move quality" toggle is hidden entirely (a toggle that renders a
   * misleading overlay reads as broken). Defaults to true so the toggle shows
   * unless the host explicitly reports the game has no spatial board.
   */
  heatmapSupported?: boolean;
  /** Whether action help affordances are currently visible (drives aria-checked). */
  isActionHelpVisible?: boolean;
  /**
   * Whether any currently-available action actually has help text. When false,
   * the "Show action help" toggle is hidden entirely — a global toggle with
   * nothing to reveal is a silent no-op that reads as broken. Defaults to true
   * so the toggle shows unless the host explicitly reports no help is authored.
   */
  hasActionHelp?: boolean;
  /**
   * When true, renders the Tutorial group showing the "Start tutorial" item.
   * Absent/false hides the group (game has no tutorial definition).
   */
  hasTutorial?: boolean;
  /**
   * When true (a tutorial is currently active for this seat), the Tutorial
   * group button reads "Exit tutorial" and emits 'exit-tutorial'.
   * When false/absent, it reads "Start tutorial" and emits 'start-tutorial'.
   */
  isTutorialRunning?: boolean;
  /**
   * When true, suppresses the entire Teaching group and Tutorial group
   * (host anti-cheat lockout). Get-a-hint, Watch-AI-demo, Show-move-quality,
   * and Start-tutorial will not render.
   *
   * Action help (the "Show action help" toggle in the Play group) is NEVER
   * gated by this prop — action help explains the rules, not a good move,
   * so it is always available (D-06).
   */
  teachingDisabled?: boolean;
}>(), {
  openUp: false,
  align: 'right',
  isActionHelpVisible: false,
  hasActionHelp: true,
  heatmapSupported: true,
  teachingDisabled: false,
});

const emit = defineEmits<{
  'update:autoEndTurn': [value: boolean];
  'update:zoom': [value: number];
  'undo': [];
  'menu-item-click': [id: string];
  /**
   * Emitted when the user selects a Teaching group item, a Tutorial item, or
   * a global display toggle.
   * - 'hint': request a one-shot move hint from the AI
   * - 'demo-toggle': start or stop the AI narrated demo
   * - 'heatmap-toggle': toggle the per-cell move quality overlay
   * - 'help-toggle': toggle action help affordances (Play group, always visible)
   * - 'start-tutorial': (re)start the tutorial from step 0
   * - 'exit-tutorial': exit the active tutorial (shown only when isTutorialRunning)
   */
  'teaching-action': [action: 'hint' | 'demo-toggle' | 'heatmap-toggle' | 'help-toggle' | 'start-tutorial' | 'exit-tutorial'];
}>();

const isOpen = ref(false);
const menuRoot = ref<HTMLElement | null>(null);
const menuRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLElement | null>(null);
// The popover is teleported to <body> with fixed positioning so it can never be
// clipped by an ancestor's overflow (e.g. the action bar's overflow-y:auto).
// Coordinates are computed from the trigger's rect each time it opens.
const menuStyle = ref<Record<string, string>>({});

const { open: openTrap, close: closeTrap, handleKeydown: trapKeydown } = useFocusTrap(menuRef, {
  escapeToClose: true,
  onClose: close,
});

function computePosition() {
  const el = triggerRef.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const style: Record<string, string> = { position: 'fixed', zIndex: '70' };
  if (props.openUp) style.bottom = `${Math.round(window.innerHeight - r.top + 6)}px`;
  else style.top = `${Math.round(r.bottom + 6)}px`;
  if (props.align === 'left') style.left = `${Math.round(r.left)}px`;
  else style.right = `${Math.round(window.innerWidth - r.right)}px`;
  menuStyle.value = style;
}

function toggle() {
  if (isOpen.value) {
    close();
  } else {
    computePosition();
    isOpen.value = true;
    nextTick(() => openTrap());
  }
}

function close() {
  closeTrap();
  isOpen.value = false;
}

function handleOutsideClick(event: MouseEvent) {
  const target = event.target as Node;
  const root = menuRoot.value;
  const menu = menuRef.value;
  // The popover is teleported to body, so check it separately from the trigger root.
  if (root && !root.contains(target) && (!menu || !menu.contains(target))) {
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
      ref="triggerRef"
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

    <Teleport to="body">
    <div v-if="isOpen" ref="menuRef" role="menu" aria-label="Game controls" class="menu" :style="menuStyle" @keydown="trapKeydown">
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

      <!-- Show action help (Play group — not AI-gated; hidden when no available
           action has help text, so the toggle is never present-but-inert). -->
      <button
        v-if="hasActionHelp"
        class="mi"
        type="button"
        role="menuitemcheckbox"
        :aria-checked="isActionHelpVisible"
        @click="emit('teaching-action', 'help-toggle')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9"/>
          <path d="M12 16v-.5c0-.8.5-1.5 1.2-1.8C14.4 13.2 15 12 15 10.5a3 3 0 0 0-6 0" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="12" cy="18.5" r="0.75" fill="currentColor" stroke="none"/>
        </svg>
        Show action help
        <span class="r">
          <span class="toggle" :class="{ on: isActionHelpVisible }"></span>
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
            :aria-valuetext="Math.round(zoom * 100) + '%'"
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

      <!-- Teaching group: one section for ALL teaching aids. Visible when the game
           has an AI player (showHint !== undefined) OR a tutorial (hasTutorial),
           AND teaching is not disabled by the host (teachingDisabled).
           The tutorial item lives here too — it is teaching, not a separate group. -->
      <template v-if="(showHint !== undefined || hasTutorial) && !teachingDisabled">
        <div class="sep"></div>
        <div class="grouplabel">Teaching</div>

        <!-- AI-driven aids: only when the game has an AI player. -->
        <template v-if="showHint !== undefined && !teachingDisabled">
          <!-- Get a hint: request a one-shot AI move suggestion -->
          <button
            class="mi"
            type="button"
            role="menuitem"
            :disabled="hintDisabled"
            :aria-disabled="hintDisabled"
            @click="emit('teaching-action', 'hint'); close()"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8v.01" stroke-linecap="round"/></svg>
            Get a hint
          </button>

          <!-- Watch AI demo / Stop demo: toggle the narrated AI demo mode -->
          <button
            class="mi"
            type="button"
            role="menuitem"
            @click="emit('teaching-action', 'demo-toggle'); close()"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 9-14 9V3z" stroke-linecap="round" stroke-linejoin="round"/></svg>
            {{ isDemoRunning ? 'Stop demo' : 'Watch AI demo' }}
          </button>

          <!-- Show move quality: toggle the per-cell MCTS evaluation heatmap.
               Hidden for gridless games (heatmapSupported=false) where the
               overlay cannot anchor moves to distinct board cells. -->
          <button
            v-if="heatmapSupported"
            class="mi"
            type="button"
            role="menuitemcheckbox"
            :aria-checked="isHeatmapVisible"
            @click="emit('teaching-action', 'heatmap-toggle')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            Show move quality
            <span class="r">
              <span class="toggle" :class="{ on: isHeatmapVisible }"></span>
            </span>
          </button>
        </template>

        <!-- Tutorial: same Teaching group. Toggle Start ↔ Exit based on run state. -->
        <button
          v-if="hasTutorial && !teachingDisabled"
          class="mi"
          type="button"
          role="menuitem"
          @click="emit('teaching-action', isTutorialRunning ? 'exit-tutorial' : 'start-tutorial'); close()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm-1 13V9l6 3-6 3z" stroke-linecap="round" stroke-linejoin="round"/></svg>
          {{ isTutorialRunning ? 'Exit tutorial' : 'Start tutorial' }}
        </button>
      </template>
    </div>
    </Teleport>
  </div>
</template>

<style scoped>
.controls-menu {
  position: relative;
  flex: none;
}

/* ⋯ trigger button — same dimensions/style as the GameShell .menubtn placeholder */
.menubtn {
  height: 38px;
  width: 38px;
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

/* Popover — teleported to <body>; position is set inline (fixed) from the
   trigger's rect so no ancestor overflow can clip it. */
.menu {
  width: 300px;
  background: var(--bsg-surface);
  border: 1px solid var(--bsg-line);
  border-radius: var(--bsg-r-lg);
  box-shadow: var(--bsg-shadow);
  padding: 8px;
  animation: pop var(--bsg-dur-fast) var(--bsg-ease);
}

@keyframes pop {
  from { opacity: 0; transform: translateY(6px); }
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
