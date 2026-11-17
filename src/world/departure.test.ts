// A CHAIR THE WORLD'S OWN CLOCK FREES COMES BACK AS CLEAN AS ONE A PLAYER
// LEAVES (ShufflewickPub #813).
//
// `ctx.world.vacate(seat)` from the `world.vacateByClock` verb is the departure
// nobody sends. The engine clears that seat's Player element and frees the
// chair in the same dispatch, exactly as it does after `world.vacate`.
import { describe, expect, it } from "vitest";
import { worldAction, worldClockAction } from "./action.js";
import { BoardSmithWorldEngine } from "./engine.js";
import {
  COMMONS,
  CountingStore,
  STAMP,
  VillageFixture,
  holdingPartition,
  villageGenesis,
} from "./village.test-helper.js";
import { TEST_WORLD_ELEMENT_ID_KEY } from "../engine/element/world-element-id-key.test-helper.js";

const DUE = STAMP.now + 1;

/** Leaves something of this player on the seat's Player element. */
const brand = worldAction<VillageFixture>("brand")
  .needs(({ player }) => [holdingPartition(player.seat)])
  .execute((_args, ctx) => {
    ctx.player.status = "eliminated";
    ctx.player.color = "#000000";
    Object.assign(ctx.player, { title: "Baron" });
  });

const leave = worldAction<VillageFixture>("leave")
  .needs(({ player }) => [holdingPartition(player.seat)])
  .execute(() => {});

const reap = worldClockAction<VillageFixture>("reap")
  .about(({ args }) => Number(args.seat))
  .needs(({ args }) => [holdingPartition(Number(args.seat))])
  .execute((args, { world }) => {
    world.vacate(Number(args.seat));
  });

function village() {
  const game = new VillageFixture({
    playerCount: 3,
    seed: "village",
    worldMode: true,
    elementIdKey: TEST_WORLD_ELEMENT_ID_KEY,
  });
  const engine = new BoardSmithWorldEngine({
    game,
    seats: new Map([
      ["p1", 1],
      ["p2", 2],
      ["p3", 3],
    ]),
    store: new CountingStore(villageGenesis(3)),
    actions: [brand, leave, reap],
    view: (seat) => [COMMONS, holdingPartition(seat)],
    vacate: "leave",
    vacateByClock: "reap",
  });
  return { game, engine };
}

async function send(engine: BoardSmithWorldEngine, player: string, name: string) {
  const command = { name, args: {} };
  for (;;) {
    const needs = engine.commandNeeds(player, command, { kind: "arrival", now: STAMP.now }, STAMP);
    if (needs.partitions.length === 0) break;
    await engine.hydrate(needs.partitions);
  }
  return engine.applyCommand(player, command, STAMP);
}

/** One `reap` occurrence for `seat`, with the host answering that the chair is held. */
async function reapSeat(engine: BoardSmithWorldEngine, seat: number) {
  const event = { name: "reap", args: { seat } };
  const timing = { due: DUE, missedCount: 0 };
  const declaredActivity = [{ seat, at: STAMP.now, since: STAMP.now, tenancy: "held" as const }];
  for (;;) {
    const needs = engine.commandNeeds(null, event, { kind: "scheduled", timing }, {
      declaredActivity,
      declaredNotices: [],
    });
    if (needs.partitions.length === 0) break;
    await engine.hydrate(needs.partitions);
  }
  return engine.onEvent(event, timing, {
    allowance: STAMP.allowance,
    presence: [],
    activity: null,
    declaredActivity,
    declaredNotices: [],
  });
}

describe("ShufflewickPub #813 -- every departed seat comes back clean", () => {
  it("never offers the departure as a seat's button, since the host runs it", async () => {
    const { engine } = village();
    for (;;) {
      const needs = engine.offerPartitions("p2", STAMP.now);
      if (needs.length === 0) break;
      await engine.hydrate(needs);
    }
    const offers = await engine.offersFor("p2", { now: STAMP.now, presence: [], activity: STAMP.activity });
    expect(offers.map((offer) => offer.name)).toEqual(["brand"]);
  });

  it("clears the Player and frees the chair when the clock finalizes a vacancy", async () => {
    const { game, engine } = village();
    const fresh = game.getPlayer(2)!.toJSON();
    await send(engine, "p2", "brand");
    expect(game.getPlayer(2)!.toJSON()).not.toEqual(fresh);

    const result = await reapSeat(engine, 2);

    expect(result.vacated).toEqual({ seat: 2, player: "p2" });
    expect(game.getPlayer(2)!.toJSON()).toEqual(fresh);
    expect(() => engine.seat("newcomer", 2)).not.toThrow();
  });

  it("clears the Player and frees the chair when the seat's own hook runs", async () => {
    const { game, engine } = village();
    const fresh = game.getPlayer(2)!.toJSON();
    await send(engine, "p2", "brand");

    const result = await send(engine, "p2", "leave");

    expect(result.vacated).toEqual({ seat: 2, player: "p2" });
    expect(game.getPlayer(2)!.toJSON()).toEqual(fresh);
    // The same element, so a reference the world already holds still resolves.
    expect(game.getPlayer(2)!.toJSON().id).toBe(fresh.id);
    expect(() => engine.seat("newcomer", 2)).not.toThrow();
  });
});
