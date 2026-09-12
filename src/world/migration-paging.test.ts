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

/** The migration every case below that does not care WHAT changed runs: one
 *  root, transformed from itself alone, which is the independently pageable
 *  shape. Shared so that "a page" and "the whole world" differ in the call
 *  rather than in the setup. */
const BUMPING = {
  from: 1,
  partition: (element: Room) => {
    element.tally += 1;
  },
};

/** A runner for one migration over a world already stored. */
const runnerFor = (migration: Record<string, unknown>, nextElementId: number) =>
  createWorld(options(bundle(migration, 2), nextElementId)).runner;

describe("#402 — whether a migration may be run a page at a time", () => {
  // WHICH MIGRATIONS MAY BE PAGED is now `migrationShape()`, which tells all
  // three shapes apart rather than the two a boolean could -- see the #449
  // block below for the whole answer.

  it("transforms only the roots the page was handed, and answers only those", async () => {
    const world = await stored();
    const runner = runnerFor(BUMPING, world.nextElementId);

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
    const runner = runnerFor({ from: 1, finalize: () => {} }, world.nextElementId);

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
    const answer = await runnerFor(BUMPING, world.nextElementId).migrateAll(world.rows, {
      from: 1,
      to: 2,
    });

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
  const migrating = (nextElementId: number) => runnerFor(BUMPING, nextElementId);

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

/**
 * ShufflewickPub #449: A CROSS-ROOT MIGRATION THAT NEVER HOLDS THE WORLD.
 *
 * `finalize` derives one root's value from another by having every root
 * resident at once, and a host with a measured memory ceiling cannot grant
 * that to a world of 662 roots and 4.5 MB -- so the one migration shape #379
 * was opened for was the one shape a real world could not run.
 *
 * The facts a cross-root migration needs are not the roots; they are what the
 * roots ADD UP TO. So `survey` folds the whole world into a BOUNDED digest one
 * page at a time, and only then does anything transform: every write is a pure
 * function of (that root, the completed digest), the fold finished before the
 * first write, and residency never exceeds one page.
 */
class Sums extends Space<Ledger> {
  seed = 0;
  derived = 0;
  note = "";
}

class Ledger extends Game<Ledger> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Sums]);
  }
}

/** What each root is worth before the migration, so one root's new value can
 *  be seen to depend on ANOTHER root's persisted value. */
const SEEDS: Record<string, number> = { a: 1, b: 2, c: 4, d: 8 };

type Digest = { readonly total: number; readonly names: readonly string[] };

const touch = worldAction<Ledger>("touch")
  .needs(() => ["a"])
  .execute(() => {});

function ledger(migration: Record<string, unknown> | undefined, stateVersion: number) {
  return {
    gameClass: Ledger,
    gameType: "ledger",
    world: {
      maxPlayers: 1,
      stateVersion,
      actions: [touch],
      genesis: (game: Game) =>
        Object.fromEntries(
          ROOMS.map((name) => {
            const root = game.create(Sums, name);
            root.seed = SEEDS[name]!;
            return [name, root];
          }),
        ) as Record<string, GameElement>,
      view: () => ["a"],
      ...(migration === undefined ? {} : { migration }),
    },
  } as WorldRunnerOptions["definition"];
}

/** The one migration every case below runs: each root's new value is the whole
 *  world's total, which is a fact no single root holds. */
const CROSS_ROOT = {
  from: 1,
  survey: {
    initial: (): Digest => ({ total: 0, names: [] }),
    root: (digest: Digest, element: Sums, name: string): Digest => ({
      total: digest.total + element.seed,
      names: [...digest.names, name].sort(),
    }),
    maxBytes: 4_096,
  },
  partition: (element: Sums, ctx: { digest: Digest; name: string }) => {
    element.derived = element.seed * 100 + ctx.digest.total;
    element.note = ctx.digest.names.join(",");
  },
};

async function storedLedger(): Promise<{
  rows: Record<string, StoredPartition>;
  nextElementId: number;
}> {
  const born = createWorld(options(ledger(undefined, 1))).runner;
  const genesis = await born.genesis();
  return { rows: genesis.partitions, nextElementId: genesis.nextElementId };
}

/**
 * ONE BOUNDED MIGRATION, DRIVEN THE WAY A HOST MUST DRIVE IT.
 *
 * Survey every page, carrying the digest ACROSS CALLS AS BYTES because that is
 * what a host persists between wakes; then transform every page against the
 * completed digest. A fresh runner per call, so nothing survives in the child
 * but what the host handed back in.
 */
