// A WORLD'S VERBS ARE ACTIONS (#169).
//
// The fixture is a village, because the acceptance case is a village: holdings
// arranged in a ring, so "a neighbouring holding" is a real thing with two
// candidates rather than a list of every holding there is. That distinction is
// the whole ticket -- the flat command table could only offer all five hundred,
// because a bundle can state what a world CONTAINS and not what is legal this
// instant.
//
// Every assertion below is made against the real engine over real stored bytes:
// the world is built once by a genesis game and then only ever reached through
// serialized partitions, so adoption is exercised rather than skipped
// (docs/TEST-FIXTURES.md).
import { describe, expect, it } from "vitest";
import { BoardSmithWorldEngine } from "./engine.js";
import { worldAction, worldClockAction } from "./action.js";
import { worldBudgets } from "./budgets.js";
import type { ActionDefinition, GameElement } from "../engine/index.js";
import {
  COMMONS,
  Commons,
  Holding,
  OFFER,
  SETTLERS,
  STAMP,
  STANDING_MAX,
  VillageFixture,
  applyThroughWalk as apply,
  holdingId,
  holdingPartition,
  neighboursOf as neighbourSeats,
  newVillageEngine,
  villageGenesis as genesis,
  CountingStore,
} from "./village.test-helper.js";

/** This suite's own verbs. The village itself -- its ring, its elements, its
 *  genesis and the two loops a host drives -- is shared with the guide's claims
 *  suite, so the two cannot come to disagree about what a world does. */
function newEngine(actions: readonly ActionDefinition[] = [gather, tend, settleBurn]) {
  return newVillageEngine(actions);
}

const tend = worldAction<VillageFixture>("tend")
  .prompt("Spend a log putting timber back on a neighbour's land")
  // ROUND ONE: a pure function of the seat, answered with nothing resident.
  .needs(({ player }) => [holdingPartition(player.seat)])
  .disabled(({ game, player }) =>
    game.holdingOf(player.seat).woodpile < 1 ? "You have no log to spend" : false,
  )
  .chooseElement("neighbour", {
    // ROUND TWO: what THIS selection's candidates live in.
    needs: ({ player }) => neighbourSeats(player.seat).map(holdingPartition),
    elements: ({ game, player }) => neighbourSeats(player.seat).map((s) => game.holdingOf(s)),
    disabled: (holding) => (holding.standing >= 8 ? "Already at full growth" : false),
  })
  .execute(({ neighbour }, ctx) => {
    const own = ctx.game.holdingOf(ctx.player.seat);
    own.woodpile -= 1;
    neighbour.standing += 2;
    ctx.world.emit(holdingPartition(neighbour.seat), { tended: 2 });
  });

const gather = worldAction<VillageFixture>("gather")
  .needs(({ player }) => [holdingPartition(player.seat)])
  .execute((_args, ctx) => {
    const own = ctx.game.holdingOf(ctx.player.seat);
    own.woodpile += own.standing;
    own.standing = 0;
    ctx.world.schedule({ delayMs: 1000, action: "settleBurn", key: `burn:${ctx.player.seat}`, args: { holding: holdingPartition(ctx.player.seat) } });
    ctx.world.emit(holdingPartition(ctx.player.seat), { gathered: own.woodpile });
  });

const settleBurn = worldClockAction<VillageFixture>("settleBurn")
  .prompt("The clock: a slow burn reaching the fire")
  .needs(({ args }) => [COMMONS, String(args.holding)])
  .execute((args, ctx) => {
    const holding = ctx.world.partition(String(args.holding)) as Holding;
    const commons = ctx.world.partition(COMMONS) as Commons;
    commons.embers += holding.woodpile;
    holding.woodpile = 0;
    ctx.world.emit(COMMONS, { embers: commons.embers });
  });







