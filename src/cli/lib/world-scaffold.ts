/**
 * WHAT `boardsmith init --world` WRITES.
 *
 * A persistent world is the other backend, not a variation on a table (#164,
 * #175): named partitions rather than a whole resident tree, a checkpoint of
 * what an action dirtied rather than a snapshot per action, a clock that acts
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
 * ## OBVIOUS RATHER THAN ELABORATE
 *
 * The generated rules are one partition per seat and two verbs: a seat's
 * `tend`, which asks WHICH row of its own plot, and the clock's own `ripen`,
 * which nobody may press. That is the smallest shape that still shows all
 * three things an author has to learn on the first day -- a partition, an
 * action's ordered declaration, and a selection whose candidates the world
 * enumerates -- and nothing beyond them is here to be read past.
 */
import { toPascalCase, type ProjectConfig } from './project-scaffold.js';
import { WORLD_AUTHORING_DOC } from './world-project.js';

/** How many seats a scaffolded world holds, in its manifest and in its rules. */
export const WORLD_SCAFFOLD_SEATS = 8;

/**
 * WHAT A SCAFFOLDED WORLD CAN DO, in one place because two copies of a moving
 * answer move separately.
 *
 * It used to be a "what does not work yet" list, because `boardsmith dev` did
 * not run a world and an author who scaffolded one discovered that by watching
 * their genesis never run. #167 built the local host, so this is now the list
 * of commands rather than a warning -- and it is still said twice on purpose:
 * printed once by `init`, and written into the project's own README where it
 * keeps.
 */
