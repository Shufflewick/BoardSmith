/**
 * #482: A WORLD IS BUILT WITH ITS HOST'S ELEMENT ID KEY, AND ONLY WITH IT.
 *
 * The host mints the key once, when the world is created
 * (`mintWorldElementIdKey`), stores it with the world beside its allocation
 * stamp, and hands both back on every wake. `createWorld` refuses to build a
 * world without it -- never minting one of its own, because a key minted on a
 * wake would make every stored id unreadable -- and every id the world mints is
 * the keyed cipher of its one world-wide counter, so ids carry no count, come
 * back the same after a restart, and never collide across partitions however
 * many hosts minted them.
 */
import { describe, expect, it } from "vitest";
import { Game, Space, WORLD_PARTITION_ID_FLOOR, type GameElement, type GameOptions } from "../engine/index.js";
import {
  createWorld,
  mintWorldElementIdKey,
  worldIdAllocationOf,
  type WorldRunnerOptions,
} from "./definition.js";
import { worldAction } from "./action.js";
import { WorldRefusal, ownerOf } from "./refusals.js";
import type { StoredPartition } from "./contract.js";
import { worldElementIds } from "../engine/element/element-ids.js";

class Room extends Space<Keyed> {}

class Keyed extends Game<Keyed> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Room]);
  }
}

const KEY = "13579bdf02468ace13579bdf";
const OTHER_KEY = "02468ace13579bdf02468ace";
const ROOMS = ["a", "b", "c"] as const;

const definition = {
  gameClass: Keyed,
  gameType: "keyed",
  world: {
    maxPlayers: 2,
    actions: [worldAction<Keyed>("look").needs(() => ["a"]).execute(() => {})],
    genesis: (game: Game) =>
      Object.fromEntries(ROOMS.map((name) => [name, game.create(Room, name)])) as Record<string, GameElement>,
    // Any name a host asks for becomes a room: the on-demand road every host
    // can mint from, which is where a cross-partition collision would show.
    createPartition: (game: Game, name: string) => game.create(Room, name) as GameElement,
    view: () => ["a"],
  },
} as WorldRunnerOptions["definition"];

function options(overrides: Partial<WorldRunnerOptions> = {}): WorldRunnerOptions {
  return {
    definition,
    seed: "keyed",
    seats: new Map([["p1", 1]]),
    elementIdKey: KEY,
    ...overrides,
  };
}

const idOf = (record: StoredPartition): number => (record.json as { id: number }).id;

/** A seat's arrival, the instant a declaration is told about. */
const arrival = { kind: "arrival", now: 1_000 } as const;
const LOOK = { name: "look", args: {} } as const;
const NO_DECLARED = { declaredActivity: [], declaredNotices: [] };