describe("a world action's offer", () => {
  it("offers a neighbouring holding by element, not every holding there is", async () => {
    const { engine } = newEngine();
    const offers = await engine.offersFor("p3", OFFER);

    const tendOffer = offers.find((offer) => offer.name === "tend");
    expect(tendOffer).toBeDefined();
    expect(tendOffer!.selections).toHaveLength(1);

    const pick = tendOffer!.selections[0]!;
    expect(pick.type).toBe("element");
    // TWO, and not SETTLERS: the ring is what makes a neighbour a real thing.
    expect(pick.validElements).toHaveLength(2);
  });

  it("leaves the clock's own action out of a seat's offer", async () => {
    const { engine } = newEngine();
    const offers = await engine.offersFor("p1", OFFER);
    expect(offers.map((offer) => offer.name)).toEqual(["gather", "tend"]);
  });

  it("refuses a seat that sends the clock's own action anyway", async () => {
    const { engine } = newEngine();
    await expect(
      apply(engine, "p1", { name: "settleBurn", args: { holding: holdingPartition(1) } }),
    ).rejects.toThrow(/clock at work/);
  });

  it("greys an action out with its reason rather than hiding it", async () => {
    const { engine, game } = newEngine();
    // Spend the one log the fixture starts with, so `tend`'s own rule bites.
    await apply(engine, "p2", { name: "tend", args: { neighbour: await holdingId(engine, game, 3) } });

    const offers = await engine.offersFor("p2", OFFER);
    const tendOffer = offers.find((offer) => offer.name === "tend");
    expect(tendOffer?.disabled).toBe("You have no log to spend");
  });

  it("says why a candidate cannot be taken instead of accepting the click", async () => {
    const { engine, game } = newEngine();
    // Push holding 2 to full growth, so seat 3 sees one neighbour it may tend
    // and one it may not -- greyed WITH the reason, rather than accepting the
    // click and refusing it afterwards.
    await apply(engine, "p1", { name: "tend", args: { neighbour: await holdingId(engine, game, 2) } });

    const offers = await engine.offersFor("p3", OFFER);
    const pick = offers.find((offer) => offer.name === "tend")!.selections[0]!;
    const byId = new Map(pick.validElements!.map((element) => [element.id, element.disabled]));
    expect(byId.get(game.holdingOf(2).id)).toBe("Already at full growth");
    expect(byId.get(game.holdingOf(4).id)).toBeUndefined();
  });

  it("loads nothing beyond what the seat's own view already names", async () => {
    const { engine, store } = newEngine();
    // A look first, exactly as a watching client does.
    await engine.hydrate([COMMONS, holdingPartition(4)]);
    store.reads.length = 0;

    await engine.offersFor("p4", OFFER);
    // `tend`'s SELECTION round names the two neighbours, which the view does
    // not: that is the honest extra cost of an offer, and it is two rather than
    // a number that grows with the village.
    expect(store.reads.sort()).toEqual([holdingPartition(3), holdingPartition(5)]);
  });
});

describe("the ordered declaration walk", () => {
  it("asks one round at a time, each answerable against the last", async () => {
    const { engine } = newEngine();
    const command = { name: "tend", args: { neighbour: 0 } };

    const first = engine.commandPartitions("p2", command);
    expect(first).toEqual([holdingPartition(2)]);

    await engine.hydrate(first);
    expect([...engine.commandPartitions("p2", command)].sort()).toEqual([
      holdingPartition(1),
      holdingPartition(3),
    ]);
  });

  it("ends when everything the walk named is resident", async () => {
    const { engine } = newEngine();
    const command = { name: "tend", args: { neighbour: 0 } };
    await engine.hydrate([holdingPartition(1), holdingPartition(2), holdingPartition(3)]);
    expect(engine.commandPartitions("p2", command)).toEqual([]);
  });

  it("refuses a declaration that tries to write", async () => {
    const writer = worldAction<VillageFixture>("writer")
      .needs(({ game, player }) => {
        game.holdingOf(player.seat).woodpile = 99;
        return [];
      })
      .execute(() => {});
    const { engine } = newEngine([writer]);
    await engine.hydrate([holdingPartition(1)]);
    expect(() => engine.commandPartitions("p1", { name: "writer", args: {} })).toThrow(
      /A declaration tried to write/,
    );
  });
});

describe("dispatching a world action", () => {
  it("runs it through the engine's own executor and reports what it dirtied", async () => {
    const { engine, game } = newEngine();
    const target = await holdingId(engine, game, 3);
    const before = game.holdingOf(3).standing;
    const result = await apply(engine, "p2", { name: "tend", args: { neighbour: target } });

    expect(game.holdingOf(2).woodpile).toBe(0);
    expect(game.holdingOf(3).standing).toBe(before + 2);
    expect([...result.dirty].sort()).toEqual([
      holdingPartition(1),
      holdingPartition(2),
      holdingPartition(3),
    ]);
  });

  it("routes what the action emitted to the seats that can see it", async () => {
    const { engine, game } = newEngine();
    const result = await apply(engine, "p2", {
      name: "tend",
      args: { neighbour: await holdingId(engine, game, 3) },
    });
    expect(result.events).toEqual([
      { scope: holdingPartition(3), payload: { tended: 2 }, seats: [3] },
    ]);
  });

  it("leaves the world unchanged when the rules refuse", async () => {
    const { engine, game } = newEngine();
    await apply(engine, "p2", { name: "tend", args: { neighbour: await holdingId(engine, game, 3) } });
    const woodpile = game.holdingOf(2).woodpile;

    // No log left, so the action's own `disabled` rule closes the door.
    const other = await holdingId(engine, game, 1);
    await expect(
      apply(engine, "p2", { name: "tend", args: { neighbour: other } }),
    ).rejects.toThrow(/no log to spend/);
    expect(game.holdingOf(2).woodpile).toBe(woodpile);
  });

  it("refuses a partition the action did not declare", async () => {
    const reacher = worldAction<VillageFixture>("reacher")
      .needs(({ player }) => [holdingPartition(player.seat)])
      .execute((_args, ctx) => {
        ctx.world.partition(COMMONS);
      });
    const { engine } = newEngine([reacher]);
    await expect(apply(engine, "p1", { name: "reacher", args: {} })).rejects.toThrow(
      /did not declare/,
    );
  });
});

