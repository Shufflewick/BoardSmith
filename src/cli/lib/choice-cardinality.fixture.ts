/**
 * Fixture games for the choice-cardinality audit (#172). Kept out of the test
 * file so `auditChoiceCardinality` runs against real game classes through the
 * real engine — the audit's whole value is that its counts are the ones move
 * enumeration actually produces.
 */
import {
  Game,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  Space,
  Piece,
  type GameOptions,
} from '../../engine/index.js';
import { worldAction, worldClockAction, type WorldDefinition } from '../../world/index.js';

const VERBS = Array.from({ length: 40 }, (_, i) => `verb-${i}`);

/** A game whose length is measured by a turn counter. */
interface TurnCounted {
  turns: number;
}

/** Four turns of the named actions, then the game ends. */
function shortFlow(actions: string[]) {
  return defineFlow({
    root: loop({
      while: (ctx) => (ctx.game as unknown as TurnCounted).turns < 4,
      maxIterations: 20,
      do: eachPlayer({ do: actionStep({ actions }) }),
    }),
  });
}

/** Every action here does the same thing: burn a turn so the flow advances. */
function burnTurn(_args: unknown, ctx: { game: TurnCounted }) {
  ctx.game.turns++;
  return { success: true };
}

/**
 * One step offers 40 flat choices with nothing shaping them (the wall of
 * buttons); a second offers the same 40 anchored on the board, which is the
 * correct shape and must not be flagged.
 */
export class WideGame extends Game<WideGame, Player> {
  // Read by the flow's loop condition below; fallow cannot follow `ctx.game.turns`.
  // fallow-ignore-next-line unused-class-member
  turns = 0;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create<WideGame>('shout')
        .chooseFrom('verb', { choices: VERBS })
        .execute(burnTurn),
    );

    this.registerAction(
      Action.create<WideGame>('mark')
        .chooseFrom('square', {
          choices: VERBS,
          boardRefs: (choice) => ({
            refs: [{ role: 'target', ref: { notation: String(choice) } }],
          }),
        })
        .execute(burnTurn),
    );

    this.setFlow(shortFlow(['shout', 'mark']));
  }
}

/** Every step is small enough to read as a sentence. Nothing to report. */
export class NarrowGame extends Game<NarrowGame, Player> {
  // fallow-ignore-next-line unused-class-member
  turns = 0;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create<NarrowGame>('pick')
        .chooseFrom('value', { choices: [1, 2, 3] })
        .execute(burnTurn),
    );

    this.setFlow(shortFlow(['pick']));
  }
}

/**
 * WideGame for three or more seats: it refuses to be built for fewer, as a
 * real game dealing a three-hand layout would. The audit must play it at a seat
 * count it supports, and must not call a two-seat crash a clean result.
 */
export class ThreeSeatWideGame extends WideGame {
  constructor(options: GameOptions) {
    if ((options.playerCount ?? 0) < 3) {
      throw new Error(`Three Seat Wide needs at least 3 players, got ${options.playerCount}.`);
    }
    super(options);
  }
}

/** Its only move asks for free text, which the random simulator cannot type, so every game gets stuck. */
export class TypedNameGame extends Game<TypedNameGame, Player> {
  // fallow-ignore-next-line unused-class-member
  turns = 0;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create<TypedNameGame>('name').enterText('nickname', {}).execute(burnTurn),
    );

    this.setFlow(shortFlow(['name']));
  }
}

// ---------------------------------------------------------------------------
// Worlds (#323). A world has no flow; its verbs are world actions, offered per
// seat, and what they offer depends on who has arrived, what has been done and
// what the clock has run.
// ---------------------------------------------------------------------------

/** The one partition every fixture world keeps. */
class Commons extends Space<CardinalityWorld> {
  /** Shoots the clock has grown, read by `harvest`. */
  sprouted = 0;
}

/** A lantern hung for each seat that arrives, read by `light`. */
class Lantern extends Piece<CardinalityWorld> {}

class CardinalityWorld extends Game<CardinalityWorld, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Commons, Lantern]);
  }
}

const COMMONS = 'commons';
const commonsOf = (ctx: { world: { partition(name: string): unknown } }): Commons =>
  ctx.world.partition(COMMONS) as Commons;
const inCommons = () => [COMMONS];
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

