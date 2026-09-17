/**
 * #275: REBUILDING AN EXISTING ROOT FROM ANOTHER ROOT'S EXACT RECORDS.
 *
 * #449 made a cross-root migration pageable by folding the world into ONE
 * bounded digest first, and that is the right shape for what the world ADDS UP
 * TO: a total, a directory, a maximum. It is the wrong shape for an exact join.
 * "This owner's carrier references are those particular records, held by those
 * other owners' manifests" is not a fold of the world, it IS the world -- so
 * expressing it as a digest means putting the corpus in the digest, and the
 * corpus does not fit. The reproduction on #275 measured it: eight sources,
 * eight existing destinations, a complete exact join of 524,401 bytes against a
 * host ceiling of 262,144.
 *
 * Every other road was closed too, and each for a stated reason: `derive` may
 * not replace a root that exists, `finalize` may not page, and a cold transform
 * page could not name another root at all.
 *
 * `join` is the missing sentence. The records travel as ROOTS -- declared per
 * root from its name and the digest, loaded by the host with the page, read
 * through a second game that dies with the call -- so the digest stays a fold
 * and the join stays bounded by what one call can carry.
 */
import { describe, expect, it } from "vitest";
import { Game, Space, type GameElement, type GameOptions } from "../engine/index.js";
import { createWorld, type WorldRunnerOptions } from "./definition.js";
import type { StoredPartition } from "./contract.js";
import { worldAction } from "./action.js";
import { worldMigration } from "./migration.js";

/**
 * THE HOST CEILING THIS ISSUE IS ABOUT.
 *
 * ShufflewickPub's `WORLD_MIGRATION_DIGEST_MAX_BYTES`, restated here as the
 * number a host sends down: a quarter of one Durable Object checkpoint put.
 * Nothing below raises it, because raising it is what #275 asks not to need.
 */
const HOST_DIGEST_MAX_BYTES = 262_144;

/** Eight owners, each holding records no fold can summarize. */
const OWNERS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

class Owner extends Space<Ledger> {
  /** The opaque records this owner holds. The whole point is that they are
   *  EXACT: no total, maximum or count reproduces one. */
  records: string[] = [];
  /** What a destination rebuilt from its source. */
  rebuilt: string[] = [];
}

class Ledger extends Game<Ledger> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Owner]);
  }
}

const read = worldAction<Ledger>("read")
  .needs(() => ["dest:0"])
  .execute(() => {});

/** One owner's records: eight 8,000-character values, so a source root is
 *  ~65 KB and eight of them are twice the host's digest ceiling. */
function recordsFor(owner: number): string[] {
  return [0, 1, 2, 3, 4, 5, 6, 7].map(
    (slot) => `${owner}-${slot}-${String(owner * 8 + slot).padStart(4, "0").repeat(2_100)}`,
  );
}

const sourceName = (owner: number) => `source:${owner}`;
const destName = (owner: number) => `dest:${owner}`;

function bundle(migration: unknown, stateVersion: number) {
  return {
    gameClass: Ledger,
    gameType: "ledger",
    world: {
      maxPlayers: 1,
      stateVersion,
      actions: [read],
      genesis: (game: Game) => {
        const roots: Record<string, GameElement> = {};
        for (const owner of OWNERS) {
          const source = game.create(Owner, sourceName(owner)) as Owner;
          source.records = recordsFor(owner);
          roots[sourceName(owner)] = source;
          roots[destName(owner)] = game.create(Owner, destName(owner));
        }
        return roots;
      },
      view: () => ["dest:0"],
      ...(migration === undefined ? {} : { migration }),
    },
  } as WorldRunnerOptions["definition"];
}

const options = (definition: WorldRunnerOptions["definition"], nextElementId?: number) =>
  ({
    definition,
    seed: "join",
    seats: new Map([["p1", 1]]),
    ...(nextElementId === undefined ? {} : { nextElementId }),
  }) as WorldRunnerOptions;

/** Genesis, as the host stores it: the world these cases migrate. */
async function stored(): Promise<{
  rows: Record<string, StoredPartition>;
  nextElementId: number;
}> {
  const born = createWorld(options(bundle(undefined, 1))).runner;
  const genesis = await born.genesis();
  return { rows: genesis.partitions, nextElementId: genesis.nextElementId };
}

