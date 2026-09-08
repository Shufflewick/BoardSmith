/**
 * A VILLAGE, FOR EVERY SUITE THAT NEEDS A WORLD TO DRIVE (#169).
 *
 * The acceptance case for a world action is a village: five hundred holdings
 * arranged in a ring, so "a neighbouring holding" is a real thing with two
 * candidates rather than a list of every holding there is. Two suites need one
 * -- `action.test.ts`, which proves the engine's behaviour, and
 * `docs/persistent-world-claims.test.ts`, which proves the authoring guide
 * describes that behaviour -- and a second hand-built village is how the two
 * would come to disagree about what a world does.
 *
 * WHAT IS HERE IS THE SCAFFOLDING AND NOT THE VERBS. Each suite writes its own
 * actions, deliberately: the guide's suite transcribes the sample the guide
 * prints, so that a sample which stops compiling stops the suite, and importing
 * the actions from here would make that transcription a pointer to something
 * nobody reads. What is shared is the part no reader learns anything from --
 * the element classes, genesis, a store that counts its reads, and the two
 * loops a host drives.
 *
 * EVERY WORLD BUILT HERE IS COLD. Genesis runs on one game and only its BYTES
 * survive; the engine under test adopts them from the store. A fixture that
 * handed the engine live objects would prove adoption worked without ever
 * running it (`docs/TEST-FIXTURES.md`).
 */
import { Game, Player, Space, type ElementJSON, type GameOptions } from "../engine/index.js";
import { BoardSmithWorldEngine } from "./engine.js";
import { worldBudgets, type WorldBudgets } from "./budgets.js";
import type { ActionDefinition } from "../engine/index.js";
import type { StoredPartition, WorldPartitionSource } from "./contract.js";

/** Small enough to read in a failure message, large enough that a ring is a
 *  ring rather than a pair. */
export const SETTLERS = 6;

/** One seat's land, by the name the store holds it under. */
export const holdingPartition = (seat: number): string => `holding:${seat}`;

/** The one partition every settler shares. */
export const COMMONS = "commons";

/** Standing timber a holding can hold. Genesis leaves every one just under it,
 *  so a neighbour has room to grow and a second tend does not. */
export const STANDING_MAX = 8;

/**
 * THE RING. Holding `n` is between `n - 1` and `n + 1`, and the ends meet.
 *
 * Arithmetic on the seat rather than a fact in the world, which is what lets a
 * selection's own declaration name a neighbour's partition before anything has
 * been loaded.
 */
export const neighboursOf = (seat: number, settlers: number = SETTLERS): number[] => [
  seat === 1 ? settlers : seat - 1,
  seat === settlers ? 1 : seat + 1,
];

// The four fields below are read by the ACTIONS each suite writes, not by this
// file, so a scan of the repository alone reports them unused. That is the same
// false positive an element's attributes always produce.
export class Holding extends Space<VillageFixture> {
  // fallow-ignore-next-line unused-class-member
  seat = 0;
  // fallow-ignore-next-line unused-class-member
  standing = 0;
  // fallow-ignore-next-line unused-class-member
  woodpile = 0;
}

export class Commons extends Space<VillageFixture> {
  // fallow-ignore-next-line unused-class-member
  embers = 0;
}

export class VillageFixture extends Game<VillageFixture, Player> {
  constructor(options: GameOptions) {
    super(options);
    // Registered in the class constructor and not the Game's: world mode has no
    // handler re-bind pass on adoption, so anything a grafted element needs
    // must come from its own class.
    this.registerElements([Holding, Commons]);
  }

  holdingOf(seat: number): Holding {
    const found = this.first(Holding, `holding-${seat}`);
    if (!found) throw new Error(`no holding for seat ${seat}`);
    return found;
  }
}

/** A stamped arrival instant, for the cases that do not care which one it is.
 *  A host stamps every command with one; a test that omitted it would be
 *  testing a road no command travels. */
