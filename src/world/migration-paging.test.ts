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
import type { WorldMigrated } from "./runner.js";
import { worldAction } from "./action.js";
import type { DeclaredSeatActivityStamp, StoredPartition } from "./contract.js";

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
  // EMPTY, ALWAYS, on a seat's road (#423): a seated verb may declare no
  // activity round, so there is nothing honest to hand its handler.
  declaredActivity: [] as readonly DeclaredSeatActivityStamp[],
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

/**
 * BoardSmith #246: A PAGE MAY EMIT NEW DURABLE ROOTS OF ITS OWN.
 *
 * #449 made the FACTS a cross-root migration reads bounded. What stayed
 * unbounded was the OUTPUT: `create` is the only hook whose answer becomes a
 * durable root, it runs once, on the final transform page, and by then every
 * earlier source root has been serialized and let go of. So the one upgrade a
 * grown world actually needs -- "every owner in this 500-root world becomes a header
 * plus five inventory pages" -- had nowhere to be written, because the payload
 * that has to move into those pages is only resident while its own source root
 * is.
 *
 * `derive` is that missing door: per source root, on the page that holds it,
 * handed the root exactly as stored and answering the new roots it splits into.
 * And an allocation made in `partition` and never answered is now a refusal
 * naming what would have been discarded, rather than a migrated header pointing
 * at roots that never reached storage.
 */
class Vault extends Space<Estate> {
  /** The payload that must MOVE into the roots this root splits into. */
  items: number[] = [];
  /** The header's references to the roots it split into. */
  pages: string[] = [];
  /** A charge applied exactly once, so a resumed run can be seen not to repeat it. */
  charge = 0;
}

class Estate extends Game<Estate> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Vault]);
  }
}

/** Two source roots with DIFFERENT payload sizes, so each splits into a
 *  different number of pages and "multiple" is more than a coincidence. */
const HOLDINGS: Record<string, readonly number[]> = {
  "owner-1": [11, 12, 13, 14],
  "owner-2": [21, 22, 23, 24, 25, 26],
  ledgerbook: [],
};
const SOURCES = Object.keys(HOLDINGS).sort();

type Fold = { readonly owners: number; readonly items: number };

const settle = worldAction<Estate>("settle")
  .needs(() => ["owner-1"])
  .execute(() => {});

function estate(migration: Record<string, unknown> | undefined, stateVersion: number) {
  return {
    gameClass: Estate,
    gameType: "estate",
    world: {
      maxPlayers: 1,
      stateVersion,
      actions: [settle],
      genesis: (game: Game) =>
        Object.fromEntries(
          Object.entries(HOLDINGS).map(([name, items]) => {
            const root = game.create(Vault, name);
            root.items = [...items];
            return [name, root];
          }),
        ) as Record<string, GameElement>,
      view: () => ["owner-1"],
      ...(migration === undefined ? {} : { migration }),
    },
  } as WorldRunnerOptions["definition"];
}

/** The split every case below runs: each owner keeps its identity as a HEADER
 *  and its payload moves into two-item pages it answers, while the digest
 *  carries counts and no payload at all. */
const FAN_OUT = {
  from: 1,
  survey: {
    initial: (): Fold => ({ owners: 0, items: 0 }),
    root: (digest: Fold, element: Vault, name: string): Fold =>
      name.startsWith("owner")
        ? { owners: digest.owners + 1, items: digest.items + element.items.length }
        : digest,
    maxBytes: 256,
  },
  derive: (
    element: Vault,
    ctx: { name: string; digest: Fold; existing: readonly string[] },
  ): Record<string, GameElement> => {
    if (!ctx.name.startsWith("owner")) return {};
    const built: Record<string, GameElement> = {};
    const names: string[] = [];
    for (let at = 0; at < element.items.length; at += 2) {
      const pageName = `${ctx.name}/page-${at / 2}`;
      const page = element.game.create(Vault, pageName);
      page.items = element.items.slice(at, at + 2);
      // ONE charge per page, applied where the payload is, so a resumed run
      // that created a page twice would be visible as a doubled total.
      page.charge = 1;
      built[pageName] = page;
      names.push(pageName);
    }
    // THE PAYLOAD LEAVES THE HEADER. This is the whole of the capability: it
    // can only be written while the source root's own bytes are resident.
    element.items = [];
    element.pages = names;
    element.charge = ctx.digest.owners;
    return built;
  },
};