describe("the clock", () => {
  it("runs a seatless action with no player and its own arguments", async () => {
    const { engine, game } = newEngine();
    await apply(engine, "p1", { name: "gather", args: {} });
    const banked = game.holdingOf(1).woodpile;
    expect(banked).toBeGreaterThan(0);

    for (;;) {
      const needs = engine.commandPartitions(null, {
        name: "settleBurn",
        args: { holding: holdingPartition(1) },
      });
      if (needs.length === 0) break;
      await engine.hydrate(needs);
    }
    const result = await engine.onEvent(
      { name: "settleBurn", args: { holding: holdingPartition(1) } },
      { due: STAMP.now + 1000, missedCount: 0 },
      { allowance: STAMP.allowance, presence: [] },
    );

    expect(game.holdingOf(1).woodpile).toBe(0);
    expect(result.events).toEqual([
      { scope: COMMONS, payload: { embers: banked }, seats: [1, 2, 3, 4, 5, 6] },
    ]);
  });

  it("names the action a schedule wakes for", async () => {
    const { engine } = newEngine();
    const result = await apply(engine, "p1", { name: "gather", args: {} });
    expect(result.schedules).toEqual([
      {
        delayMs: 1000,
        action: "settleBurn",
        key: "burn:1",
        args: { holding: holdingPartition(1) },
      },
    ]);
  });
});

describe("what stops an author writing an O(world) enumeration", () => {
  it("refuses the unbounded element form at construction", () => {
    const searching = worldAction<VillageFixture>("searching")
      .needs(() => [])
      .chooseElement("anything", {} as never)
      .execute(() => {});
    expect(() => newEngine([searching])).toThrow(/names no candidates/);
  });

  it("REFUSES ctx.world.cancel() during an offer, as it does schedule (#177)", async () => {
    // The bot boundary. An MCTS search rolls the tree back many times inside
    // one real dispatch, and a cancel escapes the tree exactly as an arm does
    // -- a search that forgot a real timer while it was only thinking would
    // leave the world holding the consequence of a move nobody made.
    const forgetful = worldAction<VillageFixture>("forgetful")
      .needs(() => [])
      .disabled((ctx) => {
        (ctx as unknown as { world: { cancel(key: string): void } }).world.cancel("burn:1");
        return false;
      })
      .execute(() => {});
    const { engine } = newEngine([forgetful]);
    await expect(engine.offersFor("p1", OFFER)).rejects.toThrow(
      /called ctx\.world\.cancel\(\) while the world was deciding what to OFFER/,
    );
  });

  it("refuses a candidate outside what the step declared", async () => {
    const straying = worldAction<VillageFixture>("straying")
      .needs(({ player }) => [holdingPartition(player.seat)])
      .chooseElement("elsewhere", {
        elements: ({ game }) => [game.holdingOf(1), game.holdingOf(2), game.holdingOf(3)],
      })
      .execute(() => {});
    const { engine } = newEngine([straying]);
    // Everything is resident, so only the DECLARATION stands between the
    // action and the whole village -- which is exactly the case the guard is
    // for: residency is an accident of what else has run.
    await engine.hydrate([holdingPartition(1), holdingPartition(2), holdingPartition(3)]);
    await expect(engine.offersFor("p1", OFFER)).rejects.toThrow(/did not declare/);
  });

  it("refuses a selection past this host's candidate budget", async () => {
    const roster = worldAction<VillageFixture>("roster")
      .needs(({ player }) => [holdingPartition(player.seat)])
      .chooseElement("anybody", {
        needs: ({ player }) => neighbourSeats(player.seat).map(holdingPartition),
        elements: ({ game, player }) => neighbourSeats(player.seat).map((s) => game.holdingOf(s)),
      })
      .execute(() => {});
    const game = new VillageFixture({ playerCount: SETTLERS, seed: "village", worldMode: true });
    const engine = new BoardSmithWorldEngine({
      game,
      seats: new Map([["p1", 1]]),
      store: new CountingStore(genesis()),
      actions: [roster],
      view: () => [],
      // The floor `worldBudgets()` enforces (#170 R2: the safety net must sit
      // above the Action Panel's reading threshold) is deliberately stepped over
      // here, because what is under test is the ENGINE's enforcement of the
      // number rather than the config validator's. A real host reaches this
      // shape only by spreading a validated set and overriding a field by hand,
      // which is exactly as deliberate as it should be.
      budgets: { ...worldBudgets(), maxCandidatesPerSelection: 1 },
    });
    await expect(engine.offersFor("p1", OFFER)).rejects.toThrow(/allows 1 per selection/);
  });

  it("refuses a dependent selection, naming the fix", () => {
    // `worldAction`'s own surface has no `dependsOn` to pass, which is the
    // signpost; this reaches past it to prove the ENFORCEMENT is at
    // registration and not merely in the builder's type.
    const dependent = worldAction<VillageFixture>("dependent")
      .needs(() => [])
      .chooseElement("first", { elements: ({ game }) => [game.holdingOf(1)] })
      .chooseElement("second", { elements: ({ game }) => [game.holdingOf(2)] })
      .execute(() => {});
    (dependent.selections[1] as { dependsOn?: string }).dependsOn = "first";
    expect(() => newEngine([dependent])).toThrow(/one action per shape/);
  });

  it("refuses a seatless action that asks a question", () => {
    const chatty = worldClockAction<VillageFixture>("chatty");
    const built = chatty.execute(() => {});
    built.selections.push({ type: "choice", name: "who", choices: [] } as never);
    expect(() => newEngine([built])).toThrow(/nobody to ask/);
  });
});

