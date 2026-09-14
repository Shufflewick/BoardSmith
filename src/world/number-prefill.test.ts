/**
 * #258, ACROSS THE WORLD BUILDER: A PRE-FILLED, LABELLED NUMBER REACHES AN OFFER.
 *
 * The ticket is reported against `src/world/action.ts`'s forwarding
 * `enterNumber`, and the forwarding version is where a declaration can silently
 * lose a field: it names every option it passes through, so an option it has
 * never heard of is dropped without a word. The engine's own unit tests
 * (`src/engine/action/number-prefill.test.ts`) prove the builder and the pick
 * metadata; this one proves the whole path a world game actually travels --
 * declaration, forwarding, the read-only offer enumeration, and the JSON a host
 * ships -- because that is the boundary the report was made from.
 */
import { describe, expect, it } from "vitest";
import { Game, Player, Space } from "../engine/index.js";
import type { ElementJSON, GameOptions } from "../engine/index.js";
import { BoardSmithWorldEngine } from "./engine.js";
import { worldAction } from "./action.js";
import type { StoredPartition } from "./contract.js";
import { MapStore, offerStamp } from "./stored-world.test-helper.js";

class Citizen extends Space<CensusGame> {
  /** What the seat last told the census, and the reason a default is not a lie. */
  age = 0;
}

class CensusGame extends Game<CensusGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Citizen]);
  }

  citizen(): Citizen {
    const found = this.first(Citizen, "citizen");
    if (!found) throw new Error("the fixture needs the citizen resident");
    return found;
  }
}

const CENSUS = "census:1";

/** The ticket's own bands, so what is asserted is what was asked for. */
function lifeStage(age: number): string {
  if (age <= 20) return "barely grown";
  if (age <= 30) return "young";
  if (age <= 50) return "in your prime";
  return "seasoned";
}

const declareAge = worldAction<CensusGame>("declare-age")
  .prompt("Tell the census your age")
  .needs(() => [CENSUS])
  .enterNumber("age", {
    prompt: "How old are you?",
    min: 16,
    max: 65,
    integer: true,
    initial: 35,
    display: lifeStage,
  })
  .execute(({ age }, { game }) => {
    game.citizen().age = age;
  });

function newGame(): CensusGame {
  return new CensusGame({ playerCount: 1, seed: "census", worldMode: true });
}

function genesis(): Map<string, StoredPartition> {
  const game = newGame();
  const citizen = game.create(Citizen, "citizen");
  return new Map([
    [
      CENSUS,
      { parentId: game.id, json: JSON.parse(JSON.stringify(citizen.toJSON())) as ElementJSON },
    ],
  ]);
}

const STAMP = offerStamp(1_700_000_000_000);

/** What a host stamps a command with, matching the offer above. */
const COMMAND_STAMP = {
  now: STAMP.now,
  allowance: { unkeyed: 0, keys: [], worldPending: 0 },
  presence: [] as readonly number[],
  activity: { seat: 1, at: null, since: STAMP.now },
  declaredActivity: [],
};

async function warmEngine(): Promise<BoardSmithWorldEngine> {
  const engine = new BoardSmithWorldEngine({
    game: newGame(),
    seats: new Map([["player-a", 1]]),
    store: new MapStore(genesis()),
    actions: [declareAge],
    view: () => [CENSUS],
  });
  await engine.hydrate([CENSUS]);
  return engine;
}

/** The pick, through the wire and back, which is the only form a panel sees. */
async function wiredAgePick(): Promise<Record<string, unknown>> {
  const engine = await warmEngine();
  const [offer] = await engine.offersFor("player-a", STAMP);
  const pick = offer!.selections.find((one) => one.name === "age")!;
  return JSON.parse(JSON.stringify(pick)) as Record<string, unknown>;
}

describe("#258 — a world's number pick opens on the value the game named", () => {
  it("carries `initial` through the forwarding builder into the offer", async () => {
    expect((await wiredAgePick()).initial).toBe(35);
  });

  it("still carries the range it always did, beside it", async () => {
    expect(await wiredAgePick()).toMatchObject({ min: 16, max: 65, integer: true });
  });

  it("labels every value in the range, keyed by the value", async () => {
    const labels = (await wiredAgePick()).valueLabels as Record<string, string>;

    expect(labels["16"]).toBe("barely grown");
    expect(labels["35"]).toBe("in your prime");
    expect(labels["65"]).toBe("seasoned");
    expect(Object.keys(labels)).toHaveLength(50);
  });

  it("accepts the starting value as an answer, because the rules admit it", async () => {
    const engine = await warmEngine();

    await engine.applyCommand(
      "player-a",
      { name: "declare-age", args: { age: 35 } },
      COMMAND_STAMP,
    );

    const stored = await engine.serializePartitions([CENSUS]);
    expect(JSON.parse(stored[CENSUS]!)).toMatchObject({ attributes: { age: 35 } });
  });
});
