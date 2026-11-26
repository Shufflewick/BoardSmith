import { describe, expect, it } from "vitest";
import { Game, Player, Space, type GameElement, type GameOptions } from "../engine/index.js";
import { createWorld, readWorldDefinition, type WorldDefinition } from "./definition.js";
import { worldAction } from "./action.js";
import { WorldRefusal } from "./refusals.js";
import { worldElementIds } from "../engine/element/element-ids.js";
import { TEST_WORLD_ELEMENT_ID_KEY } from "../engine/element/world-element-id-key.test-helper.js";
import { createTestWorld } from "../testing/test-world.js";
import { createMemoryWorldStore } from "../testing/memory-world-store.js";
import { ResidentWorld } from "./host/index.js";
import { worldBudgets } from "./budgets.js";

class Yard extends Space<FixtureGame> {
  pokes = 0;
}
class FixtureGame extends Game<FixtureGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Yard]);
  }
}

const poke = worldAction<FixtureGame>("poke")
  .needs(() => ["yard:1"])
  .execute((_args, ctx) => {
    (ctx.world.partition("yard:1") as Yard).pokes += 1;
  });
const leave = worldAction<FixtureGame>("leave")
  .needs(() => [])
  .execute(() => {});

function yardWith(game: Game, pokes: number): Record<string, GameElement> {
  const yard = game.create(Yard, "yard");
  yard.pokes = pokes;
  return { "yard:1": yard };
}

function definition(fixtures: WorldDefinition["fixtures"]) {
  return {
    gameClass: FixtureGame,
    gameType: "fixture-world",
    world: {
      maxPlayers: 2,
      actions: [poke, leave],
      vacate: "leave",
      view: () => ["yard:1"],
      genesis: (game: Game) => yardWith(game, 0),
      fixtures,
    },
  } as Parameters<typeof createWorld>[0]["definition"];
}

function runnerFor(fixtures: WorldDefinition["fixtures"]) {
  return createWorld({
    elementIdKey: TEST_WORLD_ELEMENT_ID_KEY,
    definition: definition(fixtures),
    seed: "s",
    seats: new Map([["p1", 1]]),
  }).runner;
}

async function refusal(run: () => Promise<unknown>): Promise<WorldRefusal> {
  const error = await run().then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(WorldRefusal);
  return error as WorldRefusal;
}

describe("world fixtures: a world started from a named state the bundle declares (#1825)", () => {
  it("builds the named fixture instead of genesis, with the stamp genesis would carry", async () => {
    const runner = runnerFor({ busy: (game) => yardWith(game, 5) });
    const started = await runner.fixture("busy");
    expect(Object.keys(started.partitions)).toEqual(["yard:1"]);
    expect(started.partitions["yard:1"]!.json).toMatchObject({ className: "Yard", attributes: { pokes: 5 } });
    expect(started.nextElementId).toBeGreaterThan(
      worldElementIds(TEST_WORLD_ELEMENT_ID_KEY).cursorOf((started.partitions["yard:1"]!.json as { id: number }).id),
    );
  });

  it("leaves the fixture's partitions resident, so the first command plays on them", async () => {
    const runner = runnerFor({ busy: (game) => yardWith(game, 5) });
    await runner.fixture("busy");
    const result = await runner.apply({
      player: "p1",
      command: { name: "poke", args: {} },
      timing: null,
      arrivedAt: 1_000,
      allowance: { unkeyed: 0, keys: [], worldPending: 0 },
      presence: [1],
      activity: null,
      declaredActivity: [],
      declaredNotices: [],
    });
    const checkpoint = await runner.serialize([...result.dirty]);
    expect(JSON.parse(checkpoint.partitions["yard:1"]!)).toMatchObject({ attributes: { pokes: 6 } });
  });

  it("REFUSES a name the bundle does not declare, caller-owned and naming the ones it does", async () => {
    const runner = runnerFor({ busy: (game) => yardWith(game, 5), quiet: (game) => yardWith(game, 1) });
    for (const name of ["missing", "toString", "__proto__"]) {
      const refused = await refusal(() => runner.fixture(name));
      expect(refused.code).toBe("unknown-fixture");
      expect(refused.owner).toBe("caller");
      expect(refused.message).toContain(JSON.stringify(name));
      expect(refused.message).toContain('"busy", "quiet"');
    }
  });

  it("REFUSES every name in a world that declares no fixtures, saying so", async () => {
    const refused = await refusal(() => runnerFor(undefined).fixture("busy"));
    expect(refused.code).toBe("unknown-fixture");
    expect(refused.message).toContain("declares no fixtures");
  });

  it("REFUSES a fixture that leaves an element it did not return at the top level, naming the fixture", async () => {
    const runner = runnerFor({
      leaky: (game) => {
        game.create(Yard, "stray");
        return yardWith(game, 0);
      },
    });
    const refused = await refusal(() => runner.fixture("leaky"));
    expect(refused.code).toBe("invalid-partition-root");
    expect(refused.message).toContain('fixture "leaky"');
  });

  it("REFUSES a fixtures block that is not a record of functions, when the world is read", () => {
    for (const fixtures of [[], { busy: "not a function" }, { "": () => ({}) }]) {
      expect(() => readWorldDefinition(definition(fixtures as unknown as WorldDefinition["fixtures"]))).toThrow(
        /world\.fixtures/,
      );
    }
  });

  it("starts a test world from a fixture, through the host core a real host runs", async () => {
    const world = await createTestWorld({ definition: definition({ busy: (game) => yardWith(game, 5) }), fixture: "busy" });
    await world.take(1, "poke");
    expect((await world.getPlayerView(1)).state).toMatchObject({
      children: expect.arrayContaining([expect.objectContaining({ className: "Yard", attributes: expect.objectContaining({ pokes: 6 }) })]),
    });
  });

  it("REFUSES a fixture for a world that has already launched, whose state it would not replace", async () => {
    const world = new ResidentWorld({
      definition: definition({ busy: (game) => yardWith(game, 5) }),
      seed: "s",
      budgets: worldBudgets(),
      store: createMemoryWorldStore(TEST_WORLD_ELEMENT_ID_KEY, worldBudgets()),
      clock: { now: () => 0, arm: () => {}, yieldTurn: () => Promise.resolve() },
      presence: () => [],
      mintId: () => "event",
    });
    await world.start();
    await expect(world.start("busy")).rejects.toThrow(/already launched, so it cannot start from fixture "busy"/);
  });
});