const ALL_NAMES = OWNERS.flatMap((owner) => [sourceName(owner), destName(owner)]).sort();

const bytes = (json: string) => new TextEncoder().encode(json).length;

/**
 * THE MIGRATION #275 ASKS FOR: every destination rebuilt from ITS source's
 * exact stored records, with nothing but the pair resident.
 */
const REBUILDING = worldMigration<undefined>({
  from: 1,
  join: {
    sources: (name) => (name.startsWith("dest:") ? [sourceName(Number(name.slice(5)))] : []),
    maxSources: 1,
  },
  partition: (element, ctx) => {
    if (!ctx.name.startsWith("dest:")) return;
    const source = ctx.source(sourceName(Number(ctx.name.slice(5)))) as Owner;
    (element as Owner).rebuilt = [...source.records];
  },
});

const runnerFor = (migration: unknown, nextElementId: number) =>
  createWorld(options(bundle(migration, 2), nextElementId)).runner;

describe("#275 — the join that does not fit in a digest", () => {
  it("is a world whose complete exact join is past the host's digest ceiling", async () => {
    const world = await stored();
    const complete = JSON.stringify(
      Object.fromEntries(
        OWNERS.map((owner) => [sourceName(owner), recordsFor(owner)]),
      ),
    );

    // The size the reproduction measured: a digest that carried the join would
    // be twice what a host will persist, and the largest single root is well
    // inside one call.
    expect(bytes(complete)).toBeGreaterThan(HOST_DIGEST_MAX_BYTES * 2);
    expect(bytes(JSON.stringify(world.rows[sourceName(0)]!.json))).toBeLessThan(
      HOST_DIGEST_MAX_BYTES,
    );
  });

  it("refuses the survey that would carry the join, naming the HOST's ceiling", async () => {
    const world = await stored();
    // The road #449 leaves: fold every source's records into the digest, then
    // write each destination from it. It is the shape that cannot work, and it
    // fails at the host's number rather than at the author's.
    const collecting = worldMigration<Record<string, string[]>>({
      from: 1,
      survey: {
        initial: () => ({}),
        root: (digest, element, name) =>
          name.startsWith("source:")
            ? { ...digest, [name]: [...(element as Owner).records] }
            : digest,
        maxBytes: 4_000_000,
      },
      partition: (element, ctx) => {
        if (!ctx.name.startsWith("dest:")) return;
        (element as Owner).rebuilt = [...(ctx.digest[sourceName(Number(ctx.name.slice(5)))] ?? [])];
      },
    });
    const runner = runnerFor(collecting, world.nextElementId);

    await expect(
      runner.migrateAll(
        Object.fromEntries(ALL_NAMES.map((name) => [name, world.rows[name]!])),
        {
          from: 1,
          to: 2,
          allNames: ALL_NAMES,
          pass: "survey",
          maxDigestBytes: HOST_DIGEST_MAX_BYTES,
        },
      ),
    ).rejects.toThrow(
      new RegExp(`past the ${HOST_DIGEST_MAX_BYTES}-byte ceiling THIS HOST puts`),
    );
  });

  it("rebuilds all eight destinations a page at a time, carrying no join in the digest", async () => {
    const world = await stored();
    const runner = runnerFor(REBUILDING, world.nextElementId);

    // A PAGE IS ONE DESTINATION AND THE ORIGINAL IT JOINS AGAINST. The host
    // asks which originals the page needs BEFORE it reads anything, which is
    // what makes the page's whole cost knowable in advance.
    const written: Record<string, string> = {};
    let widest = 0;
    for (const owner of OWNERS) {
      const page = [destName(owner)];
      const needed = runner.migrationSources(page, { maxSources: 4 });
      expect(needed).toEqual([sourceName(owner)]);

      const sources = Object.fromEntries(needed.map((name) => [name, world.rows[name]!]));
      const answer = await runner.migrateAll(
        { [destName(owner)]: world.rows[destName(owner)]! },
        { from: 1, to: 2, allNames: ALL_NAMES, runCreate: false, sources, maxSources: 4 },
      );
      Object.assign(written, answer.partitions);
      widest = Math.max(
        widest,
        bytes(JSON.stringify(world.rows[destName(owner)])) +
          bytes(JSON.stringify(sources)),
      );
    }

    // Every destination holds its source's records EXACTLY.
    for (const owner of OWNERS) {
      const rebuilt = JSON.parse(written[destName(owner)]!) as {
        attributes: { rebuilt: string[] };
      };
      expect(rebuilt.attributes.rebuilt).toEqual(recordsFor(owner));
    }
    // AND NO PAGE EVER HELD MORE THAN ONE PAIR. The complete join is past two
    // digests; the widest call is one root plus one original.
    expect(widest).toBeLessThan(HOST_DIGEST_MAX_BYTES);
  });

  it("serves the ORIGINAL of a root an earlier page already transformed", async () => {
    // THE COLD-PAGE PROMISE. Each owner's destination joins against the NEXT
    // owner's source, so every page but the first reads a root some earlier
    // page has already rewritten -- and it must read what that root held when
    // the migration began, or the same migration answers differently depending
    // on which order a host paged it in.
    const world = await stored();
    const chained = worldMigration<undefined>({
      from: 1,
      join: {
        sources: (name) =>
          name.startsWith("dest:") ? [sourceName((Number(name.slice(5)) + 1) % 8)] : [],
        maxSources: 1,
      },
      partition: (element, ctx) => {
        const owner = Number(ctx.name.slice(ctx.name.indexOf(":") + 1));
        if (ctx.name.startsWith("source:")) {
          // The source rewrites itself the moment its own page runs, so a host
          // that served live bytes instead of stored ones would be caught here.
          (element as Owner).records = ["rewritten"];
          return;
        }
        (element as Owner).rebuilt = [...(ctx.source(sourceName((owner + 1) % 8)) as Owner).records];
      },
    });

    let nextElementId = world.nextElementId;
    const written: Record<string, string> = {};
    // ONE COLD RUNNER PER PAGE, which is what a host that evicts between wakes
    // actually does.
    for (const name of ALL_NAMES) {
      const runner = runnerFor(chained, nextElementId);
      const needed = runner.migrationSources([name], {});
      const answer = await runner.migrateAll(
        { [name]: world.rows[name]! },
        {
          from: 1,
          to: 2,
          allNames: ALL_NAMES,
          runCreate: false,
          // THE ORIGINALS, not what earlier pages wrote: the host reads them as
          // of the migration's start.
          sources: Object.fromEntries(needed.map((source) => [source, world.rows[source]!])),
        },
      );
      Object.assign(written, answer.partitions);
      nextElementId = answer.nextElementId;
    }

    for (const owner of OWNERS) {
      const rebuilt = JSON.parse(written[destName(owner)]!) as {
        attributes: { rebuilt: string[] };
      };
      expect(rebuilt.attributes.rebuilt).toEqual(recordsFor((owner + 1) % 8));
      // And the sources really were rewritten, so the originals above came from
      // the host's stored bytes rather than from nothing having happened.
      const source = JSON.parse(written[sourceName(owner)]!) as {
        attributes: { records: string[] };
      };
      expect(source.attributes.records).toEqual(["rewritten"]);
    }
  });

  it("re-running a committed page answers the same bytes", async () => {
    // REPLAY. A page's result is a function of (its stored roots, the digest,
    // the originals it declared) and every one of those is what the migration
    // started from -- so a host that crashed after committing a page and sent
    // it again lands the identical bytes.
    const world = await stored();
    const page = { [destName(3)]: world.rows[destName(3)]! };
    const ctx = {
      from: 1,
      to: 2,
      allNames: ALL_NAMES,
      runCreate: false,
      sources: { [sourceName(3)]: world.rows[sourceName(3)]! },
    };

    const first = await runnerFor(REBUILDING, world.nextElementId).migrateAll(page, ctx);
    const again = await runnerFor(REBUILDING, world.nextElementId).migrateAll(page, ctx);
    expect(again.partitions[destName(3)]).toBe(first.partitions[destName(3)]);
  });

  it("writes nothing when a hook throws part way through a page", async () => {
    const world = await stored();
    const throwing = worldMigration<undefined>({
      from: 1,
      join: { sources: (name) => (name === destName(1) ? [sourceName(1)] : []), maxSources: 1 },
      partition: (element, ctx) => {
        if (ctx.name !== destName(1)) return;
        (element as Owner).rebuilt = [...(ctx.source(sourceName(1)) as Owner).records];
        throw new Error("the author's own hook failed");
      },
    });
    const runner = runnerFor(throwing, world.nextElementId);

    await expect(
      runner.migrateAll(
        { [destName(0)]: world.rows[destName(0)]!, [destName(1)]: world.rows[destName(1)]! },
        {
          from: 1,
          to: 2,
          allNames: ALL_NAMES,
          runCreate: false,
          sources: { [sourceName(1)]: world.rows[sourceName(1)]! },
        },
      ),
    ).rejects.toThrow("the author's own hook failed");
    // Nothing was serialized: `migrateAll` answers bytes or it throws, and the
    // host's transaction is the answer -- so the stored bytes the host still
    // holds are the bytes it started with.
    const untouched = world.rows[destName(1)]!.json as { attributes: { rebuilt: string[] } };
    expect(untouched.attributes.rebuilt).toEqual([]);
  });
});

