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

      <div v-if="host.view.value === null" class="world-shell__waiting">
        <h1>{{ worldTitle }}</h1>
        <p>Looking around…</p>
      </div>

      <component
        :is="ui"
        v-else
        :view="host.view.value"
        :seat="host.seat.value"
        :commands="host.commands.value"
        :acting="host.acting.value"
        :world-name="host.worldName.value"
        :presence="host.presence.value"
        @act="onAct"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, type Component } from 'vue';
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
  /** The game's own world UI. Handed `view`, `seat`, `commands`, `acting`,
   *  `worldName` and `presence`, and expected to emit `act(command, args)`. */
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
  commands: host.commands,
  notice: host.notice,
  worldName: host.worldName,
  presence: host.presence,
  acting: host.acting,
  act: host.act,
});

/** A UI that emits rather than injecting gets the same verb. The outcome is
 *  dropped here on purpose: a component that wants the world's sentence back
 *  calls `useWorld().act()` and awaits it. */
function onAct(command: string, args: Record<string, unknown> = {}): void {
  void host.act(command, args);
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

.world-shell__silent,
.world-shell__refused,
.world-shell__waiting {
  max-width: 42rem;
  margin: 0 auto;
}
</style>