async function storedEstate(): Promise<StoredEstate> {
  const born = createWorld(options(estate(undefined, 1))).runner;
  const genesis = await born.genesis();
  return { rows: genesis.partitions, nextElementId: genesis.nextElementId };
}

/** What a host holds after a page's transaction lands: the bytes it wrote, the
 *  allocation stamp those bytes were minted under, and the names it now knows
 *  are taken. */
interface Landed {
  rows: Record<string, StoredPartition>;
  nextElementId: number;
  digest: string;
}

/** What a host sends the child for one page of one source world. */
type StoredEstate = { rows: Record<string, StoredPartition>; nextElementId: number };

const bodyOf = (world: StoredEstate, names: readonly string[]): Record<string, StoredPartition> =>
  Object.fromEntries(names.map((name) => [name, world.rows[name]!]));

/** Every page folded in, on a fresh runner each time, the digest crossing as
 *  bytes because that is what a host persists between wakes. */
async function surveyEvery(
  definition: WorldRunnerOptions["definition"],
  world: StoredEstate,
  pages: readonly (readonly string[])[],
): Promise<string> {
  let digest: string | undefined;
  for (const names of pages) {
    const answer = await createWorld(
      options(definition, world.nextElementId),
    ).runner.migrateAll(bodyOf(world, names), {
      from: 1,
      to: 2,
      allNames: [...SOURCES],
      pass: "survey",
      ...(digest === undefined ? {} : { digest }),
    });
    digest = answer.digest;
  }
  return digest!;
}

/** One page's transaction, landed: the bytes, the roots it derived or created,
 *  and the allocation stamp they were minted under, all together. */
function keep(landed: Landed, world: StoredEstate, answer: WorldMigrated): void {
  for (const [name, json] of Object.entries(answer.partitions)) {
    landed.rows[name] = { parentId: world.rows[name]!.parentId, json: JSON.parse(json) };
  }
  for (const [name, record] of Object.entries(answer.created)) landed.rows[name] = record;
  landed.nextElementId = answer.nextElementId;
}

/**
 * ONE FAN-OUT MIGRATION, DRIVEN THE WAY A HOST MUST DRIVE ONE.
 *
 * A FRESH RUNNER per call, the digest carried as bytes, the allocation stamp
 * carried forward from each answer, and every root a landed page created added
 * to `allNames` -- because that is the host's own knowledge and it is what a
 * second attempt at a landed page has to collide with.
 *
 * `failAt` is the injected failure: a page whose transaction is thrown out
 * before anything of it is kept, which is the only rollback a forward-only
 * resume has. `from` and `firstPage` are the resume itself, and `stopAfter` is
 * the host that stopped partway with everything before it landed.
 */
async function fanOut(
  world: StoredEstate,
  pages: readonly (readonly string[])[],
  opts: {
    readonly migration?: Record<string, unknown>;
    readonly failAt?: number;
    readonly from?: Landed;
    readonly firstPage?: number;
    readonly stopAfter?: number;
  } = {},
): Promise<Landed> {
  const definition = estate(opts.migration ?? FAN_OUT, 2);
  const landed: Landed = opts.from
    ? { rows: { ...opts.from.rows }, nextElementId: opts.from.nextElementId, digest: opts.from.digest }
    : {
        rows: {},
        nextElementId: world.nextElementId,
        digest: await surveyEvery(definition, world, pages),
      };

  const last = opts.stopAfter ?? pages.length - 1;
  for (let index = opts.firstPage ?? 0; index <= last; index += 1) {
    const answer = await createWorld(
      options(definition, landed.nextElementId),
    ).runner.migrateAll(bodyOf(world, pages[index]!), {
      from: 1,
      to: 2,
      allNames: [...new Set([...SOURCES, ...Object.keys(landed.rows)])].sort(),
      pass: "transform",
      runCreate: index === pages.length - 1,
      digest: landed.digest,
    });
    // THE INJECTED FAILURE, exactly where a host's own transaction would fail:
    // the answer is thrown away whole, so nothing of this page is kept and the
    // stamp does not advance either.
    if (index === opts.failAt) throw new Error(`host lost page ${index}`);
    keep(landed, world, answer);
  }
  return landed;
}

