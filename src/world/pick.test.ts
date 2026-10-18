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
import type { ActionDefinition, ElementJSON, GameOptions } from "../engine/index.js";
import { BoardSmithWorldEngine } from "./engine.js";
import { worldAction, type WorldAction } from "./action.js";
import type { StoredPartition } from "./contract.js";
import { MapStore, offerStamp } from "./stored-world.test-helper.js";
import { STAMP as COMMAND_STAMP } from "./village.test-helper.js";
import { TEST_WORLD_ELEMENT_ID_KEY } from "../engine/element/world-element-id-key.test-helper.js";

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
  return new FleetGame({ playerCount: 2, seed: "fleet", worldMode: true, elementIdKey: TEST_WORLD_ELEMENT_ID_KEY });
}

/** A dock holding two ships of different hold and two operatives; `doryOwner`
 *  gives the dory to that seat. */
function genesis(doryOwner?: number): Map<string, StoredPartition> {
  const game = newGame();
  const dock = game.create(Dock, "dock");
  const dory = dock.create(Ship, "dory");
  dory.hold = 700;
  if (doryOwner !== undefined) dory.player = game.players[doryOwner - 1];
  const skiff = dock.create(Ship, "skiff");
  skiff.hold = 350;
  dock.create(Operative, "ash");
  dock.create(Operative, "vale");
  return new Map([
    [FLEET, { parentId: game.id, json: JSON.parse(JSON.stringify(dock.toJSON())) as ElementJSON }],
  ]);
}

const STAMP = offerStamp(1_700_000_000_000);

function newEngine(): BoardSmithWorldEngine {
  return new BoardSmithWorldEngine({
    game: newGame(),
    seats: new Map([["player-a", 1]]),
    store: new MapStore(genesis()),
    actions: [deploy],
    view: () => [FLEET],
  });
}