export const STAMP = {
  now: 1_700_000_000_000,
  allowance: { unkeyed: 0, keys: [], worldPending: 0 },
  /** Nobody connected: presence is derived from attached sockets, and these
   *  suites attach none. */
  presence: [] as readonly number[],
};

/** The same two facts an offer needs. */
export const OFFER = { now: STAMP.now, presence: [] as readonly number[] };

function throughStorage(json: ElementJSON): ElementJSON {
  return JSON.parse(JSON.stringify(json)) as ElementJSON;
}

/**
 * Build the village once and keep only its bytes.
 *
 * `settlers` IS A PARAMETER because one claim about a world is only measurable
 * at population (#181): a view that costs O(world) and a view that costs
 * O(what the seat named) are indistinguishable in a village of six. Every
 * seat-dependent helper here takes the same number, so a bigger village is the
 * same village and not a second one.
 */
export function villageGenesis(settlers: number = SETTLERS): Map<string, StoredPartition> {
  const game = new VillageFixture({ playerCount: settlers, seed: "village", worldMode: true });
  const commons = game.create(Commons, "commons");
  const stored = new Map<string, StoredPartition>([
    [COMMONS, { parentId: game.id, json: throughStorage(commons.toJSON()) }],
  ]);
  for (let seat = 1; seat <= settlers; seat++) {
    const holding = game.create(Holding, `holding-${seat}`, {
      seat,
      standing: STANDING_MAX - 1,
      woodpile: 1,
    });
    holding.player = game.players[seat - 1];
    stored.set(holdingPartition(seat), {
      parentId: game.id,
      json: throughStorage(holding.toJSON()),
    });
  }
  return stored;
}

/** Counts every read, so "an offer over a seat that has just looked reads no
 *  storage" is a claim something measured. */
export class CountingStore implements WorldPartitionSource {
  readonly reads: string[] = [];
  constructor(private readonly stored: Map<string, StoredPartition>) {}
  async read(name: string): Promise<StoredPartition | undefined> {
    this.reads.push(name);
    return this.stored.get(name);
  }
  /** A cold store re-reads a forgotten partition from its own bytes, which is
   *  what a host's storage does too. The READ COUNT is the point. */
  forget(): void {}
}

/** A cold world running the given verbs, with every seat taken. */
export function newVillageEngine(
  actions: readonly ActionDefinition[],
  budgets: WorldBudgets = worldBudgets(),
  settlers: number = SETTLERS,
): { engine: BoardSmithWorldEngine; store: CountingStore; game: VillageFixture } {
  const game = new VillageFixture({ playerCount: settlers, seed: "village", worldMode: true });
  const store = new CountingStore(villageGenesis(settlers));
  const seats = new Map<string, number>();
  for (let seat = 1; seat <= settlers; seat++) seats.set(`p${seat}`, seat);
  const engine = new BoardSmithWorldEngine({
    game,
    seats,
    store,
    actions,
    // The commons, and the seat's own holding.
    view: (seat) => [COMMONS, holdingPartition(seat)],
    budgets,
  });
  return { engine, store, game };
}

/**
 * Drive the ordered walk the way a host does: ask, supply, ask again.
 *
 * No ceiling, because the walk is as long as the action's own steps and every
 * round it names becomes resident before it is asked again.
 */
export async function applyThroughWalk(
  engine: BoardSmithWorldEngine,
  player: string,
  command: { name: string; args: Record<string, unknown> },
): ReturnType<BoardSmithWorldEngine["applyCommand"]> {
  for (;;) {
    const needs = engine.commandPartitions(player, command, STAMP.now);
    if (needs.length === 0) break;
    await engine.hydrate(needs);
  }
  return engine.applyCommand(player, command, STAMP);
}

/** The element id of one holding, which is what the wire carries for an element
 *  selection. Hydrated first, because an id is minted by adoption. */
export async function holdingId(
  engine: BoardSmithWorldEngine,
  game: VillageFixture,
  seat: number,
): Promise<number> {
  await engine.hydrate([holdingPartition(seat)]);
  return game.holdingOf(seat).id;
}
