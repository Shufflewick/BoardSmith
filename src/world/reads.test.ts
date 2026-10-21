// A WORLD ACTION CAN LOAD PARTITIONS READ-ONLY (#1334).
//
// `.needs()` loads a partition the action may write, so it is reported dirty
// and saved whether or not it changed. `.reads()` loads one the action only
// looks at: it is never reported dirty, and a write to it refuses the command.
import { describe, expect, it } from "vitest";
import { Piece } from "../engine/index.js";
import { worldAction, worldClockAction } from "./action.js";
import {
  COMMONS,
  Commons,
  Holding,
  STAMP,
  VillageFixture,
  applyThroughWalk as apply,
  fireThroughWalk,
  holdingPartition,
  neighboursOf,
  newVillageEngine,
} from "./village.test-helper.js";

class Shed extends Piece<VillageFixture> {}

/** Reads both neighbours' standing timber, and writes only the seat's own holding. */
const survey = worldAction<VillageFixture>("survey")
  .needs(({ player }) => [holdingPartition(player.seat)])
  .reads(({ player }) => neighboursOf(player.seat).map(holdingPartition))
  .execute((_args, ctx) => {
    const seen = neighboursOf(ctx.player.seat).map((seat) => ctx.game.holdingOf(seat).standing);
    ctx.game.holdingOf(ctx.player.seat).woodpile += seen.reduce((sum, n) => sum + n, 0);
  });

/** Reads a neighbour's holding and then writes to it. */
const trespass = worldAction<VillageFixture>("trespass")
  .needs(({ player }) => [holdingPartition(player.seat)])
  .reads(({ player }) => [holdingPartition(neighboursOf(player.seat)[0]!)])
  .execute((_args, ctx) => {
    ctx.game.holdingOf(ctx.player.seat).woodpile += 1;
    ctx.game.holdingOf(neighboursOf(ctx.player.seat)[0]!).standing += 1;
  });

/** Names the same neighbour read-only and writable: writable wins. */
const both = worldAction<VillageFixture>("both")
  .reads(({ player }) => [holdingPartition(neighboursOf(player.seat)[0]!)])
  .needs(({ player }) => [holdingPartition(neighboursOf(player.seat)[0]!)])
  .execute((_args, ctx) => {
    ctx.game.holdingOf(neighboursOf(ctx.player.seat)[0]!).standing += 1;
  });

/** Keeps a neighbour's holding from one command, and writes it in a later one
 *  without going through any query or accessor. */
let kept: Holding | undefined;
const keep = worldAction<VillageFixture>("keep")
  .needs(({ player }) => [holdingPartition(neighboursOf(player.seat)[0]!)])
  .execute((_args, ctx) => {
    kept = ctx.game.holdingOf(neighboursOf(ctx.player.seat)[0]!);
  });
const writeKept = worldAction<VillageFixture>("writeKept")
  .reads(({ player }) => [holdingPartition(neighboursOf(player.seat)[0]!)])
  .execute(() => {
    kept!.standing += 1;
  });

/** Moves a shed from the seat's own holding into a neighbour's it only reads. */
const dump = worldAction<VillageFixture>("dump")
  .needs(({ player }) => [holdingPartition(player.seat)])
  .reads(({ player }) => [holdingPartition(neighboursOf(player.seat)[0]!)])
  .execute((_args, ctx) => {
    const shed = ctx.game.holdingOf(ctx.player.seat).create(Shed, "shed");
    shed.putInto(ctx.game.holdingOf(neighboursOf(ctx.player.seat)[0]!));
  });

/** The clock's verb: reads a holding, writes the commons. */
const warm = worldClockAction<VillageFixture>("warm")
  .needs(() => [COMMONS])
  .reads(({ args }) => [holdingPartition(Number(args.seat))])
  .execute((args, ctx) => {
    ctx.game.first(Commons, COMMONS)!.embers += ctx.game.holdingOf(Number(args.seat)).standing;
  });

describe("a world action's read-only partitions", () => {
  it("loads them but does not report them dirty", async () => {
    const { engine, game } = newVillageEngine([survey]);
    await engine.hydrate([holdingPartition(2)]);
    const woodpile = game.holdingOf(2).woodpile;
    const result = await apply(engine, "p2", { name: "survey", args: {} });

    expect(game.holdingOf(2).woodpile).toBe(
      woodpile + neighboursOf(2).reduce((sum, seat) => sum + game.holdingOf(seat).standing, 0),
    );
    expect(result.dirty).toEqual([holdingPartition(2)]);
  });

  it("refuses a command that writes to one, and keeps nothing it changed", async () => {
    const { engine, game } = newVillageEngine([trespass]);
    const neighbour = neighboursOf(2)[0]!;
    await engine.hydrate([holdingPartition(2), holdingPartition(neighbour)]);
    const before = { own: game.holdingOf(2).woodpile, theirs: game.holdingOf(neighbour).standing };

    await expect(apply(engine, "p2", { name: "trespass", args: {} })).rejects.toMatchObject({
      code: "read-only-write",
      message: expect.stringContaining(holdingPartition(neighbour)),
    });
    expect(game.holdingOf(2).woodpile).toBe(before.own);
    expect(game.holdingOf(neighbour).standing).toBe(before.theirs);
  });

  it("refuses a write through an element kept from an earlier command", async () => {
    const { engine } = newVillageEngine([keep, writeKept]);
    await apply(engine, "p2", { name: "keep", args: {} });

    await expect(apply(engine, "p2", { name: "writeKept", args: {} })).rejects.toMatchObject({
      code: "read-only-write",
    });
  });

  it("refuses moving an element into one", async () => {
    const { engine } = newVillageEngine([dump]);

    await expect(apply(engine, "p2", { name: "dump", args: {} })).rejects.toMatchObject({
      code: "read-only-write",
    });
  });

  it("treats a partition named by both .reads() and .needs() as writable", async () => {
    const { engine } = newVillageEngine([both]);
    const result = await apply(engine, "p2", { name: "both", args: {} });

    expect(result.dirty).toEqual([holdingPartition(neighboursOf(2)[0]!)]);
  });

  it("works on the clock's verbs too", async () => {
    const { engine } = newVillageEngine([warm]);
    const result = await fireThroughWalk(
      engine,
      { name: "warm", args: { seat: 1 } },
      { due: STAMP.now, missedCount: 0 },
    );

    expect(result.dirty).toEqual([COMMONS]);
  });
});
