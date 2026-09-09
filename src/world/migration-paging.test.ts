/**
 * ShufflewickPub #402: A MIGRATION THAT NEED NOT SEE EVERY ROOT MAY BE PAGED.
 *
 * #379 made a migration ONE call carrying the whole world, so `finalize` could
 * derive one root's value from another in either direction. The cost is that
 * every migration pays for that guarantee: the platform reads and parses every
 * root, sends them in one body, adopts the entire world in the child, and
 * serialises them all back -- inside one deadline. At 500 seats that does not
 * finish, which is #393, and the feature fails on exactly the worlds it exists
 * for.
 *
 * THE DECLARATION ALREADY EXISTED and nobody had noticed: `partition`
 * transforms one root and needs no other, `create` needs the NAMES that are
 * taken rather than their bytes, and `finalize` is the only hook that needs
 * every root resident. So the presence of `finalize` is the whole answer to
 * "may this be paged", and an author who writes none pages without saying
 * anything.
 */
import { describe, expect, it } from "vitest";
import { Game, Space, type GameElement, type GameOptions } from "../engine/index.js";
import { createWorld, type WorldRunnerOptions } from "./definition.js";
import { worldAction } from "./action.js";
import type { StoredPartition } from "./contract.js";

class Room extends Space<Demo> {
  tally = 0;
}

class Demo extends Game<Demo> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Room]);
  }
}

const ROOMS = ["a", "b", "c", "d"] as const;

const read = worldAction<Demo>("read")
  .needs(() => ["a"])
  .execute(() => {});

function bundle(migration: Record<string, unknown> | undefined, stateVersion: number) {
  return {
    gameClass: Demo,
    gameType: "demo",
    world: {
      maxPlayers: 1,
      stateVersion,
      actions: [read],
      genesis: (game: Game) =>
        Object.fromEntries(ROOMS.map((name) => [name, game.create(Room, name)])) as Record<
          string,
          GameElement
        >,
      view: () => ["a"],
      ...(migration === undefined ? {} : { migration }),
    },
  } as WorldRunnerOptions["definition"];
}

const options = (definition: WorldRunnerOptions["definition"], nextElementId?: number) =>
  ({
    definition,
    seed: "pages",
    seats: new Map([["p1", 1]]),
    ...(nextElementId === undefined ? {} : { nextElementId }),
  }) as WorldRunnerOptions;

/** Genesis, as the host stores it. */
async function stored(): Promise<{
  rows: Record<string, StoredPartition>;
  nextElementId: number;
}> {
  const born = createWorld(options(bundle(undefined, 1))).runner;
  const genesis = await born.genesis();
  return { rows: genesis.partitions, nextElementId: genesis.nextElementId };
}

describe("#402 — whether a migration may be run a page at a time", () => {
  it("says a migration with no `finalize` need NOT see every root", () => {
    const runner = createWorld(
      options(bundle({ from: 1, partition: () => {} }, 2)),
    ).runner;

    expect(runner.migrationNeedsEveryRoot()).toBe(false);
  });

  it("says a migration WITH `finalize` must see every root", () => {
    // The hook #379 added, and the one reason a migration cannot always page.
    const runner = createWorld(
      options(bundle({ from: 1, finalize: () => {} }, 2)),
    ).runner;

    expect(runner.migrationNeedsEveryRoot()).toBe(true);
  });

  it("transforms only the roots the page was handed, and answers only those", async () => {
    const world = await stored();
    const runner = createWorld(
      options(
        bundle(
          {
            from: 1,
            partition: (element: Room) => {
              element.tally += 1;
            },
          },
          2,
        ),
        world.nextElementId,
      ),
    ).runner;

    const page = { a: world.rows.a!, b: world.rows.b! };
    const answer = await runner.migrateAll(page, {
      from: 1,
      to: 2,
      allNames: [...ROOMS],
      runCreate: false,
    });

    expect(Object.keys(answer.partitions).sort()).toEqual(["a", "b"]);
    expect(JSON.parse(answer.partitions.a!).attributes.tally).toBe(1);
    // The roots this page never saw are not in the answer, so a host cannot
    // write bytes for a root it did not migrate.
    expect(answer.partitions.c).toBeUndefined();
  });

  it("adds this version's new roots ONCE, on the page that says so", async () => {
    const world = await stored();
    const definition = bundle(
      {
        from: 1,
        partition: () => {},
        create: (game: Game, ctx: { existing: readonly string[] }) =>
          ctx.existing.includes("e") ? {} : { e: game.create(Room, "e") },
      },
      2,
    );

    const first = await createWorld(options(definition, world.nextElementId)).runner.migrateAll(
      { a: world.rows.a! },
      { from: 1, to: 2, allNames: [...ROOMS], runCreate: false },
    );
    expect(Object.keys(first.created), "a page that does not create adds nothing").toEqual([]);

    const last = await createWorld(options(definition, world.nextElementId)).runner.migrateAll(
      { d: world.rows.d! },
      { from: 1, to: 2, allNames: [...ROOMS], runCreate: true },
    );
    expect(Object.keys(last.created)).toEqual(["e"]);
  });

  it("REFUSES to page a migration whose `finalize` needs the whole world", async () => {
    // Loud rather than silent: paging one would run `finalize` against a world
    // that is half migrated, which is the ordering #379 exists to remove.
    const world = await stored();
    const runner = createWorld(
      options(bundle({ from: 1, finalize: () => {} }, 2), world.nextElementId),
    ).runner;

    await expect(
      runner.migrateAll(
        { a: world.rows.a! },
        { from: 1, to: 2, allNames: [...ROOMS], runCreate: true },
      ),
    ).rejects.toThrow(/cannot be run a page at a time/);
  });

  it("still migrates the whole world in one call when nothing pages it", async () => {
    // The unchanged road, and every existing world takes it.
    const world = await stored();
    const runner = createWorld(
      options(
        bundle(
          {
            from: 1,
            partition: (element: Room) => {
              element.tally += 1;
            },
          },
          2,
        ),
        world.nextElementId,
      ),
    ).runner;

    const answer = await runner.migrateAll(world.rows, { from: 1, to: 2 });

    expect(Object.keys(answer.partitions).sort()).toEqual([...ROOMS]);
  });
});
