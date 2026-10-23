<script setup lang="ts">
/**
 * ControlsMenu — ⋯ controls popover anchored at the far-left of the action bar.
 *
 * Provides a single trigger button (aria-haspopup="menu") plus a role="menu" popover
 * containing a table's Play group (Auto end turn, Undo, zoom magnifier), the
 * game's own commands (#1448) and the player's Preferences. A world's menu has
 * no Play group (#1443).
 * The popover is teleported to <body> with fixed positioning (openUp/align props) so
 * the action bar's overflow:auto can't clip it.
 *
 * There is no Leave item: the host page around the game's frame is where a
 * player leaves a game (#515). There is no New game item: a deployed host has
 * no restart op (#902).
 *
 * Phase 102 adds the Appearance and Debug panel items.
 */
import { ref, nextTick, onMounted, onUnmounted } from 'vue';
import { useFocusTrap } from '../composables/useFocusTrap';
import type { PlayerPreferences } from '../player-preferences.js';
import PlayerPreferenceItems from './PlayerPreferenceItems.vue';
import MenuCommandItems from './MenuCommandItems.vue';
import type { MenuCommand } from '../composables/menuCommands.js';
import { reduceMotionPreference } from '../composables/reducedMotion.js';
import { actionHelpPreference } from '../composables/actionHelp.js';
import { ZOOM_MIN, ZOOM_MAX } from '../composables/useAutoZoom';

const props = withDefaults(defineProps<{
  /**
   * The Play group's state: a table's turn, undo and zoom. A world has none of
   * them, so it passes no `play` and its menu has no Play group (#1443).
   */
  play?: {
    /** Current auto-end-turn state */
    autoEndTurn: boolean;
    /** Current zoom level; a fitted board can sit below the slider's minimum (#1162). */
    zoom: number;
    /** False where the browser has no CSS zoom, so the menu offers none (#1361). */
    zoomSupported: boolean;
    /** Whether the undo action is currently available */
    canUndo: boolean;
  };
  /** Open the popover upward (for a bottom-anchored trigger, e.g. the action bar). */
  openUp?: boolean;
  /** Horizontal edge the popover aligns to. */
  align?: 'left' | 'right';
  /**
   * When defined (true), renders the Teaching group. When undefined, the
   * Teaching group is hidden entirely (game has no bot / bot not configured).
   * Pass `true` when the session has a bot player; omit otherwise.
   */
  showHint?: boolean;
  /** Disable the "Get a hint" item when the local player is not at a decision point. */
  hintDisabled?: boolean;
  /** Whether a bot demo is currently running (toggles "Watch bot demo" / "Stop demo"). */
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
  /**
   * Whether any currently-available action actually has help text. When false,
   * the "Show action help" toggle is hidden entirely — a global toggle with
   * nothing to reveal is a silent no-op that reads as broken. Defaults to true
   * so the toggle shows unless the host explicitly reports no help is authored.
   */
  hasActionHelp?: boolean;
  /**
   * When true, renders the Tutorial group showing the "Start tutorial" item.
   * Absent/false hides the group (no tutorial, or this seat is not its learner seat).
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
   * (host anti-cheat lockout). Get-a-hint, Watch-bot-demo, Show-move-quality,
   * and Start-tutorial will not render.
   *
   * Action help (the "Show action help" toggle in Preferences) is NEVER
   * gated by this prop — action help explains the rules, not a good move,
   * so it is always available (D-06).
   */
  teachingDisabled?: boolean;
  /** The game's own player preferences (#1440), listed in their own group. */
  preferences?: PlayerPreferences;
  /** The game's own commands, registered by its board with `useMenuCommands` (#1448). */
  commands?: readonly MenuCommand[];
}>(), {
  openUp: false,
  align: 'right',
  // An absent boolean prop reads false, which would show the Teaching group to a menu that passed no showHint.
  showHint: undefined,
  hasActionHelp: true,
  heatmapSupported: true,
  teachingDisabled: false,
  commands: () => [],
});

