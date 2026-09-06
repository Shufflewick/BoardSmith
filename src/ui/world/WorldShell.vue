<template>
  <div class="world-shell">
    <!--
      NOBODY HAS SPOKEN TO THIS FRAME.

      Said out loud rather than left as a blank board, because a world UI that
      has been told nothing looks exactly like a world with nothing in it --
      the confusion ShufflewickPub #95 was about, arriving here by a different
      road. A frame reaches this state only when the page hosting it never sent
      a `world_state`, which is a host bug and not a world state.
    -->
    <div v-if="host.hostSilent.value && !host.heardFromHost.value" class="world-shell__silent">
      <h1>{{ displayName }}</h1>
      <p>
        The page hosting this world has not sent it any state. Nothing is wrong
        with the world itself -- this frame simply has not been told about it.
      </p>
    </div>

    <!-- REFUSED. The host's own sentence, shown as written: it is the one the
         player can act on ("you are not a member of this world"). -->
    <div v-else-if="host.phase.value === 'refused'" class="world-shell__refused" role="alert">
      <h1>{{ worldTitle }}</h1>
      <p>{{ host.notice.value ?? 'This world did not let you in.' }}</p>
    </div>

    <template v-else>
      <!-- LOST. The last view stays on screen, marked as no longer live: it is
           the only thing the player has, and taking it away tells them nothing
           the banner does not already say. -->
      <p v-if="host.phase.value === 'lost'" class="world-shell__lost" role="alert">
        {{ host.notice.value ?? 'The connection to this world dropped. This is the last view it sent.' }}
      </p>

      <!-- WHY THE LAST THING YOU TRIED DID NOT HAPPEN.
           A world refuses constantly and legitimately -- a bare holding, a door
           that is not there -- and the sentence is the one the player can act
           on. A board that emits `act` rather than awaiting `useWorld().act()`
           has nowhere of its own to put that sentence, so the SHELL puts it
           here: this is one of the three states the shell owns precisely
           because a game should never have to write it. Replaced by the next
           attempt and cleared by the one that succeeds, so it can only ever
           describe the thing that just failed. -->
      <p v-if="refusal !== null" class="world-shell__refusal" role="alert">
        {{ refusal }}
      </p>

      <!-- NO VIEW YET. Narration alone does not draw a board: a frame that has
           only been narrated at has been told nothing about what the world IS,
           and mounting the game's UI over a null view would put an empty room
           on screen for a world that has simply not answered yet. -->
      <div v-if="host.view.value === null" class="world-shell__waiting">
        <h1>{{ worldTitle }}</h1>
        <p>Looking around…</p>
      </div>

      <component
        :is="ui"
        v-else
        :view="host.view.value"
        :seat="host.seat.value"
        :actions="host.actions.value"
        :acting="host.acting.value"
        :world-name="host.worldName.value"
        :presence="host.presence.value"
        :events="host.events.value"
        @act="onAct"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref, type Component } from 'vue';
import { useWorldHost } from './useWorldHost.js';
import { WORLD_CONTEXT_KEY } from './useWorld.js';

/**
 * A BUNDLE'S OWN SURFACE FOR A RESIDENT WORLD (ShufflewickPub #128).
 *
 * `GameShell`'s twin, and deliberately not a mode of it. The reasoning is in
 * `worldProtocol.ts`: a table's shell needs a turn, a flow position and an
 * action table to render anything at all, and a world has none of the three.
 * Rather than fabricate them -- which would put buttons on screen for actions
 * the world refuses -- a world mounts this, from the bundle's `world.html`
 * entry, and renders the verbs the world actually declared.
 *
 * WHAT THIS SHELL OWNS: the wire, and the three states a game should never
 * have to write itself -- a host that has said nothing, a refusal, and a
 * dropped connection. WHAT THE GAME OWNS: everything a player looks at once
 * they are in, which is the `ui` component and the whole point of the ticket.
 */
const props = defineProps<{
  /** The game's own world UI. Handed `view`, `seat`, `actions`, `acting`,
   *  `worldName`, `presence` and `events`, and expected to emit
   *  `act(command, args)`. */
  ui: Component;
  /** What to call this game before the host has said what this world is called. */
  displayName: string;
  /** Origins allowed to talk to this frame. See `GameShellInit.isOriginAllowed`. */
  trustedOrigins?: string[];
}>();

const host = useWorldHost({ trustedOrigins: props.trustedOrigins });

/** The world's own name once the host has said it, and the game's until then --
 *  two worlds of the same game have different names and only one is this one. */
const worldTitle = computed(() => host.worldName.value ?? props.displayName);

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
  act: host.act,
});

/**
 * WHY THE EMIT PATH GETS ITS ANSWER SHOWN AND THE INJECTED PATH DOES NOT.
 *
 * `useWorld().act()` RETURNS the outcome, so a board that injects it already
 * has the world's sentence and decides where it belongs -- next to the button
 * that failed, over the room that refused, wherever the game means it. A board
 * that EMITS has no return value to hold, and this used to drop the outcome on
 * the floor: a player pressed a button, the world refused, and nothing at all
 * appeared. That is not degradation, it is silence, and it hid exactly the
 * refusals `boardsmith dev` exists to make identical to the platform's.
 *
 * So an emitted act's refusal is shown by the shell. It is deliberately not
 * pushed back into the emitting board: a board that had to render it would be
 * every board having to write the same three lines, which is the thing the
 * shell is for.
 */
const refusal = ref<string | null>(null);

async function onAct(command: string, args: Record<string, unknown> = {}): Promise<void> {
  refusal.value = null;
  const outcome = await host.act(command, args);
  // A refusal RESOLVES rather than throwing -- a world refuses legitimately --
  // so `ok` is the only place the answer lives. A refusal with no message is a
  // host that answered without saying anything, which the player still has to
  // be told about rather than left guessing at.
  if (!outcome.ok) {
    refusal.value = outcome.message ?? 'The world refused that, and did not say why.';
  }
}

onMounted(host.start);
onUnmounted(host.stop);

defineExpose({ host });
</script>

<style scoped>
.world-shell {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 1rem;
}

.world-shell__lost {
  margin: 0 0 1rem;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  background: #4a3410;
  color: #f7e6c4;
}

.world-shell__refusal {
  margin: 0 0 1rem;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  background: #4a1414;
  color: #f7cdcd;
}

.world-shell__silent,
.world-shell__refused,
.world-shell__waiting {
  max-width: 42rem;
  margin: 0 auto;
}
</style>
