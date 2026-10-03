// A DERIVED ATTRIBUTE, THROUGH A REAL WORLD, TO A SEAT'S VIEW (#269).
//
// The engine suite proves `static seatAttributes` against `toJSONForPlayer`.
// This one crosses the layer boundary the issue is actually about: a
// PERSISTENT WORLD, whose partitions come out of cold storage, whose view is
// `BoardSmithWorldEngine.viewFor` (projection, prune, roster) and whose state
// changes through ANOTHER SEAT'S COMMAND -- the path that, with a write-time
// gate, nobody remembers to re-derive from.
//
// The world is built once by genesis and only its BYTES survive; the engine
// under test adopts them from the store (docs/TEST-FIXTURES.md).
import { describe, expect, it } from "vitest";
import { Game, Piece, Player, Space } from "../engine/index.js";
import type { ElementJSON, GameOptions } from "../engine/index.js";
import { BoardSmithWorldEngine } from "./engine.js";
import { worldAction } from "./action.js";
import { worldBudgets } from "./budgets.js";
import type { StoredPartition, WorldPartitionSource } from "./contract.js";
// The ordered walk a host drives -- ask, supply, ask again -- written once for
// every world suite (`village.test-helper.ts`).
import { applyThroughWalk } from "./village.test-helper.js";
import { TEST_WORLD_ELEMENT_ID_KEY } from "../engine/element/world-element-id-key.test-helper.js";

/** The gate: a character reads their coordinate only while carrying this. */
class Gps extends Piece<CampGame> {}

class Character extends Space<CampGame> {
  /**
   * The whole point. `cell` is real state and stays whatever it is; the
   * COORDINATE the seat is shown exists only while the pack holds a GPS, and
   * that question is asked when this character is serialized for the seat.
   */
  static override seatAttributes = {
    coordinates: (character: Character) => (character.first(Gps) ? character.cell : undefined),
  };

  cell = "AB-2";
}

class CampGame extends Game<CampGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    // Registered in the class constructor: world mode has no handler re-bind
    // pass on adoption, so a grafted element's needs come from its own class.
    this.registerElements([Character, Gps]);
  }

  characterOf(seat: number): Character {
    const found = this.first(Character, `character-${seat}`);
    if (!found) throw new Error(`no character resident for seat ${seat}`);
    return found;
  }
}

const characterPartition = (seat: number): string => `character:${seat}`;

function throughStorage(json: ElementJSON): ElementJSON {
  return JSON.parse(JSON.stringify(json)) as ElementJSON;
}

/**
 * SEAT 2 TAKES SEAT 1'S GPS.
 *
 * Not seat 1's own command, which is exactly the path the issue's workaround
 * depends on somebody remembering. Nothing here rewrites seat 1's character.
 */
const steal = worldAction<CampGame>("steal")
  .needs(() => [characterPartition(1), characterPartition(2)])
  .execute((_args, ctx) => {
    const gps = ctx.game.characterOf(1).first(Gps);
    if (!gps) throw new Error("the fixture needs seat 1 carrying a GPS");
    gps.putInto(ctx.game.characterOf(2));
  });

function genesis(): Map<string, StoredPartition> {
  const game = new CampGame({ playerCount: 2, seed: "camp", worldMode: true, elementIdKey: TEST_WORLD_ELEMENT_ID_KEY });
  const stored = new Map<string, StoredPartition>();
  for (const seat of [1, 2]) {
    const character = game.create(Character, `character-${seat}`);
    character.player = game.players[seat - 1];
    if (seat === 1) character.create(Gps, "gps");
    stored.set(characterPartition(seat), {
      parentId: game.id,
      json: throughStorage(character.toJSON()),
    });
  }
  return stored;
}

class MemoryStore implements WorldPartitionSource {
  constructor(private readonly stored: Map<string, StoredPartition>) {}
  async read(name: string): Promise<StoredPartition | undefined> {
    return this.stored.get(name);
  }
  forget(): void {}
}

function newCamp(): { engine: BoardSmithWorldEngine; game: CampGame } {
  const game = new CampGame({ playerCount: 2, seed: "camp", worldMode: true, elementIdKey: TEST_WORLD_ELEMENT_ID_KEY });
  const engine = new BoardSmithWorldEngine({
    game,
    seats: new Map([
      ["p1", 1],
      ["p2", 2],
    ]),
    store: new MemoryStore(genesis()),
    actions: [steal],
    // Both characters are in view, so seat 1 is looking at a world seat 2 acts in.
    view: () => [characterPartition(1), characterPartition(2)],
    budgets: worldBudgets(),
  });
  return { engine, game };
}

/** The derived coordinate seat 1 is shown, or `undefined` if it is not there. */
function coordinatesIn(view: unknown, seat: number): unknown {
  const { state } = view as { state: ElementJSON };
  const node = state.children?.find((child) => child.name === `character-${seat}`);
  if (!node) throw new Error(`character-${seat} is missing from the view`);
  return node.attributes.coordinates;
}

describe("seatAttributes in a persistent world (#269)", () => {
  it("stops serving the gated value once another seat takes the gate away", async () => {
    const { engine } = newCamp();

    expect(coordinatesIn(await engine.viewFor("p1"), 1)).toBe("AB-2");

    await applyThroughWalk(engine, "p2", { name: "steal", args: {} });

    // Nothing re-derived anything: seat 1's character was never written by the
    // command above, and the value is simply not computed any more.
    expect(coordinatesIn(await engine.viewFor("p1"), 1)).toBeUndefined();
    // And it moved with the pack, for the seat that now holds it.
    expect(coordinatesIn(await engine.viewFor("p2"), 2)).toBe("AB-2");
  });

  it("keeps the derived value out of the bytes a partition is stored as", async () => {
    const { engine, game } = newCamp();
    await engine.hydrate([characterPartition(1)]);
    await engine.viewFor("p1");

    // A checkpoint is `toJSON()`, not a per-seat projection: a derived
    // attribute has no business in storage, and cannot go stale there.
    const stored = game.characterOf(1).toJSON();
    expect(stored.attributes.coordinates).toBeUndefined();
    expect(stored.attributes.cell).toBe("AB-2");
  });
});