async function migrateBounded(
  rows: Record<string, StoredPartition>,
  nextElementId: number,
  pages: readonly (readonly string[])[],
  migration: Record<string, unknown> = CROSS_ROOT,
): Promise<{
  after: Record<string, StoredPartition>;
  created: Record<string, StoredPartition>;
  digest: string;
}> {
  const definition = ledger(migration, 2);
  const page = (names: readonly string[]): Record<string, StoredPartition> =>
    Object.fromEntries(names.map((name) => [name, rows[name]!]));

  let digest: string | undefined;
  for (const names of pages) {
    const answer = await createWorld(options(definition, nextElementId)).runner.migrateAll(
      page(names),
      {
        from: 1,
        to: 2,
        allNames: [...ROOMS],
        pass: "survey",
        ...(digest === undefined ? {} : { digest }),
      },
    );
    expect(answer.digest, "a survey pass answers the digest it accumulated").toBeTypeOf("string");
    digest = answer.digest;
  }

  const after: Record<string, StoredPartition> = {};
  const created: Record<string, StoredPartition> = {};
  for (const [index, names] of pages.entries()) {
    const answer = await createWorld(options(definition, nextElementId)).runner.migrateAll(
      page(names),
      {
        from: 1,
        to: 2,
        allNames: [...ROOMS],
        pass: "transform",
        runCreate: index === pages.length - 1,
        digest: digest!,
      },
    );
    for (const [name, json] of Object.entries(answer.partitions)) {
      after[name] = { parentId: rows[name]!.parentId, json: JSON.parse(json) };
    }
    Object.assign(created, answer.created);
  }
  return { after, created, digest: digest! };
}

/** A runner for one bounded migration over a world already stored. */
const ledgerRunner = (migration: Record<string, unknown>, nextElementId: number) =>
  createWorld(options(ledger(migration, 2), nextElementId)).runner;

/** One paged call of the shared cross-root migration, which is what every
 *  refusal below differs from by exactly one field. */
const onePage = (
  world: { rows: Record<string, StoredPartition>; nextElementId: number },
  ctx: Partial<Parameters<ReturnType<typeof ledgerRunner>["migrateAll"]>[1]>,
  migration: Record<string, unknown> = CROSS_ROOT,
) =>
  ledgerRunner(migration, world.nextElementId).migrateAll(
    { a: world.rows.a! },
    { from: 1, to: 2, allNames: [...ROOMS], ...ctx },
  );

const attributesOf = (row: StoredPartition) =>
  (JSON.parse(JSON.stringify(row.json)) as { attributes: Record<string, unknown> }).attributes;

