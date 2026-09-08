/**
 * ShufflewickPub #378: A WORLD'S PICK IS RE-ASKED ONCE ITS ARGUMENT IS BOUND.
 *
 * #376 gave a world action `multiSelect`, and native `apply` enforces whatever
 * it resolves to. The BROWSER could not reach it. A world's offer is enumerated
 * in one frame with `args: {}` -- that is the whole cost model, and it is right
 * -- so a `multiSelect` that reads `args.ship` was evaluated before any ship
 * existed. What crossed the wire was the unbounded fallback, and unbounded is
 * `Infinity`, which is `null` once it has been through JSON. The panel read a
 * cap of `null`, disabled every checkbox, and the crew could not be picked at
 * all: "Selected: 0/null", with two eligible operatives greyed beside it.
 *
 * Two separate defects, and both are here:
 *
 *   A cap the wire CANNOT CARRY. `Infinity` is not JSON, and a protocol that
 *     turns "no limit" into "limit zero" is worse than one that says nothing.
 *     An unbounded pick omits `max` now, which is what a UI already reads as
 *     "no upper bound".
 *
 *   A cap NOTHING RE-ASKED. The table's panel refreshes a pick through
 *     `fetchPickChoices(action, selection, player, currentArgs)` as the player
 *     walks the action; a world answered that locally, off the one-shot offer,
 *     and threw the args away. `resolvePick` is the missing verb: one selection,
 *     re-evaluated against the args bound so far, read-only, over the partitions
 *     its own rounds declare.
 *
 * `dependsOn` is not the answer and is still refused for world actions: it makes
 * a selection's CANDIDATES a function of another's, which is the recursion a
 * world's single-frame enumeration exists to avoid. Re-asking one pick on demand
 * costs one round trip, and only when a player is actually mid-action.
 */
import { describe, expect, it } from "vitest";
import { Game, Piece, Player, Space } from "../engine/index.js";
import type { ElementJSON, GameOptions } from "../engine/index.js";
import { BoardSmithWorldEngine } from "./engine.js";
import { worldAction } from "./action.js";
import type { StoredPartition, WorldPartitionSource } from "./contract.js";

class Operative extends Piece<FleetGame> {}

class Ship extends Space<FleetGame> {
  /** Paid cargo hold, which is what a crew cap is derived from. */
  hold = 0;
}

class Dock extends Space<FleetGame> {}

class FleetGame extends Game<FleetGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Dock, Ship, Operative]);
  }

  ship(name: string): Ship {
    const found = this.first(Ship, name);
    if (!found) throw new Error(`the fixture needs ${name} resident`);
    return found;
  }
}

const FLEET = "fleet:1";

/** One spy per 350 units of hold, which is the game's own arithmetic and the
 *  reason a static per-hull number is not the answer: hold moves with upgrades. */
const crewCap = (ship: Ship): number => Math.floor(ship.hold / 350);

/**
 * Choose a ship, then choose a crew whose SIZE depends on that ship.
 *
 * The shape the issue is about, and the smallest one that has it: the cap is a
 * function of an argument bound by an earlier selection.
 */
const deploy = worldAction<FleetGame>("deploy")
  .prompt("Deploy operatives")
  .needs(() => [FLEET])
  .chooseFrom("ship", {
    prompt: "Ship",
    choices: ({ game }) => game.all(Ship).map((ship) => ship.name!),
  })
  .chooseFrom("crew", {
    prompt: "Operatives",
    choices: ({ game }) => game.all(Operative).map((one) => one.name!),
    multiSelect: ({ game, args }) => {
      const chosen = args.ship as string | undefined;
      if (chosen === undefined) return { min: 1 };
      return { min: 1, max: crewCap(game.ship(chosen)) };
    },
  })
  .execute(() => {});

function newGame(): FleetGame {
  return new FleetGame({ playerCount: 2, seed: "fleet", worldMode: true });
}

/** A dock holding two ships of different hold and two operatives. */
function genesis(): Map<string, StoredPartition> {
  const game = newGame();
  const dock = game.create(Dock, "dock");
  const dory = dock.create(Ship, "dory");
  dory.hold = 700;
  const skiff = dock.create(Ship, "skiff");
  skiff.hold = 350;
  dock.create(Operative, "ash");
  dock.create(Operative, "vale");
  return new Map([
    [FLEET, { parentId: game.id, json: JSON.parse(JSON.stringify(dock.toJSON())) as ElementJSON }],
  ]);
}

