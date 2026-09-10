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

/** A command that WRITES, so a world's life after a migration can be driven. */
const poke = worldAction<Demo>("poke")
  .needs(() => ["a"])
  .execute((_args, ctx) => {
    (ctx.world.partition("a") as Room).tally += 1;
  });

function bundle(migration: Record<string, unknown> | undefined, stateVersion: number) {
  return {
    gameClass: Demo,
    gameType: "demo",
    world: {
      maxPlayers: 1,
      stateVersion,
      actions: [read, poke],
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

/** One migration, run a page at a time and evicted page by page, which is what
 *  paging exists to make possible (ShufflewickPub #407). */
async function migrateInPages(
  runner: ReturnType<typeof createWorld>["runner"],
  rows: Record<string, StoredPartition>,
  pages: readonly (readonly string[])[],
): Promise<Record<string, StoredPartition>> {
  const after: Record<string, StoredPartition> = {};
  for (const [index, page] of pages.entries()) {
    const body: Record<string, StoredPartition> = {};
    for (const name of page) body[name] = rows[name]!;
    const answer = await runner.migrateAll(body, {
      from: 1,
      to: 2,
      allNames: [...ROOMS],
      runCreate: index === pages.length - 1,
    });
    for (const [name, json] of Object.entries(answer.partitions)) {
      after[name] = { parentId: rows[name]!.parentId, json: JSON.parse(json) };
    }
    // THE LINE THE PLATFORM COULD NOT WRITE (#407). Without it a child that
    // serves ten pages holds the whole world resident by the tenth, which is
    // the exact cost paging exists to remove.
    runner.evict(page);
  }
  return after;
}

const STAMP = {
  arrivedAt: 1_000,
  allowance: { unkeyed: 0, keys: [] as readonly string[], worldPending: 0 },
  presence: [1] as readonly number[],
  activity: null,
};

describe("#407 — a migrated page may be let go of", () => {
  const migrating = (nextElementId: number) =>
    createWorld(
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
        nextElementId,
      ),
    ).runner;

  it("answers the world's next command after each page was evicted", async () => {
    const world = await stored();
    const runner = migrating(world.nextElementId);

    const after = await migrateInPages(runner, world.rows, [
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(JSON.parse(JSON.stringify(after.d!.json)).attributes.tally).toBe(1);

    const command = { name: "poke", args: {} };
    await runner.declare(command, "p1", { a: after.a! }, 0, []);
    const result = await runner.apply({ player: "p1", command, timing: null, ...STAMP });

    // ONLY the room the command named. A touch-mark left behind by the
    // migration would either refuse this command outright or checkpoint a
    // partition nothing wrote.
    expect(result.dirty).toEqual(["a"]);
  });

  it("lets a WHOLE-WORLD migration's roots be evicted afterwards too", async () => {
    // The same mark on the road every migration takes today. Nothing evicts
    // during that migration, so it has never refused -- but a world that lets
    // go of a cold room an hour later is refusing on a mark the migration left.
    const world = await stored();
    const runner = migrating(world.nextElementId);
    await runner.migrateAll(world.rows, { from: 1, to: 2 });
    runner.evict(["c", "d"]);

    const command = { name: "poke", args: {} };
    await runner.declare(command, "p1", {}, 0, []);
    const result = await runner.apply({ player: "p1", command, timing: null, ...STAMP });

    expect(result.dirty).toEqual(["a"]);
  });
});
