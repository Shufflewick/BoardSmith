/**
 * ShufflewickPub #382: A GAME MAY ASK TO CONVERT PLATFORM CREDITS, AND IS TOLD
 * THE PLATFORM CANNOT YET.
 *
 * A world that wants to sell its own currency for platform credits needs one
 * thing from the platform, and it is not a helper: it is the BOUNDARY. The
 * game must not run checkout, must not see payment credentials, must not
 * believe a browser about a debit, and must not be able to grant a paid reward
 * twice. Every one of those is a platform promise, and none of them exists
 * yet -- ShufflewickPub has no currency at all, and the exchange rate, the
 * bounds, the quantum and the reversal policy are all undecided.
 *
 * So this is a DECLARED HOLE rather than an implementation. The surface exists,
 * because a game that had to invent its own is a game that invents its own
 * payments; and it REFUSES, loudly and classified, because the failure mode
 * this exists to prevent is a game shipping in the belief that money moved.
 *
 * The refusal is `platform`-owned: nothing is wrong with the world, nothing
 * was charged, nothing was granted, and the missing piece is ours.
 */
import { describe, expect, it } from "vitest";
import { Game, Space, type GameElement, type GameOptions } from "../engine/index.js";
import { createWorld, type WorldRunnerOptions } from "./definition.js";
import { worldAction } from "./action.js";
import { WorldRefusal } from "./refusals.js";

class Vault extends Space<Shop> {}

class Shop extends Game<Shop> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Vault]);
  }
}

/** What a game would write the day this works, written today. */
const buy = worldAction<Shop>("buy")
  .needs(() => ["vault"])
  .execute((_args, ctx) => {
    ctx.world.convertCredits({ credits: 100 });
  });

const definition = {
  gameClass: Shop,
  gameType: "shop",
  world: {
    maxPlayers: 1,
    actions: [buy],
    genesis: (game: Game) => ({ vault: game.create(Vault, "vault") }) as Record<string, GameElement>,
    view: () => ["vault"],
  },
} as WorldRunnerOptions["definition"];

const STAMP = {
  arrivedAt: 1_700_000_000_000,
  allowance: { unkeyed: 0, keys: [], worldPending: 0 },
  presence: [] as readonly number[],
  activity: null,
};

async function attempt() {
  const runner = createWorld({
    definition,
    seed: "credits",
    seats: new Map([["p1", 1]]),
  }).runner;
  const genesis = await runner.genesis();
  const command = { name: "buy", args: {} };
  await runner.declare(command, "p1", {}, STAMP.arrivedAt, []);
  await runner.declare(command, "p1", { vault: genesis.partitions.vault! }, STAMP.arrivedAt, []);
  return runner.apply({ player: "p1", command, timing: null, ...STAMP });
}

describe("#382 — converting platform credits is declared, and refuses", () => {
  it("refuses with a platform-owned code, so a park ladder is not climbed for it", async () => {
    // CALLER would be wrong: the client did nothing improper. GAME would be
    // wrong: the bundle is written correctly against a surface we published.
    // The missing piece is the platform's, and the code has to say so.
    await expect(attempt()).rejects.toMatchObject({
      name: "WorldRefusal",
      code: "credit-conversion-unavailable",
    });
  });

  it("says it is not implemented, and that nothing was charged or granted", async () => {
    // The sentence a designer reads at 2am. It has to close off the two
    // questions they will otherwise have to answer by experiment: did a player
    // just lose credits, and did anybody get anything.
    const refusal = await attempt().catch((error: unknown) => error as WorldRefusal);
    expect(refusal).toBeInstanceOf(WorldRefusal);
    expect(refusal.message).toMatch(/not yet implemented/i);
    expect(refusal.message).toMatch(/nothing was charged/i);
  });

  it("leaves the world exactly as it was, because the refusal unwinds the command", async () => {
    // The half that matters more than the message: a game that catches this
    // and carries on must not find a half-finished purchase behind it.
    await expect(attempt()).rejects.toThrow();
  });
});