export function worldScaffoldStatus(): string[] {
  return [
    'What your world does now:',
    '  boardsmith dev     runs YOUR WORLD in a browser, with no network: your genesis',
    '                     once into a durable local store, every action declared then',
    '                     run, a view per attached seat, and your scheduled events on',
    '                     their due time. The dev bar switches seats, fires due events',
    '                     without waiting for them, and wakes the world from parked.',
    '                     world.html is the surface it serves.',
    '  boardsmith dev --reset',
    '                     deletes the local world and runs genesis again. Nothing else',
    '                     deletes it -- closing the laptop is meant to be safe.',
    '  boardsmith test    runs tests/world.test.ts, which drives your world through',
    '                     the `boardsmith/world` library -- genesis, an action, the',
    '                     clock, and one seat\'s view. No host, no browser.',
    '  boardsmith lint    checks for BoardSmith pitfalls',
    '  boardsmith build   builds the publishable bundle',
    '',
    'The dev host and the hosting platform run the SAME library, with the same',
    'budgets and the same refusals. What differs is lifecycle policy -- sockets,',
    'hibernation, eviction timing -- and never what your world is.',
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
 * A partition is the unit a world loads, checkpoints and evicts. An action
 * declares the partitions each of its steps needs before it may read any of
 * them, touches only those, and the host writes back only what it dirtied --
 * so a world of five hundred plots costs one plot to tend.
 */
export class Plot extends Space {
  /** The seat this plot belongs to. */
  seat: number = 0;
}

/**
 * One row of a plot, and the thing a player actually picks.
 *
 * It exists so \`tend\` has a QUESTION to ask. An action's selection is offered
 * with its candidates already resolved -- these rows, by element id -- which is
 * what lets a board wire a click straight to the row that was clicked, and what
 * an action panel reads to draw the same choice as a list.
 */
export class Row extends Space {
  /** How far along this row's crop is. */
  growth: number = 0;
}
`;
}

/** `src/rules/game.ts` -- the element tree a world adopts partitions into. */
export function generateWorldGameTs(pascal: string): string {
  return `import { Game, Player, type GameOptions } from 'boardsmith';
import { Plot, Row } from './elements.js';

export class ${pascal}Player extends Player<${pascal}Game, ${pascal}Player> {}

/**
 * The game a world is built from.
 *
 * ITS CONSTRUCTOR BUILDS NO FURNITURE, and that is the difference from a table
 * game. A world's contents are created once, by \`genesis\`, and every later
 * wake adopts them back from the store as partitions -- so a constructor that
 * created a plot would create a second one beside the plot the world already
 * has. Register the element classes here; create the world in \`world.ts\`.
 *
 * IT REGISTERS NO ACTIONS EITHER. A world's actions are the ones its
 * \`gameDefinition\`'s \`world.actions\` names, and the runtime registers them on
 * this game when it builds the world; a constructor that registered them too
 * would be a second, silently different list.
 */
export class ${pascal}Game extends Game<${pascal}Game, ${pascal}Player> {
  static PlayerClass = ${pascal}Player;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Plot, Row]);
  }

  /** One seat's plot, once it is resident. Actions reach for it through their
   *  own declaration, so this throws rather than answering for a partition
   *  nothing asked the host to load. */
  plotOf(seat: number): Plot {
    const plot = this.first(Plot, \`plot-\${seat}\`);
    if (!plot) {
      throw new Error(\`Seat \${seat}'s plot is not resident. Declare it with 'needs' first.\`);
    }
    return plot;
  }
}
`;
}

/** `src/rules/world.ts` -- the world half, typed by `boardsmith/world`. */
export function generateWorldTs(pascal: string): string {
  return `import type { GameElement } from 'boardsmith';
import { worldAction, worldClockAction } from 'boardsmith/world';
import type { WorldDefinition, WorldViewDeclaration } from 'boardsmith/world';
import type { ${pascal}Game } from './game.js';
import { Plot, Row } from './elements.js';

/**
 * This world, as the runtime reads it.
 *
 * EVERY TYPE HERE IS IMPORTED, never re-declared. \`boardsmith/world\` is the
 * module that RUNS a world and the module that TYPES one, so what you write
 * against is what executes -- on your laptop under \`boardsmith test\` and on
 * the hosting platform, from the same declaration.
 *
 * ## A WORLD'S VERBS ARE ACTIONS
 *
 * \`tend\` below is an ordinary BoardSmith Action with one world block on it, so
 * it reaches the same action panel, the same board clicks, the same enumeration
 * and the same bots a table game's actions do. What a world adds is the
 * DECLARATION: a world holds nothing until something names it, so every step of
 * an action has to say which partitions it needs BEFORE it may read any of
 * them.
 *
 * ## THE DECLARATION IS AN ORDERED WALK
 *
 * It is ordered because an action already is: its selections are a sequence the
 * engine resolves one step at a time, so the declaration is one step of its own
 * per step of the action, in the order you wrote them.
 *
 *   \`.needs()\` before the first selection is ROUND ONE. Nothing is resident
 *     when it is asked, so it is a pure function of the acting seat -- "my own
 *     plot" and nothing that requires reading the world to name.
 *   a selection's own \`needs:\` is THAT SELECTION'S ROUND, asked with round one
 *     already loaded. This is what lets a candidate list read the world, and
 *     every candidate must lie inside a partition this step named -- the engine
 *     refuses one that strays, by name.
 *   \`.needs()\` after the last selection is THE EXECUTE ROUND, for a partition
 *     \`execute\` writes that no candidate list ever mentioned.
 *
 * The host walks them in that order, loading what each round names and asking
 * again. Nothing here has a ceiling to tune: the walk is exactly as long as the
 * steps you wrote.
 */

/** Seats in this world: the definition's \`maxPlayers\` and the manifest's \`world.maxPlayers\`. */
export const WORLD_SEATS = ${WORLD_SCAFFOLD_SEATS};

/** How long a tended row takes to ripen. */
export const RIPEN_MS = 10 * 60 * 1000;

/** How far a row grows before there is nothing left to do to it. */
export const MAX_GROWTH = 5;

/** The rows every plot is divided into, and therefore what \`tend\` offers. */
export const PLOT_ROWS = ['north', 'south'] as const;

/** One seat's plot, by the name the store holds it under. */
export function plotPartition(seat: number): string {
  return \`plot:\${seat}\`;
}

/** A seat off a scheduled event's arguments, or a refusal saying so. */
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
    for (const row of PLOT_ROWS) {
      plot.create(Row, row);
    }
    // WHO CAN SEE A PARTITION IS WHO HEARS ABOUT IT. An event an action
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

/**
 * A SEAT TENDS ONE ROW OF ITS OWN PLOT.
 *
 * Two steps, and a declaration for each: round one names the plot, and the
 * selection reads the rows out of it. The selection declares nothing of its own
 * because its candidates live in the partition round one already named -- which
 * is an ordinary shape, not an omission. A verb whose candidates lived
 * somewhere else (a neighbour's plot, the room next door) would say so in that
 * selection's \`needs:\`, and only then may it name them.
 */
const tend = worldAction<${pascal}Game>('tend')
  .prompt('Tend one row of your plot')
  .needs(({ player }) => [plotPartition(player.seat)])
  .chooseElement('row', {
    prompt: 'Which row?',
    // NAMED, NEVER SEARCHED. A world action's element selection must hand over
    // its candidates: the alternative is a walk of whatever happens to be
    // resident, whose size is a fact about what other players recently did.
    elements: ({ game, player }) => [...game.plotOf(player.seat).all(Row)],
    // GREYED WITH THE REASON, rather than accepting the click and refusing it
    // afterwards. A player can see that the row is finished and why.
    disabled: (row) => (row.growth >= MAX_GROWTH ? 'This row is fully grown' : false),
  })
  .execute(({ row }, ctx) => {
    row.growth += 1;
    // THE WORLD KEEPS GOING WHILE NOBODY IS LOOKING. A keyed schedule upserts,
    // so tending twice re-arms one timer rather than queueing two, and its
    // arguments are plain JSON scalars because a schedule outlives the tree the
    // elements in it belong to.
    ctx.world.schedule({
      delayMs: RIPEN_MS,
      key: \`ripen:\${ctx.player.seat}\`,
      action: 'ripen',
      args: { seat: ctx.player.seat },
    });
    // NARRATION IS ADDRESSED, not broadcast: a payload scoped to a partition
    // reaches the seats that can see it, and this plot is its owner's alone.
    ctx.world.emit(plotPartition(ctx.player.seat), {
      tended: ctx.player.seat,
      row: row.name,
      growth: row.growth,
    });
  });

/**
 * THE CLOCK'S OWN, AND NO PLAYER MAY SEND IT.
 *
 * A scheduled event runs an action out of the same registry a player's comes
 * from -- one way for a world to change, not two -- and \`worldClockAction\` is
 * what keeps this one off the action panel and refuses a player who names it
 * anyway. It has nobody acting, so it has no \`player\` and asks no questions:
 * its arguments come off the schedule row.
 */
const ripen = worldClockAction<${pascal}Game>('ripen')
  .prompt('A plot ripens')
  .needs(({ args }) => [plotPartition(requireSeat(args.seat))])
  .execute((args, ctx) => {
    const seat = requireSeat(args.seat);
    const plot = ctx.world.partition(plotPartition(seat)) as Plot;
    // \`missedCount\` is how many occurrences got no call of their own, so a
    // world that was parked for a week catches up in one wake instead of being
    // replayed a thousand times.
    const grown = 1 + (ctx.world.timing?.missedCount ?? 0);
    for (const row of plot.all(Row)) {
      row.growth = Math.min(MAX_GROWTH, row.growth + grown);
    }
    ctx.world.emit(plotPartition(seat), { ripened: seat, grown });
  });

/** Everything this world answers to, a player's verbs and the clock's alike. */
export const worldActions: WorldDefinition['actions'] = [tend, ripen];
`;
}

/** `src/rules/index.ts` -- what the platform and the library register. */
export function generateWorldRulesIndexTs(config: ProjectConfig): string {
  const pascal = toPascalCase(config.name);
  return `import type { GameDefinition } from 'boardsmith/session';
import { ${pascal}Game } from './game.js';
import { WORLD_SEATS, worldActions, worldGenesis, worldView } from './world.js';

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
  world: { actions: worldActions, genesis: worldGenesis, view: worldView },
};
`;
}

/** `tests/world.test.ts` -- the world driven by the library that runs it. */
export function generateWorldTestTs(): string {
  return `import { describe, expect, it } from 'vitest';
import { createWorld, settleDeclaration, walkDeclaration } from 'boardsmith/world';
import { gameDefinition } from '../src/rules/index.js';
import { PLOT_ROWS, RIPEN_MS, plotPartition } from '../src/rules/world.js';

/**
 * THE WORLD, DRIVEN THROUGH THE LIBRARY THAT RUNS IT.
 *
 * \`createWorld\` is what a host calls -- the hosting platform's runner, and
 * \`boardsmith dev\` too. Driving it here rather than hand-rolling a fake runner
 * is what makes these assertions worth anything: a change to the contract fails
 * this file instead of passing it and failing in production.
 *
 * The loop is the real one. The runner says which partitions the next step
 * needs, a host loads them and asks again, \`apply\` runs the action against a
 * world that is finished assembling, and \`serialize\` writes back exactly what
 * was dirtied.
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

type Runner = ReturnType<typeof launch>['runner'];
type Command = { name: string; args: Record<string, unknown> };

/**
 * WHERE A HOST WOULD READ A PARTITION FROM.
 *
 * This world was built by \`genesis\` in this process, so everything a
 * declaration names is already resident and nothing is ever read. It refuses by
 * name rather than inventing an empty partition, so an action that declares
 * something genesis never created fails here saying which.
 */
function unstored(name: string): Promise<never> {
  return Promise.reject(new Error(\`Nothing in this test holds partition "\${name}".\`));
}

/** What this seat may do, declared and then enumerated -- the two calls a host
 *  makes to draw a player's options. */
async function offersFor(runner: Runner, player: string) {
  await walkDeclaration(
    async (supplied) => (await runner.declareOffers(player, supplied)).needs,
    unstored,
  );
  return runner.offersFor(player, { now: T0, presence: [1] });
}

/**
 * One action, walked and then applied.
 *
 * \`walkDeclaration\` is the loop for a WRITE: one round per step of the action,
 * in the order its author wrote them. It ends when the runner asks for nothing,
 * and it needs no ceiling, because the walk is as long as the action's own
 * steps.
 */
async function perform(
  runner: Runner,
  player: string | null,
  command: Command,
  timing: { due: number; missedCount: number } | null = null,
  arrivedAt: number = T0,
) {
  await walkDeclaration(
    async (supplied) => (await runner.declare(command, player, supplied)).needs,
    unstored,
  );
  return runner.apply({
    player,
    command,
    timing,
    arrivedAt,
    allowance: NO_TIMERS,
    presence: player === null ? [] : [1],
  });
}

describe('the world', () => {
  it('gives every seat a plot at genesis, once in the world\\'s lifetime', async () => {
    const { runner, seatCount } = launch();
    const genesis = await runner.genesis();
    expect(Object.keys(genesis)).toHaveLength(seatCount);
    expect(genesis[plotPartition(1)]).toBeDefined();
  });

  it('offers a seat the rows of its own plot, as elements it can click', async () => {
    const { runner } = launch();
    await runner.genesis();

    const offers = await offersFor(runner, 'alice');
    // \`ripen\` is the clock's own, so it is not a seat's to take and is not here.
    expect(offers.map((offer) => offer.name)).toEqual(['tend']);

    const row = offers[0]!.selections[0]!;
    expect(row.type).toBe('element');
    // THE CANDIDATES ARRIVE WITH THE OFFER, resolved to the rows that exist
    // right now -- which is what an offer can say and a static declaration
    // never could.
    expect(row.validElements).toHaveLength(PLOT_ROWS.length);
  });

  it('tends one row, dirties only that plot, and arms one ripening', async () => {
    const { runner } = launch();
    await runner.genesis();

    const offers = await offersFor(runner, 'alice');
    const row = offers[0]!.selections[0]!.validElements![0]!;
    const result = await perform(runner, 'alice', { name: 'tend', args: { row: row.id } });

    // ONE SEAT'S ACTION COSTS ONE SEAT'S PLOT. Bob's plot is untouched, so a
    // checkpoint writes one partition however many players the world holds.
    expect(result.dirty).toEqual([plotPartition(1)]);
    expect(result.schedules).toEqual([
      { delayMs: RIPEN_MS, key: 'ripen:1', action: 'ripen', args: { seat: 1 } },
    ]);
    // Addressed to the one seat who can see the plot, which is who the platform
    // delivers it to.
    expect(result.events).toEqual([
      { scope: plotPartition(1), payload: { tended: 1, row: PLOT_ROWS[0], growth: 1 }, seats: [1] },
    ]);

    const bytes = await runner.serialize([...result.dirty]);
    expect(JSON.parse(bytes[plotPartition(1)]!)).toMatchObject({ attributes: { seat: 1 } });
  });

  it('REFUSES a player who reaches for the clock\\'s own action', async () => {
    const { runner } = launch();
    await runner.genesis();
    await expect(
      runner.declare({ name: 'ripen', args: { seat: 1 } }, 'alice', {}),
    ).rejects.toThrow();
  });

  it('catches a parked world up in one wake instead of replaying it', async () => {
    const { runner } = launch();
    await runner.genesis();

    const result = await perform(
      runner,
      null,
      { name: 'ripen', args: { seat: 1 } },
      // Three occurrences came due while nobody was watching: this one, and two
      // that got no call of their own.
      { due: T0 + RIPEN_MS, missedCount: 2 },
      T0 + RIPEN_MS,
    );
    // ONE OCCURRENCE OF WORK, THREE OCCURRENCES OF GROWTH.
    expect(result.events).toEqual([
      { scope: plotPartition(1), payload: { ripened: 1, grown: 3 }, seats: [1] },
    ]);
  });

  it('shows one seat their own plot and nobody else\\'s', async () => {
    const { runner } = launch();
    await runner.genesis();

    // A VIEW'S DECLARATION IS A FIXPOINT, not a walk: "what is this seat looking
    // at" is answered by the world's own state -- the room they are standing in
    // -- so it is asked, loaded and asked again until it stops changing its
    // mind. \`settleDeclaration\` is that loop, beside \`walkDeclaration\` for an
    // action.
    let refused: Record<string, unknown> = {};
    await settleDeclaration(
      async (supplied) => {
        const declared = await runner.declareViews(['alice'], supplied);
        refused = declared.refused;
        return declared.needs;
      },
      unstored,
      "this world's \`world.view\`",
    );
    expect(refused).toEqual({});

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
 *
 * \`actions\` is what this seat may do, enumerated by the world with each
 * selection's candidates already resolved: an element selection arrives as
 * \`validElements\`, a choice as \`choices\`. That is the difference an Action
 * makes -- the world can say WHICH rows are tendable this instant, so this
 * board draws a button per real candidate instead of asking the player to
 * describe one.
 */
import { computed } from 'vue';
import type { WorldActionOffer, WorldNarration } from 'boardsmith/ui';

const props = defineProps<{
  view: unknown;
  seat: number | null;
  actions: readonly WorldActionOffer[];
  acting: boolean;
  worldName: string | null;
  presence: readonly number[];
  events: readonly WorldNarration[];
}>();

const emit = defineEmits<{ act: [action: string, args?: Record<string, unknown>] }>();

/** An action that asks nothing can be a button on its own. */
const simpleActions = computed(() => props.actions.filter((action) => action.selections.length === 0));

/** An action with one question is a button per candidate. A verb that asks two
 *  questions in a row wants a surface of your own, which is what this file is
 *  for. */
const askingActions = computed(() => props.actions.filter((action) => action.selections.length === 1));

/** The answer to an action's first question, under the name that question was
 *  asked by -- which is what \`act\` sends and the engine resolves. */
function answer(action: WorldActionOffer, value: unknown): Record<string, unknown> {
  const selection = action.selections[0];
  return selection ? { [selection.name]: value } : {};
}
</script>

<template>
  <main class="world-board">
    <h1>{{ worldName ?? 'This world' }}</h1>
    <p class="world-board__seat">
      You are seat {{ seat ?? 'none' }}. {{ presence.length }} here right now.
    </p>

    <ul class="world-board__verbs">
      <li v-for="action in simpleActions" :key="action.name">
        <button
          type="button"
          :disabled="acting || !!action.disabled"
          :aria-label="action.disabled ?? action.prompt ?? action.name"
          @click="emit('act', action.name)"
        >
          {{ action.prompt ?? action.name }}
        </button>
      </li>
    </ul>

    <section v-for="action in askingActions" :key="action.name" class="world-board__ask">
      <h2>{{ action.prompt ?? action.name }}</h2>
      <!-- A greyed action always says why: the world answered with a reason,
           and swallowing it leaves a dead button on the screen. -->
      <p v-if="action.disabled">{{ action.disabled }}</p>
      <ul v-else class="world-board__verbs">
        <li v-for="element in action.selections[0]?.validElements ?? []" :key="element.id">
          <button
            type="button"
            :disabled="acting || !!element.disabled"
            :aria-label="element.disabled ?? element.display ?? String(element.id)"
            @click="emit('act', action.name, answer(action, element.id))"
          >
            {{ element.display ?? element.id }}
          </button>
        </li>
        <li v-for="choice in action.selections[0]?.choices ?? []" :key="String(choice.value)">
          <button
            type="button"
            :disabled="acting || !!choice.disabled"
            :aria-label="choice.disabled ?? choice.display"
            @click="emit('act', action.name, answer(action, choice.value))"
          >
            {{ choice.display }}
          </button>
        </li>
      </ul>
    </section>

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
    // with attachTo and detach in \`finally\`. Mount with a real offer -- one
    // whose selection carries the candidates the world enumerated -- so the
    // board renders focusable controls with game-semantic labels; an empty
    // render proves nothing. This is the copy-me template for every UI chunk.
    const wrapper = mount(WorldBoard, {
      attachTo: document.body,
      props: {
        view: {},
        seat: 1,
        actions: [
          {
            name: 'tend',
            prompt: 'Tend one row of your plot',
            selections: [
              {
                name: 'row',
                type: 'element',
                prompt: 'Which row?',
                validElements: [
                  { id: 11, display: 'north' },
                  { id: 12, display: 'south', disabled: 'This row is fully grown' },
                ],
              },
            ],
          },
        ],
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
resident tree, a checkpoint of what an action dirtied rather than a snapshot per
action, and a clock that acts on its own rather than a turn order.

Its verbs are **actions**, built with \`worldAction()\`. Every step of one
declares which partitions it needs before it may read them, so the world offers
a seat the candidates that are legal this instant rather than everything it
contains.

## Where things are

| File | What it is |
| --- | --- |
| \`boardsmith.json\` | the \`world\` block, which is how this game says it is a world |
| \`src/rules/world.ts\` | the world half: actions, genesis, and the per-seat view |
| \`src/rules/elements.ts\` | the furniture a partition is made of |
| \`src/rules/index.ts\` | \`gameDefinition\`, where the world block is registered |
| \`tests/world.test.ts\` | your world, driven through \`boardsmith/world\` |
| \`world.html\` | the entry a world's own surface is served from |
| \`src/ui/components/WorldBoard.vue\` | that surface |

## What you can run

${worldScaffoldStatus()
  .map((line) => (line === '' ? '' : `    ${line}`))
  .join('\n')}
`;
}
