<template>
  <div class="world-shell">
    <!--
      NOBODY HAS SPOKEN TO THIS FRAME.

      Said out loud rather than left as a blank board, because a world UI that
      has been told nothing looks exactly like a world with nothing in it --
      the confusion ShufflewickPub #95 was about, arriving here by a different
      road. A frame reaches this state only when the page hosting it never sent
      a `world_state`, which is a host bug and not a world state.

      It is deliberately NOT the platform's "this world's UI is missing": that
      one answers "there was nothing to load", and this code could not be
      running if that were true. The two are mutually exclusive by construction
      and neither can report the other's fault (ShufflewickPub #357).
    -->
    <div v-if="host.hostSilent.value && !host.heardFromHost.value" class="world-shell__silent">
      <h1>{{ displayName }}</h1>
      <p>
        The page hosting this world has not sent it any state. Nothing is wrong
        with the world itself -- this frame simply has not been told about it.
      </p>
    </div>

    <!-- REFUSED. The host's own sentence, shown as written: it is the one the
         player can act on ("you are not a member of this world"). A door, not a
         refusal -- which is why it is a full surface rather than the toast every
         refused ACTION speaks through, and why it stays here rather than moving
         into the shared chrome a table also renders. -->
    <div v-else-if="host.phase.value === 'refused'" class="world-shell__refused" role="alert">
      <h1>{{ worldTitle }}</h1>
      <p>{{ host.notice.value ?? 'This world did not let you in.' }}</p>
    </div>

    <!-- NO VIEW YET. Narration alone does not draw a board: a frame that has
         only been narrated at has been told nothing about what the world IS,
         and mounting the chrome over a null view would put an empty room on
         screen for a world that has simply not answered yet. -->
    <div v-else-if="host.view.value === null" class="world-shell__waiting">
      <h1>{{ worldTitle }}</h1>
      <p>Looking around…</p>
    </div>

    <PlayShell
      v-else
      :players="play.players.value"
      :player-seat="host.seat.value ?? -1"
      :present-seats="host.presence.value"
      :messages="play.messages.value"
      :log-empty-text="LOG_EMPTY_TEXT"
      :may-act="play.mayAct.value"
      :available-actions="play.availableActions.value"
      :action-metadata="play.actionMetadata.value"
      :disabled-actions="play.disabledActions.value"
      :panel-token="panelToken"
      :prompt="actionController.currentPick.value?.prompt"
      :connection="connectionIndicator"
      v-model:sidebar-rail="sidebarRail"
      v-model:mobile-expanded="mobileExpanded"
      :is-compact="isCompact"
    >
      <!-- LOST. The last view stays on screen, marked as no longer live: it is
           the only thing the player has, and taking it away tells them nothing
           the banner does not already say. -->
      <template v-if="host.phase.value === 'lost' || host.recovering.value" #board-overlays>
        <p v-if="host.phase.value === 'lost'" class="world-shell__lost" role="alert">
          {{ host.notice.value ?? 'The connection to this world dropped. This is the last view it sent.' }}
        </p>
        <!-- AN ORDER THIS PAGE CAME BACK HOLDING, being asked about (#195). It
             is said out loud because the world may be about to change under the
             player without them having pressed anything. -->
        <p v-else class="world-shell__recovering" role="status">
          Checking what became of something you sent before this page reloaded…
        </p>
      </template>

      <template #board>
        <!-- `boardHostReady` gate (#204): a board mounts one tick after
             the chrome is in the document, so a game's documented
             `<Teleport to="#bs-game-modal">` always finds the host `PlayShell`
             renders. `GameShell` holds a table's board back for exactly this
             reason; the guarantee is the SHELL's, so both give it. -->
        <component
          v-if="boardHostReady && boardComponent"
          :is="boardComponent"
          :game-view="play.gameView.value"
          :players="play.players.value"
          :my-player="play.myPlayer.value"
          :player-seat="host.seat.value ?? -1"
          :is-my-turn="play.mayAct.value"
          :available-actions="play.availableActions.value"
          :action-args="actionController.currentArgs.value"
          :set-board-prompt="() => {}"
          :action-controller="actionController"
          :is-action-help-visible="false"
          :disabled-actions="play.disabledActions.value"
          :presence="host.presence.value"
          :events="host.events.value"
          :world-name="host.worldName.value"
          :phase="host.phase.value"
        />
        <!-- Only reachable if the registry's default entry resolved to no
             component — a broken uis.ts. Name the fix, don't render blank.
             It waits for the same tick, so a shell that has not finished
             mounting never accuses a game's uis.ts of being broken. -->
        <div v-else-if="boardHostReady" class="empty-game-area">
          <p>No board to render. Mark one UI with defaultUI() in src/ui/uis.ts.</p>
        </div>
      </template>
    </PlayShell>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useWorldHost } from './useWorldHost.js';
import { useWorldPlay } from './useWorldPlay.js';
import { WORLD_CONTEXT_KEY } from './useWorld.js';
import { provide } from 'vue';
import PlayShell, { type PlayConnection } from '../components/PlayShell.vue';
import { resolveUiComponent, type GameUIRegistry } from '../game-uis.js';
import { useActionController } from '../composables/useActionController.js';
import { createBoardInteraction, provideBoardInteraction } from '../composables/useBoardInteraction.js';
import { useBoardActionBridge } from '../composables/useBoardActionBridge.js';
import { providePlayContext } from '../composables/useGameContext.js';
import { useToast } from '../composables/useToast.js';
import { applyTheme, BREAKPOINTS } from '../theme.js';

/**
 * A BUNDLE'S OWN SURFACE FOR A RESIDENT WORLD (ShufflewickPub #128, #170).
 *
 * `GameShell`'s twin, and still deliberately not a mode of it -- but for a
 * narrower reason than before. `GameShell` is ~2,700 lines and most of them are
 * a table's LIFECYCLE: the lobby, the waiting room, the standalone connection,
 * flow, undo, time travel, bots, the flow boundary key stamped on every op,
 * game over. A world has none of that and never will.
 *
 * What it DOES have, since #169, is the same action system a table has. So both
 * shells are transport-and-lifecycle adapters over one chrome (`PlayShell`) and
 * one controller (`useActionController`), and this file is the world's adapter:
 * the wire, the four phases, the hello timeout, and the four states the game
 * should never have to write itself.
 *
 * WHAT THIS SHELL OWNS: a host that has said nothing, a world that refused you,
 * a world that has not answered yet, and a dropped connection. WHAT THE GAME
 * OWNS: the BOARD, and only the board -- a custom UI is a board area inside the
 * shared shell, never a replacement for it.
 */
const props = defineProps<{
  /**
   * The game's UI registry, from `src/ui/uis.ts` -- the same one a table
   * declares, and the reason `WorldShell` no longer takes a single `ui`
   * component with a hand-rolled prop bag.
   *
   * A world had no registry because (said `validate.ts`) it had "no turn, no
   * flow position and no action table to switch boards over". #169 gave it an
   * action table, so the reason expired: the dev UI switcher works for a world
   * now, and `devUI(() => import('boardsmith/ui/auto-ui'))` makes AutoUI a
   * world's default board with no new renderer at all -- a world's view IS the
   * serialized element tree a table's is.
   */
  uis: GameUIRegistry;
  /** What to call this game before the host has said what this world is called. */
  displayName: string;
  /** Origins allowed to talk to this frame. See `GameShellInit.isOriginAllowed`. */
  trustedOrigins?: string[];
}>();

/**
 * WHAT AN EMPTY WORLD LOG MEANS, which is not what an empty table log means.
 *
 * A table's log is state: re-sent whole, durable across a reload, the whole
 * history. A world's is a live tail bounded at 200 lines that starts empty on
 * every mount and is gone on reload. "No activity yet" here would be a claim
 * about a silence the log has no way to know about.
 */
const LOG_EMPTY_TEXT = 'Nothing has been said since you arrived';

const host = useWorldHost({ trustedOrigins: props.trustedOrigins });
const play = useWorldPlay(host);
const toast = useToast();

/** The world's own name once the host has said it, and the game's until then --
 *  two worlds of the same game have different names and only one is this one. */
const worldTitle = computed(() => host.worldName.value ?? props.displayName);

const isDevBuild = import.meta.env.DEV;
const selectedUiName = ref('');
const boardComponent = computed(() =>
  resolveUiComponent(props.uis, selectedUiName.value, isDevBuild),
);

const playerSeat = computed(() => host.seat.value ?? -1);

/**
 * THE TABLE'S CONTROLLER, UNCHANGED, WITH A WORLD'S ANSWERS.
 *
 * Everything it needs is injected, and nothing in it knows what a table is. The
 * one piece that has to be a world's own is `fetchPickChoices`: a world's offer
 * arrives with every selection's candidates resolved, so the answer is already
 * in hand and no round trip happens. See `useWorldPlay` for why that is an
 * adapter rather than a change to the controller.
 *
 * `pickStep` and `cancelPendingAction` are absent because a world has no
 * step-wise protocol to reach: a submit carries every selection at once.
 */
const actionController = useActionController({
  sendAction: play.sendAction,
  availableActions: play.availableActions,
  actionMetadata: play.actionMetadata,
  isMyTurn: play.mayAct,
  disabledActions: play.disabledActions,
  gameView: play.gameView as never,
  playerSeat,
  fetchPickChoices: play.fetchPickChoices,
});

/**
 * THE OTHER HALF OF #169: A REFUSAL THE PANEL EARNED.
 *
 * `act()` below covers a board that EMITS. But the board a world with no board
 * of its own gets — the supported shape since #170/#181 — never calls `act()`:
 * its player presses the SHARED ACTION PANEL, which submits through the
 * controller. A refusal there only sets `lastError` and bumps `errorTick`, and
 * with nobody in this shell watching, a refused command was invisible on the
 * generic board — the player pressed a button and the page said nothing.
 *
 * `GameShell` watches the same pair for the same reason, and watching
 * `errorTick` rather than `lastError` is load-bearing there and here: a
 * repeated IDENTICAL refusal leaves the string unchanged, so a watch on the
 * message alone would silently drop the second one.
 */
watch(actionController.errorTick, () => {
  const refusal = actionController.lastError.value;
  if (!refusal) return;
  toast.show(refusal, { type: 'error', duration: 5000 });
});

/**
 * WHAT BECAME OF AN ORDER THIS PAGE CAME BACK HOLDING (#195).
 *
 * A page that reloaded mid-order asks the world about it again, with the same
 * identity, before the player touches anything. They are asked nothing and see
 * no sequence number -- but they are TOLD, because "the colony you founded was
 * already founded" and "nobody can say whether it was" are both things a player
 * is entitled to know before they press the button again.
 */
watch(host.recoveryNotice, (notice) => {
  if (notice === null) return;
  toast.show(notice, { type: 'info', duration: 8000 });
});

/**
 * THE BOARD SUBSTRATE, SHARED VERBATIM.
 *
 * `useBoardInteraction` is pure element-ref plumbing and reads no game state,
 * and the bridge feeds the board off the controller's `validElements` -- which
 * is precisely why the local `fetchPickChoices` above is load-bearing rather
 * than a nicety. Without it a pre-filled offer would light the action panel and
 * leave the board dead, which is the divergence the bridge exists to forbid.
 */
const boardInteraction = createBoardInteraction();
provideBoardInteraction(boardInteraction);
useBoardActionBridge({
  controller: actionController,
  boardInteraction,
  isMyTurn: play.mayAct,
  autoEndTurn: computed(() => true),
  actionMetadata: play.actionMetadata,
  availableActions: play.availableActions,
  disabledActions: play.disabledActions,
  // A world checkpoints on dirty and keeps no per-action snapshot, so there is
  // no history to view and no restore epoch to invalidate a pick against.
  isViewingHistory: computed(() => false),
  restoreEpoch: computed(() => undefined),
});

providePlayContext({
  gameView: play.gameView,
  players: play.players,
  myPlayer: play.myPlayer,
  playerSeat,
  isMyTurn: play.mayAct,
  availableActions: play.availableActions,
  actionController,
  platformRequest: async () => ({}),
  presentation: ref(undefined),
  debugHighlight: ref(null),
});

provide(WORLD_CONTEXT_KEY, {
  phase: host.phase,
  view: host.view,
  seat: host.seat,
  actions: host.actions,
  notice: host.notice,
  worldName: host.worldName,
  presence: host.presence,
  events: host.events,
  acting: host.acting,
  act,
});

/** The identity token at the head of the action bar: always the VIEWER's own
 *  seat. A world has no turn, so there is no other claim it could make. */
const panelToken = computed(() => play.myPlayer.value ?? null);

/**
 * THE ATTACHMENT LIFECYCLE, THROUGH ONE SHARED INDICATOR (#170 §2.5).
 *
 * Deliberately NOT merged with a table's socket health: this axis has states a
 * table has no analogue for. Only the dot is shared; the two state machines are
 * not, and `refused` never reaches here at all because it is a full surface.
 */
const connectionIndicator = computed<PlayConnection | null>(() => {
  if (host.phase.value === 'watching') return null;
  if (host.phase.value === 'lost') {
    return { tone: 'lost', title: 'The connection to this world dropped.' };
  }
  return { tone: 'attaching', title: 'Attaching to this world…' };
});

/**
 * WHY AN EMITTED ACT'S REFUSAL IS THE SHELL'S TO SHOW.
 *
 * `useWorld().act()` RETURNS the outcome, so a board that injects it already
 * has the world's sentence and decides where it belongs. A board that EMITS has
 * no return value to hold, and this used to drop the outcome on the floor: a
 * player pressed a button, the world refused, and nothing at all appeared.
 *
 * It speaks through `Toast`, which is where a TABLE's post-hoc refusals go, so
 * the two backends refuse in one voice. The rule both now share: a refusal you
 * can PREDICT is a greyed control with a reason (that is `disabled` on the
 * offer, reaching the panel through `disabledActions`); a refusal you can only
 * discover by TRYING is a sentence next to the thing you tried.
 */
async function act(command: string, args: Record<string, unknown> = {}) {
  const outcome = await host.act(command, args);
  // A refusal RESOLVES rather than throwing -- a world refuses legitimately --
  // so `ok` is the only place the answer lives. A refusal with no message is a
  // host that answered without saying anything, which the player still has to
  // be told about rather than left guessing at.
  if (!outcome.ok) {
    toast.show(outcome.message ?? 'The world refused that, and did not say why.', {
      type: 'error',
      duration: 5000,
    });
  }
  return outcome;
}

// ── Chrome layout state, the shell's own ──────────────────────────────────────
const sidebarRail = ref(false);
const mobileExpanded = ref(false);
const isCompact = ref(false);
let compactQuery: MediaQueryList | null = null;
function trackCompact(event: MediaQueryListEvent | MediaQueryList): void {
  isCompact.value = event.matches;
  if (!event.matches) mobileExpanded.value = false;
}

/**
 * WHETHER THE MODAL HOST A BOARD TELEPORTS INTO IS IN THE DOCUMENT YET (#204).
 *
 * A game's board is told to open a modal with the documented plain
 * `<Teleport to="#bs-game-modal">`, and the host that selector names is
 * `PlayShell`'s. Vue resolves a Teleport's target at MOUNT, against the real
 * document -- so a board that mounts in the same pass as the host it aims at
 * gets a null target, two warnings, and a modal that is simply absent when the
 * player opens it.
 *
 * `GameShell` holds a table's board back one tick for exactly this reason, and
 * a world needs the same guarantee for a different arrival: this shell draws
 * FOUR states before `PlayShell` exists at all (nobody has spoken, refused, no
 * view yet), so the chrome -- and the host inside it -- arrives with the first
 * view rather than with this component. The wait is therefore for the CHROME,
 * not for this shell: a tick after `PlayShell` renders, the host is in the
 * document and the documented pattern works.
 */
const boardHostReady = ref(false);
watch(
  () => host.view.value !== null && host.phase.value !== 'refused',
  async (chromeDrawn) => {
    if (!chromeDrawn) return;
    await nextTick();
    boardHostReady.value = true;
  },
  { immediate: true },
);

onMounted(() => {
  // THE CHROME HAS TO HAVE TOKENS TO BE DRAWN IN. `PlayShell` is written in
  // `--bsg-*` throughout, and nothing else emits them -- `GameShell` calls this
  // for the same reason. A host re-themes by overriding the same tokens, so a
  // world embedded in ShufflewickPub picks up the platform's palette exactly as
  // a table does.
  applyTheme();
  host.start();
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    compactQuery = window.matchMedia(`(max-width: ${BREAKPOINTS.compact - 1}px)`);
    trackCompact(compactQuery);
    compactQuery.addEventListener('change', trackCompact);
  }
});
onUnmounted(() => {
  host.stop();
  compactQuery?.removeEventListener('change', trackCompact);
});

defineExpose({ host });
</script>

<style scoped>
.world-shell {
  min-height: 100vh;
  min-height: 100dvh;
  box-sizing: border-box;
  font-family: var(--bsg-font);
  background: var(--bsg-bg);
  color: var(--bsg-ink);
}

/* The three full surfaces the shell owns: they replace the chrome rather than
   sitting inside it, because in each of them there is no world to draw. */
.world-shell__silent,
.world-shell__refused,
.world-shell__waiting {
  max-width: 42rem;
  margin: 0 auto;
  padding: 1rem;
}

/* LOST sits over the board region, marking the last view as no longer live. */
.world-shell__lost {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
  margin: 0;
  padding: 0.75rem 1rem;
  background: #4a3410;
  color: #f7e6c4;
}

.empty-game-area {
  padding: 2rem;
  color: var(--bsg-ink-2);
}
</style>
