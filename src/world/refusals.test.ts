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
import type { GameOptions } from "../engine/index.js";
import {
  BoardSmithWorldEngine,
  type WorldCommandTable,
} from "./engine.js";
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

/** A REAL engine over a real world-mode game, holding the table under test.
 *  A stub would prove the shape of the refusal and not that the module raises
 *  one, which is the whole point of these cases. */
function engineWith(commands: WorldCommandTable): BoardSmithWorldEngine {
  return new BoardSmithWorldEngine({
    game: new RefusalWorld({ playerCount: 2, seed: "refusals", worldMode: true }),
    seats: new Map([["p1", 1]]),
    store: createInlinedPartitionStore(),
    commands,
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

  it("classifies a bad command as the CALLER's, so one client cannot park a world", () => {
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

  it("the world raises a CLASSIFIED refusal for an unknown command", async () => {
    // Driven through the real modules rather than asserted about the table, so
    // a site that goes back to a bare `new Error` fails here rather than
    // looking correct in a taxonomy nothing reaches.
    //
    // It is the ENGINE that refuses, and the runner that a caller reaches it
    // through: since #121 the declaration is answered from the engine, because
    // it may name the acting seat's own partition and only the engine holds the
    // roster.
    const runner = createWorldRunner(engineWith({}), createInlinedPartitionStore());

    try {
      await runner.declare({ name: "nope", args: {} }, "p1", {});
      expect.unreachable("declare accepted an unknown command");
    } catch (error) {
      expect(error).toBeInstanceOf(WorldRefusal);
      expect((error as WorldRefusal).code).toBe("unknown-command");
      expect(ownerOf(error)).toBe("caller");
    }
  });

  it("refuses a player who reaches for the CLOCK'S OWN command (#120)", async () => {
    // The declaration is the earliest door there is -- before a partition is
    // read and before a handler runs -- and it is where a bundle's `clockOnly`
    // is enforced. A game that had to refuse this by hand inside `run` was
    // answering a button the platform should never have drawn.
    const runner = createWorldRunner(
      engineWith({
        settle: { clockOnly: true, args: [], partitions: () => [], run: () => [] },
      }),
      createInlinedPartitionStore(),
    );

    // THE CLOCK MAY. `null` is the clock, and the same declaration answers it.
    expect(await runner.declare({ name: "settle", args: {} }, null, {})).toEqual({ needs: [] });

    try {
      await runner.declare({ name: "settle", args: {} }, "p1", {});
      expect.unreachable("declare accepted the clock's command from a player");
    } catch (error) {
      expect(error).toBeInstanceOf(WorldRefusal);
      expect((error as WorldRefusal).code).toBe("clock-only-command");
      // CALLER-owned: a client reaching for a command it was never offered
      // says nothing about the world's health, so it must never park anything.
      expect(ownerOf(error)).toBe("caller");
    }
  });

  it("the schedule cap comes back classified, with #35's wording intact", () => {
    const result = planSchedules([{ delayMs: 1, command: "tick" }], {
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
