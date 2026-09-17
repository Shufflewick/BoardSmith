/**
 * BOARDSMITH #270, IN A WORLD: AN OFFER IS DECIDED BY ITS FIRST QUESTION.
 *
 * A world enumerates every selection of an action in ONE frame with `args: {}`,
 * and then drops the action when any required selection came back candidateless.
 * For a SECOND selection that is the wrong question: it was asked before the
 * first one was answered, so a dependent `choices` callback has nothing to
 * narrow by, and the natural `if (args.slot === undefined) return []` took the
 * whole verb out of the seat's offer -- silently, while every single-step verb
 * beside it was offered normally.
 *
 * The candidates for a later selection are re-asked with the args bound
 * (`resolvePick`, ShufflewickPub #378), so the panel gets the narrowed list the
 * moment the player answers the first question. Nothing was ever gained by
 * deciding the offer on a list nobody would see.
 *
 * What still drops an action is its FIRST question having no answer -- #187's
 * rule, unchanged: a pick that opens on nothing.
 */
import { describe, expect, it, vi } from "vitest";
import { Game, Piece, Player, Space } from "../engine/index.js";
import type { ElementJSON, GameOptions } from "../engine/index.js";
import { BoardSmithWorldEngine } from "./engine.js";
import { worldAction } from "./action.js";
import type { StoredPartition } from "./contract.js";
import { MapStore, offerStamp } from "./stored-world.test-helper.js";

class Item extends Piece<KitGame> {
  /** Which of the two equipment slots this item may go in. */
  slot = "";
}

class Pack extends Space<KitGame> {}

class KitGame extends Game<KitGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Pack, Item]);
  }
}

const KIT = "kit:1";
const STAMP = offerStamp(1_700_000_000_000);

/** The issue's own verb: a slot from a fixed pair, then an item OF that slot. */
const equip = worldAction<KitGame>("equip")
  .prompt("Equip an item")
  .needs(() => [KIT])
  .chooseFrom("slot", { prompt: "Slot", choices: () => ["head", "hand"] })
  .chooseFrom("item", {
    prompt: "Item",
    choices: ({ game, args }) => {
      const slot = args.slot as string | undefined;
      // NOTHING TO NARROW BY YET. The natural way to write it, and the whole
      // of the bug: this used to take `equip` off the seat's panel.
      if (slot === undefined) return [];
      return game.all(Item).filter((item) => item.slot === slot).map((item) => item.name!);
    },
  })
  .execute(() => {});

/** A single-step verb beside it, which was always offered correctly. */
const look = worldAction<KitGame>("look")
  .prompt("Look around")
  .needs(() => [KIT])
  .execute(() => {});

function newGame(): KitGame {
  return new KitGame({ playerCount: 1, seed: "kit", worldMode: true });
}

function genesis(): Map<string, StoredPartition> {
  const game = newGame();
  const pack = game.create(Pack, "pack");
  pack.create(Item, "helm", { slot: "head" });
  pack.create(Item, "sword", { slot: "hand" });
  return new Map([
    [KIT, { parentId: game.id, json: JSON.parse(JSON.stringify(pack.toJSON())) as ElementJSON }],
  ]);
}

async function warmEngine(actions = [look, equip]): Promise<BoardSmithWorldEngine> {
  const engine = new BoardSmithWorldEngine({
    game: newGame(),
    seats: new Map([["player-a", 1]]),
    store: new MapStore(genesis()),
    actions,
    view: () => [KIT],
  });
  await engine.hydrate([KIT]);
  return engine;
}

describe("#270 — a dependent choice does not take the verb out of the offer", () => {
  it("offers the two-step verb beside the single-step one", async () => {
    const engine = await warmEngine();

    const offers = await engine.offersFor("player-a", STAMP);

    expect(offers.map((offer) => offer.name).sort()).toEqual(["equip", "look"]);
  });

  it("answers the item pick from the slot the player chose, and nothing wider", async () => {
    const engine = await warmEngine();

    const forHead = await engine.resolvePick("player-a", "equip", "item", { slot: "head" }, STAMP);
    const forHand = await engine.resolvePick("player-a", "equip", "item", { slot: "hand" }, STAMP);

    expect(forHead.choices?.map((choice) => choice.value)).toEqual(["helm"]);
    expect(forHand.choices?.map((choice) => choice.value)).toEqual(["sword"]);
  });

  it("says nothing about a ONE-QUESTION verb it drops", async () => {
    // A world drops a verb whenever its one question has no candidate, which is
    // most of what a seat cannot do right now. Warning about it would fire for
    // every such verb on every offer and teach its reader to ignore the warning
    // that means something.
    const nothingHere = worldAction<KitGame>("nothingHere")
      .needs(() => [KIT])
      .chooseFrom("slot", { choices: () => [] as string[] })
      .execute(() => {});
    const engine = await warmEngine([look, nothingHere]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      expect((await engine.offersFor("player-a", STAMP)).map((o) => o.name)).toEqual(["look"]);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("still drops an action whose FIRST question has no answer", async () => {
    // #187's rule, and the half that stays: a pick that opens on nothing is a
    // button whose every press is refused.
    const nothingToWear = worldAction<KitGame>("nothingToWear")
      .needs(() => [KIT])
      .chooseFrom("slot", { choices: () => [] as string[] })
      .chooseFrom("item", { choices: () => ["helm"] })
      .execute(() => {});
    const engine = await warmEngine([look, nothingToWear]);

    const offers = await engine.offersFor("player-a", STAMP);

    expect(offers.map((offer) => offer.name)).toEqual(["look"]);
  });
});