class Store implements WorldPartitionSource {
  constructor(private readonly stored: Map<string, StoredPartition>) {}
  async read(name: string): Promise<StoredPartition | undefined> {
    return this.stored.get(name);
  }
  forget(): void {}
}

const STAMP = { now: 1_700_000_000_000, presence: [1, 2] as readonly number[] };

function newEngine(): BoardSmithWorldEngine {
  return new BoardSmithWorldEngine({
    game: newGame(),
    seats: new Map([["player-a", 1]]),
    store: new Store(genesis()),
    actions: [deploy],
    view: () => [FLEET],
  });
}

/** An engine with the fleet resident, which is what an offer needs. */
async function warmEngine(): Promise<BoardSmithWorldEngine> {
  const engine = newEngine();
  await engine.hydrate([FLEET]);
  return engine;
}

describe("#378 — an unbounded cap is not a cap of null on the wire", () => {
  it("omits max entirely rather than sending a number JSON cannot carry", async () => {
    const engine = await warmEngine();

    const [offer] = await engine.offersFor("player-a", STAMP);
    const crew = offer!.selections.find((pick) => pick.name === "crew")!;

    // Through the wire and back, which is where `Infinity` became `null`.
    const wired = JSON.parse(JSON.stringify(crew)) as { multiSelect?: Record<string, unknown> };
    expect(wired.multiSelect).toEqual({ min: 1 });
    expect(Object.keys(wired.multiSelect!)).not.toContain("max");
  });

  it("still carries a cap the game DID give, unchanged", async () => {
    const engine = await warmEngine();

    const pick = await engine.resolvePick(
      "player-a",
      "deploy",
      "crew",
      { ship: "dory" },
      STAMP,
    );

    expect(JSON.parse(JSON.stringify(pick.multiSelect))).toEqual({ min: 1, max: 2 });
  });
});

describe("#378 — one pick, re-asked with the arguments bound so far", () => {
  it("resolves the cap from the ship the player has chosen", async () => {
    const engine = await warmEngine();

    const dory = await engine.resolvePick("player-a", "deploy", "crew", { ship: "dory" }, STAMP);
    const skiff = await engine.resolvePick("player-a", "deploy", "crew", { ship: "skiff" }, STAMP);

    expect(dory.multiSelect).toEqual({ min: 1, max: 2 });
    expect(skiff.multiSelect).toEqual({ min: 1, max: 1 });
  });

  it("answers the selection's candidates too, evaluated with the same args", async () => {
    const engine = await warmEngine();

    const pick = await engine.resolvePick("player-a", "deploy", "crew", { ship: "dory" }, STAMP);

    expect(pick.choices?.map((choice) => choice.value)).toEqual(["ash", "vale"]);
  });

  it("answers an ELEMENT selection's candidates in the same shape", async () => {
    const engine = await warmEngine();

    const pick = await engine.resolvePick("player-a", "deploy", "ship", {}, STAMP);

    expect(pick.choices?.map((choice) => choice.value)).toEqual(["dory", "skiff"]);
  });

  it("REFUSES an action this world does not offer, naming what it does", async () => {
    const engine = await warmEngine();

    await expect(
      engine.resolvePick("player-a", "nosuchverb", "crew", {}, STAMP),
    ).rejects.toThrow(/nosuchverb/);
  });

  it("REFUSES a selection the action does not have", async () => {
    const engine = await warmEngine();

    await expect(
      engine.resolvePick("player-a", "deploy", "nosuchpick", {}, STAMP),
    ).rejects.toThrow(/nosuchpick/);
  });

  it("says which partitions re-asking this pick still needs, before running it", async () => {
    // The declare-then-read split every other read path has: the child cannot
    // reach the parent's storage, so it names and is told. A cold engine has
    // nothing resident, so the pick's own round is what it asks for.
    const engine = newEngine();

    expect(engine.pickPartitions("player-a", "deploy", "crew", {}, STAMP.now)).toEqual([FLEET]);

    await engine.hydrate([FLEET]);
    expect(engine.pickPartitions("player-a", "deploy", "crew", {}, STAMP.now)).toEqual([]);
  });
});