/** An engine running one action, with the fleet resident. */
async function engineFor(action: ActionDefinition, doryOwner?: number) {
  const engine = new BoardSmithWorldEngine({
    game: newGame(),
    seats: new Map([["player-a", 1]]),
    store: new MapStore(genesis(doryOwner)),
    actions: [action],
    view: () => [FLEET],
  });
  await engine.hydrate([FLEET]);
  return engine;
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

  it("REFUSES args carrying a key no pick declares, as the command itself would (#665)", async () => {
    const engine = await warmEngine();
    const refusal = {
      code: "undeclared-arg",
      message: "'deploy' was sent 'bribe', which is not one of its picks. It takes: ship, crew.",
    };

    expect(() =>
      engine.pickPartitions("player-a", "deploy", "crew", { ship: "dory", bribe: 100 }, STAMP.now),
    ).toThrow(expect.objectContaining(refusal));
    await expect(
      engine.resolvePick("player-a", "deploy", "crew", { ship: "dory", bribe: 100 }, STAMP),
    ).rejects.toMatchObject(refusal);
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

  it("REFUSES a write from a candidate callback, and leaves the world alone", async () => {
    const engine = await engineFor(meddle);

    await expect(engine.offersFor("player-a", STAMP)).rejects.toThrow(
      /A read-only view of this world tried to write/,
    );
    expect(await engine.serializePartitions([FLEET])).toMatchObject({
      [FLEET]: expect.stringContaining('"dock"') as unknown as string,
    });
  });

  it("REFUSES a write from a disabled predicate, which runs before any pick", async () => {
    const engine = await engineFor(greying);

    await expect(engine.offersFor("player-a", STAMP)).rejects.toThrow(
      /A read-only view of this world tried to write/,
    );
  });

  it("REFUSES the same write through a re-asked pick (#378)", async () => {
    const engine = await engineFor(meddle);

    await expect(
      engine.resolvePick("player-a", "meddle", "ship", {}, STAMP),
    ).rejects.toThrow(/A read-only view of this world tried to write/);
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
      /A read-only view of this world tried to write/,
    );
  });

  it("REFUSES a write from the action's own disabled rule", async () => {
    const engine = await engineFor(meddlingRule);

    await expect(engine.offersFor("player-a", STAMP)).rejects.toThrow(
      /A read-only view of this world tried to write/,
    );
  });

  /** #794: `ctx.player.game` is a third door into the same tree. */
  const viaPlayer = (player: Player) => (player.game as FleetGame).ship("dory");

  const meddlingCondition = worldAction<FleetGame>("meddlingCondition")
    .needs(() => [FLEET])
    .condition({
      "may meddle": ({ player }) => {
        viaPlayer(player).hold = 1;
        return true;
      },
    })
    .execute(() => {});

  const meddlingPick = worldAction<FleetGame>("meddlingPick")
    .needs(() => [FLEET])
    .chooseFrom("ship", {
      choices: ({ player }) => {
        viaPlayer(player).hold = 1;
        return ["dory"];
      },
    })
    .execute(() => {});

  const meddlingQuote = worldAction<FleetGame>("meddlingQuote")
    .needs(() => [FLEET])
    .chooseFrom("ship", { choices: () => ["dory"] })
    .quote((_args, { player }) => {
      viaPlayer(player).hold = 1;
      return null;
    })
    .execute(() => {});

  it("REFUSES a write through ctx.player.game from a condition (#794)", async () => {
    const engine = await engineFor(meddlingCondition);

    await expect(engine.offersFor("player-a", STAMP)).rejects.toThrow(
      /A read-only view of this world tried to write/,
    );
    expect(await engine.serializePartitions([FLEET])).toMatchObject({
      [FLEET]: expect.stringContaining('"hold":700') as unknown as string,
    });
  });

  it("REFUSES a write through ctx.player.game from a pick's choices (#794)", async () => {
    const engine = await engineFor(meddlingPick);

    await expect(engine.offersFor("player-a", STAMP)).rejects.toThrow(
      /A read-only view of this world tried to write/,
    );
    await expect(
      engine.resolvePick("player-a", "meddlingPick", "ship", {}, STAMP),
    ).rejects.toThrow(/A read-only view of this world tried to write/);
  });

  it("REFUSES a write through ctx.player.game from a quote (#794)", async () => {
    const engine = await engineFor(meddlingQuote);

    await expect(
      engine.resolveQuote("player-a", "meddlingQuote", { ship: "dory" }, STAMP),
    ).rejects.toThrow(/A read-only view of this world tried to write/);
    expect(await engine.serializePartitions([FLEET])).toMatchObject({
      [FLEET]: expect.stringContaining('"hold":700') as unknown as string,
    });
  });

  /** Every way a callback asks "is this mine", against a seat that owns the dory:
   *  the projected player must still be the player the projected tree names. */
  const ownedBy = (game: FleetGame, player: Player): string[] => {
    const dory = game.first(Ship, "dory")!;
    if (dory.player !== player) throw new Error("the dory's player is not ctx.player");
    if (player.my(Ship) !== dory) throw new Error("player.my(Ship) is not the dory");
    const mine = player.allMy(Ship).map((ship) => ship.name!);
    const byFinder = game.all(Ship, { player }).map((ship) => ship.name!);
    const byPredicate = game.all(Ship, (ship) => ship.player === player).map((ship) => ship.name!);
    if (byFinder.join() !== mine.join() || byPredicate.join() !== mine.join()) {
      throw new Error(`owner reads disagree: ${mine.join()} / ${byFinder.join()} / ${byPredicate.join()}`);
    }
    return mine;
  };

  const sailMine = worldAction<FleetGame>("sailMine")
    .needs(() => [FLEET])
    .condition({ "owns a ship": ({ game, player }) => ownedBy(game, player).length > 0 })
    .chooseFrom("ship", { choices: ({ game, player }) => ownedBy(game, player) })
    .quote((_args, { game, player }) => [`You own ${ownedBy(game, player).join()}.`])
    .execute(() => {});

  it("still matches an owned element to ctx.player in an offer (#794)", async () => {
    const engine = await engineFor(sailMine, 1);

    const [offer] = await engine.offersFor("player-a", STAMP);

    expect(offer!.name).toBe("sailMine");
    expect(offer!.selections[0]!.choices?.map((choice) => choice.value)).toEqual(["dory"]);
  });

  it("still matches an owned element to ctx.player in a pick and a quote (#794)", async () => {
    const engine = await engineFor(sailMine, 1);

    const pick = await engine.resolvePick("player-a", "sailMine", "ship", {}, STAMP);
    const quote = await engine.resolveQuote("player-a", "sailMine", { ship: "dory" }, STAMP);

    expect(pick.choices?.map((choice) => choice.value)).toEqual(["dory"]);
    expect(quote).toEqual(["You own dory."]);
  });

  it("still lets an offer READ everything its declaration named", async () => {
    // The half that must not break: an offer's whole job is to read the
    // resident tree, and a projection that refused reads would refuse offers.
    const engine = await engineFor(deploy);

    const [offer] = await engine.offersFor("player-a", STAMP);

    expect(offer!.selections.find((pick) => pick.name === "ship")!.choices).toHaveLength(2);
  });
});