describe("a world action outside a world", () => {
  it("says so rather than reporting a TypeError from inside the library", () => {
    const table = new VillageFixture({ playerCount: 2, seed: "table" });
    table.registerAction(tend);
    expect(() => table.performAction("tend", table.players[0]!, { neighbour: 1 })).toThrow(
      /only exists while a persistent world is running it/,
    );
  });
});

describe("a chain of rounds at one step", () => {
  // THE CASE #122 EXISTS FOR, on an action that asks nothing. A wanderer's room
  // is state, so a verb about it must name the index, read it, and then name
  // the room the index points at -- two rounds in one place. An earlier design
  // allowed one declaration per position, and `look` had to branch on whether
  // its own partition happened to be resident yet, which is exactly the branch
  // the mechanism deletes.
  const INDEX = "commons";

  it("asks the second round with what the first loaded in front of it", async () => {
    const seen: number[] = [];
    const chained = worldAction<VillageFixture>("chained")
      .needs(() => [INDEX])
      .needs(({ game }) => {
        // THROWS RATHER THAN BRANCHING, which is the whole point: a second
        // round is only ever asked once the round before it is resident, so an
        // author writes the read straight rather than guarding it. The old
        // fixpoint asked every round from the first attempt, which is why every
        // declaration in the catalogue began with "is it there yet?".
        const commons = game.first(Commons, "commons");
        if (commons === undefined) throw new Error("asked before the index was resident");
        seen.push(commons.embers);
        return [holdingPartition(1)];
      })
      .execute((_args, ctx) => {
        ctx.world.partition(holdingPartition(1));
      });

    const { engine } = newEngine([chained]);
    const command = { name: "chained", args: {} };

    expect(engine.commandPartitions("p1", command)).toEqual([INDEX]);
    await engine.hydrate([INDEX]);
    expect(engine.commandPartitions("p1", command)).toEqual([holdingPartition(1)]);
    await engine.hydrate([holdingPartition(1)]);
    expect(engine.commandPartitions("p1", command)).toEqual([]);

    const result = await engine.applyCommand("p1", command, STAMP);
    expect([...result.dirty].sort()).toEqual([INDEX, holdingPartition(1)]);
    // Never asked while its own input was absent, on any of those calls.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((embers) => embers === 0)).toBe(true);
  });
});

describe("who may issue what", () => {
  it("refuses a scheduled event that names a seat's own action", async () => {
    const { engine } = newEngine();
    await expect(
      engine.onEvent({ name: "gather", args: {} }, { due: STAMP.now, missedCount: 0 }, {
        allowance: STAMP.allowance,
        presence: [],
      }),
    ).rejects.toThrow(/a due event has no player/);
  });
});