describe("#275 — what a join may not be", () => {
  it("refuses a read the root did not declare", async () => {
    const world = await stored();
    const peeking = worldMigration<undefined>({
      from: 1,
      join: { sources: () => [], maxSources: 1 },
      partition: (_element, ctx) => {
        ctx.source(sourceName(2));
      },
    });

    await expect(
      runnerFor(peeking, world.nextElementId).migrateAll(
        { [destName(0)]: world.rows[destName(0)]! },
        { from: 1, to: 2, allNames: ALL_NAMES, runCreate: false, sources: {} },
      ),
    ).rejects.toThrow(/did not declare it/);
  });

  it("refuses a migration that reaches for an original and declares no join", async () => {
    const world = await stored();
    const undeclared = worldMigration<undefined>({
      from: 1,
      partition: (_element, ctx) => {
        ctx.source(sourceName(2));
      },
    });

    await expect(
      runnerFor(undeclared, world.nextElementId).migrateAll(
        { [destName(0)]: world.rows[destName(0)]! },
        { from: 1, to: 2, allNames: ALL_NAMES, runCreate: false },
      ),
    ).rejects.toThrow(/declares no `join` block/);
  });

  it("refuses a root that names ITSELF as its own original", async () => {
    const world = await stored();
    const selfish = worldMigration<undefined>({
      from: 1,
      join: { sources: (name) => [name], maxSources: 1 },
      partition: () => {},
    });

    await expect(
      runnerFor(selfish, world.nextElementId).migrateAll(
        { [destName(0)]: world.rows[destName(0)]! },
        { from: 1, to: 2, allNames: ALL_NAMES, runCreate: false, sources: {} },
      ),
    ).rejects.toThrow(/as an original source of itself/);
  });

  it("refuses a join wider than the author's own ceiling, and than the host's lower one", async () => {
    const world = await stored();
    const wide = worldMigration<undefined>({
      from: 1,
      join: { sources: () => OWNERS.map(sourceName), maxSources: 4 },
      partition: () => {},
    });
    const page = { [destName(0)]: world.rows[destName(0)]! };

    await expect(
      runnerFor(wide, world.nextElementId).migrateAll(page, {
        from: 1,
        to: 2,
        allNames: ALL_NAMES,
        runCreate: false,
        sources: {},
      }),
    ).rejects.toThrow(/past the ceiling of 4 this migration declares in `join.maxSources`/);

    const narrow = worldMigration<undefined>({
      from: 1,
      join: { sources: () => [sourceName(1), sourceName(2)], maxSources: 8 },
      partition: () => {},
    });
    await expect(
      runnerFor(narrow, world.nextElementId).migrateAll(page, {
        from: 1,
        to: 2,
        allNames: ALL_NAMES,
        runCreate: false,
        sources: {},
        maxSources: 1,
      }),
    ).rejects.toThrow(/past the ceiling of 1 THIS HOST puts/);
  });

  it("refuses a transform page whose originals are not the ones it declared", async () => {
    const world = await stored();
    const runner = runnerFor(REBUILDING, world.nextElementId);
    const page = { [destName(0)]: world.rows[destName(0)]! };

    // None sent at all: a host that has not implemented the read.
    await expect(
      runner.migrateAll(page, { from: 1, to: 2, allNames: ALL_NAMES, runCreate: false }),
    ).rejects.toThrow(/carries the ORIGINAL bytes of the roots it reads, and this call carried none/);

    // The wrong ones sent: the two sides disagree about what this page is.
    await expect(
      runner.migrateAll(page, {
        from: 1,
        to: 2,
        allNames: ALL_NAMES,
        runCreate: false,
        sources: { [sourceName(5)]: world.rows[sourceName(5)]! },
      }),
    ).rejects.toThrow(/Not sent: source:0\. Sent and not declared: source:5\./);
  });

  it("refuses originals sent to a migration that declares no join", async () => {
    const world = await stored();
    await expect(
      runnerFor({ from: 1, partition: () => {} }, world.nextElementId).migrateAll(
        { [destName(0)]: world.rows[destName(0)]! },
        {
          from: 1,
          to: 2,
          allNames: ALL_NAMES,
          runCreate: false,
          sources: { [sourceName(0)]: world.rows[sourceName(0)]! },
        },
      ),
    ).rejects.toThrow(/this migration declares no `join`/);
  });

  it("refuses originals sent to a SURVEY pass", async () => {
    const world = await stored();
    const surveyed = worldMigration<number>({
      from: 1,
      survey: { initial: () => 0, root: (digest) => digest + 1, maxBytes: 64 },
      join: { sources: () => [], maxSources: 1 },
      partition: () => {},
    });

    await expect(
      runnerFor(surveyed, world.nextElementId).migrateAll(
        { [destName(0)]: world.rows[destName(0)]! },
        { from: 1, to: 2, allNames: ALL_NAMES, pass: "survey", sources: {} },
      ),
    ).rejects.toThrow(/survey folds every root in the world exactly once/);
  });

  it("refuses a migration that declares both `join` and `finalize` at the door", async () => {
    expect(() =>
      createWorld(
        options(
          bundle({ from: 1, join: { sources: () => [], maxSources: 1 }, finalize: () => {} }, 2),
          1,
        ),
      ),
    ).toThrow(/declares BOTH `join` and `finalize`/);
  });

  it("refuses a `join` block that is not one, at the door", async () => {
    expect(() =>
      createWorld(options(bundle({ from: 1, join: { sources: () => [] } }, 2), 1)),
    ).toThrow(/`world.migration.join.maxSources` is undefined, which is not a ceiling/);
    expect(() =>
      createWorld(options(bundle({ from: 1, join: { maxSources: 2 } }, 2), 1)),
    ).toThrow(/`world.migration.join.sources` is not a function/);
  });

  it("tells a host that this migration joins, and how wide", async () => {
    const world = await stored();
    expect(runnerFor(REBUILDING, world.nextElementId).migrationShape()).toEqual({
      kind: "independent",
      joins: { maxSources: 1 },
    });
    // A migration with no join says nothing new, so a host written before this
    // reads exactly the shape it always did.
    expect(
      runnerFor({ from: 1, partition: () => {} }, world.nextElementId).migrationShape(),
    ).toEqual({ kind: "independent" });
  });

  it("answers the same originals for the same page, however often a host asks", async () => {
    const world = await stored();
    const runner = runnerFor(REBUILDING, world.nextElementId);
    const page = [destName(2), destName(5)];
    expect(runner.migrationSources(page, {})).toEqual([sourceName(2), sourceName(5)]);
    expect(runner.migrationSources(page, {})).toEqual([sourceName(2), sourceName(5)]);
    // And a root that reads none costs a host nothing.
    expect(runner.migrationSources([sourceName(1)], {})).toEqual([]);
  });

  it("hands a joining migration an original that is READ-ONLY", async () => {
    const world = await stored();
    const writing = worldMigration<undefined>({
      from: 1,
      join: { sources: () => [sourceName(0)], maxSources: 1 },
      partition: (_element, ctx) => {
        (ctx.source(sourceName(0)) as Owner).records = ["stolen"];
      },
    });

    await expect(
      runnerFor(writing, world.nextElementId).migrateAll(
        { [destName(1)]: world.rows[destName(1)]! },
        {
          from: 1,
          to: 2,
          allNames: ALL_NAMES,
          runCreate: false,
          sources: { [sourceName(0)]: world.rows[sourceName(0)]! },
        },
      ),
    ).rejects.toThrow(/read-only/);
  });
});
