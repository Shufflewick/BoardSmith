/**
 * A WORLD'S OFFER CARRIES ITS MENU PLACEMENT (#228).
 *
 * The hierarchy is metadata on the action, and a world's offer IS that
 * metadata: `WorldActionOffer extends ActionMetadata`, so the same `group` and
 * `order` a table's `buildActionMetadata` emits have to travel on the offer
 * frame or the shared panel gets a hierarchy in table mode and a flat list in
 * world mode.
 *
 * IT HAS TO SURVIVE JSON, which is the whole reason the offer path needs its
 * own test rather than trusting the table's. An offer is serialized into a
 * frame the host relays, so a field the engine sets but the wire drops would
 * look correct in every unit test on either side of the bar -- the shape #227
 * and ShufflewickPub #378 were both about.
 */
import { describe, it, expect } from "vitest";
import { Game, Space } from "../engine/index.js";
import { worldAction, createWorld } from "./index.js";

class Yard extends Space {
  ore = 3;
}

class PlacementWorld extends Game {
  constructor(options: ConstructorParameters<typeof Game>[0]) {
    super(options);
    this.registerElements([Yard]);
  }
}

const construct = worldAction("construct")
  .prompt("Construct building")
  .order(10)
  .needs(() => ["yard"])
  .execute(() => {});

const dumpOre = worldAction("dumpOre")
  .prompt("Dump ore")
  .group("Dump")
  .order(20)
  .needs(() => ["yard"])
  .execute(() => {});

const renamePlanet = worldAction("renamePlanet")
  .prompt("Rename planet")
  .group("More", "Empire settings")
  .needs(() => ["yard"])
  .execute(() => {});

const skipMission = worldAction("skipMission")
  .prompt("Skip mission")
  .needs(() => ["yard"])
  .execute(() => {});

async function offers() {
  const { runner } = createWorld({
    definition: {
      gameClass: PlacementWorld,
      world: {
        maxPlayers: 1,
        actions: [construct, dumpOre, renamePlanet, skipMission],
        view: () => ["yard"],
        genesis: (game) => ({ yard: game.create(Yard, "yard") }),
      },
    },
    seed: "placement",
    seats: new Map([["p1", 1]]),
  });
  await runner.genesis();
  await runner.declareOffers("p1", {}, 1);
  return runner.offersFor("p1", { now: 1, presence: [], activity: null });
}

describe("a world offer's Action Panel menu placement", () => {
  it("carries the group path and the order a world action declared", async () => {
    const byName = new Map((await offers()).map((offer) => [offer.name, offer]));
    expect(byName.get("dumpOre")?.group).toEqual(["Dump"]);
    expect(byName.get("dumpOre")?.order).toBe(20);
    expect(byName.get("renamePlanet")?.group).toEqual(["More", "Empire settings"]);
    expect(byName.get("construct")?.order).toBe(10);
  });

  it("omits both keys for an unplaced action rather than sending an absent one", async () => {
    // Absent rather than `undefined`, which is what every other optional field
    // on the offer does: a key whose value is `undefined` vanishes in JSON, so
    // the two forms are indistinguishable on the far side and only one of them
    // is honest about what the game said.
    const byName = new Map((await offers()).map((offer) => [offer.name, offer]));
    const plain = byName.get("skipMission")!;
    expect("group" in plain).toBe(false);
    expect("order" in plain).toBe(false);
  });

  it("survives the serialization the host relays the offer through", async () => {
    const relayed = JSON.parse(JSON.stringify(await offers())) as Array<{
      name: string;
      group?: string[];
      order?: number;
    }>;
    const byName = new Map(relayed.map((offer) => [offer.name, offer]));
    expect(byName.get("renamePlanet")?.group).toEqual(["More", "Empire settings"]);
    expect(byName.get("dumpOre")?.group).toEqual(["Dump"]);
    expect(byName.get("dumpOre")?.order).toBe(20);
    expect("group" in byName.get("skipMission")!).toBe(false);
  });
});
