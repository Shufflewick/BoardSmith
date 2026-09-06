<script setup lang="ts">
/**
 * A WORLD'S SURFACE WHEN THE BUNDLE HAS NOT WRITTEN ONE.
 *
 * Handed to `WorldShell` by `world-fallback-main.ts`, so it receives exactly
 * what a game's own board receives and emits exactly what one emits. It is a
 * BOARD and not a debug console: it draws the verbs the world declared, the
 * arguments they ask for, what the world narrated, and the view as the engine
 * projected it.
 *
 * The view is rendered as JSON, and that is the honest answer rather than a
 * shortcut. Only the game knows what its projection MEANS -- a room, a holding,
 * a sector -- so anything else this could draw would be an invented reading of
 * somebody else's data. What it can do without inventing anything is show every
 * byte the seat was actually sent, which is also what an author needs while
 * their `world.view` is still being written.
 */
import { computed, reactive, ref } from 'vue';
import type { WorldCommandOffer, WorldNarration } from '../../ui/world/worldProtocol.js';

const props = defineProps<{
  view: unknown;
  seat: number | null;
  commands: readonly WorldCommandOffer[];
  acting: boolean;
  worldName: string | null;
  presence: readonly number[] | null;
  events: readonly WorldNarration[];
}>();

const emit = defineEmits<{ act: [command: string, args: Record<string, unknown>] }>();

/** One draft per command, so filling in `move`'s destination does not clear
 *  what was typed into `say`. */
const drafts = reactive<Record<string, Record<string, unknown>>>({});

function draft(command: WorldCommandOffer): Record<string, unknown> {
  drafts[command.name] ??= Object.fromEntries(
    command.args.map((arg) => [arg.name, arg.kind === 'choice' ? (arg.choices[0]?.value ?? '') : '']),
  );
  return drafts[command.name]!;
}

function send(command: WorldCommandOffer): void {
  const filled = draft(command);
  const args: Record<string, unknown> = {};
  for (const arg of command.args) {
    const raw = filled[arg.name];
    // A `number` argument is declared as one, so it is sent as one. Handing a
    // string to a handler that declared a number is the shape of bug this
    // surface exists to keep out of an author's way.
    args[arg.name] = arg.kind === 'number' ? Number(raw) : raw;
  }
  emit('act', command.name, args);
}

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
      <h2>What this world answers to</h2>
      <p v-if="commands.length === 0" class="dev-board__empty">
        This world declares no command a player may issue.
      </p>
      <form
        v-for="command in commands"
        :key="command.name"
        class="dev-board__command"
        @submit.prevent="send(command)"
      >
        <div class="dev-board__command-name">
          <strong>{{ command.name }}</strong>
          <span v-if="command.prompt">{{ command.prompt }}</span>
        </div>
        <label v-for="arg in command.args" :key="arg.name" class="dev-board__arg">
          <span>{{ arg.prompt || arg.name }}</span>
          <select v-if="arg.kind === 'choice'" v-model="draft(command)[arg.name]">
            <option v-for="choice in arg.choices" :key="choice.value" :value="choice.value">
              {{ choice.label }}
            </option>
          </select>
          <input
            v-else-if="arg.kind === 'number'"
            v-model="draft(command)[arg.name]"
            type="number"
            :min="arg.min"
            :max="arg.max"
            :step="arg.integer ? 1 : 'any'"
          />
          <input v-else v-model="draft(command)[arg.name]" type="text" />
        </label>
        <button type="submit" :disabled="acting">Send</button>
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
