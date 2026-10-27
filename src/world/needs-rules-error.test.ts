// A throw out of a `.needs()` round reaches the player the way a throw out of
// `execute` does (#1492): a refusal written for them in their words, anything
// else as the rules-error sentence, with the thrown text only in dev (#47).
import { describe, expect, it, vi } from "vitest";
import { createInlinedPartitionStore, createWorldRunner } from "./runner.js";
import { Game, Player, PlayerFacingError, Space } from "../engine/index.js";
import type { ActionDefinition, GameOptions } from "../engine/index.js";
import { BoardSmithWorldEngine } from "./engine.js";
import { worldAction } from "./action.js";
import { WorldRefusal, worldRefusal } from "./refusals.js";
import { rulesErrorSentence } from "../engine/action/rules-error.js";
import { TEST_WORLD_ELEMENT_ID_KEY } from "../engine/element/world-element-id-key.test-helper.js";

// Lets a test run as a deployed isolate does, where no dev detail travels (#1045).
const devThrow = vi.hoisted(() => ({ enabled: true }));
vi.mock("../utils/dev.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/dev.js")>();
  return { ...actual, isDevThrowEnabled: () => devThrow.enabled };
});

class Room extends Space<NeedsWorld> {}
class NeedsWorld extends Game<NeedsWorld, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Room]);
  }
}

const throwing = (name: string, error: unknown): ActionDefinition =>
  worldAction<NeedsWorld>(name)
    .needs(() => {
      throw error;
    })
    .execute(() => {});

const actions = [
  throwing("crash", new Error("internal detail")),
  throwing("refuseInWords", new PlayerFacingError("That room is closed until dawn.")),
  throwing("refuseCoded", worldRefusal("undeclared-partition", "a coded refusal")),
];

function declared(name: string): Promise<unknown> {
  const engine = new BoardSmithWorldEngine({
    game: new NeedsWorld({ playerCount: 1, seed: "needs", worldMode: true, elementIdKey: TEST_WORLD_ELEMENT_ID_KEY }),
    seats: new Map([["p1", 1]]),
    store: createInlinedPartitionStore(),
    actions,
    view: () => [],
  });
  const runner = createWorldRunner(engine, createInlinedPartitionStore());
  return runner
    .declare({ name, args: {} }, "p1", {}, { kind: "arrival", now: 0 }, { declaredActivity: [], declaredNotices: [] })
    .then(() => expect.unreachable(`declare accepted "${name}", whose needs() throws`), (error: unknown) => error);
}

describe("#1492: a throw from a needs() round", () => {
  it("is the rules-error sentence alone in production", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    devThrow.enabled = false;
    try {
      const error = await declared("crash");
      expect(error).toBeInstanceOf(WorldRefusal);
      expect(error).toMatchObject({ code: "rules-error", owner: "game" });
      expect((error as Error).message).toBe(rulesErrorSentence("crash"));
    } finally {
      devThrow.enabled = true;
      vi.restoreAllMocks();
    }
  });

  it("logs what was thrown, and appends it to the sentence only in dev", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(((await declared("crash")) as Error).message).toBe(`${rulesErrorSentence("crash")} (internal detail)`);
      expect(logged.mock.calls.flat()).toContainEqual(expect.objectContaining({ message: "internal detail" }));
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("passes a PlayerFacingError through in the game's own words", async () => {
    devThrow.enabled = false;
    try {
      const error = await declared("refuseInWords");
      expect(error).toBeInstanceOf(PlayerFacingError);
      expect((error as Error).message).toBe("That room is closed until dawn.");
    } finally {
      devThrow.enabled = true;
    }
  });

  it("passes a WorldRefusal through with its own code", async () => {
    expect(await declared("refuseCoded")).toMatchObject({ code: "undeclared-partition" });
  });
});
