<script setup lang="ts">
/**
 * THE CHROME BOTH BACKENDS RENDER (BoardSmith #170).
 *
 * `GameShell` and `WorldShell` both survive, because most of `GameShell` is
 * table-only lifecycle -- the lobby, the waiting room, the standalone
 * connection, flow, undo and time travel, bots, the flow boundary key stamped on
 * every outbound op, game over. `WorldShell` has none of that and never will.
 * What the two DO share is everything a player looks at once they are in: the
 * seat list, the log, the board region, the action bar. That is this file.
 *
 * ## The boundary, in one testable sentence
 *
 * Everything that reads `flowState` stays on the table side. Everything that
 * reads the seat's enumerated actions, the seat's identity or the element tree
 * is here.
 *
 * Which is why this component takes no `flowState`, no `canUndo`, no `winners`
 * and no lobby: those reach it, when they exist at all, through the slots the
 * adapter fills. A world passes nothing into them and loses nothing.
 *
 * ## `mayAct` is not `isMyTurn`
 *
 * A table's action bar is up when it is your go. A world runs no flow and has no
 * turn -- but the property the bar is actually gated on is "may this viewer act
 * now", and a world's answer is yes whenever it is attached and seated. So the
 * prop is named for what it means. Everything that genuinely means "it is your
 * GO" -- the turn announcer, the notification sound, the turn-status sentence on
 * the seat card -- stays in `GameShell` and is never handed to this component.
 *
 * ## The `data-testid`s are load-bearing
 *
 * ShufflewickPub's world e2e specs currently select on a platform-owned form.
 * When `WorldStage` is deleted (SWP #357) they re-point here, at markup the
 * platform does not own. Selecting on classes would make every chrome CSS change
 * a platform test break, so the shell names its own surfaces and keeps the names.
 */
import { computed, ref } from 'vue';
import ActionPanel from './auto-ui/ActionPanel.vue';
import GameHistory, { type HistoryMessage } from './GameHistory.vue';
import PlayersPanel, { type Player } from './PlayersPanel.vue';
import PlayerToken from './PlayerToken.vue';
import Toast from './Toast.vue';
import DisabledReasonTooltip from './helpers/DisabledReasonTooltip.vue';
import type { ActionMetadata } from '../composables/useActionControllerTypes.js';

/** What the adapter has to say about its own connection, on whichever axis it
 *  has. A table's is socket health; a world's is an attachment lifecycle. The
 *  two state machines are deliberately NOT merged -- only the indicator is. */
export interface PlayConnection {
  /** A class name for the dot. The adapter's vocabulary, not this component's. */
  tone: string;
  /** What a person reading the dot is told. */
  title: string;
}