/** Forty flat choices with nothing shaping them: the wall of buttons. */
const shout = worldAction<CardinalityWorld>('shout')
  .needs(inCommons)
  .chooseFrom('verb', { choices: VERBS })
  .execute(() => {});

/** The same forty, anchored on the board: the correct shape. */
const mark = worldAction<CardinalityWorld>('mark')
  .needs(inCommons)
  .chooseFrom('square', {
    choices: VERBS,
    boardRefs: (choice) => ({ refs: [{ role: 'target', ref: { notation: String(choice) } }] }),
  })
  .execute(() => {});

/** Three choices. Nothing to report. */
const nod = worldAction<CardinalityWorld>('nod')
  .needs(inCommons)
  .chooseFrom('how', { choices: ['slowly', 'twice', 'gravely'] })
  .execute(() => {});

/**
 * Its SECOND question offers forty once the first is answered, and nothing
 * before: the offer is enumerated with no answers bound, so only a re-asked
 * pick ever sees the forty.
 */
const pair = worldAction<CardinalityWorld>('pair')
  .needs(inCommons)
  .chooseFrom('first', { choices: ['left', 'right'] })
  .chooseFrom('second', { choices: ({ args }) => (args.first === undefined ? [] : VERBS) })
  .execute(() => {});

/** Asks for ten lanterns to be hung for every seat that arrives. */
const hang = worldClockAction<CardinalityWorld>('hang')
  .needs(inCommons)
  .execute((args, ctx) => {
    for (let i = 0; i < 10; i++) commonsOf(ctx).create(Lantern, `lantern-${String(args.seat)}-${i}`);
  });

/** One lantern, off the board, from every lantern hung: ten per arrival. */
const light = worldAction<CardinalityWorld>('light')
  .needs(inCommons)
  .chooseElement('lantern', { elements: (ctx) => commonsOf(ctx).all(Lantern) })
  .execute(() => {});

/** Plants a shoot that the clock grows a minute later. */
const plant = worldAction<CardinalityWorld>('plant')
  .needs(inCommons)
  .execute((_args, ctx) => {
    ctx.world.schedule({ delayMs: 60_000, action: 'sprout', args: {} });
  });

/** The clock's: ten shoots grow, up to forty. */
const sprout = worldClockAction<CardinalityWorld>('sprout')
  .needs(inCommons)
  .execute((_args, ctx) => {
    commonsOf(ctx).sprouted = Math.min(40, commonsOf(ctx).sprouted + 10);
  });

/** One shoot from every shoot grown, so it widens only as the world is played. */
const harvest = worldAction<CardinalityWorld>('harvest')
  .needs(inCommons)
  .chooseFrom('shoot', { choices: (ctx) => range(commonsOf(ctx).sprouted) })
  .execute(() => {});

/** Asks for words, which a random driver cannot type. */
const say = worldAction<CardinalityWorld>('say')
  .needs(inCommons)
  .enterText('line', {})
  .execute(() => {});

/** Writes to a partition it never declared, which the world refuses. */
const trespass = worldAction<CardinalityWorld>('trespass')
  .needs(inCommons)
  .chooseFrom('how', { choices: ['quietly'] })
  .execute((_args, ctx) => {
    ctx.world.partition('elsewhere');
  });

/** More choices than a host lets one selection offer, so the offer itself is refused. */
const flood = worldAction<CardinalityWorld>('flood')
  .needs(inCommons)
  .chooseFrom('drop', { choices: range(250) })
  .execute(() => {});

const WORLD_ACTIONS = { shout, mark, nod, pair, hang, light, plant, sprout, harvest, say, trespass, flood };

/**
 * A three-seat world bundle offering the named actions. `onArrive` names the
 * clock verb a host issues when a seat attaches.
 */
export function cardinalityWorld(
  actions: readonly (keyof typeof WORLD_ACTIONS)[],
  onArrive?: keyof typeof WORLD_ACTIONS,
) {
  const world: WorldDefinition = {
    maxPlayers: 3,
    actions: actions.map((name) => WORLD_ACTIONS[name]),
    view: () => [COMMONS],
    genesis: (game: Game) => ({ [COMMONS]: game.create(Commons, COMMONS) }),
    ...(onArrive === undefined ? {} : { presence: { onArrive } }),
  };
  return { gameClass: CardinalityWorld, gameType: 'cardinality-world', displayName: 'Cardinality World', world };
}