const attrs = (row: StoredPartition) =>
  (JSON.parse(JSON.stringify(row.json)) as { attributes: Record<string, unknown> }).attributes;

/** Every element id in a stored subtree, so "no duplicate ids" is measurable. */
function idsIn(row: StoredPartition): number[] {
  const walk = (node: { _id?: number; children?: unknown[] }): number[] => [
    ...(node._id === undefined ? [] : [node._id]),
    ...((node.children ?? []) as { _id?: number; children?: unknown[] }[]).flatMap(walk),
  ];
  return walk(JSON.parse(JSON.stringify(row.json)) as { _id?: number });
}

describe("#246 — a transform page emits the roots its own source root splits into", () => {
  it("splits TWO source roots into a header plus MULTIPLE new durable pages", async () => {
    const world = await storedEstate();
    const landed = await fanOut(world, [["owner-1"], ["owner-2"], ["ledgerbook"]]);

    expect(Object.keys(landed.rows).sort()).toEqual([
      "ledgerbook",
      "owner-1",
      "owner-1/page-0",
      "owner-1/page-1",
      "owner-2",
      "owner-2/page-0",
      "owner-2/page-1",
      "owner-2/page-2",
    ]);
    // The header kept its identity and lost its payload; the payload is in the
    // pages, which is the move that could only happen while it was resident.
    expect(attrs(landed.rows["owner-1"]!).items).toEqual([]);
    expect(attrs(landed.rows["owner-1"]!).pages).toEqual(["owner-1/page-0", "owner-1/page-1"]);
    expect(attrs(landed.rows["owner-1/page-1"]!).items).toEqual([13, 14]);
    expect(attrs(landed.rows["owner-2/page-2"]!).items).toEqual([25, 26]);
    // The digest carried counts and no payload at all.
    expect(JSON.parse(landed.digest)).toEqual({ owners: 2, items: 10 });
    expect(landed.digest).not.toMatch(/13|25/);
  });

  it("reaches the same world in EITHER source-root order, on a cold runner per page", async () => {
    const world = await storedEstate();
    const forwards = await fanOut(world, [["owner-1"], ["owner-2"], ["ledgerbook"]]);
    const backwards = await fanOut(world, [["ledgerbook"], ["owner-2"], ["owner-1"]]);

    for (const name of Object.keys(forwards.rows)) {
      expect(attrs(backwards.rows[name]!), `root ${name}`).toEqual(attrs(forwards.rows[name]!));
    }
  });

  it("every saved header reference resolves to a stored root", async () => {
    const world = await storedEstate();
    const landed = await fanOut(world, [["owner-1", "ledgerbook"], ["owner-2"]]);

    for (const [name, row] of Object.entries(landed.rows)) {
      for (const reference of attrs(row).pages as string[]) {
        expect(landed.rows[reference], `${name} references ${reference}`).toBeDefined();
      }
    }
  });

  it("mints no id twice and charges no page twice", async () => {
    const world = await storedEstate();
    const landed = await fanOut(world, [["owner-1"], ["owner-2"], ["ledgerbook"]]);

    const ids = Object.values(landed.rows).flatMap(idsIn);
    expect(new Set(ids).size, "every stored element id is distinct").toBe(ids.length);
    const charged = Object.values(landed.rows).reduce(
      (total, row) => total + (attrs(row).charge as number),
      0,
    );
    // Five pages, one charge each, plus two headers stamped with the owner count.
    expect(charged).toBe(5 + 2 * 2);
  });

  it("resumes forward-only after a page's transaction is lost, without duplicating anything", async () => {
    const world = await storedEstate();
    const pages = [["owner-1"], ["owner-2"], ["ledgerbook"]];

    // The run that loses page 1's transaction: page 0 landed, nothing of page 1
    // was kept, and the stamp did not advance past it.
    await expect(fanOut(world, pages, { failAt: 1 })).rejects.toThrow(/host lost page 1/);

    // What the host holds at that point, and the forward-only resume from it.
    const kept = await fanOut(world, pages, { stopAfter: 0 });
    const finished = await fanOut(world, pages, { from: kept, firstPage: 1 });

    const whole = await fanOut(world, pages);
    expect(Object.keys(finished.rows).sort()).toEqual(Object.keys(whole.rows).sort());
    const ids = Object.values(finished.rows).flatMap(idsIn);
    expect(new Set(ids).size).toBe(ids.length);
    const charged = (landed: Landed) =>
      Object.values(landed.rows).reduce((total, row) => total + (attrs(row).charge as number), 0);
    expect(charged(finished)).toBe(charged(whole));
  });

  it("REFUSES a page that would re-derive roots a landed page already stored", async () => {
    // The forward-only policy's own guard: a host that re-sent a page it had
    // already committed would mint a second copy of every page that root split
    // into, so the name it already holds is the refusal.
    const world = await storedEstate();
    const pages = [["owner-1"], ["owner-2"], ["ledgerbook"]];
    const kept = await fanOut(world, pages, { stopAfter: 0 });

    await expect(
      fanOut(world, pages, { from: kept, firstPage: 0, stopAfter: 0 }),
    ).rejects.toThrow(/already holds/);
  });

  it("resumes after the FINAL creation hook failed, adding its root exactly once", async () => {
    const world = await storedEstate();
    const pages = [["owner-1"], ["owner-2"], ["ledgerbook"]];
    let attempts = 0;
    const withFinalCreate = {
      ...FAN_OUT,
      create: (game: Game, ctx: { digest: Fold; existing: readonly string[] }) => {
        attempts += 1;
        if (attempts === 1) throw new Error("final creation lost");
        const index = game.create(Vault, "index");
        index.charge = ctx.digest.owners;
        index.pages = ctx.existing.filter((name) => name.includes("/page-"));
        return { index };
      },
    };

    await expect(fanOut(world, pages, { migration: withFinalCreate })).rejects.toThrow(
      /final creation lost/,
    );

    const upToLast = await fanOut(world, pages, {
      migration: withFinalCreate,
      stopAfter: 1,
    });
    const finished = await fanOut(world, pages, {
      migration: withFinalCreate,
      from: upToLast,
      firstPage: 2,
    });

    expect(Object.keys(finished.rows).filter((name) => name === "index")).toEqual(["index"]);
    expect(attrs(finished.rows.index!).pages).toEqual([
      "owner-1/page-0",
      "owner-1/page-1",
      "owner-2/page-0",
      "owner-2/page-1",
      "owner-2/page-2",
    ]);
    const ids = Object.values(finished.rows).flatMap(idsIn);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the digest ceiling exactly where it was", async () => {
    const world = await storedEstate();
    const attempt = createWorld(options(estate({ ...FAN_OUT, survey: { ...FAN_OUT.survey, maxBytes: 8 } }, 2), world.nextElementId)).runner.migrateAll(
      { "owner-1": world.rows["owner-1"]! },
      { from: 1, to: 2, allNames: [...SOURCES], pass: "survey" },
    );

    await expect(attempt).rejects.toThrow(/past the 8-byte ceiling/);
  });

  it("lets a page AND the roots it derived be evicted, and answers the next command", async () => {
    // #407 on the fan-out road: the derived roots are partitions the engine
    // invented, so a baseline it forgot for one of them would leave a mark the
    // world's next command could not name -- and refuse, for good.
    const world = await storedEstate();
    const runner = createWorld(options(estate(FAN_OUT, 2), world.nextElementId)).runner;
    const survey = await runner.migrateAll(world.rows, { from: 1, to: 2, allNames: [...SOURCES], pass: "survey" });
    const answer = await runner.migrateAll(world.rows, {
      from: 1,
      to: 2,
      allNames: [...SOURCES],
      pass: "transform",
      runCreate: true,
      digest: survey.digest!,
    });
    runner.evict([...SOURCES, ...Object.keys(answer.created)]);

    const command = { name: "settle", args: {} };
    const stored: Record<string, StoredPartition> = {
      "owner-1": { parentId: 0, json: JSON.parse(answer.partitions["owner-1"]!) },
    };
    await runner.declare(command, "p1", stored, 0, []);
    const result = await runner.apply({ player: "p1", command, timing: null, ...STAMP });

    expect(result.dirty).toEqual(["owner-1"]);
  });

  it("writes nothing on the survey pass of a migration that derives", async () => {
    const world = await storedEstate();
    const answer = await createWorld(
      options(estate(FAN_OUT, 2), world.nextElementId),
    ).runner.migrateAll(
      { "owner-1": world.rows["owner-1"]! },
      { from: 1, to: 2, allNames: [...SOURCES], pass: "survey" },
    );

    expect(answer.partitions).toEqual({});
    expect(answer.created).toEqual({});
  });
});