const props = withDefaults(defineProps<{
  // ── Seat identity ──────────────────────────────────────────────────────────
  /** Every seat the chrome draws a row for. */
  players: Player[];
  /** The viewer's own seat; -1 for a spectator. */
  playerSeat: number;
  /** Whose go it is, when the backend HAS a turn. A world never sets this. */
  currentPlayerSeat?: number;
  /** Seats still to act in a simultaneous step. A world never sets this. */
  awaitingPlayerSeats?: number[];
  /** Who is here right now, three-valued. See `PlayersPanel.presentSeats`. */
  presentSeats?: readonly number[] | null;
  /** Whether the seat card carries the shell's own turn-status sentence. */
  showTurnStatus?: boolean;

  // ── The log ────────────────────────────────────────────────────────────────
  /** The lines the log shows, oldest first. */
  messages: HistoryMessage[];
  /** What the log says when it is empty, if "No activity yet" would be a lie.
   *  A world's log is a live tail, not a history. */
  logEmptyText?: string;
  /** How many lines arrived since the player last looked, for the mobile badge. */
  unreadLogCount?: number;

  // ── Acting ─────────────────────────────────────────────────────────────────
  /** May this viewer act right now? See the header: this is not `isMyTurn`. */
  mayAct: boolean;
  /** The actions the backend enumerated for this seat. */
  availableActions: string[];
  /** Those actions' metadata, by name. */
  actionMetadata: Record<string, ActionMetadata>;
  /** Action name to why it is offered but cannot be taken. */
  disabledActions?: Record<string, string>;
  /** Whether the panel is showing each action's help text. */
  isActionHelpVisible?: boolean;
  /** The identity token at the head of the action bar. Never absent while the
   *  bar is up: an anchor that comes and goes between phases reads as broken. */
  panelToken?: { name: string; seat: number; color?: string } | null;
  /** The sentence over the action bar, when the board or a pick supplies one. */
  prompt?: string | null;
  /** Names still to act in a simultaneous step. A world passes none. */
  awaitingPlayers?: string[];
  /** Whose go it is, by name and colour, for the panel's own sentence. */
  currentPlayerName?: string;
  currentPlayerColor?: string;
  /** This seat's own `completed` flag for a simultaneous step. */
  completed?: boolean;
  /** Whether undo is offered right now. A world never offers it. */
  canUndo?: boolean;
  /** The auto-end-turn preference, for the panel's own footer. */
  autoEndTurn?: boolean;
  /**
   * Take the action panel away entirely (the platform's D-02 escape hatch).
   * The prompt survives it: a board that says nothing and offers nothing is the
   * one state the chrome must never be in.
   *
   * Named identically to the adapter's own prop on purpose. It is the SAME flag
   * relayed, not a second gate. The shorter name it might have had is retired
   * (LIBX-01): it belonged to a shell-level suppression gate that was deleted,
   * and a test guards against its return.
   */
  platformActionPanelEscapeHatch?: boolean;

  // ── The frame ──────────────────────────────────────────────────────────────
  /** What the adapter has to say about its connection, or null for nothing. */
  connection?: PlayConnection | null;
  /** The board's zoom factor. */
  zoomLevel?: number;
  /** Whether the sidebar is collapsed to its rail. `v-model`. */
  sidebarRail?: boolean;
  /** Whether the mobile seat strip is expanded into the full overlay. `v-model`. */
  mobileExpanded?: boolean;
  /** Whether the viewport is at the compact tier. */
  isCompact?: boolean;
}>(), {
  showTurnStatus: true,
  unreadLogCount: 0,
  zoomLevel: 1,
  sidebarRail: false,
  mobileExpanded: false,
});

const emit = defineEmits<{
  'update:sidebarRail': [value: boolean];
  'update:mobileExpanded': [value: boolean];
  undo: [];
}>();

defineSlots<{
  /** The adapter's header band, above the stage. */
  header(): unknown;
  /** The game's board. One render path, reached through the registry -- there is
   *  deliberately no second way to name it. */
  board(): unknown;
  /** The adapter's own overlays over the board region: a table's game-over card,
   *  tutorial, hint and heatmap. Confined to the board region by construction,
   *  so none of them can cover the action bar. */
  'board-overlays'(): unknown;
  /** Whatever the adapter puts under the seat list. */
  'sidebar-extra'(): unknown;
  /** The game's per-seat content, on the card's info column. */
  'player-stats'(props: { player: Player }): unknown;
  /** The game's per-seat content, under the identity token. */
  'player-token-extra'(props: { player: Player }): unknown;
  /** The controls menu, at the far left of the action bar. Its contents are the
   *  adapter's: a table's carries undo, hints and the tutorial. */
  controls(): unknown;
  /** Replace the action panel wholesale. */
  'action-panel'(): unknown;
  /** Whatever the adapter puts after the panel — a table's time-travel banner. */
  'actionbar-extra'(): unknown;
  /**
   * The adapter's debug surface. A SHARED INTERFACE AND PLACEMENT, not a shared
   * component: a table's tabs are action history, time travel, state search and
   * rewind, and a world's are resident partitions, the dirty set, the schedule
   * queue and clock skew. Merging them would produce four dead tabs.
   */
  debug(): unknown;
}>();

const railed = computed({
  get: () => props.sidebarRail,
  set: (value: boolean) => emit('update:sidebarRail', value),
});
const expanded = computed({
  get: () => props.mobileExpanded,
  set: (value: boolean) => emit('update:mobileExpanded', value),
});

/**
 * THE THREE ELEMENTS THE ADAPTER STILL HAS TO REACH.
 *
 * The board region is what the zoom fit measures and what the board focus
 * handoff returns focus to; the zoom container is the element the fit scales and
 * the drag-drop substrate anchors against; the log is what the debug panel
 * copies and clears. All three are chrome this component owns and behaviour the
 * adapter drives, so they are exposed rather than duplicated.
 */
const boardRegionEl = ref<HTMLElement | null>(null);
const zoomContainerEl = ref<HTMLElement | null>(null);
const historyPanel = ref<InstanceType<typeof GameHistory> | null>(null);

