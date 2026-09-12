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

  it("still offers a DISABLED action whose every candidate is greyed out, with its reason", async () => {
    // BOARDSMITH #187, AND THE FIELD CASE IT WAS FOUND IN.
    //
    // `example-rts` stands every holding at its cap at genesis, so a settler's
    // two neighbours are both greyed ("already at full growth") from the first
    // instant of the world. `tend` therefore had NO enabled candidate, was
    // dropped by the satisfiability rule, and never reached the panel at all --
    // while `kindle`, whose selection is a number and can never be
    // candidateless, sat beside it correctly greyed. A seat was told two of its
    // three verbs existed.
    //
    // A DISABLED ACTION IS NEVER STARTED, so whether its questions have answers
    // decides nothing: the reason it cannot be taken is the reason, and it is
    // the one `candidateless` itself says belongs on the action.
    const { engine, game } = newEngine();
    // Fill BOTH of seat 3's neighbours, and spend seat 3's only log doing half
    // of it, so `tend` is disabled AND every candidate it could name is greyed.
    await apply(engine, "p3", { name: "tend", args: { neighbour: await holdingId(engine, game, 2) } });
    await apply(engine, "p5", { name: "tend", args: { neighbour: await holdingId(engine, game, 4) } });
    expect(game.holdingOf(2).standing).toBeGreaterThanOrEqual(STANDING_MAX);
    expect(game.holdingOf(4).standing).toBeGreaterThanOrEqual(STANDING_MAX);
    expect(game.holdingOf(3).woodpile).toBe(0);

    const offers = await engine.offersFor("p3", OFFER);
    const tendOffer = offers.find((offer) => offer.name === "tend");
    expect(tendOffer, `The world offered this seat ${JSON.stringify(offers.map((o) => o.name))}.`)
      .toBeDefined();
    expect(tendOffer!.disabled).toBe("You have no log to spend");
    // The candidates travel with it, each carrying its own reason, so the panel
    // greys the verb and can still say what it would have asked.
    expect(tendOffer!.selections[0]!.validElements).toHaveLength(2);
  });

  it("still drops an ENABLED action whose every candidate is greyed out", async () => {
    // THE OTHER HALF OF THE SAME RULE, and the reason the rule exists: an
    // action a seat may take, whose only question has no answer, is a button
    // whose every press is refused and a pick that opens on nothing. That was
    // #187's first symptom and it stays cured -- what changed is only that a
    // DISABLED action is no longer dropped for the same reason.
    const nothingToTake = worldAction<VillageFixture>("nothingToTake")
      .needs(({ player }) => [holdingPartition(player.seat)])
      .chooseElement("neighbour", {
        needs: ({ player }) => neighbourSeats(player.seat).map(holdingPartition),
        elements: ({ game, player }) => neighbourSeats(player.seat).map((s) => game.holdingOf(s)),
        disabled: () => "Not this one",
      })
      .execute(() => {});
    const { engine } = newEngine([nothingToTake]);
    expect((await engine.offersFor("p3", OFFER)).map((offer) => offer.name)).toEqual([]);
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

    const first = engine.commandNeeds("p2", command, STAMP.now, []).partitions;
    expect(first).toEqual([holdingPartition(2)]);

    await engine.hydrate(first);
    expect([...engine.commandNeeds("p2", command, STAMP.now, []).partitions].sort()).toEqual([
      holdingPartition(1),
      holdingPartition(3),
    ]);
  });

  it("ends when everything the walk named is resident", async () => {
    const { engine } = newEngine();
    const command = { name: "tend", args: { neighbour: 0 } };
    await engine.hydrate([holdingPartition(1), holdingPartition(2), holdingPartition(3)]);
    expect(engine.commandNeeds("p2", command, STAMP.now, []).partitions).toEqual([]);
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
    expect(() => engine.commandNeeds("p1", { name: "writer", args: {} }, STAMP.now, []).partitions).toThrow(
      /A read-only view of this world tried to write/,
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
      const needs = engine.commandNeeds(null, {
        name: "settleBurn",
        args: { holding: holdingPartition(1) },
      }, STAMP.now, []).partitions;
      if (needs.length === 0) break;
      await engine.hydrate(needs);
    }
    const result = await engine.onEvent(
      { name: "settleBurn", args: { holding: holdingPartition(1) } },
      { due: STAMP.now + 1000, missedCount: 0 },
      { allowance: STAMP.allowance, presence: [], activity: null },
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

    expect(engine.commandNeeds("p1", command, STAMP.now, []).partitions).toEqual([INDEX]);
    await engine.hydrate([INDEX]);
    expect(engine.commandNeeds("p1", command, STAMP.now, []).partitions).toEqual([holdingPartition(1)]);
    await engine.hydrate([holdingPartition(1)]);
    expect(engine.commandNeeds("p1", command, STAMP.now, []).partitions).toEqual([]);

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
        activity: null,
      }),
    ).rejects.toThrow(/a due event has no player/);
  });
});

