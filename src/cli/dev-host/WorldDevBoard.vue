<script setup lang="ts">
/**
 * A WORLD'S SURFACE WHEN THE BUNDLE HAS NOT WRITTEN ONE.
 *
 * Handed to `WorldShell` by `world-fallback-main.ts`, so it receives exactly
 * what a game's own board receives and emits exactly what one emits. It is a
 * BOARD and not a debug console: it draws the actions the world offered THIS
 * SEAT, the candidates each of their selections actually has, what the world
 * narrated, and the view as the engine projected it.
 *
 * The view is rendered as JSON, and that is the honest answer rather than a
 * shortcut. Only the game knows what its projection MEANS -- a room, a holding,
 * a sector -- so anything else this could draw would be an invented reading of
 * somebody else's data. What it can do without inventing anything is show every
 * byte the seat was actually sent, which is also what an author needs while
 * their `world.view` is still being written.
 */
import { computed, reactive, ref } from 'vue';
import type { PickMetadata, WorldActionOffer, WorldNarration } from '../../ui/world/worldProtocol.js';

const props = defineProps<{
  view: unknown;
  seat: number | null;
  actions: readonly WorldActionOffer[];
  acting: boolean;
  worldName: string | null;
  presence: readonly number[] | null;
  events: readonly WorldNarration[];
}>();

const emit = defineEmits<{ act: [action: string, args: Record<string, unknown>] }>();

/** One draft per action, so filling in `tend`'s neighbour does not clear what
 *  was typed into `say`. */
const drafts = reactive<Record<string, Record<string, unknown>>>({});

/**
 * What a selection is asking for, and the first answer it will accept.
 *
 * An element selection's value is an ELEMENT ID, which is what
 * `chooseElement`'s wire encoding already is -- so this board hands the id
 * straight back and the engine resolves it. That is the whole reason the
 * element form matters: a custom board wires a click on the element to exactly
 * this value with nothing in between.
 */
function firstAnswer(pick: PickMetadata): unknown {
  if (pick.validElements) return pick.validElements.find((e) => !e.disabled)?.id ?? '';
  if (pick.choices) return pick.choices.find((c) => !c.disabled)?.value ?? '';
  return '';
}

function draft(action: WorldActionOffer): Record<string, unknown> {
  drafts[action.name] ??= Object.fromEntries(
    action.selections.map((pick) => [pick.name, firstAnswer(pick)]),
  );
  return drafts[action.name]!;
}

function send(action: WorldActionOffer): void {
  const filled = draft(action);
  const args: Record<string, unknown> = {};
  for (const pick of action.selections) {
    const raw = filled[pick.name];
    // A number selection is declared as one, so it is sent as one. An element
    // selection's id is a number too, and `<select>` hands back strings.
    args[pick.name] =
      pick.type === 'number' || pick.type === 'element' || pick.type === 'elements'
        ? Number(raw)
        : raw;
  }
  emit('act', action.name, args);
}

const label = (pick: PickMetadata): string => pick.prompt || pick.name;

const viewJson = computed(() => JSON.stringify(props.view, null, 2));
const viewOpen = ref(true);
</script>

