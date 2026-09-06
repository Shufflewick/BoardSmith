/**
 * WHAT `boardsmith init --world` WRITES.
 *
 * A persistent world is the other backend, not a variation on a table (#164,
 * #175): named partitions rather than a whole resident tree, a checkpoint of
 * what a command dirtied rather than a snapshot per action, a clock that acts
 * on its own rather than a turn order. A scaffold that started from the card
 * game and bolted a `world` block onto it would teach the wrong model on the
 * first day, so the world project's rules are written from the world down.
 *
 * ## Every type here comes from `boardsmith/world`
 *
 * Nothing in the generated `src/rules/world.ts` re-declares the contract. That
 * is the whole point of #165 landing `boardsmith/world`: the four world games
 * written before it each hand-copied `WorldCommandHandler` and its neighbours
 * into their own source, four copies drifted, and the library that RUNS the
 * contract now also types it. A new project starts on the shared declaration.
 *
 * ## TRANSITIONAL, deliberately and cheaply
 *
 * A world's verbs are a flat command table today and become Actions in #169,
 * which rewrites this template. So the generated rules are kept small and
 * obvious -- two commands, one partition per seat -- rather than elaborate:
 * the rewrite should cost an afternoon, and nothing here is built around a
 * shape that is about to go.
 */
import { toPascalCase, type ProjectConfig } from './project-scaffold.js';
import { WORLD_AUTHORING_DOC } from './world-project.js';

/** How many seats a scaffolded world holds, in its manifest and in its rules. */
export const WORLD_SCAFFOLD_SEATS = 8;

/**
 * WHAT WORKS TODAY AND WHAT DOES NOT, in one place because it is a moving
 * answer and two copies of it would move separately.
 *
 * `boardsmith dev` does not run a world yet -- that is #167, and the sentence
 * the dev host itself prints lives next door in `world-project.ts`. An author
 * who scaffolds a world and is not told this discovers it by watching their
 * genesis never run, so the scaffold says it twice on purpose: printed once by
 * `init`, and written into the project's own README where it keeps.
 */
export function worldScaffoldStatus(): string[] {
  return [
    'What works today:',
    '  boardsmith test    runs tests/world.test.ts, which drives your world through',
    '                     the `boardsmith/world` library -- genesis, a command, the',
    '                     clock, and one seat\'s view. No host, no network.',
    '  boardsmith lint    checks for BoardSmith pitfalls',
    '  boardsmith build   builds the publishable bundle',
    '',
    'What does not work yet:',
    '  boardsmith dev     serves the TABLE half of a project, and this project has none.',
    '                     It refuses, rather than opening a blank page. Running a world',
    '                     locally is BoardSmith #167: nothing here yet runs your genesis,',
    '                     dispatches a command, projects a view or fires a scheduled',
    '                     event, and world.html is the surface it will serve when it',
    '                     lands. Until then your test is where your world actually runs.',
    '',
    `${WORLD_AUTHORING_DOC} is the authoring guide.`,
  ];
}

/** `src/rules/elements.ts` -- the world's own furniture. */
export function generateWorldElementsTs(): string {
  return `import { Space } from 'boardsmith';

/**
 * One seat's corner of the world, and one PARTITION.
 *
 * A partition is the unit a world loads, checkpoints and evicts. A command
 * names the partitions it needs before it runs, touches only those, and the
 * host writes back only what it dirtied -- so a world of five hundred plots
 * costs one plot to tend.
 */
export class Plot extends Space {
  /** How far along this plot's crop is. */
  growth: number = 0;
  /** The seat this plot belongs to. */
  seat: number = 0;
}
`;
}

/** `src/rules/game.ts` -- the element tree a world adopts partitions into. */
export function generateWorldGameTs(pascal: string): string {
  return `import { Game, Player, type GameOptions } from 'boardsmith';
import { Plot } from './elements.js';

export class ${pascal}Player extends Player<${pascal}Game, ${pascal}Player> {}

/**
 * The game a world is built from.
 *
 * ITS CONSTRUCTOR BUILDS NO FURNITURE, and that is the difference from a table
 * game. A world's contents are created once, by \`genesis\`, and every later
 * wake adopts them back from the store as partitions -- so a constructor that
 * created a plot would create a second one beside the plot the world already
 * has. Register the element classes here; create the world in \`world.ts\`.
 */
export class ${pascal}Game extends Game<${pascal}Game, ${pascal}Player> {
  static PlayerClass = ${pascal}Player;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Plot]);
  }
}
`;
}

