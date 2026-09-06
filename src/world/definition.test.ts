/**
 * #165: THE CONTRACT HALF OF THE WORLD RUNNER ENTRY, DRIVEN WITHOUT A HOST.
 *
 * ShufflewickPub reached every one of these facts through a Durable Object, a
 * spliced CJS bundle and a `fetch` dispatch, because that was the only place
 * `readWorldDefinition`, `worldSeatCount` and `assertSeatWithinWorld` existed.
 * None of them is a fact about a Durable Object. Each is a statement about what
 * a world BUNDLE must export and what a host may then build from it -- which is
 * the whole reason they moved, and the reason `boardsmith dev` can now run the
 * same world a platform runs.
 *
 * The `world.maxPlayers` ceiling in particular used to be a platform constant
 * imported from a 966-line manifest schema. It is a host budget now, and the
 * cases below drive it at four seats and at five hundred to prove that.
 */
import { describe, expect, it } from "vitest";
import { Game, Player, Space, type GameOptions, type GameElement } from "../engine/index.js";
import {
  assertSeatWithinWorld,
  createWorld,
  readWorldDefinition,
  worldColorPalette,
  worldSeatCount,
  type WorldDefinition,
} from "./definition.js";
import { worldAction } from "./action.js";
import { worldBudgets } from "./budgets.js";
import { WorldRefusal } from "./refusals.js";

class Yard extends Space<TinyWorld> {
  pokes = 0;
}
class TinyWorld extends Game<TinyWorld, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Yard]);
  }
}

/**
 * The world's one verb, as an ACTION (#169).
 *
 * Declared at module scope rather than inside `bundle()` because `createWorld`
 * REGISTERS what `world.actions` names on the game it builds -- so the array is
 * the bundle's declaration and not a thing to rebuild per call.
 */
const poke = worldAction<TinyWorld>("poke")
  .needs(() => ["yard:1"])
  .execute((_args, ctx) => {
    const yard = ctx.world.partition("yard:1") as Yard;
    yard.pokes += 1;
    ctx.world.emit("yard:1", { poked: true });
  });

/**
 * A world bundle's definition, in the shape a real one exports.
 *
 * NO `minPlayers`/`maxPlayers`. A world has no table roster; the ONE seat count
 * it has is `world.maxPlayers`, which is also what the manifest's is derived
 * from, so the two can never disagree (#171 / ShufflewickPub #354).
 */
function bundle(overrides: { world?: WorldDefinition } = {}) {
  const world: WorldDefinition = {
    maxPlayers: 2,
    genesis: (game) => ({ "yard:1": game.create(Yard, "yard") as GameElement }),
    view: () => ["yard:1"],
    actions: [poke],
  };
  return {
    gameClass: TinyWorld,
    gameType: "tiny-world",
    world,
    ...overrides,
  } as Parameters<typeof createWorld>[0]["definition"];
}

describe("readWorldDefinition — what a bundle must export", () => {
  it("returns the block a real world bundle exports", () => {
    const world = readWorldDefinition(bundle());
    expect(world.actions.map((action) => action.name)).toEqual(["poke"]);
    expect(typeof world.view).toBe("function");
  });

  it("REFUSES a bundle with no world.actions, naming what to export", () => {
    // The FIRST moment anything can check this. A manifest declares the intent
    // and nothing reading a manifest can see inside compiled rules, so a game
    // that declared a world and shipped no verbs would otherwise fail as a
    // TypeError on somebody's first command.
    expect(() => readWorldDefinition({})).toThrow(/world: \{ actions, view \}/);
  });

  it("REFUSES a world block that declares no seats", () => {
    // The seat count moved INTO the block (#171): a world's roster is not a
    // table's, and leaving it on `gameDefinition.maxPlayers` is what let a world
    // game ship a vestigial table half beside its world.
    const noSeats = bundle({
      world: { actions: [poke], view: () => [] } as unknown as WorldDefinition,
    });
    expect(() => readWorldDefinition(noSeats)).toThrow(/world\.maxPlayers/);
  });

  it("REFUSES a bundle with no world.view, because a look would show nothing", () => {
    // A resident world's partitions are absent until something names them, so a
    // look that names nothing projects an EMPTY world -- and the one thing
    // every visitor does first is look. A default of "nothing" would be that
    // bug wearing a library decision's clothes; "everything" would be the
    // O(world) read the whole mode deletes.
    const noView = bundle({
      world: { maxPlayers: 2, actions: [poke] } as unknown as WorldDefinition,
    });
    expect(() => readWorldDefinition(noView)).toThrow(/declares no `view`/);
  });

  it("classifies both refusals as the GAME's", () => {
    try {
      readWorldDefinition({});
      expect.unreachable("a bundle with no world block was accepted");
    } catch (error) {
      expect((error as WorldRefusal).code).toBe("bundle-not-a-world");
      expect((error as WorldRefusal).owner).toBe("game");
    }
  });
});