<template>
  <div class="dev-board">
    <header class="dev-board__head">
      <h1>{{ worldName ?? 'This world' }}</h1>
      <p class="dev-board__meta">
        You are seat {{ seat ?? '—' }}.
        <span v-if="presence">Present: {{ presence.join(', ') || 'nobody' }}.</span>
      </p>
      <p class="dev-board__why">
        This project ships no <code>world.html</code>, so <code>boardsmith dev</code> is showing the
        shell's own surface. It runs the same <code>WorldShell</code> your own world UI would mount.
      </p>
    </header>

    <section class="dev-board__commands">
      <h2>What you can do here</h2>
      <p v-if="actions.length === 0" class="dev-board__empty">
        This world offers this seat nothing it can do right now.
      </p>
      <form
        v-for="action in actions"
        :key="action.name"
        class="dev-board__command"
        @submit.prevent="send(action)"
      >
        <div class="dev-board__command-name">
          <strong>{{ action.name }}</strong>
          <span v-if="action.prompt">{{ action.prompt }}</span>
        </div>
        <label v-for="pick in action.selections" :key="pick.name" class="dev-board__arg">
          <span>{{ label(pick) }}</span>
          <select v-if="pick.validElements" v-model="draft(action)[pick.name]">
            <option
              v-for="element in pick.validElements"
              :key="element.id"
              :value="element.id"
              :disabled="!!element.disabled"
            >
              {{ element.display ?? element.id }}{{ element.disabled ? ` — ${element.disabled}` : '' }}
            </option>
          </select>
          <select v-else-if="pick.choices" v-model="draft(action)[pick.name]">
            <option
              v-for="(choice, index) in pick.choices"
              :key="index"
              :value="choice.value"
              :disabled="!!choice.disabled"
            >
              {{ choice.display }}{{ choice.disabled ? ` — ${choice.disabled}` : '' }}
            </option>
          </select>
          <input
            v-else-if="pick.type === 'number'"
            v-model="draft(action)[pick.name]"
            type="number"
            :min="pick.min"
            :max="pick.max"
            :step="pick.integer ? 1 : 'any'"
          />
          <input v-else v-model="draft(action)[pick.name]" type="text" />
        </label>
        <button type="submit" :disabled="acting || !!action.disabled" :title="action.disabled">
          Send
        </button>
        <!-- A GREYED BUTTON MUST SAY WHY. The engine's own `.disabled()` reason
             is the whole channel, so a player never meets a dead button with no
             explanation. -->
        <span v-if="action.disabled" class="dev-board__why-not">{{ action.disabled }}</span>
      </form>
    </section>

    <section class="dev-board__log">
      <h2>What just happened</h2>
      <p v-if="events.length === 0" class="dev-board__empty">
        Nothing has been narrated to this seat yet.
      </p>
      <ol v-else>
        <li v-for="(event, index) in events" :key="index">
          <code>{{ event.scope }}</code>
          <span>{{ JSON.stringify(event.payload) }}</span>
        </li>
      </ol>
    </section>

    <section class="dev-board__view">
      <h2>
        <button type="button" @click="viewOpen = !viewOpen">
          {{ viewOpen ? '▾' : '▸' }} What this seat can see
        </button>
      </h2>
      <pre v-if="viewOpen">{{ viewJson }}</pre>
    </section>
  </div>
</template>

<style scoped>
.dev-board {
  font: 13px/1.5 system-ui, -apple-system, sans-serif;
  padding: 1rem;
  display: grid;
  gap: 1.25rem;
  max-width: 60rem;
}
h1 { font-size: 1.3rem; margin: 0 0 0.25rem; }
h2 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.06em; color: #666; margin: 0 0 0.5rem; }
.dev-board__meta { margin: 0; }
.dev-board__why { margin: 0.4rem 0 0; color: #666; }
.dev-board__empty { color: #888; margin: 0; }
.dev-board__command {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 0.6rem;
  padding: 0.5rem 0;
  border-top: 1px solid #e6e6e6;
}
.dev-board__command-name { display: grid; min-width: 12rem; }
.dev-board__command-name span { color: #666; }
.dev-board__arg { display: grid; gap: 0.15rem; }
.dev-board__arg span { color: #666; font-size: 0.85em; }
.dev-board__why-not { color: #a33; }
.dev-board input, .dev-board select {
  font: inherit;
  padding: 0.25rem 0.4rem;
  border: 1px solid #bbb;
  border-radius: 4px;
}
.dev-board button {
  font: inherit;
  padding: 0.3rem 0.7rem;
  border: 1px solid #bbb;
  border-radius: 4px;
  background: #f4f4f5;
  cursor: pointer;
}
.dev-board__log ol { margin: 0; padding-left: 1.2rem; }
.dev-board__log li { display: flex; gap: 0.5rem; }
.dev-board__log code { color: #7a4; }
.dev-board__view h2 button {
  border: 0;
  background: transparent;
  padding: 0;
  font: inherit;
  text-transform: inherit;
  letter-spacing: inherit;
  color: inherit;
  cursor: pointer;
}
.dev-board pre {
  margin: 0;
  padding: 0.6rem;
  background: #f6f6f7;
  border-radius: 4px;
  max-height: 26rem;
  overflow: auto;
  font-size: 12px;
}
</style>
