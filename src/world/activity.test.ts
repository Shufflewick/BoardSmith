/**
 * ShufflewickPub #383: HOW LONG THIS SEAT HAS BEEN GONE, ON THE PLATFORM'S WORD.
 *
 * A world with an inactivity rule -- warn at five days, start charging at
 * twenty, schedule a cancelable self-destruct after that -- needs one number:
 * the last instant this seat actually did something here. Every substitute the
 * r55 surface offered is wrong in a way that costs somebody their empire:
 *
 *   - `world.now` on a replayed scheduled event is the event's NOMINAL due, so
 *     a world drained a week late reads a week of silence that never happened.
 *   - `world.presence` is a socket, and a socket is not a person: a tab left
 *     open for a month reports activity nobody performed, and a player who
 *     plays daily from a phone that sleeps reports none.
 *   - A timestamp in the command's own args is the player's, and a deadline a
 *     player can postpone by typing a number is not a deadline.
 *
 * So it is the HOST's stamp, arriving the way `now` and `presence` arrive, and
 * durable the way neither of them is.
 *
 * TWO THINGS THIS FILE PINS THAT ARE EASY TO GET BACKWARDS:
 *
 * `at` IS THE WATERMARK AS OF ARRIVAL, and does not count the command carrying
 * it. A seat's own command that reported zero inactivity would be answering a
 * question nobody asked -- of course the player acting is here -- and would
 * make the prompt "your empire expires in 20 days" unwritable, because the
 * only road that can render it is a command by the seat it is about.
 *
 * `since` IS WHY A WORLD THAT PREDATES THIS FEATURE DOES NOT EXPIRE EVERYBODY.
 * A seat that has never been recorded reads `at: null`, and `inactiveSince`
 * falls back to the instant this world began RECORDING rather than to zero. An
 * epoch default would make every existing empire 56 years idle on the first
 * wake after the upgrade, and the self-destruct is exactly the feature that
 * would then run.
 */
import { describe, expect, it } from "vitest";
import { Game, Space, type GameElement, type GameOptions } from "../engine/index.js";
import { createWorld, type WorldRunnerOptions } from "./definition.js";
import { worldAction, worldClockAction } from "./action.js";
import type { SeatActivity, SeatActivityStamp, StoredPartition } from "./contract.js";

class Room extends Space<Demo> {}

class Demo extends Game<Demo> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Room]);
  }
}

/** Whatever the last dispatch was handed, so a test can read a facility that
 *  is otherwise only visible from inside a handler. */
let seen: { activity: SeatActivity | null } = { activity: null };

const act = worldAction<Demo>("act")
  .needs(() => ["hall"])
  .execute((_args, { world }) => {
    seen = { activity: world.activity };
  });

const reap = worldClockAction<Demo>("reap")
  .needs(() => ["hall"])
  .execute((_args, { world }) => {
    seen = { activity: world.activity };
  });

const definition = {
  gameClass: Demo,
  gameType: "demo",
  world: {
    maxPlayers: 2,
    actions: [act, reap],
    genesis: (game: Game) => ({ hall: game.create(Room, "hall") }) as Record<string, GameElement>,
    view: () => ["hall"],
  },
} as WorldRunnerOptions["definition"];

const SEATS = new Map([
  ["p1", 1],
  ["p2", 2],
]);

const DAY = 86_400_000;
const OPENED = 1_700_000_000_000;

function world() {
  return createWorld({ definition, seed: "activity", seats: SEATS }).runner;
}

/**
 * ONE DISPATCH, DECLARED AND APPLIED, on whichever road it belongs to.
 *
 * A host declares until the walk settles and then applies with the stamp; both
 * roads do it identically apart from who is acting, so the difference between
 * the cases below is the WATERMARK and nothing else.
 */
async function dispatch(
  runner: Awaited<ReturnType<typeof world>>,
  hall: StoredPartition,
  options: {
    name: string;
    player: string | null;
    at: number;
    activity: SeatActivityStamp | null;
    timing?: { due: number; missedCount: number };
  },
) {
  const command = { name: options.name, args: {} };
  await runner.declare(command, options.player, {}, options.at);
  await runner.declare(command, options.player, { hall }, options.at);
  return runner.apply({
    player: options.player,
    command,
    timing: options.timing ?? null,
    arrivedAt: options.at,
    allowance: { unkeyed: 0, keys: [], worldPending: 0 },
    presence: [] as readonly number[],
    activity: options.activity,
  });
}

describe("#383 — a seat's activity is the host's stamp, and it is durable", () => {
  /** A launched world and its one room, which every case starts from. */
  async function launched() {
    const runner = world();
    const genesis = await runner.genesis();
    return { runner, hall: genesis.partitions.hall! };
  }

  it("hands a seat's own command the watermark AS OF ARRIVAL, not the command itself", async () => {
    const { runner, hall } = await launched();
    const now = OPENED + 30 * DAY;

    await dispatch(runner, hall, {
      name: "act",
      player: "p1",
      at: now,
      activity: { seat: 1, at: OPENED + 9 * DAY, since: OPENED },
    });

    // Nine days ago, not "right now": the handler can therefore say how long
    // this player had been away when they came back.
    expect(seen.activity).toEqual({
      seat: 1,
      at: OPENED + 9 * DAY,
      since: OPENED,
      inactiveSince: OPENED + 9 * DAY,
    });
  });

  it("hands a seat-owned scheduled event that SEAT's watermark, so a deadline can be rechecked", async () => {
    const { runner, hall } = await launched();
    const due = OPENED + 20 * DAY;

    // The event is the world's to charge, and seat 2's to be ABOUT. The
    // self-destruct armed twenty days ago is checked against the watermark as
    // it fires, so a player who came back on day 19 keeps their empire.
    await dispatch(runner, hall, {
      name: "reap",
      player: null,
      at: due,
      timing: { due, missedCount: 0 },
      activity: { seat: 2, at: OPENED + 19 * DAY, since: OPENED },
    });

    expect(seen.activity?.seat).toBe(2);
    expect(seen.activity?.inactiveSince).toBe(OPENED + 19 * DAY);
  });

  it("hands the world's own clock event null, because nobody is being asked about", async () => {
    const { runner, hall } = await launched();
    const due = OPENED + DAY;

    await dispatch(runner, hall, {
      name: "reap",
      player: null,
      at: due,
      timing: { due, missedCount: 0 },
      activity: null,
    });

    expect(seen.activity).toBeNull();
  });

  it("measures a never-seen seat from when RECORDING began, never from the epoch", async () => {
    const { runner, hall } = await launched();
    // The world existed for years before it recorded activity; recording began
    // at the upgrade.
    const recordingBegan = OPENED + 400 * DAY;
    const now = recordingBegan + 2 * DAY;

    await dispatch(runner, hall, {
      name: "act",
      player: "p1",
      at: now,
      activity: { seat: 1, at: null, since: recordingBegan },
    });

    expect(seen.activity?.at).toBeNull();
    // Two days idle, not fifty-six years.
    expect(now - seen.activity!.inactiveSince).toBe(2 * DAY);
  });
});
