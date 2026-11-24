import { describe, it, expect } from "vitest";
import { Game, Space } from "../engine/index.js";
import { worldAction, worldClockAction, createWorld } from "./index.js";
import { TEST_WORLD_ELEMENT_ID_KEY } from "../engine/element/world-element-id-key.test-helper.js";
import { leaveNothing } from "./departure.test-helper.js";
class Store extends Space {
  ready = true;
}
class TestGame extends Game {
  constructor(options: ConstructorParameters<typeof Game>[0]) {
    super(options);
    this.registerElements([Store]);
  }
}
describe("offer declarations and stamped conditions", () => {
  it("declares reads without evaluating unstamped predicates, then filters with real world facilities", async () => {
    let calls = 0;
    const ready = worldAction("ready")
      .needs(() => ["store"])
      .condition({
        ready: (ctx) => {
          calls++;
          return (
            (ctx.world.partition("store") as Store).ready &&
            ctx.world.now === 42
          );
        },
      })
      .execute(() => {});
    const tick = worldClockAction("tick")
      .needs(() => ["store"])
      .execute(() => {});
    const { runner } = createWorld({
      elementIdKey: TEST_WORLD_ELEMENT_ID_KEY,
      definition: {
        gameClass: TestGame,
        world: {
          maxPlayers: 1,
          actions: [ready, tick, leaveNothing],
          vacate: "leave",
          view: () => ["store"],
          genesis: (game) => ({ store: game.create(Store, "store") }),
        },
      },
      seed: "condition",
      seats: new Map([["p1", 1]]),
    });
    await runner.genesis();
    expect(await runner.declareOffers("p1", {}, 41)).toEqual({ needs: [] });
    expect(calls).toBe(0);
    expect(await runner.offersFor("p1", { now: 41, presence: [], activity: null })).toEqual([]);
    expect(calls).toBe(1);
    expect(
      (await runner.offersFor("p1", { now: 42, presence: [], activity: null })).map(
        (o) => o.name,
      ),
    ).toEqual(["ready"]);
  });

  it("never walks a zero-pick action's execute round for an offer, whether its condition holds or not", async () => {
    let executeRounds = 0;
    let open = false;
    const claim = worldAction("claim")
      .needs(() => ["store"])
      .condition({ open: () => open })
      .needs(() => {
        executeRounds++;
        return ["store"];
      })
      .execute(() => {});
    const { runner } = createWorld({
      elementIdKey: TEST_WORLD_ELEMENT_ID_KEY,
      definition: {
        gameClass: TestGame,
        world: {
          maxPlayers: 1,
          actions: [claim, leaveNothing],
          vacate: "leave",
          view: () => ["store"],
          genesis: (game) => ({ store: game.create(Store, "store") }),
        },
      },
      seed: "execute-round",
      seats: new Map([["p1", 1]]),
    });
    await runner.genesis();
    const stamp = { now: 1, presence: [], activity: null };
    expect(await runner.declareOffers("p1", {}, 1)).toEqual({ needs: [] });
    expect(await runner.offersFor("p1", stamp)).toEqual([]);
    open = true;
    expect((await runner.offersFor("p1", stamp)).map((o) => o.name)).toEqual(["claim"]);
    expect(executeRounds).toBe(0);

    await runner.declare({ name: "claim", args: {} }, "p1", {}, { kind: "arrival", now: 1 }, {
      declaredActivity: [],
      declaredNotices: [],
    });
    expect(executeRounds).toBeGreaterThan(0);
  });

  it("refuses an offer whose condition reads a partition only its execute round declares", async () => {
    const late = worldAction("late")
      .condition({ ready: (ctx) => (ctx.world.partition("store") as Store).ready })
      .needs(() => ["store"])
      .execute(() => {});
    const { runner } = createWorld({
      elementIdKey: TEST_WORLD_ELEMENT_ID_KEY,
      definition: {
        gameClass: TestGame,
        world: {
          maxPlayers: 1,
          actions: [late, leaveNothing],
          vacate: "leave",
          view: () => ["store"],
          genesis: (game) => ({ store: game.create(Store, "store") }),
        },
      },
      seed: "late-declaration",
      seats: new Map([["p1", 1]]),
    });
    await runner.genesis();
    await expect(runner.offersFor("p1", { now: 1, presence: [], activity: null })).rejects.toThrow(
      'Action "late" asked for partition "store", which it did not declare.',
    );
  });
});
