// The refusal taxonomy, and the decision it exists to drive.
//
// The point is not tidiness. A host decides whether a failure PARKS a world
// from its OWNER, and until this table existed nothing supplied one -- every
// world refusal was a bare `new Error` with a good sentence and no
// machine-readable anything. These cases are about that owner being right,
// because misclassifying is expensive in both directions: a game bug called a
// platform refusal lets one bad bundle park a live world, and a platform quota
// called a game bug burns a wake an hour forever against a refusal that will
// never stop being issued.
//
// The LADDERS themselves -- how many consecutive platform refusals park a
// world, how long an outage is forgiven -- stayed with the host (#165). A
// laptop parks nothing and has no season to end; the vocabulary it reasons
// with is here, the consequence it draws is its own.
import { describe, expect, it } from "vitest";
import {
  WORLD_REFUSALS,
  WorldRefusal,
  ownerOf,
  worldRefusal,
  type WorldRefusalCode,
} from "./refusals.js";
import { createInlinedPartitionStore, createWorldRunner } from "./runner.js";
import { Game, Player, Space } from "../engine/index.js";
import type { ActionDefinition, GameOptions } from "../engine/index.js";
import { BoardSmithWorldEngine } from "./engine.js";
import { worldAction, worldClockAction } from "./action.js";
import { planSchedules } from "./schedule-api.js";
import { worldBudgets } from "./budgets.js";

const BUDGETS = worldBudgets();
const WORLD_MAX_UNKEYED_PENDING_PER_PLAYER = BUDGETS.maxUnkeyedPendingPerPlayer;

const CODES = Object.keys(WORLD_REFUSALS) as WorldRefusalCode[];

class Room extends Space<RefusalWorld> {}
class RefusalWorld extends Game<RefusalWorld, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Room]);
  }
}

/** A REAL engine over a real world-mode game, holding the actions under test.
 *  A stub would prove the shape of the refusal and not that the module raises
 *  one, which is the whole point of these cases. */
function engineWith(actions: readonly ActionDefinition[]): BoardSmithWorldEngine {
  return new BoardSmithWorldEngine({
    game: new RefusalWorld({ playerCount: 2, seed: "refusals", worldMode: true }),
    seats: new Map([["p1", 1]]),
    store: createInlinedPartitionStore(),
    actions,
    view: () => [],
  });
}