defineExpose({ boardRegionEl, zoomContainerEl, historyPanel });

/** The toggle's label, carrying the unread count for screen readers too. */
const mobileToggleLabel = computed(() => {
  if (props.mobileExpanded) return 'Hide players and log';
  return props.unreadLogCount > 0
    ? `Show players and log, ${props.unreadLogCount} new`
    : 'Show players and log';
});
</script>

<template>
  <div class="game-shell__game">
    <!-- The adapter's own header band. Dev/standalone only for a table; absent
         in platform mode, where the host draws its own chrome over the top. -->
    <slot name="header"></slot>

    <!-- Stage: sidebar + boardregion side by side (full-width actionbar is a
         sibling, below). -->
    <div class="stage">
      <!-- Sidebar: always-visible player status + log; collapses to rail (IA-06) -->
      <aside
        class="sidebar"
        :class="{ rail: railed, 'mobile-expanded': expanded }"
        aria-label="Players and log"
        data-testid="bs-seats"
      >
        <!-- Rail toggle: absolutely positioned on the sidebar's right edge -->
        <button
          class="side-edge"
          type="button"
          :aria-label="railed ? 'Expand panel' : 'Collapse panel'"
          :aria-expanded="!railed"
          @click="railed = !railed"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>

        <!-- Mobile only (CSS-gated): a one-line player-icon strip with an expand
             toggle. Keeps the board the hero; the full panel + log open as an
             overlay below (see .mobile-expanded). -->
        <div class="mobile-strip">
          <PlayersPanel
            class="mobile-strip__players"
            :players="players"
            :player-seat="playerSeat"
            :current-player-seat="currentPlayerSeat"
            :awaiting-player-seats="awaitingPlayerSeats"
            :present-seats="presentSeats"
            seat-strip
          />
          <button
            class="mobile-strip__toggle"
            type="button"
            :aria-expanded="expanded"
            :aria-label="mobileToggleLabel"
            @click="expanded = !expanded"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <!-- Unread badge (#22). aria-hidden because the count is already in
                 the button's own label — announcing it twice is worse than once.
                 Capped at 99+ so the badge cannot grow the control. -->
            <span
              v-if="unreadLogCount > 0"
              class="mobile-strip__unread"
              data-bs-unread
              aria-hidden="true"
            >{{ unreadLogCount > 99 ? '99+' : unreadLogCount }}</span>
          </button>
        </div>

        <!-- No header band: host branding (ShufflewickPub pull-down tab) overlays
             the top in production, and the ⋯ controls live in the action bar. -->
        <div class="side-scroll">
          <PlayersPanel
            :players="players"
            :player-seat="playerSeat"
            :current-player-seat="currentPlayerSeat"
            :awaiting-player-seats="awaitingPlayerSeats"
            :present-seats="presentSeats"
            :seat-strip="!isCompact && railed"
            :show-turn-status="showTurnStatus"
          >
            <!-- Beneath the identity token, in the card's narrow first column —
                 for content that reads as part of the seat's identity (a
                 portrait, a rank pip) and would otherwise stack under the name
                 row and make every card taller. -->
            <template #player-token-extra="{ player }">
              <slot name="player-token-extra" :player="player"></slot>
            </template>
            <template #player-stats="{ player }">
              <slot name="player-stats" :player="player"></slot>
            </template>
          </PlayersPanel>

          <slot name="sidebar-extra"></slot>

          <!-- The log, in the side-scroll: shown when expanded on desktop, and
               always on mobile (inside the overlay).

               A game cannot turn this off. The log is the shell's record of what
               happened, and the only gate on it is the PLAYER's own sidebar-rail
               collapse — reversible, by the person who chose it. There is
               deliberately no prop for hiding it: a game rendering its own
               narration elsewhere ADDS a surface, it does not remove this one,
               and a game that publishes nothing gets an honestly empty log
               rather than no log at all. -->
          <GameHistory
            v-if="isCompact || !railed"
            ref="historyPanel"
            :messages="messages"
            :empty-text="logEmptyText"
            class="sidebar-history"
            data-testid="bs-log"
          />
        </div>
      </aside>

      <!-- Board region: hero; ~zero chrome padding; container-query-sized.
           Its padding-bottom reserves the Action Panel's CONSTANT footprint
           (--bsg-panel-reserved), so the board is fitted above the panel without
           anything measuring the panel. -->
      <main
        class="boardregion"
        id="main"
        role="main"
        tabindex="-1"
        ref="boardRegionEl"
        data-testid="bs-board"
      >
        <!-- Connection indicator: one dot, two sources. Surfaced only when the
             adapter has something to say — a persistent healthy dot over the
             board reads as a mystery speck (IA-01). The adapter names the tone
             and writes the sentence, because a table's socket health and a
             world's attachment lifecycle are different axes and merging the two
             state machines would lose states neither has an analogue for. -->
        <span
          v-if="connection"
          class="conn-dot"
          :class="connection.tone"
          :title="connection.title"
          data-testid="bs-connection"
          aria-hidden="true"
        ></span>

        <!-- The adapter's own overlays. A direct child of .boardregion, so like
             every overlay here they can cover the board but NEVER the action bar
             or the header (those are siblings outside .boardregion). -->
        <slot name="board-overlays"></slot>

        <!-- Game modal host: the sanctioned full-board-region overlay layer for
             custom UIs. A game Teleports a blocking modal here
             (`<Teleport to="#bs-game-modal">`) to cover the board area.
             `contain: layout` re-establishes the containing block, so even a
             teleported overlay that uses `position: fixed` is confined to THIS
             box instead of escaping to the viewport — the board-area sandbox
             invariant holds no matter what the game designer does.
             pointer-events are none on the host and auto on its children. -->
        <div class="game-shell__game-modal-host" id="bs-game-modal"></div>

        <div
          class="game-shell__zoom-container"
          ref="zoomContainerEl"
          :style="{ '--zoom-level': zoomLevel }"
        >
          <!-- ONE render path for the board: the registry's default UI, or the
               dev switcher's selection. There is no second slot for naming a
               default board — a second way would be a second thing to disagree
               with `src/ui/uis.ts`, and props drifted between the two paths for
               real while both existed. -->
          <slot name="board"></slot>
        </div>
      </main>

      <!-- Scrim: active only on mobile when the player strip is expanded into the
           full overlay. Tapping it collapses back to the strip. Sibling of the
           .stage children so it sits inside .stage and never covers the
           .actionbar below. -->
      <div
        class="scrim"
        :class="{ active: expanded }"
        aria-hidden="true"
        @click="expanded = false"
      ></div>
    </div>

    <!-- Floating action bar: absolutely positioned over the BOTTOM of the game
         area (full width) so showing or growing it NEVER reflows or moves the
         board. Its options list caps at 5 rows and scrolls; the board reserves
         the panel's measured height as scroll room so anything it floats over
         stays reachable. -->
    <div class="actionbar" role="region" aria-label="Actions" data-testid="bs-actionbar">
      <!-- ⋯ controls menu: always at the far left of the bar, and in platform
           mode the sole control surface (GameHeader is hidden there). Its
           CONTENTS are the adapter's — a table's carries undo, hints, heatmap
           and the tutorial, none of which a world has. -->
      <slot name="controls"></slot>

      <!-- The bar is up when the viewer may act, or when a simultaneous step is
           still waiting on somebody. -->
      <template v-if="mayAct || (awaitingPlayers?.length ?? 0) > 0">
        <!-- Identity token at the head of the bar, so it always carries WHO
             (IA-02) regardless of whether the panel or the prompt strip renders
             the WHAT. -->
        <PlayerToken
          v-if="panelToken"
          class="turn-token"
          :name="panelToken.name"
          :seat="panelToken.seat"
          :color="panelToken.color"
          :size="30"
        />
        <!-- Prompt strip: the fallback surface, shown ONLY when the platform
             takes the panel away entirely (the D-02 escape hatch). The prompt
             survives even when no panel renders (IA-03) — never a silent board
             with no indication of what is wanted. -->
        <span v-if="platformActionPanelEscapeHatch" class="turn">
          <span class="pr">{{ prompt }}</span>
        </span>
        <template v-else>
          <!-- The panel always carries at least one operable control — including
               in the all-board-anchored case, where it renders its
               anchored-choices button list ("Select on board or choose here").
               That focusable list is the keyboard/SR safety net (A11Y C-2):
               custom UIs whose board isn't keyboard-operable still expose an
               operable control. -->
          <slot name="action-panel">
            <ActionPanel
              data-testid="bs-action-panel"
              :available-actions="availableActions"
              :action-metadata="actionMetadata"
              :is-action-help-visible="isActionHelpVisible"
              :disabled-actions="disabledActions"
              :players="players"
              :player-seat="playerSeat"
              :is-my-turn="mayAct"
              :completed="completed"
              :can-undo="canUndo"
              :auto-end-turn="autoEndTurn"
              :messages="messages"
              :current-player-name="currentPlayerName"
              :current-player-color="currentPlayerColor"
              :awaiting-players="awaitingPlayers"
              @undo="emit('undo')"
            />
          </slot>
          <slot name="actionbar-extra"></slot>
        </template>
      </template>
    </div>

    <!-- The adapter's debug surface: one placement, one keyboard shortcut, one
         transport, and a tab set the adapter declares. -->
    <div v-if="$slots.debug" data-testid="bs-debug">
      <slot name="debug"></slot>
    </div>

    <!-- The single tooltip every dimmed control borrows to explain itself.
         Mounted once here rather than per-button: at most one shows at a time,
         and a teleported node per compass point / card / option is waste. -->
    <DisabledReasonTooltip />

    <!-- ONE VOICE FOR REFUSALS. A refusal you can PREDICT is a greyed control
         with a reason (the tooltip above, fed by `disabledActions`); a refusal
         you can only discover by TRYING is a sentence next to the thing you
         tried. Both backends now agree on that rule, so both speak it through
         the same component. -->
    <Toast />
  </div>