/** `src/rules/world.ts` -- the world half, typed by `boardsmith/world`. */
export function generateWorldTs(pascal: string): string {
  return `import type { GameElement } from 'boardsmith';
import type { WorldCommandTable, WorldDefinition, WorldViewDeclaration } from 'boardsmith/world';
import { Plot } from './elements.js';

/**
 * This world, as the runtime reads it.
 *
 * EVERY TYPE HERE IS IMPORTED, never re-declared. \`boardsmith/world\` is the
 * module that RUNS a world and the module that TYPES one, so what you write
 * against is what executes -- on your laptop under \`boardsmith test\` and on
 * the hosting platform, from the same declaration.
 *
 * TRANSITIONAL: a world's verbs are a flat command table today and become
 * Actions (BoardSmith #169), which is what will give a world board clicks, an
 * accessible action panel and bots. Expect this file to change shape once, with
 * every world game updated in the same pass.
 */

/** Seats in this world: the definition's \`maxPlayers\` and the manifest's \`world.maxPlayers\`. */
export const WORLD_SEATS = ${WORLD_SCAFFOLD_SEATS};

/** How long a tended plot takes to ripen. */
export const RIPEN_MS = 10 * 60 * 1000;

/** One seat's plot, by the name the store holds it under. */
export function plotPartition(seat: number): string {
  return \`plot:\${seat}\`;
}

/** A seat off a command's arguments, or a refusal saying so. */
function requireSeat(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(\`Expected a seat number, got \${JSON.stringify(value)}.\`);
  }
  return value;
}

/**
 * WHAT A BRAND-NEW WORLD STARTS WITH, run exactly once in its lifetime.
 *
 * Returns the elements it created, by partition name. The host records where
 * each one hangs and writes the bytes; every later wake adopts them back.
 */
export const worldGenesis: NonNullable<WorldDefinition['genesis']> = (game) => {
  const partitions: Record<string, GameElement> = {};
  for (const player of game.players) {
    const plot = game.create(Plot, \`plot-\${player.seat}\`);
    plot.seat = player.seat;
    // WHO CAN SEE A PARTITION IS WHO HEARS ABOUT IT. An event a command
    // addresses to a partition reaches exactly the seats that can see it, so
    // this one line is what makes a plot private: its owner's business, told to
    // its owner. A world where everything is public simply leaves it out.
    plot.showOnlyTo(player);
    partitions[plotPartition(player.seat)] = plot;
  }
  return partitions;
};

/**
 * WHAT A LOOK IS ABOUT.
 *
 * Required, and it has to be: a world's partitions are ABSENT until something
 * names them, so a view that named nothing would show a visitor an empty world.
 * A world that genuinely needs no partition writes \`() => []\`.
 */
export const worldView: WorldViewDeclaration = (seat) => [plotPartition(seat)];

/** Everything this world answers to. */
export const worldCommands: WorldCommandTable = {
  tend: {
    prompt: 'Tend your plot',
    args: [],
    /**
     * Answered BEFORE anything is loaded, which is why it may not read the
     * world. \`seat\` is the acting seat, so a command can name "my own plot"
     * without asking the player to pass it.
     */
    partitions: (_args, seat) => {
      if (seat === null) throw new Error('Tending is something a player does.');
      return [plotPartition(seat)];
    },
    run: ({ seat, partition, schedule }) => {
      const plot = partition(plotPartition(seat as number)) as Plot;
      plot.growth += 1;
      // THE WORLD KEEPS GOING WHILE NOBODY IS LOOKING. A keyed schedule
      // upserts, so tending twice re-arms one timer rather than queueing two.
      schedule({ delayMs: RIPEN_MS, key: \`ripen:\${seat}\`, command: 'ripen', args: { seat } });
      return [{ scope: plotPartition(seat as number), payload: { tended: seat, growth: plot.growth } }];
    },
  },

  ripen: {
    // THE CLOCK'S OWN, AND NO PLAYER MAY SEND IT. A scheduled event runs a
    // command out of this same table -- one way for a world to change, not two
    // -- and this is what keeps it off the action panel and refuses a player
    // who names it anyway.
    clockOnly: true,
    prompt: 'A plot ripens',
    args: [],
    partitions: (args) => [plotPartition(requireSeat(args.seat))],
    run: ({ args, partition, timing }) => {
      const seat = requireSeat(args.seat);
      const plot = partition(plotPartition(seat)) as Plot;
      // \`missedCount\` is how many occurrences got no call of their own, so a
      // world that was parked for a week catches up in one wake instead of
      // being replayed a thousand times.
      plot.growth += 1 + (timing?.missedCount ?? 0);
      return [{ scope: plotPartition(seat), payload: { ripened: seat, growth: plot.growth } }];
    },
  },
};
`;
}