/**
 * #393: A CHOICE GONE STALE IS REFUSED IN THE GAME'S WORDS, OR IN PLAIN ONES.
 *
 * A world's choices go stale while a player is choosing: another seat took the
 * offer, the ship sailed. The refusal used to be the engine's own text, raw
 * values and a list of the valid ones, and the host showed it to the player.
 * `unavailable` lets the game write that sentence, with the world in scope; a
 * game that does not gets a plain one that says what to do.
 */
describe("#393 — a submitted choice that is no longer listed", () => {
  const board = (unavailable?: Parameters<WorldAction<FleetGame>["chooseFrom"]>[1]["unavailable"]) =>
    worldAction<FleetGame>("board")
      .needs(() => [FLEET])
      .chooseFrom("ship", {
        choices: ({ game }) => game.all(Ship).map((ship) => ship.name!),
        unavailable,
      })
      .execute(() => {});

  it("refuses in plain words when the game says nothing", async () => {
    const engine = await engineFor(board());

    await expect(
      engine.applyCommand("player-a", { name: "board", args: { ship: "galleon" } }, COMMAND_STAMP),
    ).rejects.toThrow(
      /^That choice is no longer available\. Things changed while you were choosing, so please choose again\.$/,
    );
  });

  it("refuses in the game's own words, with the world in scope", async () => {
    const engine = await engineFor(
      board((value, { world, player }) => {
        const dock = world.partition(FLEET) as Dock;
        return `The ${String(value)} has left ${dock.name} before seat ${player.seat} could board. Pick another ship.`;
      }),
    );

    await expect(
      engine.applyCommand("player-a", { name: "board", args: { ship: "galleon" } }, COMMAND_STAMP),
    ).rejects.toThrow(/^The galleon has left dock before seat 1 could board\. Pick another ship\.$/);
  });
});

/**
 * #798: A PICK OR A QUOTE ANSWERS ONLY FOR AN ACTION THE SEAT IS OFFERED.
 *
 * `offersFor` drops an action whose condition is false; a re-asked pick or a
 * quote used to answer for it anyway, so a seat could read candidates the
 * offer never showed it. A disabled action is still offered (greyed, with its
 * picks), so its reads still answer, exactly as the offer does.
 */