describe("worldSeatCount — the bundle's number, bounded by the host's", () => {
  const budgets = worldBudgets();

  it("takes the number the compiled rules declare", () => {
    expect(worldSeatCount({ maxPlayers: 40 }, budgets)).toBe(40);
  });

  it("REFUSES a bundle that declares no seats at all", () => {
    expect(() => worldSeatCount({}, budgets)).toThrow(/declares no maxPlayers/);
    expect(() => worldSeatCount({ maxPlayers: 0 }, budgets)).toThrow(/declares no maxPlayers/);
    expect(() => worldSeatCount({ maxPlayers: 2.5 }, budgets)).toThrow(/declares no maxPlayers/);
  });

  it("REFUSES a bundle past the HOST's ceiling, not a hardcoded one", () => {
    // The reason this became a budget. A build can cap what a MANIFEST
    // declares; the number read here comes from the compiled definition, which
    // build validation never sees -- so a hand-built bundle with a spotless
    // manifest and `maxPlayers: 10_000_000` reached `new GameClass` beside a
    // ten-million-entry colour palette.
    expect(() => worldSeatCount({ maxPlayers: 10_000_000 }, budgets)).toThrow(/500 players/);
  });

  it("lets a host that runs small worlds say so", () => {
    // A laptop host is entitled to a four-seat ceiling, and a world declaring
    // more must be refused with the host's own number in the sentence.
    const laptop = worldBudgets({ maxPlayers: 4 });
    expect(worldSeatCount({ maxPlayers: 4 }, laptop)).toBe(4);
    expect(() => worldSeatCount({ maxPlayers: 5 }, laptop)).toThrow(/holds 4 players/);
  });
});

describe("assertSeatWithinWorld — a seat this world does not have", () => {
  it("admits every seat the world declares", () => {
    for (const seat of [1, 2, 3]) {
      expect(() => assertSeatWithinWorld("ada", seat, 3)).not.toThrow();
    }
  });

  it("REFUSES seat zero, a fraction, and one past the last chair", () => {
    // The engine holds exactly `seatCount` Game players, so a seat past that is
    // a chair that does not exist -- and seats are never reused, so admitting
    // one burns it forever while every later view fails inside game code.
    for (const seat of [0, -1, 2.5, 4]) {
      expect(() => assertSeatWithinWorld("ada", seat, 3)).toThrow(/seats 1 through 3/);
    }
  });

  it("is CALLER-owned: one refused request says nothing about the world", () => {
    try {
      assertSeatWithinWorld("ada", 9, 3);
      expect.unreachable("a seat past the ceiling was admitted");
    } catch (error) {
      expect((error as WorldRefusal).code).toBe("world-full");
      expect((error as WorldRefusal).owner).toBe("caller");
    }
  });
});