/** `src/rules/index.ts` -- what the platform and the library register. */
export function generateWorldRulesIndexTs(config: ProjectConfig): string {
  const pascal = toPascalCase(config.name);
  return `import type { GameDefinition } from 'boardsmith/session';
import { ${pascal}Game } from './game.js';
import { WORLD_SEATS, worldCommands, worldGenesis, worldView } from './world.js';

export { ${pascal}Game, ${pascal}Player } from './game.js';
export * from './elements.js';
export * from './world.js';

/**
 * What this game IS. \`world\` is what makes it runnable as a persistent world;
 * \`boardsmith.json\`'s \`world\` block declares the same intent to the catalogue,
 * and \`boardsmith validate\` checks the two agree.
 */
export const gameDefinition: GameDefinition = {
  gameClass: ${pascal}Game,
  gameType: '${config.name}',
  displayName: '${config.displayName}',
  minPlayers: 1,
  maxPlayers: WORLD_SEATS,
  world: { commands: worldCommands, genesis: worldGenesis, view: worldView },
};
`;
}

/** `tests/world.test.ts` -- the world driven by the library that runs it. */
export function generateWorldTestTs(): string {
  return `import { describe, expect, it } from 'vitest';
import { createWorld } from 'boardsmith/world';
import { gameDefinition } from '../src/rules/index.js';
import { RIPEN_MS, plotPartition } from '../src/rules/world.js';

/**
 * THE WORLD, DRIVEN THROUGH THE LIBRARY THAT RUNS IT.
 *
 * \`createWorld\` is what a host calls -- the hosting platform's runner and, once
 * BoardSmith #167 lands, \`boardsmith dev\` too. Driving it here rather than
 * hand-rolling a fake runner is what makes these assertions worth anything: a
 * change to the contract fails this file instead of passing it and failing in
 * production.
 *
 * The loop is the real one. \`declare\` says which partitions the command needs,
 * a host loads them, \`apply\` runs the command against a world that is finished
 * assembling, and \`serialize\` writes back exactly what was dirtied.
 */
const T0 = 1_800_000_000_000;

/** What the schedule caps see: a world with no timers pending. */
const NO_TIMERS = { unkeyed: 0, keys: [], worldPending: 0 };

function launch() {
  return createWorld({
    definition: gameDefinition,
    seed: 'test-world',
    seats: new Map([
      ['alice', 1],
      ['bob', 2],
    ]),
  });
}

describe('the world', () => {
  it('gives every seat a plot at genesis, once in the world\\'s lifetime', async () => {
    const { runner, seatCount } = launch();
    const genesis = await runner.genesis();
    expect(Object.keys(genesis)).toHaveLength(seatCount);
    expect(genesis[plotPartition(1)]).toBeDefined();
  });

  it('tends a plot, dirties only that plot, and arms one ripening', async () => {
    const { runner } = launch();
    await runner.genesis();

    // Genesis CREATED the plots, so the engine already holds them and the host
    // is told to send nothing.
    const declared = await runner.declare({ name: 'tend', args: {} }, 'alice', {});
    expect(declared.needs).toEqual([]);

    const result = await runner.apply({
      player: 'alice',
      command: { name: 'tend', args: {} },
      timing: null,
      arrivedAt: T0,
      allowance: NO_TIMERS,
      presence: [1],
    });

    // ONE SEAT'S COMMAND COSTS ONE SEAT'S PLOT. Bob's plot is untouched, so a
    // checkpoint writes one partition however many players the world holds.
    expect(result.dirty).toEqual([plotPartition(1)]);
    expect(result.schedules).toEqual([
      { delayMs: RIPEN_MS, key: 'ripen:1', command: 'ripen', args: { seat: 1 } },
    ]);

    const bytes = await runner.serialize([...result.dirty]);
    expect(JSON.parse(bytes[plotPartition(1)]!)).toMatchObject({
      attributes: { growth: 1, seat: 1 },
    });
  });

  it('REFUSES a player who reaches for the clock\\'s own command', async () => {
    const { runner } = launch();
    await runner.genesis();
    await expect(
      runner.declare({ name: 'ripen', args: { seat: 1 } }, 'alice', {}),
    ).rejects.toThrow();
    // And it is not offered to them in the first place.
    expect(runner.commandOffers().map((offer) => offer.name)).toEqual(['tend']);
  });

  it('catches a parked world up in one wake instead of replaying it', async () => {
    const { runner } = launch();
    await runner.genesis();
    await runner.declare({ name: 'ripen', args: { seat: 1 } }, null, {});

    const result = await runner.apply({
      player: null,
      command: { name: 'ripen', args: { seat: 1 } },
      // Three occurrences came due while nobody was watching: this one, and
      // two that got no call of their own.
      timing: { due: T0 + RIPEN_MS, missedCount: 2 },
      arrivedAt: T0 + RIPEN_MS,
      allowance: NO_TIMERS,
      presence: [],
    });
    // ONE OCCURRENCE OF WORK, THREE OCCURRENCES OF GROWTH -- and addressed to
    // the one seat who can see the plot, which is who the platform delivers it
    // to.
    expect(result.events).toEqual([
      { scope: plotPartition(1), payload: { ripened: 1, growth: 3 }, seats: [1] },
    ]);
  });

  it('shows one seat their own plot and nobody else\\'s', async () => {
    const { runner } = launch();
    await runner.genesis();

    const needs = await runner.declareViews(['alice'], {});
    expect(needs.needs).toEqual([]);
    expect(needs.refused).toEqual({});

    const { views } = await runner.viewsFor(['alice']);
    expect(JSON.stringify(views.alice)).toContain('plot-1');
    expect(JSON.stringify(views.alice)).not.toContain('plot-2');
  });
});
`;
}