describe("#246 — an allocation a hook never answered is refused, not discarded", () => {
  const runnerFor246 = (migration: Record<string, unknown>, nextElementId: number) =>
    createWorld(options(estate(migration, 2), nextElementId)).runner;

  it("REFUSES a `partition` hook that allocated a top-level root, naming it", async () => {
    // The whole reason this issue exists: the header was rewritten to point at
    // roots the answer silently omitted, so a host stored a reference to bytes
    // that never existed.
    const world = await storedEstate();

    await expect(
      runnerFor246(
        {
          from: 1,
          partition: (element: Vault) => {
            const orphan = element.game.create(Vault, "owner-1/page-0");
            orphan.items = [...element.items];
            element.items = [];
            element.pages = ["owner-1/page-0"];
          },
        },
        world.nextElementId,
      ).migrateAll({ "owner-1": world.rows["owner-1"]! }, { from: 1, to: 2 }),
    ).rejects.toThrow(/"owner-1\/page-0"/);
  });

  it("REFUSES a `derive` hook that allocated a root it did not answer", async () => {
    const world = await storedEstate();

    await expect(
      runnerFor246(
        {
          from: 1,
          derive: (element: Vault) => {
            element.game.create(Vault, "stranded");
            return {};
          },
        },
        world.nextElementId,
      ).migrateAll({ "owner-1": world.rows["owner-1"]! }, { from: 1, to: 2 }),
    ).rejects.toThrow(/"stranded"/);
  });

  it("REFUSES a `create` hook that allocated a root it did not answer", async () => {
    const world = await storedEstate();

    await expect(
      runnerFor246(
        {
          from: 1,
          create: (game: Game) => {
            const kept = game.create(Vault, "kept");
            game.create(Vault, "dropped");
            return { kept };
          },
        },
        world.nextElementId,
      ).migrateAll({ "owner-1": world.rows["owner-1"]! }, { from: 1, to: 2 }),
    ).rejects.toThrow(/"dropped"/);
  });

  it("allows a hook to allocate INTO the root it was handed", async () => {
    // The legitimate case the refusal must not catch: an element created and
    // then placed inside the partition's own subtree is that partition's bytes.
    const world = await storedEstate();
    const answer = await runnerFor246(
      {
        from: 1,
        partition: (element: Vault) => {
          element.create(Vault, "slot");
        },
      },
      world.nextElementId,
    ).migrateAll({ "owner-1": world.rows["owner-1"]! }, { from: 1, to: 2 });

    expect(Object.keys(answer.partitions)).toEqual(["owner-1"]);
  });
});