/** What a call threw, so a case can assert the refusal itself. */
async function refusalOf(attempt: () => unknown): Promise<unknown> {
  try {
    await attempt();
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal, and the call succeeded");
}

describe("#482 -- createWorld takes the host's key and never mints one", () => {
  it("refuses a world built without a key, as the platform's fault, naming where one comes from", () => {
    const { elementIdKey: _omitted, ...keyless } = options();
    const refusal = (() => {
      try {
        createWorld(keyless as WorldRunnerOptions);
        return undefined;
      } catch (error) {
        return error;
      }
    })();
    expect(refusal).toBeInstanceOf(WorldRefusal);
    expect((refusal as WorldRefusal).code).toBe("element-id-key-invalid");
    expect(ownerOf(refusal)).toBe("platform");
    expect((refusal as WorldRefusal).message).toMatch(/mintWorldElementIdKey/);
    expect((refusal as WorldRefusal).message).toMatch(/store it with the world/);
  });

  it("refuses a key of the wrong shape before anything is built", () => {
    expect(() => createWorld(options({ elementIdKey: "0123456789abcdef" }))).toThrow(WorldRefusal);
    expect(() => createWorld(options({ elementIdKey: "0123456789abcdef" }))).toThrow(
      /24 hexadecimal digits/,
    );
  });

  it("exports a key minter for the host to call once, at creation", () => {
    expect(mintWorldElementIdKey()).toMatch(/^[0-9a-f]{24}$/);
    expect(mintWorldElementIdKey()).not.toBe(mintWorldElementIdKey());
  });
});

describe("#482 -- a world's ids", () => {
  it("are opaque: the keyed cipher of the counter, not the counter", async () => {
    const genesis = await createWorld(options()).runner.genesis();
    const ids = ROOMS.map((name) => idOf(genesis.partitions[name]!));
    const keyed = worldElementIds(KEY);

    expect(ids).not.toContain(WORLD_PARTITION_ID_FLOOR);
    expect(ids.map((id) => keyed.cursorOf(id))).toEqual([
      WORLD_PARTITION_ID_FLOOR,
      WORLD_PARTITION_ID_FLOOR + 1,
      WORLD_PARTITION_ID_FLOOR + 2,
    ]);
    // The stamp a host persists stays a COUNTER value: it is never an id.
    expect(genesis.nextElementId).toBe(WORLD_PARTITION_ID_FLOOR + ROOMS.length);
  });

  it("are the same after a restart with the same key", async () => {
    const first = await createWorld(options()).runner.genesis();
    const again = await createWorld(options()).runner.genesis();
    expect(again.partitions).toEqual(first.partitions);
  });

  it("differ under another key", async () => {
    const one = await createWorld(options()).runner.genesis();
    const other = await createWorld(options({ elementIdKey: OTHER_KEY })).runner.genesis();
    const ids = ROOMS.map((name) => idOf(one.partitions[name]!));
    const otherIds = ROOMS.map((name) => idOf(other.partitions[name]!));
    expect(ids.filter((id) => otherIds.includes(id))).toEqual([]);
    // And the root every stored partition hangs from moves with the key.
    expect(other.partitions.a!.parentId).not.toBe(one.partitions.a!.parentId);
  });

  it("never collide across partitions, however many hosts minted them", async () => {
    // Every partition draws from ONE world-wide counter, carried host to host
    // by the stamp; one permutation of one counter cannot repeat an id.
    const genesis = await createWorld(options()).runner.genesis();
    const seen = new Set<number>(ROOMS.map((name) => idOf(genesis.partitions[name]!)));
    let stamp = genesis.nextElementId;
    for (let host = 0; host < 6; host += 1) {
      const runner = createWorld(options({ nextElementId: stamp })).runner;
      for (let room = 0; room < 4; room += 1) {
        const made = await runner.createPartition(`host-${host}-room-${room}`);
        const id = idOf(made!.partition);
        expect(seen.has(id)).toBe(false);
        seen.add(id);
        stamp = made!.nextElementId;
      }
    }
    expect(seen.size).toBe(ROOMS.length + 24);
  });

  it("are read back to the stamp by worldIdAllocationOf, with the world's key", async () => {
    const genesis = await createWorld(options()).runner.genesis();
    const records = ROOMS.map((name) => genesis.partitions[name]!);
    expect(worldIdAllocationOf(records, KEY)).toBe(genesis.nextElementId);
  });

  it("refuses, as the platform's fault, a world woken with a key its bytes were not minted under", async () => {
    // The host handed back the wrong key -- another world's, or one minted
    // afresh on a wake. Every stored partition hangs from the root, whose id is
    // the cipher of counter value 0 under the RIGHT key, so the first adoption
    // can tell. Charged to the game, this would refuse every verb while the
    // park ladder sat still and the publisher paid for it (#224's lesson).
    const genesis = await createWorld(options()).runner.genesis();
    const woken = createWorld(options({ elementIdKey: OTHER_KEY, nextElementId: genesis.nextElementId })).runner;
    await woken.declare(LOOK, "p1", {}, arrival, NO_DECLARED);

    const refusal = await refusalOf(() =>
      woken.declare(LOOK, "p1", { a: genesis.partitions.a! }, arrival, NO_DECLARED),
    );

    expect(refusal).toBeInstanceOf(WorldRefusal);
    expect((refusal as WorldRefusal).code).toBe("element-id-key-mismatch");
    expect(ownerOf(refusal)).toBe("platform");
    expect((refusal as WorldRefusal).message).toMatch(/key/);
    expect((refusal as WorldRefusal).message).not.toContain(OTHER_KEY);
  });

  it("refuses to derive a stamp under a key the stored bytes were not minted under", async () => {
    const genesis = await createWorld(options()).runner.genesis();
    const records = ROOMS.map((name) => genesis.partitions[name]!);

    const refusal = await refusalOf(() => worldIdAllocationOf(records, OTHER_KEY));

    expect(refusal).toBeInstanceOf(WorldRefusal);
    expect((refusal as WorldRefusal).code).toBe("element-id-key-mismatch");
    expect(ownerOf(refusal)).toBe("platform");
  });

  it("never put the key in the bytes a host stores", async () => {
    const genesis = await createWorld(options()).runner.genesis();
    expect(JSON.stringify(genesis)).not.toContain(KEY);
  });
});
