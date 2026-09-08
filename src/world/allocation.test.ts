/**
 * ShufflewickPub #377: A COLD RUNNER MAY NOT MINT AN ID A STORED ROOT OWNS.
 *
 * Element ids come from one counter per game, and in world mode #218 parted it:
 * construction below `WORLD_PARTITION_ID_FLOOR`, everything durable above. What
 * was never said is where the counter STARTS on the second host that ever runs
 * the world.
 *
 * It started at the floor. A cold runner adopts only the partitions a command
 * declared, `adoptSubtree` advances the counter past the ids it just grafted,
 * and `createPartition` then mints from there -- so a world with five stored
 * rooms, one of them resident, built its sixth room on top of the third one's
 * identity. Nothing complained until some later command declared both, and then
 * the world was unplayable: "element id 1000002 is already resident", from an
 * adoption that was correct, about a collision minted hours earlier.
 *
 * Hydrating every stored partition to make the counter safe is exactly the cost
 * partitioning exists to avoid, so the counter cannot be derived from residency
 * at all. It is DURABLE STATE, the host persists it beside the partitions it
 * was minted for, and it comes back in on the next wake.
 *
 * The world in this file is the issue's own: five rooms from genesis, one root
 * built on demand, and a second runner that hydrates one room and then asks for
 * the sixth.
 */
import { describe, expect, it } from "vitest";
import { Game, Space, type GameElement, type GameOptions } from "../engine/index.js";
import { createWorld, worldIdAllocationOf, type WorldRunnerOptions } from "./definition.js";
import { worldAction } from "./action.js";
import { WorldRefusal } from "./refusals.js";
import type { StoredPartition } from "./contract.js";

class Room extends Space<Demo> {}

class Demo extends Game<Demo> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Room]);
  }
}

const ROOMS = ["a", "b", "c", "d", "e"] as const;

/** A stored root's own element id. `StoredPartition.json` is `unknown` to the
 *  host on purpose -- it never parses a partition -- so a test that wants the
 *  id says so once. */
const idOf = (record: StoredPartition): number => (record.json as { id: number }).id;

const readA = worldAction<Demo>("read-a")
  .needs(() => ["a"])
  .execute(() => {});

const readBoth = worldAction<Demo>("read-both")
  .needs(() => ["c", "dynamic"])
  .execute(() => {});

const definition = {
  gameClass: Demo,
  gameType: "demo",
  world: {
    maxPlayers: 1,
    actions: [readA, readBoth],
    genesis: (game: Game) =>
      Object.fromEntries(ROOMS.map((name) => [name, game.create(Room, name)])) as Record<
        string,
        GameElement
      >,
    createPartition: (game: Game, name: string) =>
      name === "dynamic" ? (game.create(Room, name) as GameElement) : undefined,
    view: () => ["a"],
  },
} as WorldRunnerOptions["definition"];

function options(overrides: Partial<WorldRunnerOptions> = {}): WorldRunnerOptions {
  return {
    definition,
    seed: "ids",
    seats: new Map([["p1", 1]]),
    ...overrides,
  };
}

/** Genesis, plus the allocation stamp a host must persist beside it. */
async function storedWorld() {
  const born = createWorld(options()).runner;
  const genesis = await born.genesis();
  return genesis;
}