/**
 * BoardSmith #255: THE CARRIED DIGEST IS INPUT, AND INPUT IS CHECKED.
 *
 * A survey pass measures the digest it just folded, and an unpaged transform
 * folds and measures in the same call. A PAGED transform folds neither: its
 * digest arrives as bytes a host persisted between wakes, and those bytes were
 * taken on trust -- so a world could be handed a digest larger than the
 * author's own `survey.maxBytes` AND larger than the host's, and run `derive`,
 * `partition` and `create` against it. The ceilings are the whole of the
 * bounded-memory promise, so they are met on the way IN as well as on the way
 * out, by the one measurement both paths share.
 */
describe("#255 — a carried digest past either ceiling is refused before any hook", () => {
  type Blob = { readonly text: string };

  /** A digest of EXACTLY `bytes` UTF-8 bytes, so a ceiling can be sat on as
   *  well as passed. `{"text":"…"}` is eleven bytes of frame. */
  const digestOf = (bytes: number): string => JSON.stringify({ text: "x".repeat(bytes - 11) });

  /** The migration every case runs: it folds nothing of its own, so the only
   *  digest in play is the one the host carried in, and each hook says it ran. */
  const carrying = (maxBytes: number, ran: string[]) => ({
    from: 1,
    survey: {
      initial: (): Blob => ({ text: "" }),
      root: (digest: Blob): Blob => digest,
      maxBytes,
    },
    derive: (): Record<string, GameElement> => {
      ran.push("derive");
      return {};
    },
    partition: (): void => {
      ran.push("partition");
    },
    create: (): Record<string, GameElement> => {
      ran.push("create");
      return {};
    },
  });

  /** A cold transform page, the way a host resumes one: a fresh runner, one
   *  page of bytes, and the digest carried in as bytes of a stated size. */
  const resume = async (
    authorMax: number,
    hostMax: number,
    bytes: number,
    ran: string[],
  ): Promise<WorldMigrated> => {
    const world = await storedLedger();
    const digest = digestOf(bytes);
    expect(new TextEncoder().encode(digest).length, "the carried digest's own size").toBe(bytes);
    return ledgerRunner(carrying(authorMax, ran), world.nextElementId).migrateAll(
      { a: world.rows.a! },
      {
        from: 1,
        to: 2,
        allNames: [...ROOMS],
        pass: "transform",
        runCreate: true,
        digest,
        maxDigestBytes: hostMax,
      },
    );
  };

  it.each([
    {
      label: "the AUTHOR's own stated ceiling",
      authorMax: 32,
      hostMax: 1_024,
      bytes: 139,
      bound: 32,
      whose: /this migration declares in `survey\.maxBytes`/,
    },
    {
      // A host that lowered its ceiling since the digest was persisted is the
      // reason this is checked on the way in at all: the author's number was
      // met when the fold ran, and THIS wake's number is the one that binds.
      label: "the HOST's lower ceiling, naming whose it was",
      authorMax: 1_024,
      hostMax: 32,
      bytes: 139,
      bound: 32,
      whose: /THIS HOST puts on a migration digest[\s\S]*`survey\.maxBytes` of 1024/,
    },
    {
      label: "the reported 128 KiB author / 256 KiB host bound",
      authorMax: 131_072,
      hostMax: 262_144,
      bytes: 262_156,
      bound: 131_072,
      whose: /this migration declares in `survey\.maxBytes`/,
    },
  ])("REFUSES a carried digest past $label, and runs no hook", async (each) => {
    const ran: string[] = [];

    const attempt = resume(each.authorMax, each.hostMax, each.bytes, ran);

    await expect(attempt).rejects.toThrow(
      new RegExp(`digest of ${each.bytes} bytes, past the ${each.bound}-byte ceiling`),
    );
    await expect(attempt).rejects.toThrow(each.whose);
    expect(ran, "no hook may run against an out-of-bound digest").toEqual([]);
  });

  it.each([
    { label: "the author's", authorMax: 64, hostMax: 1_024 },
    { label: "the host's lower", authorMax: 1_024, hostMax: 64 },
  ])("ACCEPTS a carried digest exactly AT $label ceiling", async (each) => {
    const ran: string[] = [];

    const answer = await resume(each.authorMax, each.hostMax, 64, ran);

    expect(Object.keys(answer.partitions)).toEqual(["a"]);
    expect(ran).toEqual(["derive", "partition", "create"]);
  });

  it("leaves a normal paged run, and the bytes it carries, exactly as they were", async () => {
    // The check is on the input, not on the value: the same four-page run still
    // folds to the same digest and writes the same world.
    const world = await storedLedger();
    const run = await migrateBounded(world.rows, world.nextElementId, [["a"], ["b"], ["c"], ["d"]]);

    expect(run.digest).toBe(JSON.stringify({ total: 15, names: [...ROOMS] }));
    expect(attributesOf(run.after.a!).derived).toBe(115);
  });
});