describe("#37 item 5 — the world refusal taxonomy", () => {
  it("gives every refusal an owner and a stated reason", () => {
    // The reason is not decoration: it is what a future reader checks a NEW
    // refusal's classification against, and misclassifying is what this whole
    // table exists to make hard.
    for (const code of CODES) {
      const entry = WORLD_REFUSALS[code];
      expect(["caller", "game", "platform", "infrastructure"]).toContain(entry.owner);
      expect(entry.why.length, `${code} has no stated reason`).toBeGreaterThan(20);
    }
  });

  it("carries the owner on the error, so a catcher never parses prose", () => {
    const refusal = worldRefusal("partition-not-resident", "nope");
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal.code).toBe("partition-not-resident");
    expect(refusal.owner).toBe("platform");
  });

  it("treats an UNCLASSIFIED throw as the game's, which is the safe default", () => {
    // Safe rather than tidy. An unexpected error from inside a command is most
    // likely the bundle's, and calling it a platform refusal would let a game
    // bug park a live world after two occurrences. Being wrong the other way
    // costs one dead-lettered event, which quarantine already bounds.
    expect(ownerOf(new Error("something else"))).toBe("game");
    expect(ownerOf("not even an error")).toBe("game");
    expect(ownerOf(worldRefusal("partition-not-resident", "x"))).toBe("platform");
  });

  it("classifies a bad action name as the CALLER's, so one client cannot park a world", () => {
    // The distinction the two-owner vocabulary could not express. A client
    // naming a command that does not exist says nothing about the world's
    // health, and a world that parked over it would be trivially griefable.
    expect(WORLD_REFUSALS["unknown-command"].owner).toBe("caller");
    expect(WORLD_REFUSALS["unknown-player"].owner).toBe("caller");
    // #150: a full world and a seat conflict are one request refused, never a
    // rung on the ladder -- a world that parked on them would let the 5th
    // joiner of a 4-seat world take it down for everybody.
    expect(WORLD_REFUSALS["world-full"].owner).toBe("caller");
    expect(WORLD_REFUSALS["seat-conflict"].owner).toBe("caller");
  });

  it("states the producer `world-full` can still have, not the retired one", () => {
    // A stated reason is what the next reader checks a classification against,
    // so a reason naming a producer that cannot occur is worse than a short
    // one: it sends whoever meets this refusal at a setting that is already
    // correct.
    //
    // This entry named "a membership cap set above the game's own number" as
    // the usual cause. That cause is gone: a host that admits players before
    // seating them counts the same LIFETIME seats this door counts, so a joiner
    // the world has no chair for is refused at the door before it. What is left
    // is a host's stored player count declaring more seats than the compiled
    // rules build.
    //
    // `definition.ts:assertSeatWithinWorld` says exactly that to the player it
    // refuses. The table has to agree with it, because the two are read by the
    // same person one after the other.
    const why = WORLD_REFUSALS["world-full"].why;
    expect(why, "the retired cause must not be named as this refusal's producer").not.toMatch(
      /membership cap/i,
    );
    expect(why, "the producer that is left is a stored player count").toMatch(
      /stored player count/i,
    );
    expect(why, "and the sentence a player reads is raised there").toContain(
      "assertSeatWithinWorld",
    );
  });

  it("classifies a bundle's own mistakes as the GAME's, so they dead-letter", () => {
    // #35: "one poison respawn timer must not kill a 500-player world."
    for (const code of [
      "undeclared-partition",
      "schedule-cap",
      "invalid-schedule-delay",
      "invalid-partition-name",
      // #110. The BUDGET is the platform's, drawn below the SQLite value wall;
      // what a partition contains is the bundle's, and the fix -- split it --
      // is the author's. Classified like `schedule-cap` for that reason: one
      // room that outgrew its budget must not park a world 499 other players
      // are in.
      "partition-too-large",
      // #134. Every raise site addresses the game author, and the reachable
      // producer is a `partitions()` or `world.view` declaration with a typo in
      // it. It was PLATFORM-owned, so one misspelt room name parked a whole
      // world after two wakes; the platform's own bookkeeping breaking keeps
      // its own codes below.
      "partition-missing",
      // #169, and the successor to `invalid-command-args`. That code covered a
      // command table declaring arguments the platform could not offer -- a
      // reserved `now`, a repeated name, a nameless argument, a choice between
      // nothing -- all of which were facts about an argument DECLARATION that
      // no longer exists. What replaced it is a wider rule about the same
      // hazard: a world action the platform cannot offer or cannot BOUND. Same
      // owner, for the same reason it always had one -- a bundle whose verbs
      // are wrong is wrong for every player who will ever attach, and the same
      // bundle does it again on the next wake.
      "invalid-world-action",
      // #169's other new code. An action built with `worldAction()` that
      // reaches `ctx.world` outside a world was, before it, a TypeError raised
      // from inside library code on `undefined.partition` -- unclassified, and
      // therefore already the game's by `ownerOf`'s safe default. Naming it is
      // what turns an unreadable stack into a sentence about registering a
      // world action on a table.
      "not-in-a-world",
    ] as const) {
      expect(WORLD_REFUSALS[code].owner, code).toBe("game");
    }
  });

  it("classifies store disagreements as the PLATFORM's, so they can park", () => {
    // These are the ones only the platform's own bookkeeping can produce: a
    // partition the engine and the store disagree about, or a checkpoint the
    // store cannot place. Each fails identically next time, and retrying
    // forever spends a wake an hour on a world that cannot advance.
    for (const code of [
      "partition-not-resident",
      "partition-vanished",
      "checkpoint-unknown-partition",
    ] as const) {
      expect(WORLD_REFUSALS[code].owner, code).toBe("platform");
    }
  });

  // ---- The refusals as the modules actually raise them ----

  it("the world raises a CLASSIFIED refusal for an unknown action", async () => {
    // Driven through the real modules rather than asserted about the table, so
    // a site that goes back to a bare `new Error` fails here rather than
    // looking correct in a taxonomy nothing reaches.
    //
    // It is the ENGINE that refuses, and the runner that a caller reaches it
    // through: since #121 the declaration is answered from the engine, because
    // it may name the acting seat's own partition and only the engine holds the
    // roster.
    const runner = createWorldRunner(engineWith([]), createInlinedPartitionStore());

    try {
      await runner.declare({ name: "nope", args: {} }, "p1", {}, 0);
      expect.unreachable("declare accepted an action this world does not have");
    } catch (error) {
      expect(error).toBeInstanceOf(WorldRefusal);
      expect((error as WorldRefusal).code).toBe("unknown-command");
      expect(ownerOf(error)).toBe("caller");
    }
  });

  it("refuses a player who reaches for the CLOCK'S OWN action (#120)", async () => {
    // The declaration is the earliest door there is -- before a partition is
    // read and before an action runs -- and it is where a `worldClockAction`'s
    // seatlessness is enforced. A game that had to refuse this by hand inside
    // its own rules was answering a button the platform should never have drawn.
    const settle = worldClockAction<RefusalWorld>("settle")
      .needs(() => [])
      .execute(() => {});
    const runner = createWorldRunner(
      engineWith([settle]),
      createInlinedPartitionStore(),
    );

    // THE CLOCK MAY. `null` is the clock, and the same declaration answers it.
    expect(await runner.declare({ name: "settle", args: {} }, null, {}, 0)).toEqual({ needs: [] });

    try {
      await runner.declare({ name: "settle", args: {} }, "p1", {}, 0);
      expect.unreachable("declare accepted the clock's own action from a player");
    } catch (error) {
      expect(error).toBeInstanceOf(WorldRefusal);
      expect((error as WorldRefusal).code).toBe("clock-only-command");
      // CALLER-owned: a client reaching for a command it was never offered
      // says nothing about the world's health, so it must never park anything.
      expect(ownerOf(error)).toBe("caller");
    }
  });

  it("refuses a bundle whose action cannot be bounded, when the world is BUILT (#169)", () => {
    // Driven through the real engine rather than asserted about the table, for
    // the reason the two cases above are: a rule enforced nowhere reads exactly
    // like a rule enforced everywhere from inside a taxonomy.
    //
    // AT CONSTRUCTION, and that is the half worth pinning. A bundle whose
    // declaration is wrong is wrong for every player who will ever attach, so
    // it is refused once, before the world is built, rather than on whichever
    // player first asked what they could do here -- which is where an
    // enumeration-time refusal would land, looking like a bug in that seat.
    const searching = worldAction<RefusalWorld>("searching")
      .needs(() => [])
      .chooseElement("anything", {} as never)
      .execute(() => {});

    try {
      engineWith([searching]);
      expect.unreachable("the engine built a world around an unbounded enumeration");
    } catch (error) {
      expect(error).toBeInstanceOf(WorldRefusal);
      expect((error as WorldRefusal).code).toBe("invalid-world-action");
      // GAME-owned: a bundle mistake dead-letters rather than parking a world
      // 499 other players are in.
      expect(ownerOf(error)).toBe("game");
    }
  });

  it("names the world an action needs, rather than reporting a TypeError (#169)", () => {
    // The producer is real and ordinary: a world action registered on a TABLE
    // game. Its callback reads `ctx.world`, which does not exist there, and
    // before this code the failure was `undefined.partition` raised from inside
    // library code -- a stack an author cannot act on, about a mistake with a
    // one-line fix.
    const table = new RefusalWorld({ playerCount: 2, seed: "table" });
    // `.disabled()` is what makes the refusal land where a table can see it
    // classified: every world callback's context is built with `ctx.world`
    // resolved eagerly, and a table's executor CATCHES what `execute` throws
    // and answers `{success: false, error}` -- deliberately, so the game's own
    // sentence travels unclassified and a bug in a game's rules is never
    // relabelled as one of the platform's words. The availability check runs
    // outside that catch, so this is the door the code comes through.
    const tend = worldAction<RefusalWorld>("tend")
      .needs(() => [])
      .disabled(({ player }) => (player.seat === 99 ? "never" : false))
      .execute(() => {});
    table.registerAction(tend);

    try {
      table.performAction("tend", table.players[0]!, {});
      expect.unreachable("a world action ran on a table");
    } catch (error) {
      expect(error).toBeInstanceOf(WorldRefusal);
      expect((error as WorldRefusal).code).toBe("not-in-a-world");
      expect(ownerOf(error)).toBe("game");
    }
  });

  it("the schedule cap comes back classified, with #35's wording intact", () => {
    const result = planSchedules([{ delayMs: 1, action: "tick" }], {
      owner: "p1",
      arrivedAt: 0,
      nextSeq: 99,
      mintId: () => "new",
      budgets: BUDGETS,
      allowance: {
        unkeyed: WORLD_MAX_UNKEYED_PENDING_PER_PLAYER,
        keys: [],
        worldPending: WORLD_MAX_UNKEYED_PENDING_PER_PLAYER,
      },
      replaces: () => undefined,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("schedule-cap");
    expect(result.refusal.owner).toBe("game");
    // The three ways forward survive the wrapping -- the code is for the
    // ladder, the message is still for the author.
    expect(result.refusal.message).toContain("give the schedule a KEY");
  });
});

/**
 * WHAT LEFT WITH THE HOST (#165): the two ladders.
 *
 * `failureParks` counted consecutive platform refusals; `outageParks` measured
 * how long a bundle store had been unreachable. Both decided a CONSEQUENCE --
 * end this world's season -- and a consequence is a fact about a host. The
 * owner each ladder reads is below and is the same on every host, which is the
 * split: one vocabulary, and as many ladders as there are places to run a
 * world.
 */
describe("the owners a host's ladder reads", () => {
  it("classifies an unreachable bundle store as INFRASTRUCTURE, not the game's", () => {
    // The whole defect in one assertion. `#loadRulesJs` threw uncoded, so
    // `ownerOf`'s safe-by-default "game" charged an R2 outage to whichever
    // timer was due and dead-lettered it four wakes later -- having never
    // reached a line of the bundle's code.
    expect(WORLD_REFUSALS["bundle-store-unavailable"].owner).toBe("infrastructure");
    expect(ownerOf(worldRefusal("bundle-store-unavailable", "R2 is unreachable"))).toBe(
      "infrastructure",
    );
  });

  it("keeps the two PRE-HANDLER refusals that ARE deterministic on their own owners", () => {
    // The issue's second requirement, and the reason this is not a blanket
    // exemption for everything raised before a handler. A world pinned to a
    // deleted bundle, or one that has spent its lifetime allowance of child
    // isolates, gets the same answer on every wake forever -- so those must
    // keep costing what they cost.
    expect(WORLD_REFUSALS["bundle-not-a-world"].owner).toBe("game");
    expect(WORLD_REFUSALS["child-generations-exhausted"].owner).toBe("platform");
  });

});