/**
 * ShufflewickPub #384: AN OFFER IS A QUESTION, SO IT MAY NOT WRITE.
 *
 * `world.partition` is projected read-only for a DECLARATION (#219) and for
 * `world.view`, which additionally runs under `game.readingOnly`. The OFFER
 * path was projected by neither: `readOnlyFacilities` handed over the live root,
 * so a `choices`, `elements`, `display`, `disabled`, `prompt` or `condition`
 * callback -- all of which an offer runs -- could write to the world.
 *
 * It is the #152/#219 failure class on a surface those tickets did not cover,
 * and it is the worst-placed instance of it: an offer runs once per watcher per
 * refresh, on a path with no rollback and no checkpoint. The write showed up in
 * every watcher's next frame, was never made durable, and was reverted at the
 * next hibernation with nobody told.
 */
describe("#384 — an offer cannot write to the world it is describing", () => {
  /** Writes through the accessor a declaration is handed, from inside a
   *  callback the offer path runs. */
  const meddle = worldAction<FleetGame>("meddle")
    .needs(() => [FLEET])
    .chooseFrom("ship", {
      choices: ({ world }) => {
        (world.partition(FLEET) as Dock).name = "tampered";
        return ["dory"];
      },
    })
    .execute(() => {});

  /** The same write from a `disabled` predicate, which runs before any
   *  selection is reached at all. */
  const greying = worldAction<FleetGame>("greying")
    .needs(() => [FLEET])
    .disabled(({ world }) => {
      (world.partition(FLEET) as Dock).name = "tampered";
      return false;
    })
    .execute(() => {});

  async function engineFor(action: ReturnType<typeof worldAction>) {
    const engine = new BoardSmithWorldEngine({
      game: newGame(),
      seats: new Map([["player-a", 1]]),
      store: new Store(genesis()),
      actions: [action],
      view: () => [FLEET],
    });
    await engine.hydrate([FLEET]);
    return engine;
  }

  it("REFUSES a write from a candidate callback, and leaves the world alone", async () => {
    const engine = await engineFor(meddle);

    await expect(engine.offersFor("player-a", STAMP)).rejects.toThrow(
      /A declaration tried to write/,
    );
    expect(await engine.serializePartitions([FLEET])).toMatchObject({
      [FLEET]: expect.stringContaining('"dock"') as unknown as string,
    });
  });

  it("REFUSES a write from a disabled predicate, which runs before any pick", async () => {
    const engine = await engineFor(greying);

    await expect(engine.offersFor("player-a", STAMP)).rejects.toThrow(
      /A declaration tried to write/,
    );
  });

  it("REFUSES the same write through a re-asked pick (#378)", async () => {
    const engine = await engineFor(meddle);

    await expect(
      engine.resolvePick("player-a", "meddle", "ship", {}, STAMP),
    ).rejects.toThrow(/A declaration tried to write/);
  });

  /** Writes through `ctx.game`, which is the OTHER door into the same tree. */
  const meddleViaGame = worldAction<FleetGame>("meddleViaGame")
    .needs(() => [FLEET])
    .chooseFrom("ship", {
      choices: ({ game }) => {
        game.ship("dory").hold = 0;
        return ["dory"];
      },
    })
    .execute(() => {});

  /** And from an action-level `disabled` rule, which is evaluated last and was
   *  handed the live game by `getActionDisabledReason`. */
  const meddlingRule = worldAction<FleetGame>("meddlingRule")
    .needs(() => [FLEET])
    .disabled(({ game }) => {
      game.ship("dory").hold = 0;
      return false;
    })
    .execute(() => {});

  it("REFUSES a write through ctx.game, not only through world.partition", async () => {
    const engine = await engineFor(meddleViaGame);

    await expect(engine.offersFor("player-a", STAMP)).rejects.toThrow(
      /A declaration tried to write/,
    );
  });

  it("REFUSES a write from the action's own disabled rule", async () => {
    const engine = await engineFor(meddlingRule);

    await expect(engine.offersFor("player-a", STAMP)).rejects.toThrow(
      /A declaration tried to write/,
    );
  });

  it("still lets an offer READ everything its declaration named", async () => {
    // The half that must not break: an offer's whole job is to read the
    // resident tree, and a projection that refused reads would refuse offers.
    const engine = await engineFor(deploy);

    const [offer] = await engine.offersFor("player-a", STAMP);

    expect(offer!.selections.find((pick) => pick.name === "ship")!.choices).toHaveLength(2);
  });
});