</template>

<style scoped>
/* THE GAME SCREEN, and the positioning context for the floating action bar.
   The class name is unchanged: it is the box `.game-shell--platform` sizes from
   the adapter above, and a rename would have been a rename in two files for no
   reason. */
.game-shell__game {
  display: flex;
  flex-direction: column;
  height: 100vh; /* fallback: browsers without dvh support */
  height: 100dvh;
  position: relative;

  /* ── Action Panel footprint tokens ────────────────────────────────────────
     Defined HERE rather than on the adapter's root, because every one of them
     describes the action bar and the action bar is this component's. A world
     shell inherits them by mounting this, and neither adapter has to know the
     numbers exist.

     The board is fitted above a CONSTANT reserved footprint, never above the
     panel's measured height. The panel's height legitimately changes on every
     selection step, so it has no single value and a fit that reserved it was
     not reproducible between two loads of the same state (issue #13). These
     tokens are derived from the panel's own control metrics, so there is one
     definition of a "row" for both the ceiling and the reservation. */
  --bsg-panel-row: 44px;   /* one control row: the WCAG 2.5.8 touch-target floor */
  --bsg-panel-gap: 8px;    /* .actionbar row gap */
  --bsg-panel-pad: 9px;    /* .actionbar vertical padding */

  /* Visual ceiling: the panel's content lays out inside this and scrolls past it. */
  --bsg-panel-max: calc(5 * var(--bsg-panel-row) + 4 * var(--bsg-panel-gap)
                        + 2 * var(--bsg-panel-pad) + env(safe-area-inset-bottom));

  /* Reserved footprint the board is fitted above: TWO rows. The panel has two
     resting states a player sits in between picks -- the action-choice row (which
     routinely wraps once on a phone) and prompt + one row of choices during a
     pick. One row guarantees routine overlap; three would cost 158px of board on
     every load to buy headroom that only many-choice moments need, and internal
     scroll already serves those. */
  --bsg-panel-reserved: min(
    calc(2 * var(--bsg-panel-row) + var(--bsg-panel-gap)
         + 2 * var(--bsg-panel-pad) + env(safe-area-inset-bottom)),
    var(--bsg-panel-max)
  );
}

