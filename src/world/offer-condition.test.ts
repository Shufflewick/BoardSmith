import { describe, it, expect } from "vitest";
import { Game, Space } from "../engine/index.js";
import { worldAction, worldClockAction, createWorld } from "./index.js";
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
      definition: {
        gameClass: TestGame,
        gameType: "offer-condition",
        world: {
          maxPlayers: 1,
          actions: [ready, tick],
          view: () => ["store"],
          genesis: (game) => ({ store: game.create(Store, "store") }),
        },
      },
      seed: "condition",
      seats: new Map([["p1", 1]]),
    });
    await runner.genesis();
    expect(await runner.declareOffers("p1", {})).toEqual({ needs: [] });
    expect(calls).toBe(0);
    expect(await runner.offersFor("p1", { now: 41, presence: [] })).toEqual([]);
    expect(calls).toBe(1);
    expect(
      (await runner.offersFor("p1", { now: 42, presence: [] })).map(
        (o) => o.name,
      ),
    ).toEqual(["ready"]);
  });
});
