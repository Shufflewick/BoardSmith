/**
 * #248: A DRAFT IS QUOTED BEFORE IT IS PAID FOR.
 *
 * A world action that charges for a number -- five Essentia a week, a boost that
 * ends seven days per week from now -- could not tell the player the price of
 * what they had typed. The offer is enumerated with nothing bound, so the price
 * of two weeks is not in it; `validate` runs at submit, which is after the
 * money; and the receipt an `emit` writes is a sentence about a purchase that
 * has already happened. The standard panel therefore read
 *
 *   Weeks · 5 Essentia per week (skip for one week; zero adds no time)
 *
 * with a 2 in the field and no total anywhere, and the game's own pre-commit
 * assertion failed rather than submitting blindly.
 *
 * `.quote()` is the missing verb: ONE read, over the args the player has drafted
 * so far, answered under the same read-only facilities an offer runs under, and
 * re-answered every time the draft moves. Declaring it also takes the auto-commit
 * away -- a price nobody can see before they pay it is the whole defect, so the
 * last pick stops being the purchase and a confirmation becomes the purchase.
 *
 * WHAT THIS FILE HOLDS, and what each case is really about:
 *
 *   THE ARITHMETIC IS THE GAME'S. Two weeks is ten Essentia because the game
 *     says so, not because a panel multiplied something. So the quote is a
 *     function of the DRAFT, evaluated inside the bundle.
 *   OMITTED IS NOT ZERO. An absent `weeks` is the game's own default of one and
 *     zero is a real, chargeable, time-adding-nothing answer. The quote sees the
 *     difference, because `undefined` and `0` reach it as themselves.
 *   NOTHING MOVES WHILE DRAFTING. Quoting is a read: the owner's bytes are
 *     identical afterwards, and a quote that tries to write is refused rather
 *     than silently reverted at the next hibernation (#219/#384's failure class).
 */
import { describe, expect, it } from "vitest";
import { Game, Player, Space } from "../engine/index.js";
import type { ElementJSON, GameOptions } from "../engine/index.js";
import { BoardSmithWorldEngine } from "./engine.js";
import { assertWorldAction, worldAction, worldClockAction } from "./action.js";
import type { StoredPartition, WorldPartitionSource } from "./contract.js";

class Empire extends Space<BoostGame> {
  /** Genuinely earned, and the reason a preview may not be a guess. */
  essentia = 16;
  /** When the boost this seat already paid for runs out, or 0 for none. */
  boostUntil = 0;
}

class BoostGame extends Game<BoostGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Empire]);
  }

  empire(): Empire {
    const found = this.first(Empire, "empire");
    if (!found) throw new Error("the fixture needs the empire resident");
    return found;
  }
}

const EMPIRE = "empire:1";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PER_WEEK = 5;

/** The operation's own rule, in ONE place, so the quote and the purchase cannot
 *  disagree about it: an omitted quantity is one week, and zero is zero. */
const weeksOf = (weeks: number | undefined): number => (weeks === undefined ? 1 : weeks);

/** Extending from `max(now, saved expiry)`, which is what makes a saturated
 *  expiry additive rather than a reset. */
const expiryAfter = (from: number, saved: number, weeks: number): number =>
  Math.max(from, saved) + weeks * WEEK_MS;

const boost = worldAction<BoostGame>("boost")
  .prompt("Purchase boost")
  .needs(() => [EMPIRE])
  .enterNumber("weeks", {
    prompt: "Weeks",
    min: 0,
    integer: true,
    optional: "skip for one week",
  })
  .chooseFrom("resource", { prompt: "Resource", choices: ["food", "storage"] })
  .quote(({ weeks, resource }, { game, world }) => {
    // NOTHING TO SAY UNTIL THE PLAYER HAS SAID WHAT THEY ARE BUYING. A quote
    // reaches this with as little bound as the player has bound.
    if (resource === undefined) return null;
    const paid = weeksOf(weeks);
    const empire = game.empire();
    const ends = expiryAfter(world.now, empire.boostUntil, paid);
    return [
      `${paid * PER_WEEK} Essentia`,
      paid === 0
        ? "adds no time"
        : `${resource} boosted until ${new Date(ends).toISOString().slice(0, 10)}`,
    ];
  })
  .execute(({ weeks, resource }, { game, world }) => {
    const paid = weeksOf(weeks);
    const empire = game.empire();
    empire.essentia -= paid * PER_WEEK;
    empire.boostUntil = expiryAfter(world.now, empire.boostUntil, paid);
    world.emit(EMPIRE, { resource, weeks: paid }, `Boosted ${resource} for ${paid} week(s).`);
  });