describe("worldColorPalette — a distinct colour per seat past the default palette", () => {
  it("leaves a small world the real palette, with the names people recognise", () => {
    expect(worldColorPalette(8)).toBeUndefined();
  });

  it("gives a large world one colour per seat, deterministically", () => {
    // The colour is written into the player element and therefore into every
    // checkpoint, so the same seat must get the same colour on every wake.
    const first = worldColorPalette(500)!;
    expect(first).toHaveLength(500);
    expect(new Set(first).size).toBe(500);
    expect(worldColorPalette(500)).toEqual(first);
    for (const hex of first) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("createWorld — one construction, every host", () => {
  it("builds a world in WORLD MODE, because snapshot mode would resolve the wrong element", () => {
    // Not switchable afterwards: in snapshot mode an element reference
    // serializes as a positional branch path, which resolves to the WRONG
    // element once a partition is not resident.
    const { seatCount } = createWorld({
      definition: bundle(),
      seed: "s",
      seats: new Map([["p1", 1]]),
    });
    expect(seatCount).toBe(2);
  });

  it("takes its seat count from world.maxPlayers, not from a table roster", () => {
    const { seatCount } = createWorld({
      // A stale table roster beside the world block changes nothing: the world
      // reads its own number, so there is only ever one to read.
      definition: {
        ...bundle({ world: { ...bundle().world!, maxPlayers: 7 } }),
        minPlayers: 2,
        maxPlayers: 4,
      } as Parameters<typeof createWorld>[0]["definition"],
      seed: "s",
      seats: new Map([["p1", 1]]),
    });
    expect(seatCount).toBe(7);
  });

  it("runs the bundle's genesis and hands back what a store must write", async () => {
    const { runner } = createWorld({
      definition: bundle(),
      seed: "s",
      seats: new Map([["p1", 1]]),
    });
    const genesis = await runner.genesis();
    expect(Object.keys(genesis)).toEqual(["yard:1"]);
    // `parentId` is the HOST's to record: it is outside the subtree, so the
    // serialized bytes cannot say where the subtree hangs.
    expect(genesis["yard:1"]!.parentId).toBeTypeOf("number");
  });

  it("declares, applies and serializes a command end to end", async () => {
    const { runner } = createWorld({
      definition: bundle(),
      seed: "s",
      seats: new Map([["p1", 1]]),
    });
    await runner.genesis();

    // Genesis CREATED the partition, so the engine already holds it and the
    // host is told to send nothing -- the residency subtraction that keeps a
    // warm world's command free of storage reads.
    const declared = await runner.declare({ name: "poke", args: {} }, "p1", {});
    expect(declared.needs).toEqual([]);

    const result = await runner.apply({
      player: "p1",
      command: { name: "poke", args: {} },
      timing: null,
      arrivedAt: 1_000,
      allowance: { unkeyed: 0, keys: [], worldPending: 0 },
      presence: [1],
    });
    expect(result.dirty).toEqual(["yard:1"]);
    expect(result.events).toHaveLength(1);

    const bytes = await runner.serialize([...result.dirty]);
    expect(JSON.parse(bytes["yard:1"]!)).toMatchObject({
      className: "Yard",
      attributes: { pokes: 1 },
    });
  });

  it("REFUSES a seating outside the world before it builds anything", () => {
    expect(() =>
      createWorld({ definition: bundle(), seed: "s", seats: new Map([["p1", 3]]) }),
    ).toThrow(/seats 1 through 2/);
  });

  it("hands the host's budgets to the engine, so ctx.schedule refuses on them", async () => {
    // The load-bearing case for #165's budget parameterization. A host whose
    // queue enforced different numbers from the ones a handler was refused
    // against would let a command run to completion believing timers it will
    // not get.
    const spam = worldAction<TinyWorld>("spam")
      .needs(() => [])
      .execute((_args, ctx) => {
        ctx.world.schedule({ delayMs: 1, action: "spam" });
        ctx.world.schedule({ delayMs: 2, action: "spam" });
      });
    const definition = bundle({ world: { maxPlayers: 2, view: () => [], actions: [spam] } });
    const { runner } = createWorld({
      definition,
      seed: "s",
      seats: new Map([["p1", 1]]),
      budgets: worldBudgets({ maxUnkeyedPendingPerPlayer: 1 }),
    });
    // It throws AT THE OFFENDING LINE, inside the handler, so the command
    // unwinds and the world is left unchanged. Refusing only in the host's
    // queue would leave a command that ran, changed the world, and had its
    // timers dropped.
    await expect(
      runner.apply({
        player: "p1",
        command: { name: "spam", args: {} },
        timing: null,
        arrivedAt: 0,
        allowance: { unkeyed: 0, keys: [], worldPending: 0 },
        presence: [],
      }),
    ).rejects.toThrow(/already has 1 unkeyed events pending, which is this world's limit/);
  });

  /**
   * #177: `ctx.world.cancel(key)` rides home the way `schedule` does.
   *
   * The end-to-end half of the cancel: what a handler calls, what a host is
   * handed, and that the two arrive in the order the handler wrote them. The
   * planning half -- which rows are named for deletion, and what a cancel gives
   * back to the caps -- is `schedule-api.test.ts`.
   */
  it("carries a CANCEL home beside the arms, in the order the handler wrote them", async () => {
    const rearm = worldAction<TinyWorld>("rearm")
      .needs(() => [])
      .execute((_args, ctx) => {
        ctx.world.cancel("raid");
        ctx.world.schedule({ delayMs: 60_000, key: "raid", action: "rearm" });
      });
    const { runner } = createWorld({
      definition: bundle({ world: { maxPlayers: 2, view: () => [], actions: [rearm] } }),
      seed: "s",
      seats: new Map([["p1", 1]]),
    });

    const result = await runner.apply({
      player: "p1",
      command: { name: "rearm", args: {} },
      timing: null,
      arrivedAt: 0,
      allowance: { unkeyed: 0, keys: ["raid"], worldPending: 1 },
      presence: [],
    });

    expect(result.schedules).toEqual([
      { cancel: "raid" },
      { delayMs: 60_000, key: "raid", action: "rearm" },
    ]);
  });

  it("REFUSES a cancel with no key, at the offending line, so the command unwinds", async () => {
    const forget = worldAction<TinyWorld>("forget")
      .needs(() => [])
      .execute((_args, ctx) => {
        ctx.world.cancel("");
      });
    const { runner } = createWorld({
      definition: bundle({ world: { maxPlayers: 2, view: () => [], actions: [forget] } }),
      seed: "s",
      seats: new Map([["p1", 1]]),
    });

    await expect(
      runner.apply({
        player: "p1",
        command: { name: "forget", args: {} },
        timing: null,
        arrivedAt: 0,
        allowance: { unkeyed: 0, keys: [], worldPending: 0 },
        presence: [],
      }),
    ).rejects.toThrow(/must name the key its timer was armed under/);
  });
});