/* Stage: sidebar + boardregion side by side; fills remaining height */
.stage {
  flex: 1;
  min-height: 0;
  display: flex;
  position: relative;
}

/* Sidebar: always-visible player status + history; collapses to rail (IA-06) */
.sidebar {
  flex: none;
  width: clamp(220px, 22vw, 320px);
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bsg-surface);
  border-right: 1px solid var(--bsg-line);
  position: relative;
  transition: width var(--bsg-dur-base) cubic-bezier(.4, 0, .2, 1);
}

/* Rail mode: slim sidebar showing only icon tokens (IA-06) */
.sidebar.rail {
  width: var(--bsg-rail);
}
.sidebar.rail .side-scroll {
  padding: var(--bsg-s2) 0;
}
/* In rail, hide sidebar text labels; keep only the player tokens visible */
.sidebar.rail :deep(.player-name-row),
.sidebar.rail :deep(.you-badge) {
  display: none;
}
/* History hidden in rail mode */
.sidebar.rail .sidebar-history {
  display: none;
}

/* Rail toggle button: floats on the right edge of the sidebar */
.side-edge {
  position: absolute;
  top: 14px;
  right: -13px;
  z-index: 6;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--bsg-surface);
  border: 1px solid var(--bsg-line);
  box-shadow: var(--bsg-shadow-sm);
  color: var(--bsg-ink-2);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.side-edge svg {
  width: 15px;
  height: 15px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  transition: transform var(--bsg-dur-fast);
}
.sidebar.rail .side-edge svg {
  transform: rotate(180deg);
}