/** The same action without the quote, which is what every world action was
 *  before this and what most of them stay. */
const plainBoost = worldAction<BoostGame>("plain")
  .needs(() => [EMPIRE])
  .enterNumber("weeks", { min: 0, integer: true, optional: true })
  .execute(() => {});

function newGame(): BoostGame {
  return new BoostGame({ playerCount: 2, seed: "boost", worldMode: true });
}

function genesis(boostUntil = 0): Map<string, StoredPartition> {
  const game = newGame();
  const empire = game.create(Empire, "empire");
  empire.essentia = 16;
  empire.boostUntil = boostUntil;
  return new Map([
    [
      EMPIRE,
      { parentId: game.id, json: JSON.parse(JSON.stringify(empire.toJSON())) as ElementJSON },
    ],
  ]);
}

class Store implements WorldPartitionSource {
  constructor(private readonly stored: Map<string, StoredPartition>) {}
  async read(name: string): Promise<StoredPartition | undefined> {
    return this.stored.get(name);
  }
  forget(): void {}
}

/** A Monday, so the quoted dates below are readable rather than derived. */
const NOW = Date.UTC(2026, 8, 14);

const STAMP = {
  now: NOW,
  presence: [1] as readonly number[],
  activity: { seat: 1, at: null, since: NOW },
};

function newEngine(actions = [boost, plainBoost]): BoardSmithWorldEngine {
  return new BoardSmithWorldEngine({
    game: newGame(),
    seats: new Map([["player-a", 1]]),
    store: new Store(genesis()),
    actions,
    view: () => [EMPIRE],
  });
}

async function warmEngine(): Promise<BoardSmithWorldEngine> {
  const engine = newEngine();
  await engine.hydrate([EMPIRE]);
  return engine;
}