describe("#377 — a world's id allocation is durable, not derived from what is resident", () => {
  it("reports the stamp a host must persist alongside genesis", async () => {
    const genesis = await storedWorld();

    const ids = ROOMS.map((name) => idOf(genesis.partitions[name]!));
    expect(ids).toEqual([1_000_000, 1_000_001, 1_000_002, 1_000_003, 1_000_004]);
    // The next id the world may mint: above every id genesis handed out.
    expect(genesis.nextElementId).toBeGreaterThan(Math.max(...ids));
  });

  it("mints a cold on-demand root OUTSIDE every stored root's identity", async () => {
    const genesis = await storedWorld();

    // A fresh host: same definition, same seed, same roster, and the stamp it
    // wrote down last time. It hydrates ONE room, exactly as a real command
    // that only declared `a` would.
    const cold = createWorld(options({ nextElementId: genesis.nextElementId })).runner;
    await cold.declare({ name: "read-a", args: {} }, "p1", {}, 1_000);
    await cold.declare({ name: "read-a", args: {} }, "p1", { a: genesis.partitions.a! }, 1_000);

    const made = await cold.createPartition("dynamic");

    const storedIds = ROOMS.map((name) => idOf(genesis.partitions[name]!));
    expect(storedIds).not.toContain(idOf(made!.partition));
    // And the stamp moved, so the NEXT host does not mint this one again.
    expect(made!.nextElementId).toBeGreaterThan(genesis.nextElementId);
  });

  it("lets a later command load the created root beside the stored ones", async () => {
    // The failure the collision actually produced: a world that could no longer
    // run a command naming both roots.
    const genesis = await storedWorld();
    const cold = createWorld(options({ nextElementId: genesis.nextElementId })).runner;
    await cold.declare({ name: "read-a", args: {} }, "p1", {}, 1_000);
    await cold.declare({ name: "read-a", args: {} }, "p1", { a: genesis.partitions.a! }, 1_000);
    await cold.createPartition("dynamic");

    await expect(
      cold.declare({ name: "read-both", args: {} }, "p1", { c: genesis.partitions.c! }, 1_000),
    ).resolves.toBeDefined();
  });

  it("carries the stamp forward across a THIRD host, which mints again", async () => {
    const genesis = await storedWorld();
    const second = createWorld(options({ nextElementId: genesis.nextElementId })).runner;
    const first = await second.createPartition("dynamic");

    const third = createWorld(options({ nextElementId: first!.nextElementId })).runner;
    const again = await third.createPartition("dynamic");

    expect(idOf(again!.partition)).not.toBe(idOf(first!.partition));
  });

  it("REFUSES a cold mint from a host that declared no stamp at all", async () => {
    // The wrong path, made loud rather than made silent. A host that never
    // persisted the allocation cannot mint safely, and the old behaviour was to
    // mint anyway and corrupt the world hours later.
    const cold = createWorld(options()).runner;

    await expect(cold.createPartition("dynamic")).rejects.toThrow(WorldRefusal);
    await expect(cold.createPartition("dynamic")).rejects.toThrow(/nextElementId/);
  });

  it("still mints on the instance that ran genesis, which owns the counter", async () => {
    // Genesis IS the declaration: that runner minted every id there is, so its
    // counter is authoritative and no stamp has to be handed back to itself.
    const born = createWorld(options()).runner;
    const genesis = await born.genesis();

    const made = await born.createPartition("dynamic");

    expect(idOf(made!.partition)).toBeGreaterThan(
      Math.max(...ROOMS.map((name) => idOf(genesis.partitions[name]!))),
    );
  });

  it("REFUSES a stamp that stands below an id the world has already stored", async () => {
    // The occupied-world repair's other half: a host that hands back a stale
    // number is told so at the moment it hydrates the proof, rather than at the
    // collision it would cause later.
    const genesis = await storedWorld();
    const stale = createWorld(options({ nextElementId: 1_000_001 })).runner;

    await stale.declare({ name: "read-a", args: {} }, "p1", {}, 1_000);

    await expect(
      stale.declare({ name: "read-a", args: {} }, "p1", { c: genesis.partitions.c! }, 1_000),
    ).rejects.toThrow(/nextElementId/);
  });

  it("derives the repair stamp from stored bytes, for a world that has none", async () => {
    // The supported repair for a world that was already occupied when this
    // landed, and for one whose roots have already collided: read what is
    // stored, take the highest id in it, and write the stamp above it. It is
    // O(stored) ONCE, at the repair, and never again.
    const genesis = await storedWorld();
    const records: StoredPartition[] = ROOMS.map((name) => genesis.partitions[name]!);

    const repaired = worldIdAllocationOf(records);

    expect(repaired).toBe(genesis.nextElementId);
    const cold = createWorld(options({ nextElementId: repaired })).runner;
    const made = await cold.createPartition("dynamic");
    expect(ROOMS.map((name) => idOf(genesis.partitions[name]!))).not.toContain(
      idOf(made!.partition),
    );
  });
});