describe("#798 — a read answers only for an offered action", () => {
  const hidden = worldAction<FleetGame>("hidden")
    .needs(() => [FLEET])
    .condition({ "never offered": () => false })
    .chooseFrom("ship", { choices: ({ game }) => game.all(Ship).map((ship) => ship.name!) })
    .quote(() => ["secret price"])
    .execute(() => {});

  const greyed = worldAction<FleetGame>("greyed")
    .needs(() => [FLEET])
    .disabled(() => "The dock is closed.")
    .chooseFrom("ship", { choices: ({ game }) => game.all(Ship).map((ship) => ship.name!) })
    .quote(() => ["closed price"])
    .execute(() => {});

  const notOffered = { code: "unknown-command", message: expect.stringContaining('"hidden"') as unknown };

  it("REFUSES a pick and a quote on an action whose condition is false", async () => {
    const engine = await engineFor(hidden);

    expect(await engine.offersFor("player-a", STAMP)).toEqual([]);
    await expect(
      engine.resolvePick("player-a", "hidden", "ship", {}, STAMP),
    ).rejects.toMatchObject(notOffered);
    await expect(
      engine.resolveQuote("player-a", "hidden", { ship: "dory" }, STAMP),
    ).rejects.toMatchObject(notOffered);
  });

  /** Offered only to seat 1, and only once round zero has loaded a ship. */
  const captains = worldAction<FleetGame>("captains")
    .needs(() => [FLEET])
    .condition({ "seat 1 with a ship": ({ game, player }) => player.seat === 1 && game.all(Ship).length > 0 })
    .chooseFrom("ship", { choices: ({ game }) => game.all(Ship).map((ship) => ship.name!) })
    .quote(() => ["captain's price"])
    .execute(() => {});

  it("decides by the asking seat, against what round zero loaded", async () => {
    // COLD, so the fleet arrives only through the read's own round zero.
    const engine = new BoardSmithWorldEngine({
      game: newGame(),
      seats: new Map([["player-a", 1], ["player-b", 2]]),
      store: new MapStore(genesis()),
      actions: [captains],
      view: () => [FLEET],
    });
    const refused = { code: "unknown-command", message: expect.stringContaining('"captains"') as unknown };

    const pick = await engine.resolvePick("player-a", "captains", "ship", {}, STAMP);
    const quote = await engine.resolveQuote("player-a", "captains", { ship: "dory" }, STAMP);

    expect(pick.choices?.map((choice) => choice.value)).toEqual(["dory", "skiff"]);
    expect(quote).toEqual(["captain's price"]);
    await expect(
      engine.resolvePick("player-b", "captains", "ship", {}, STAMP),
    ).rejects.toMatchObject(refused);
    await expect(
      engine.resolveQuote("player-b", "captains", { ship: "dory" }, STAMP),
    ).rejects.toMatchObject(refused);
  });

  it("still answers a disabled action, which the offer shows greyed with its picks", async () => {
    const engine = await engineFor(greyed);

    const [offer] = await engine.offersFor("player-a", STAMP);
    const pick = await engine.resolvePick("player-a", "greyed", "ship", {}, STAMP);
    const quote = await engine.resolveQuote("player-a", "greyed", { ship: "dory" }, STAMP);

    expect(offer!.disabled).toBe("The dock is closed.");
    expect(pick.choices?.map((choice) => choice.value)).toEqual(
      offer!.selections[0]!.choices?.map((choice) => choice.value),
    );
    expect(quote).toEqual(["closed price"]);
  });
});

/**
 * #1129: A COMMAND FOR AN ACTION WHOSE CONDITION IS FALSE IS REFUSED BEFORE ITS
 * DISABLED RULE RUNS, as the offer drops it before asking. The rule is written
 * on the understanding that the condition guards it, so it may read what only
 * a true condition makes safe to read.
 */
describe("#1129 — a command checks the condition before the disabled rule", () => {
  it("refuses as unavailable and never runs the disabled rule", async () => {
    const calls: string[] = [];
    const guarded = worldAction<FleetGame>("guarded")
      .needs(() => [FLEET])
      .condition({ "never offered": () => (calls.push("condition"), false) })
      .disabled(() => {
        calls.push("disabled");
        throw new Error("the disabled rule ran without its condition");
      })
      .execute(() => {});
    const engine = await engineFor(guarded);

    await expect(
      engine.applyCommand("player-a", { name: "guarded", args: {} }, COMMAND_STAMP),
    ).rejects.toThrow(/^Action is not available$/);
    expect(calls).toEqual(["condition"]);
  });
});