/** `world.html` -- the entry a world's own surface is served from. */
export function generateWorldHtml(config: ProjectConfig): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>${config.displayName}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { height: 100%; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/world-main.ts"></script>
  </body>
</html>
`;
}

/** `src/world-main.ts` -- the world entry point's mount. */
export function generateWorldMainTs(): string {
  return `import { createApp } from 'vue';
import { WorldApp } from './ui/index.js';

createApp(WorldApp).mount('#app');
`;
}

/** `src/ui/index.ts` for a world project. */
export function generateWorldUiIndexTs(): string {
  return `import WorldApp from './WorldApp.vue';
export { WorldApp };
`;
}

/** `src/ui/WorldApp.vue` -- the shell, wrapped round this world's board. */
export function generateWorldAppVue(config: ProjectConfig): string {
  return `<script setup lang="ts">
/**
 * WorldShell is GameShell's twin, not a mode of it: a world has no turn, no
 * flow position and no action table, so it owns the wire and the three states
 * no game should have to write itself -- a host that has said nothing, a
 * refusal, and a dropped connection. Everything a player looks at once they are
 * in is WorldBoard, below, and yours.
 */
import { WorldShell } from 'boardsmith/ui';
import WorldBoard from './components/WorldBoard.vue';
</script>

<template>
  <WorldShell :ui="WorldBoard" display-name="${config.displayName}" />
</template>
`;
}

/** `src/ui/components/WorldBoard.vue` -- this world's own surface. */
export function generateWorldBoardVue(): string {
  return `<script setup lang="ts">
/**
 * This world's board. WorldShell hands it everything below and expects \`act\`
 * back; a board that would rather inject than emit calls \`useWorld()\`.
 *
 * \`view\` is YOUR shape -- the per-seat projection your \`world.view\`
 * declaration named -- so nothing between your rules and here interprets it.
 */
import { computed } from 'vue';
import type { WorldCommandOffer, WorldNarration } from 'boardsmith/ui';

const props = defineProps<{
  view: unknown;
  seat: number | null;
  commands: readonly WorldCommandOffer[];
  acting: boolean;
  worldName: string | null;
  presence: readonly number[];
  events: readonly WorldNarration[];
}>();

const emit = defineEmits<{ act: [command: string, args?: Record<string, unknown>] }>();

/** Commands that ask for nothing can be a button. One that asks for arguments
 *  needs a surface of your own to collect them. */
const simpleCommands = computed(() => props.commands.filter((command) => command.args.length === 0));
</script>

<template>
  <main class="world-board">
    <h1>{{ worldName ?? 'This world' }}</h1>
    <p class="world-board__seat">
      You are seat {{ seat ?? '—' }}. {{ presence.length }} here right now.
    </p>

    <ul class="world-board__verbs">
      <li v-for="command in simpleCommands" :key="command.name">
        <button
          type="button"
          :disabled="acting"
          :aria-label="command.prompt ?? command.name"
          @click="emit('act', command.name)"
        >
          {{ command.prompt ?? command.name }}
        </button>
      </li>
    </ul>

    <h2>What has happened</h2>
    <ol class="world-board__narration">
      <li v-for="(event, index) in events" :key="index">
        {{ JSON.stringify(event.payload) }}
      </li>
    </ol>
  </main>
</template>

<style scoped>
.world-board {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
}
.world-board__seat {
  color: var(--bsg-ink-2);
}
.world-board__verbs,
.world-board__narration {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
</style>
`;
}

/** `tests/a11y.example.test.ts` for a world project. */
export function generateWorldA11yTestTs(): string {
  return `// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import axe from 'axe-core';
import WorldBoard from '../src/ui/components/WorldBoard.vue';

describe('WorldBoard — a11y floor (axe-core scan)', () => {
  it('has no axe-core violations', async () => {
    // axe.run() only scans nodes that are actually IN the document, so mount
    // with attachTo and detach in \`finally\`. Mount with a real command so the
    // board renders a focusable control with a game-semantic label -- an empty
    // render proves nothing. This is the copy-me template for every UI chunk.
    const wrapper = mount(WorldBoard, {
      attachTo: document.body,
      props: {
        view: {},
        seat: 1,
        commands: [{ name: 'tend', prompt: 'Tend your plot', args: [] }],
        acting: false,
        worldName: 'A world',
        presence: [1],
        events: [],
      },
    });
    try {
      const results = await axe.run(wrapper.element);
      expect(results.violations).toEqual([]);
    } finally {
      wrapper.unmount();
    }
  });
});
`;
}

/** `README.md` -- where the status above keeps, after the terminal scrolls. */
export function generateWorldReadme(config: ProjectConfig): string {
  return `# ${config.displayName}

A BoardSmith **persistent world**: named partitions rather than a whole
resident tree, a checkpoint of what a command dirtied rather than a snapshot per
action, and a clock that acts on its own rather than a turn order.

## Where things are

| File | What it is |
| --- | --- |
| \`boardsmith.json\` | the \`world\` block, which is how this game says it is a world |
| \`src/rules/world.ts\` | the world half: commands, genesis, and the per-seat view |
| \`src/rules/elements.ts\` | the furniture a partition is made of |
| \`src/rules/index.ts\` | \`gameDefinition\`, where the world block is registered |
| \`tests/world.test.ts\` | your world, driven through \`boardsmith/world\` |
| \`world.html\` | the entry a world's own surface is served from |
| \`src/ui/components/WorldBoard.vue\` | that surface |

## Where you stand today

${worldScaffoldStatus()
  .map((line) => (line === '' ? '' : `    ${line}`))
  .join('\n')}
`;
}