const emit = defineEmits<{
  'update:autoEndTurn': [value: boolean];
  'update:zoom': [value: number];
  /** One-shot re-fit of the board to the available space. */
  'fit-zoom': [];
  'undo': [];
  /**
   * Emitted when the user selects a Teaching group item, a Tutorial item, or
   * a global display toggle.
   * - 'hint': request a one-shot move hint from the bot
   * - 'demo-toggle': start or stop the bot narrated demo
   * - 'heatmap-toggle': toggle the per-cell move quality overlay
   * - 'start-tutorial': (re)start the tutorial from step 0
   * - 'exit-tutorial': exit the active tutorial (shown only when isTutorialRunning)
   */
  'teaching-action': [action: 'hint' | 'demo-toggle' | 'heatmap-toggle' | 'start-tutorial' | 'exit-tutorial'];
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

function runCommand(command: MenuCommand) {
  // Closed first, so a command that opens a dialog keeps the focus it moves there.
  close();
  command.run();
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
    <div v-if="isOpen" ref="menuRef" role="menu" aria-label="Game controls" class="menu" tabindex="-1" :style="menuStyle" @keydown="trapKeydown">
      <template v-if="play">
        <div class="grouplabel">Play</div>

        <!-- Auto end turn -->
        <button
          class="mi"
          type="button"
          role="menuitemcheckbox"
          :aria-checked="play.autoEndTurn"
          @click="emit('update:autoEndTurn', !play.autoEndTurn)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Auto end turn
          <span class="r">
            <span class="toggle" :class="{ on: play.autoEndTurn }"></span>
          </span>
        </button>

        <!-- Undo -->
        <button
          class="mi"
          type="button"
          role="menuitem"
          :disabled="!play.canUndo"
          :aria-disabled="!play.canUndo"
          @click="handleUndo"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Undo last action
        </button>

        <!-- Zoom: fitted once at game startup; the slider adjusts manually and
             "Fit" re-fits the board to the available space on demand. -->
        <div v-if="play.zoomSupported" class="mi zoom-mi" role="menuitem">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6M21 21l-4-4" stroke-linecap="round"/></svg>
          Zoom
          <span class="r">
            <input
              type="range"
              class="zoom-range"
              :min="ZOOM_MIN"
              :max="ZOOM_MAX"
              step="0.1"
              :value="play.zoom"
              aria-label="Zoom"
              :aria-valuetext="Math.round(play.zoom * 100) + '%'"
              @input="handleZoomInput"
            />
            <button
              type="button"
              class="zoom-fit"
              title="Fit board to available space"
              @click="emit('fit-zoom')"
            >
              Fit
            </button>
          </span>
        </div>
        <div class="sep"></div>
      </template>

      <!-- The game's own commands (#1448). -->
      <template v-if="commands.length">
        <div class="grouplabel">Game</div>
        <MenuCommandItems :commands="commands" @run="runCommand" />
        <div class="sep"></div>
      </template>

      <!-- Built-in Reduce motion (#1442) and action help (#1449), then the game's own
           preferences (#1440). Action help hides when no available action has any. -->
      <div class="grouplabel">Preferences</div>
      <PlayerPreferenceItems :preferences="reduceMotionPreference()" />
      <PlayerPreferenceItems v-if="hasActionHelp" :preferences="actionHelpPreference()" />
      <PlayerPreferenceItems v-if="preferences" :preferences="preferences" />

      <!-- Teaching group: one section for ALL teaching aids. Visible when the game
           has a bot player (showHint !== undefined) OR a tutorial (hasTutorial),
           AND teaching is not disabled by the host (teachingDisabled).
           The tutorial item lives here too — it is teaching, not a separate group. -->
      <template v-if="(showHint !== undefined || hasTutorial) && !teachingDisabled">
        <div class="sep"></div>
        <div class="grouplabel">Teaching</div>

        <!-- bot-driven aids: only when the game has a bot player. -->
        <template v-if="showHint !== undefined && !teachingDisabled">
          <!-- Get a hint: request a one-shot bot move suggestion -->
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

          <!-- Watch bot demo / Stop demo: toggle the narrated bot demo mode -->
          <button
            class="mi"
            type="button"
            role="menuitem"
            @click="emit('teaching-action', 'demo-toggle'); close()"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 9-14 9V3z" stroke-linecap="round" stroke-linejoin="round"/></svg>
            {{ isDemoRunning ? 'Stop demo' : 'Watch bot demo' }}
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
  /* Teleported out of the shell root, so it does not inherit the shell's font (#451). */
  font-family: var(--bsg-font);
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

/* Menu item button; :deep so MenuCommandItems' items share it. */
.menu :deep(.mi) {
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
.menu :deep(.mi:hover) {
  background: var(--bsg-surface-2);
}
.menu :deep(.mi:disabled) {
  background: var(--bsg-disabled-surface);
  color: var(--bsg-disabled-ink);
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

/* No icon, so indent to line up with the labels of items that have one, as PlayerPreferenceItems does. */
.menu :deep(.mi-command) {
  padding-left: 39px;
}

/* Zoom magnifier row — label semantics via <div role="menuitem">, not <button> */
.zoom-mi {
  cursor: default;
}
.zoom-range {
  accent-color: var(--bsg-accent);
  width: 84px;
}
.zoom-fit {
  border: 1px solid var(--bsg-line-2);
  border-radius: var(--bsg-r-pill);
  background: none;
  color: var(--bsg-ink-2);
  font: inherit;
  font-size: 0.72rem;
  padding: 1px 8px;
  cursor: pointer;
  flex: none;
}
.zoom-fit:hover {
  border-color: var(--bsg-accent);
  color: var(--bsg-accent);
}

/* Section separator */
.sep {
  height: 1px;
  background: var(--bsg-line);
  margin: 6px 8px;
}

/* Toggle pill; :deep so PlayerPreferenceItems' toggles share it. */
.menu :deep(.toggle) {
  width: 38px;
  height: 22px;
  border-radius: var(--bsg-r-pill);
  background: var(--bsg-line-2);
  position: relative;
  transition: background var(--bsg-dur-fast);
  flex: none;
}
.menu :deep(.toggle::after) {
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
.menu :deep(.toggle.on) {
  background: var(--bsg-accent);
}
.menu :deep(.toggle.on::after) {
  left: 18px;
}
</style>