describe("#449 — a bounded cross-root migration", () => {
  it("derives the FIRST root's value from a LATER root, in either page order", async () => {
    // #379's acceptance regression, on the bounded path: `a`'s new value is a
    // function of `b`, `c` and `d`'s persisted values, and the fold finished
    // before a single write, so no order can change the answer.
    const world = await storedLedger();

    const forwards = await migrateBounded(world.rows, world.nextElementId, [
      ["a", "b"],
      ["c", "d"],
    ]);
    const backwards = await migrateBounded(world.rows, world.nextElementId, [
      ["d", "c"],
      ["b", "a"],
    ]);

    expect(attributesOf(forwards.after.a!).derived).toBe(115);
    expect(attributesOf(forwards.after.d!).derived).toBe(815);
    expect(attributesOf(forwards.after.a!).note).toBe("a,b,c,d");
    for (const name of ROOMS) {
      expect(attributesOf(backwards.after[name]!), `root ${name}`).toEqual(
        attributesOf(forwards.after[name]!),
      );
    }
  });

  it("creates a NEW root out of the completed digest", async () => {
    const world = await storedLedger();
    const answer = await migrateBounded(
      world.rows,
      world.nextElementId,
      [["a", "b"], ["c", "d"]],
      {
        ...CROSS_ROOT,
        create: (game: Game, ctx: { digest: Digest; existing: readonly string[] }) => {
          const totals = game.create(Sums, "totals");
          totals.derived = ctx.digest.total;
          totals.note = ctx.digest.names.join(",");
          return { totals };
        },
      },
    );

    expect(Object.keys(answer.created)).toEqual(["totals"]);
    const totals = JSON.parse(JSON.stringify(answer.created.totals!.json)) as {
      attributes: Record<string, unknown>;
    };
    expect(totals.attributes.derived).toBe(15);
    expect(totals.attributes.note).toBe("a,b,c,d");
  });

  it("writes NOTHING on a survey pass", async () => {
    // The pass that reads the world may not touch it, or the "bounded" promise
    // would be a half-migrated world held across a host's wakes.
    const world = await storedLedger();
    const answer = await ledgerRunner(
      { ...CROSS_ROOT, create: (game: Game) => ({ totals: game.create(Sums, "totals") }) },
      world.nextElementId,
    ).migrateAll(
      { a: world.rows.a!, b: world.rows.b! },
      { from: 1, to: 2, allNames: [...ROOMS], pass: "survey" },
    );

    expect(answer.partitions).toEqual({});
    expect(answer.created).toEqual({});
    expect(JSON.parse(answer.digest!)).toEqual({ total: 3, names: ["a", "b"] });
  });

  it("carries the digest between calls as BYTES, unchanged", async () => {
    // The host persists it between wakes, so what a later call is handed is
    // what JSON preserved and nothing else.
    const world = await storedLedger();
    const run = await migrateBounded(world.rows, world.nextElementId, [["a"], ["b"], ["c"], ["d"]]);

    expect(JSON.parse(run.digest)).toEqual({ total: 15, names: [...ROOMS] });
    // Four survey pages and one page at a time still reaches the same world as
    // two pages did, because the digest is the only thing that crossed.
    const paired = await migrateBounded(world.rows, world.nextElementId, [["a", "b"], ["c", "d"]]);
    expect(attributesOf(run.after.a!)).toEqual(attributesOf(paired.after.a!));
  });

  it("REFUSES a survey that writes to the root it was handed", async () => {
    const world = await storedLedger();

    await expect(
      onePage(world, { pass: "survey" }, {
        ...CROSS_ROOT,
        survey: {
          ...CROSS_ROOT.survey,
          root: (digest: Digest, element: Sums) => {
            element.seed = 99;
            return digest;
          },
        },
      }),
    ).rejects.toThrow(/A read-only view of this world tried to write "seed"/);
  });

  it("REFUSES a digest past the AUTHOR's own stated ceiling, naming both numbers", async () => {
    const world = await storedLedger();
    const attempt = ledgerRunner(
      {
        ...CROSS_ROOT,
        survey: {
          initial: () => ({ blob: "" }),
          root: (digest: { blob: string }) => ({ blob: `${digest.blob}${"x".repeat(64)}` }),
          maxBytes: 32,
        },
      },
      world.nextElementId,
    ).migrateAll(
      { a: world.rows.a!, b: world.rows.b! },
      { from: 1, to: 2, allNames: [...ROOMS], pass: "survey" },
    );
    await expect(attempt).rejects.toThrow(/`survey.maxBytes`/);
    await expect(attempt).rejects.toThrow(/past the 32-byte ceiling/);
    await expect(attempt).rejects.toThrow(/accumulated a digest of 139 bytes/);
    await expect(attempt).rejects.toThrow(/will not help/);
  });

  it("REFUSES a digest past the HOST's lower ceiling, and says whose it was", async () => {
    const world = await storedLedger();

    await expect(
      onePage(world, { pass: "survey", maxDigestBytes: 8 }),
    ).rejects.toThrow(/THIS HOST puts on a migration digest/);
  });

  it("REFUSES a transform pass that was handed no digest", async () => {
    // Transforming against an incomplete world is the exact bug the fold
    // exists to remove, so the absence is loud rather than a fresh `initial()`.
    const world = await storedLedger();

    await expect(onePage(world, { pass: "transform" })).rejects.toThrow(/survey pass/);
  });

  it("REFUSES a paged survey migration that names no pass", async () => {
    const world = await storedLedger();

    await expect(onePage(world, {})).rejects.toThrow(/TWO PASSES/);
  });

  it("still migrates a survey migration in ONE call for a world small enough", async () => {
    // A bounded migration is not a paged-only one: handed the whole world, the
    // fold and the transform are the same call.
    const world = await storedLedger();
    const answer = await ledgerRunner(CROSS_ROOT, world.nextElementId).migrateAll(world.rows, {
      from: 1,
      to: 2,
    });

    expect(Object.keys(answer.partitions).sort()).toEqual([...ROOMS]);
    expect(JSON.parse(answer.partitions.a!).attributes.derived).toBe(115);
  });
});

describe("#449 — what SHAPE a migration is, so a host knows how to run it", () => {
  const shapeOf = (migration: Record<string, unknown>) =>
    createWorld(options(ledger(migration, 2))).runner.migrationShape();

  it("reports a plain `partition` migration as independently pageable", () => {
    expect(shapeOf({ from: 1, partition: () => {} })).toEqual({ kind: "independent" });
  });

  it("reports a `survey` migration as pageable in two passes, with its own ceiling", () => {
    expect(shapeOf(CROSS_ROOT)).toEqual({ kind: "survey", maxDigestBytes: 4_096 });
  });

  it("reports a `finalize` migration as whole-world only", () => {
    expect(shapeOf({ from: 1, finalize: () => {} })).toEqual({ kind: "whole-world" });
  });
});