describe("a draft is quoted by the game that will charge for it", () => {
  it("prices the number the player has typed but not yet submitted", async () => {
    const engine = await warmEngine();

    const quote = await engine.resolveQuote(
      "player-a",
      "boost",
      { resource: "storage", weeks: 2 },
      STAMP,
    );

    // The total the reporter's bar could not show: two weeks at five.
    expect(quote).toEqual(["10 Essentia", "storage boosted until 2026-09-28"]);
  });

  it("re-prices when the draft moves, because it is a function of the draft", async () => {
    const engine = await warmEngine();

    const two = await engine.resolveQuote("player-a", "boost", { resource: "storage", weeks: 2 }, STAMP);
    const three = await engine.resolveQuote("player-a", "boost", { resource: "storage", weeks: 3 }, STAMP);

    expect(two![0]).toBe("10 Essentia");
    expect(three![0]).toBe("15 Essentia");
  });

  it("quotes an OMITTED quantity as the game's own default, not as zero", async () => {
    const engine = await warmEngine();

    const quote = await engine.resolveQuote("player-a", "boost", { resource: "storage" }, STAMP);

    expect(quote).toEqual(["5 Essentia", "storage boosted until 2026-09-21"]);
  });

  it("quotes ZERO as zero, which is a different answer from omitting it", async () => {
    const engine = await warmEngine();

    const quote = await engine.resolveQuote(
      "player-a",
      "boost",
      { resource: "storage", weeks: 0 },
      STAMP,
    );

    expect(quote).toEqual(["0 Essentia", "adds no time"]);
  });

  it("extends a saturated expiry from the saved one, so the preview is truthful", async () => {
    // A boost already paid for, running two weeks out.
    const warmed = new BoardSmithWorldEngine({
      game: newGame(),
      seats: new Map([["player-a", 1]]),
      store: new Store(genesis(NOW + 2 * WEEK_MS)),
      actions: [boost, plainBoost],
      view: () => [EMPIRE],
    });
    await warmed.hydrate([EMPIRE]);

    const quote = await warmed.resolveQuote(
      "player-a",
      "boost",
      { resource: "storage", weeks: 1 },
      STAMP,
    );

    // Three weeks out, not one: the saved expiry is the basis.
    expect(quote).toEqual(["5 Essentia", "storage boosted until 2026-10-05"]);
  });

  it("says nothing at all while the draft has nothing to price", async () => {
    const engine = await warmEngine();

    expect(await engine.resolveQuote("player-a", "boost", {}, STAMP)).toBeNull();
  });

  it("tells a seat's offer that this action quotes, so the panel knows to ask", async () => {
    const engine = await warmEngine();

    const offers = await engine.offersFor("player-a", STAMP);

    expect(offers.find((offer) => offer.name === "boost")!.quote).toBe(true);
    expect(offers.find((offer) => offer.name === "plain")!.quote).toBeUndefined();
  });

  it("says which partitions a quote needs resident before it can be answered", async () => {
    const engine = newEngine();

    expect(engine.quotePartitions("player-a", "boost", { resource: "storage" }, NOW)).toEqual([
      EMPIRE,
    ]);

    await engine.hydrate([EMPIRE]);
    expect(engine.quotePartitions("player-a", "boost", { resource: "storage" }, NOW)).toEqual([]);
  });

  it("REFUSES to quote an action that declares no quote, rather than inventing one", async () => {
    const engine = await warmEngine();

    await expect(
      engine.resolveQuote("player-a", "plain", { weeks: 2 }, STAMP),
    ).rejects.toThrow(/"plain"/);
  });

  it("REFUSES an action this world does not offer at all", async () => {
    const engine = await warmEngine();

    await expect(engine.resolveQuote("player-a", "nosuchverb", {}, STAMP)).rejects.toThrow(
      /nosuchverb/,
    );
  });
});

describe("quoting a draft changes nothing about the world", () => {
  it("leaves the owner's bytes identical, so drafting is not a transaction", async () => {
    const engine = await warmEngine();
    const before = await engine.serializePartitions([EMPIRE]);

    await engine.resolveQuote("player-a", "boost", { resource: "storage", weeks: 2 }, STAMP);
    await engine.resolveQuote("player-a", "boost", { resource: "storage", weeks: 9 }, STAMP);

    const after = await engine.serializePartitions([EMPIRE]);
    expect(after).toEqual(before);
    // The reporter's own check: sixteen genuinely earned Essentia, untouched.
    expect(after[EMPIRE]).toContain('"essentia":16');
    expect(after[EMPIRE]).toContain('"boostUntil":0');
  });

  it("REFUSES a quote that writes, rather than reverting it at the next hibernation", async () => {
    const meddling = worldAction<BoostGame>("meddle")
      .needs(() => [EMPIRE])
      .chooseFrom("resource", { choices: ["food"] })
      .quote((_args, { world }) => {
        (world.partition(EMPIRE) as Empire).essentia = 9999;
        return ["free"];
      })
      .execute(() => {});
    const engine = newEngine([meddling]);
    await engine.hydrate([EMPIRE]);

    await expect(
      engine.resolveQuote("player-a", "meddle", { resource: "food" }, STAMP),
    ).rejects.toThrow(/read/i);
  });
});

describe("a quote belongs to a seat's own action", () => {
  it("REFUSES one declared on the world's own clock, which nobody is watching", () => {
    const tick = worldClockAction<BoostGame>("tick")
      .needs(() => [EMPIRE])
      .execute(() => {});
    // Hand-built, because the clock's builder offers no `.quote()` at all: the
    // refusal is the enforcement, and the missing method is the signpost.
    (tick.world as { quote?: unknown }).quote = () => ["nobody sees this"];

    expect(() => assertWorldAction(tick)).toThrow(/clock/i);
  });
});