describe("#376 — a world action can ask for a GROUP", () => {
  // A world action could only ever ask for ONE of a thing. `chooseFrom`
  // forwarded prompt, choices, display, optional, validate, boardRefs and
  // disabled and dropped `multiSelect`, which is the option that turns radio
  // buttons into checkboxes and the resolved value into an array. And
  // `chooseElements` -- the plural of `chooseElement` -- was not on the facade
  // at all, which made two of this module's OWN refusals point at a door that
  // did not exist: "ask for the whole set in one `chooseElements`" is what a
  // world action is told when it tries to `repeat` a selection.
  //
  // `dependsOn` is NOT part of this. It is refused for a world deliberately
  // (`assertIndependentSelection`) and the refusal is right: a world offers
  // every selection's candidates at once, so a dependent selection means the
  // whole cross-product in one shot -- a hydration per candidate. A dynamic
  // CAP does not need it, which is the case #376 actually described: a
  // `multiSelect` function reads the earlier argument and returns a number.

  /** A cart of two, and a work party that must fit in it. */
  const crew = worldAction<VillageFixture>("crew")
    .prompt("Send a work party")
    .needs(({ player }) => [holdingPartition(player.seat)])
    .chooseFrom("size", {
      prompt: "How big a cart?",
      choices: [1, 2],
    })
    .chooseFrom("hands", {
      prompt: "Who goes?",
      needs: ({ player }) => neighbourSeats(player.seat).map(holdingPartition),
      choices: ({ player }) => neighbourSeats(player.seat),
      // THE CAP IS A FACT ABOUT THE EARLIER PICK, and a function is how that is
      // said without asking the engine to enumerate one candidate list per
      // cart size. This is the half of #376 that a world can honour.
      multiSelect: ({ args }) => ({ min: 1, max: Number(args.size) }),
    })
    .execute(({ hands }, ctx) => {
      // `hands` is an ARRAY, and that it TYPE-CHECKS as one is half the point:
      // a forwarded multiSelect whose argument still inferred as a single value
      // would compile here and break in the game.
      ctx.game.holdingOf(ctx.player.seat).woodpile -= hands.length;
    });

  it("resolves a multiSelect choice to an ARRAY of the chosen values", async () => {
    const { engine, game } = newEngine([crew]);
    await engine.hydrate([holdingPartition(1)]);
    const before = game.holdingOf(1).woodpile;

    await apply(engine, "p1", { name: "crew", args: { size: 2, hands: neighbourSeats(1) } });

    expect(game.holdingOf(1).woodpile).toBe(before - 2);

    // AND THE LOWER BOUND HOLDS, which is the half that proves the option was
    // really forwarded: an unforwarded multiSelect leaves the array to arrive
    // unchecked, and an empty work party would be accepted.
    await expect(
      apply(engine, "p1", { name: "crew", args: { size: 2, hands: [] } }),
    ).rejects.toThrow(/at least 1 choice/);
  });

  it("REFUSES a party larger than the cart the earlier pick named", async () => {
    // The cap is the whole point of a dynamic multiSelect. Forwarding the
    // option and losing the bound would be worse than not forwarding it.
    const { engine } = newEngine([crew]);
    await engine.hydrate([holdingPartition(1)]);

    await expect(
      apply(engine, "p1", { name: "crew", args: { size: 1, hands: neighbourSeats(1) } }),
    ).rejects.toThrow(/at most 1 choice/);
  });

  it("puts multiSelect on the SELECTION the engine reads", () => {
    // The forwarding itself, at the one place a dropped option is invisible.
    const selection = crew.selections.find((s) => s.name === "hands");

    expect(selection).toBeDefined();
    expect((selection as { multiSelect?: unknown }).multiSelect).toBeTypeOf("function");
  });

  it("offers chooseElements, which the repeat refusal already told authors to use", async () => {
    const gang = worldAction<VillageFixture>("gang")
      .needs(({ player }) => [holdingPartition(player.seat)])
      .chooseElements("holdings", {
        needs: ({ player }) => neighbourSeats(player.seat).map(holdingPartition),
        elements: ({ game, player }) => neighbourSeats(player.seat).map((s) => game.holdingOf(s)),
        multiSelect: { min: 1, max: 2 },
      })
      .execute(({ holdings }) => {
        // An array of ELEMENTS, and it type-checks as one.
        for (const holding of holdings) holding.standing += 1;
      });
    const { engine, game } = newEngine([gang]);
    const ids = [];
    for (const seat of neighbourSeats(1)) ids.push(await holdingId(engine, game, seat));
    const before = neighbourSeats(1).map((s) => game.holdingOf(s).standing);

    await apply(engine, "p1", { name: "gang", args: { holdings: ids } });

    expect(neighbourSeats(1).map((s) => game.holdingOf(s).standing)).toEqual(
      before.map((standing) => standing + 1),
    );
  });

  it("still REFUSES dependsOn, because a world offers every candidate at once", () => {
    // Not an oversight and not fixed here. #376 asked for this too; the cost
    // model says no until the protocol is step-wise (#170), and a facade that
    // quietly forwarded it would have turned one offer into a cross-product.
    const dependent = worldAction<VillageFixture>("dependent")
      .needs(({ player }) => [holdingPartition(player.seat)])
      .chooseFrom("which", { choices: [1, 2] })
      .chooseElement("holding", {
        needs: ({ player }) => neighbourSeats(player.seat).map(holdingPartition),
        elements: ({ game, player }) => neighbourSeats(player.seat).map((s) => game.holdingOf(s)),
      })
      .execute(() => {});
    (dependent.selections.find((s) => s.name === "holding") as { dependsOn?: string }).dependsOn =
      "which";

    expect(() => newEngine([dependent])).toThrow(/depends on another selection/);
  });
});