/* Scrim: transparent cover over board area; visible only on mobile when the player
   strip is expanded into the overlay (IA-06). Inside .stage so it never covers the
   .actionbar sibling below. */
.scrim {
  position: absolute;
  inset: 0;
  z-index: 45;
  background: rgba(0, 0, 0, .5);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--bsg-dur-base);
}
.scrim.active {
  opacity: 1;
  pointer-events: auto;
}

/* Mobile player strip (one-line icons + expand toggle). Hidden on desktop;
   shown only inside the mobile @media block below. */
.mobile-strip {
  display: none;
}

/* Side scroll: players panel + game history (scrollable) */
.side-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--bsg-s3);
}

/* Connection health dot: absolute corner of boardregion; platform mode only (IA-01).
   Class bound to connectionHealth ref: connected / stale / connecting. */
.conn-dot {
  position: absolute;
  top: var(--bsg-s2);
  right: var(--bsg-s2);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--bsg-away);
  z-index: 5;
  pointer-events: none;
}
.conn-dot.connected { background: var(--bsg-ok); }
.conn-dot.stale     { background: var(--bsg-warn); }
.conn-dot.connecting { background: var(--bsg-away); }

/* Board region: hero; container-query-sized; ~zero chrome padding (IA-05).
   The board renders at its NATURAL size, pinned top-left; at startup a
   one-shot fit (useAutoZoom) zooms it to fill this region without scrolling,
   clamped to the 0.5–2.0 slider range, then leaves it alone. Whenever the
   board — grown mid-game, clamped, or manually zoomed — is larger than the
   region, this region scrolls (both axes): scroll is the contract after
   startup, never clipping and never auto-rescaling. */
.boardregion {
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  overflow: auto;
  /* Reserve scrollbar space so a fit landing near the overflow boundary can't
     toggle the scrollbar on/off, which would change clientWidth/clientHeight
     and create a resize-observer feedback path into useAutoZoom's re-fit. */
  scrollbar-gutter: stable;
  padding: var(--bsg-s1);
  /* The Action Panel's reserved footprint is LAYOUT, not arithmetic: the region's
     own padding excludes it, so the fit's `region.clientHeight - padding` already
     accounts for it and nothing in JS has to know the panel exists. It is a
     constant, so this padding never changes and the persistent region observer
     fires only on genuine viewport changes. Includes the safe-area inset. */
  padding-bottom: var(--bsg-panel-reserved);
}

/* Floating Action Panel: absolutely anchored to the bottom, FULL WIDTH (spans under
   the sidebar too). Out of flow, so it never reflows/moves the board — it floats over
   the board's bottom; the board reserves a CONSTANT footprint (--bsg-panel-reserved,
   in .boardregion's padding) plus scroll room up to the panel's ceiling, so covered
   content stays reachable however tall the panel grows. Everything inside wraps
   naturally (flex-wrap) — no reserved columns; the options list caps at 5 rows and scrolls. */
.actionbar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 30;
  background: var(--bsg-surface);
  border-top: 1px solid var(--bsg-line);
  box-shadow: var(--bsg-shadow);
  /* One inline-wrapping flow: the ⋯ menu, player token, prompt text, cancel, and
     every option button are flattened into THIS flex container (ActionPanel wrappers
     use display:contents) so they wrap together like words in a sentence — no header
     row / carriage return before the buttons. */
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  align-content: flex-start;
  gap: 8px;
  padding: 9px var(--bsg-s4);
  padding-bottom: calc(9px + env(safe-area-inset-bottom));
  /* Cap at 5 button-rows, then the whole flow scrolls. The ⋯ menu popover teleports
     to <body>, so overflow is safe. */
  max-height: var(--bsg-panel-max);
  overflow-y: auto;
}

/* ⋯ controls menu — first item in the inline action bar flow. */
.actionbar-controls {
  margin-right: 4px;
}

/* Active-player identity token — flows inline right after the ⋯ menu. */
.turn-token {
  margin-right: 4px;
}

/* The token in a simultaneous step gets NO decoration of its own — it is drawn
   exactly as the whose-turn token is. Do not add a ring, outline, or opacity
   here: a treatment on the identity glyph reads as an unexplained decoration
   rather than as meaning, and it competes with shape, which is the stable
   identity channel and the only one in a colourless game. Which seat the token
   names is `panelToken`'s job; how it looks never varies. */

/* Turn strip: prompt sentence (fallback when ActionPanel is not rendering) */
.turn {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px 0 4px;
  min-height: 46px;
  border-right: 1px solid var(--bsg-line);
  margin-right: 4px;
}
.turn .pr {
  font-size: 13.5px;
  color: var(--bsg-ink);
  font-weight: 600;
}

/* ─── Responsive Tiers (IA-06) ──────────────────────────────────────────────
   Shared breakpoint scale: 640 / 768 / 1024 / 1440.
   @media queries drive shell chrome; @container for renderer reflow (plan 100-02).
   one-line player-icon strip across the top; tapping its chevron opens the full
   players + log as an overlay over the board (never the action bar), with a scrim. */
@media (max-width: 639px) {
  .stage {
    flex-direction: column;
  }
  /* Sidebar = just the strip height by default; positioned so the expanded overlay
     (top:100%) anchors right below the strip. */
  .sidebar,
  .sidebar.rail {
    position: relative;
    width: 100%;
    flex: none;
    max-height: none;
    overflow: visible;
    border-right: none;
    border-bottom: 1px solid var(--bsg-line);
    box-shadow: none;
  }
  /* The desktop rail toggle has no role on phones. */
  .side-edge {
    display: none;
  }
  /* Compact strip: player icons on the left, expand chevron on the right. */
  .mobile-strip {
    display: flex;
    align-items: center;
    gap: var(--bsg-s2);
    padding: 6px var(--bsg-s3);
  }
  .mobile-strip__players {
    flex: 1;
    min-width: 0;
  }
  /* Strip icons hug the left and never wrap to a second row. */
  .mobile-strip :deep(.seat-strip) {
    justify-content: flex-start;
  }
  .mobile-strip :deep(.strip-tokens) {
    flex-wrap: nowrap;
    justify-content: flex-start;
  }
  /* Un-hide the turn-status sentence in the phone strip so off-turn players can
     READ whose turn it is (the desktop rail keeps it icon-only — see PlayersPanel).
     Scoped to .mobile-strip so only the wide phone bar gets the text. */
  .mobile-strip :deep(.strip-status) {
    display: inline-block;
    margin-left: var(--bsg-s2);
    font-size: 13px;
    font-weight: 600;
    color: var(--bsg-accent);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .mobile-strip__unread {
    position: absolute;
    top: -2px;
    right: -2px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    box-sizing: border-box;
    display: grid;
    place-items: center;
    border-radius: 999px;
    /* Accent on the page background rather than white on accent: the accent is
       a mid-tone in both themes, so white text on it does not carry. */
    background: var(--bsg-accent);
    color: var(--bsg-bg);
    font-size: 10px;
    font-weight: 600;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }

  .mobile-strip__toggle {
    flex: none;
    display: grid;
    place-items: center;
    position: relative;
    width: 32px;
    height: 32px;
    border-radius: var(--bsg-r-sm);
    background: transparent;
    border: 1px solid var(--bsg-line);
    color: var(--bsg-ink-2);
    cursor: pointer;
  }
  .mobile-strip__toggle svg {
    width: 16px;
    height: 16px;
    stroke: currentColor;
    fill: none;
    stroke-width: 2;
    transition: transform var(--bsg-dur-fast);
  }
  .sidebar.mobile-expanded .mobile-strip__toggle svg {
    transform: rotate(180deg);
  }
  /* Full panel + log: hidden by default; shown as an overlay below the strip when
     expanded (board stays the hero underneath, dimmed by the scrim). */
  .side-scroll {
    display: none;
  }
  /* Lift the whole sidebar (strip + overlay) above the scrim so the toggle stays tappable. */
  .sidebar.mobile-expanded {
    z-index: 50;
    background: var(--bsg-surface);
  }
  .sidebar.mobile-expanded .side-scroll {
    display: block;
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    max-height: 60dvh;
    overflow-y: auto;
    background: var(--bsg-surface);
    border-bottom: 1px solid var(--bsg-line);
    box-shadow: var(--bsg-shadow);
  }
  /* Phones use the SAME 5-row Action Panel row cap as desktop (no override) — the base
     .actionbar max-height applies. */
}

/* Medium (640px–1023px): standard sidebar + board. Lower bound aligns with the
   compact ceiling (639px) so 640–767px is a real tier, not an untiered gap. */
@media (min-width: 640px) and (max-width: 1023px) {
  .boardregion {
    min-height: 380px;
  }
}

/* Large (≥1024px): wider board min-height. The board is NOT centered or width-capped
   — many games have more content than fits the viewport, so the board sits top-left
   and the region scrolls (both axes) when the board is larger than the viewport. */
@media (min-width: 1024px) {
  .boardregion {
    min-height: 480px;
  }
}

/* Landscape phone (short screen): prevent the actionbar from crushing the board.
   The stage already uses the row layout (sidebar | board); this branch only
   reduces the actionbar height cap so the board retains adequate vertical space. */
@media (orientation: landscape) and (max-height: 600px) {
  .game-shell__game {
    --bsg-panel-max: min(22dvh, 120px);
    /* One row on a short screen: vertical space is the scarce axis here. */
    --bsg-panel-reserved: min(
      calc(var(--bsg-panel-row) + 2 * var(--bsg-panel-pad) + env(safe-area-inset-bottom)),
      var(--bsg-panel-max)
    );
  }

  .actionbar {
    padding-top: 6px;
    padding-bottom: max(6px, env(safe-area-inset-bottom));
  }
}

.game-shell__zoom-container {
  --zoom-level: 1;
  /* Size to the board's NATURAL content (not stretched to the region), so the board
     keeps its intrinsic size top-left and the region scrolls when it's bigger. */
  flex: none;
  width: max-content;
  max-width: none;
  /* Use the `zoom` property (not transform): it scales the LAYOUT box, so a
     zoomed-up board genuinely overflows .boardregion and becomes scrollable in both
     axes (the board has an intrinsic size to multiply) — unlike transform:scale,
     which only shifts the paint and left the board un-scrollable / drifting sideways. */
  zoom: var(--zoom-level);

  /* Total clearance below the board = .boardregion's padding-bottom
     (--bsg-panel-reserved) + this margin = --bsg-panel-max, the panel's ceiling.
     So even a panel grown to its full 5 rows can always be scrolled clear of, while
     the board is still FITTED against only the constant reserved footprint.
     Divided by --zoom-level because `zoom` scales this element's whole layout box,
     margin included: at zoom 0.82 an undivided margin delivered only 82% of the
     clearance and the board's last ~27px stayed pinned under the panel. */
  margin-bottom: calc((var(--bsg-panel-max) - var(--bsg-panel-reserved)) / var(--zoom-level));

  /* CONTAINMENT: Prevents position:fixed from escaping to viewport.
     Any fixed-position elements inside will behave like absolute positioning
     relative to this container - they cannot cover the navbar or ActionPanel. */
  contain: layout;
}

/* Sanctioned full-board-region overlay layer for custom-UI modals (see the
   #bs-game-modal host in the template). Fills .boardregion exactly (like the
   GameOverCard scrim) so a game modal covers the board but not the chrome, and
   `contain: layout` keeps a teleported position:fixed overlay confined to this
   box — the board cannot be escaped. */
.game-shell__game-modal-host {
  position: absolute;
  inset: 0;
  /* Same stacking level as the GameOverCard scrim: above the board content and
     the tutorial/hint/heatmap overlays, but NOT above the floating .actionbar
     Action Panel (also z-index 30, a later sibling that therefore stays on top). A game
     modal covers the board area only — never the Action Panel/header chrome. */
  z-index: 30;
  contain: layout;
  /* Transparent to pointer events when no modal is open; a teleported modal
     (a direct child) re-enables them, so it blocks the board as expected. */
  pointer-events: none;
}
.game-shell__game-modal-host > * {
  pointer-events: auto;
}

/* GameHistory when used in sidebar (not standalone left column) */
.sidebar-history {
  width: 100% !important;
  min-width: unset !important;
  border-right: none !important;
  border-top: 1px solid var(--bsg-line);
  height: auto !important;
  max-height: 300px;
  margin-top: 20px;
  border-radius: 8px;
  overflow: hidden;
}

</style>
