/**
 * ShufflewickPub #521, BoardSmith #420: A NOTICE LEFT FOR A SEAT, WITHOUT
 * LOADING THAT SEAT'S PARTITION.
 *
 * Before this, a command could reach another seat's state only by declaring
 * that seat's partition -- a whole partition loaded and written back to add one
 * line. A clan alert to forty members declared forty partitions, so sotf queued
 * alerts on one world partition and copied them out in a clock sweep that took
 * about eighty minutes to reach everybody.
 *
 * The notice box is the platform's, not the game's: a small, bounded list per
 * seat, kept by the host beside the partitions. What this file pins:
 *
 *   SENDING COSTS NO PARTITION. `ctx.world.notify(seat, ...)` rides home on the
 *     result, and the host appends it in the checkpoint's own write.
 *   A FULL BOX IS THE CALLER'S CHOICE, NAMED EVERY TIME. `whenFull` has no
 *     default: `dropOldest` evicts and counts, `refuse` refuses the command at
 *     the line -- and a `refuse` needs the box declared, because the engine has
 *     to know how full it is to refuse at the line rather than at a write that
 *     would take a whole batch down with it.
 *   READING IS A DECLARED POINT READ OF ONE BOX. `.noticeBox()` names a seat on
 *     the same walk `.needs()` and `.about()` use, and the host answers that box
 *     and nothing else. `takeNotices(seat)` empties it, which is how the game
 *     moves the entries into its own state.
 *   THE LINE ALSO REACHES A CONNECTED SEAT AT ONCE, and only that seat, on the
 *     reserved `notice` scope. It is never part of the shared view.
 */
import { describe, expect, it } from "vitest";
import { Game, Space, type GameElement, type GameOptions } from "../engine/index.js";
import { createWorld, type WorldRunnerOptions } from "./definition.js";
import { worldAction, worldClockAction } from "./action.js";
import { walkDeclaration } from "./declaration.js";
import { worldBudgets } from "./budgets.js";
import {
  applyNoticeWrites,
  EMPTY_NOTICE_BOX,
  NOTICE_SCOPE,
  type WorldNoticeBox,
} from "./notices.js";
import { assertStorablePartitionName } from "./partition-store.js";
import type { StoredPartition, WorldCommandResult } from "./contract.js";
import type { WorldRunnerHandle } from "./runner.js";

class Room extends Space<Clan> {
  /** Lines this seat has moved out of its notice box into its own state. */
  log: string[] = [];
  /** How many notices the box said were dropped before it was taken. */
  lost = 0;
}

class Clan extends Game<Clan> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Room]);
  }
}

const NOW = 1_700_000_000_000;
const PER_SEAT = 3;

/** The clan alert: tell every member, load nobody's partition. */
const alert = worldAction<Clan>("alert")
  .needs(() => ["hall"])
  .execute((_args, { world, player }) => {
    for (const seat of [2, 3, 4]) {
      world.notify(seat, {
        payload: { from: player.seat },
        line: `Seat ${player.seat} raised the alarm.`,
        whenFull: "dropOldest",
      });
    }
  });

/** Mail, which refuses rather than losing a letter -- so it declares the box. */
const mail = worldAction<Clan>("mail")
  .needs(() => ["hall"])
  .enterNumber("to", { min: 1, max: 4, integer: true })
  .noticeBox(({ args }) => Number(args.to))
  .execute((args, { world }) => {
    // Written FIRST, so a refusal at the notify below has something to roll back.
    (world.partition("hall") as Room).log.push("sent");
    world.notify(Number(args.to), { payload: { letter: true }, whenFull: "refuse" });
  });

/** Mail written WITHOUT declaring the box it may refuse against. */
const blindMail = worldAction<Clan>("blindMail")
  .needs(() => ["hall"])
  .enterNumber("to", { min: 1, max: 4, integer: true })
  .execute((args, { world }) => {
    world.notify(Number(args.to), { payload: {}, whenFull: "refuse" });
  });

/** A seat reading its own box on its next move, into its own partition. */
const read = worldAction<Clan>("read")
  .needs(({ player }) => [`room:${player.seat}`])
  .noticeBox(({ player }) => player.seat)
  .execute((_args, { world, player }) => {
    const box = world.takeNotices(player.seat);
    const room = world.partition(`room:${player.seat}`) as Room;
    room.log.push(...box.entries.map((entry) => entry.text ?? "(silent)"));
    room.lost += box.dropped;
  });

/** Peeks, and takes nothing. */
let peeked: WorldNoticeBox | null = null;
const peek = worldAction<Clan>("peek")
  .noticeBox(({ player }) => player.seat)
  .execute((_args, { world, player }) => {
    peeked = world.notices(player.seat);
  });

/** Takes a box nobody declared. */
const grab = worldAction<Clan>("grab")
  .enterNumber("seat", { min: 1, max: 4, integer: true })
  .execute((args, { world }) => {
  world.takeNotices(Number(args.seat));
});

/** The presence hook's shape: the clock names the arriving seat. */
const arrive = worldClockAction<Clan>("arrive")
  .needs(({ args }) => [`room:${Number(args.seat)}`])
  .noticeBox(({ args }) => Number(args.seat))
  .execute((args, { world }) => {
    const seat = Number(args.seat);
    const box = world.takeNotices(seat);
    (world.partition(`room:${seat}`) as Room).log.push(...box.entries.map((e) => e.text ?? ""));
  });

/** Notify with whatever the test sets here, to reach every validation --
 *  including shapes no selection could carry. */
let rawCall: { seat: unknown; notice: unknown } = { seat: 2, notice: {} };
const raw = worldAction<Clan>("raw").execute((_args, { world }) => {
  const notify = world.notify as (seat: unknown, notice: unknown) => void;
  notify(rawCall.seat, rawCall.notice);
});

/** One command asking for more sends than a command may. */
const flood = worldAction<Clan>("flood")
  .enterNumber("count", { min: 1, max: 1000, integer: true })
  .execute((args, { world }) => {
  for (let i = 0; i < Number(args.count); i++) {
    world.notify(2, { payload: i, whenFull: "dropOldest" });
  }
});

function definitionWith(notices: { perSeat: number } | null) {
  return {
    gameClass: Clan,
    gameType: "clan",
    world: {
      maxPlayers: 4,
      ...(notices === null ? {} : { notices }),
      // A world with no box may not even DECLARE a box read, so it gets the
      // verbs that only send.
      actions:
        notices === null
          ? [alert, raw, flood]
          : [alert, mail, blindMail, read, peek, grab, arrive, raw, flood],
      genesis: (game: Game) =>
        ({
          hall: game.create(Room, "hall"),
          "room:1": game.create(Room, "room1"),
          "room:2": game.create(Room, "room2"),
          "room:3": game.create(Room, "room3"),
          "room:4": game.create(Room, "room4"),
        }) as Record<string, GameElement>,
      view: () => ["hall"],
    },
  } as WorldRunnerOptions["definition"];
}

const SEATS = new Map([
  ["p1", 1],
  ["p2", 2],
  ["p3", 3],
  ["p4", 4],
]);

async function launched(notices: { perSeat: number } | null = { perSeat: PER_SEAT }) {
  const definition = definitionWith(notices);
  const genesis = await createWorld({ definition, seed: "notices", seats: SEATS }).runner.genesis();
  // A COLD WAKE over genesis's bytes, so every partition a dispatch needs is
  // one it has to ask the host for -- which is how a case sees what it loaded.
  const runner = createWorld({
    definition,
    seed: "notices",
    seats: SEATS,
    nextElementId: genesis.nextElementId,
  }).runner;
  return { runner, bytes: { ...genesis.partitions } };
}

/**
 * ONE DISPATCH, DRIVEN THROUGH THE LIBRARY'S OWN WALK.
 *
 * `boxes` is the host's store of notice boxes; `loaded` records every partition
 * the walk asked the host for, which is how a case proves a send loaded nobody.
 */
async function dispatch(
  runner: WorldRunnerHandle,
  bytes: Readonly<Record<string, StoredPartition>>,
  options: {
    readonly player: string | null;
    readonly name: string;
    readonly args?: Record<string, unknown>;
    readonly boxes?: ReadonlyMap<number, WorldNoticeBox>;
    readonly answerBox?: (seat: number) => WorldNoticeBox & { readonly seat?: number };
  },
): Promise<{ result: WorldCommandResult; loaded: string[]; askedBoxes: number[] }> {
  const command = { name: options.name, args: options.args ?? {} };
  const loaded: string[] = [];
  const askedBoxes: number[] = [];
  const timing = options.player === null ? { due: NOW, missedCount: 0 } : null;
  const answers = await walkDeclaration(
    (supplied, declared) =>
      runner.declare(
        command,
        options.player,
        supplied,
        timing === null ? { kind: "arrival", now: NOW } : { kind: "scheduled", timing },
        declared,
      ),
    async (name) => {
      loaded.push(name);
      const stored = bytes[name];
      if (stored === undefined) throw new Error(`test store has no partition "${name}"`);
      return stored;
    },
    async (seat) => ({ seat, at: null, since: NOW, tenancy: "held" }),
    async (seat) => {
      askedBoxes.push(seat);
      if (options.answerBox !== undefined) {
        const { seat: answeredFor, ...box } = options.answerBox(seat);
        return { seat: answeredFor ?? seat, box };
      }
      return { seat, box: options.boxes?.get(seat) ?? EMPTY_NOTICE_BOX };
    },
  );
  const result = await runner.apply({
    player: options.player,
    command,
    timing,
    arrivedAt: NOW,
    allowance: { unkeyed: 0, keys: [], worldPending: 0 },
    presence: [],
    activity: null,
    ...answers,
  });
  return { result, loaded, askedBoxes };
}

const box = (...texts: string[]): WorldNoticeBox => ({
  entries: texts.map((text) => ({ at: NOW - 1, payload: null, text })),
  dropped: 0,
});

describe("#521 — ctx.world.notify leaves a notice without loading the seat's partition", () => {
  it("sends to three seats and loads none of their partitions", async () => {
    const { runner, bytes } = await launched();
    const { result, loaded } = await dispatch(runner, bytes, { player: "p1", name: "alert" });

    expect(loaded).toEqual(["hall"]);
    expect(result.dirty).toEqual(["hall"]);
    expect(result.notices).toEqual({
      perSeat: PER_SEAT,
      writes: [2, 3, 4].map((seat) => ({
        kind: "send",
        seat,
        whenFull: "dropOldest",
        notice: { at: NOW, payload: { from: 1 }, text: "Seat 1 raised the alarm." },
      })),
    });
  });

  it("delivers the line at once to the one seat it is for, on the reserved notice scope", async () => {
    const { runner, bytes } = await launched();
    const { result } = await dispatch(runner, bytes, { player: "p1", name: "alert" });

    expect(result.events).toEqual(
      [2, 3, 4].map((seat) => ({
        scope: NOTICE_SCOPE,
        payload: { from: 1 },
        text: "Seat 1 raised the alarm.",
        seats: [seat],
      })),
    );
  });

  it("answers no notices at all when a command sent none", async () => {
    const { runner, bytes } = await launched();
    const { result } = await dispatch(runner, bytes, { player: "p1", name: "mail", args: { to: 2 } });
    expect(result.notices?.writes).toHaveLength(1);
    const quiet = await dispatch(runner, bytes, { player: "p2", name: "peek" });
    expect(quiet.result.notices).toBeUndefined();
  });
});

describe("#521 — a full box is the sender's choice, and it is never a default", () => {
  it("refuses a `refuse` notice to a box nobody declared, at the line, and changes nothing", async () => {
    const { runner, bytes } = await launched();
    await expect(
      dispatch(runner, bytes, { player: "p1", name: "blindMail", args: { to: 2 } }),
    ).rejects.toMatchObject({ code: "undeclared-notice-box", owner: "game" });
  });

  it("refuses a `refuse` notice to a full box by name, and rolls the command back", async () => {
    const { runner, bytes } = await launched();
    const full = new Map([[2, box("a", "b", "c")]]);
    await expect(
      dispatch(runner, bytes, { player: "p1", name: "mail", args: { to: 2 }, boxes: full }),
    ).rejects.toMatchObject({ code: "notice-box-full", owner: "game" });

    // The hall's "sent" line was written before the refusal and is gone: the
    // next dispatch that reads the hall finds nothing.
    const again = await dispatch(runner, bytes, { player: "p1", name: "mail", args: { to: 3 } });
    const written = await runner.serialize(again.result.dirty);
    expect(JSON.parse(written.partitions.hall!)).toMatchObject({ attributes: { log: ["sent"] } });
  });

  it("admits a `refuse` notice to a declared box with room, and asks the host for that box only", async () => {
    const { runner, bytes } = await launched();
    const { result, loaded, askedBoxes } = await dispatch(runner, bytes, {
      player: "p1",
      name: "mail",
      args: { to: 2 },
      boxes: new Map([[2, box("a", "b")]]),
    });
    expect(askedBoxes).toEqual([2]);
    expect(loaded).toEqual(["hall"]);
    expect(result.notices?.writes).toEqual([
      { kind: "send", seat: 2, whenFull: "refuse", notice: { at: NOW, payload: { letter: true } } },
    ]);
  });

  it("refuses a notice that does not say what a full box means", async () => {
    const { runner, bytes } = await launched();
    rawCall = { seat: 2, notice: { payload: 1 } };
    await expect(dispatch(runner, bytes, { player: "p1", name: "raw" })).rejects.toMatchObject({ code: "invalid-notice", message: expect.stringMatching(/whenFull/) });
  });
});

describe("#521 — reading a box is a declared point read of that box alone", () => {
  it("takes the box into the seat's own state, and tells the host to empty it", async () => {
    const { runner, bytes } = await launched();
    const { result, askedBoxes } = await dispatch(runner, bytes, {
      player: "p2",
      name: "read",
      boxes: new Map([[2, { ...box("hello", "again"), dropped: 4 }]]),
    });
    expect(askedBoxes).toEqual([2]);
    expect(result.notices).toEqual({ perSeat: PER_SEAT, writes: [{ kind: "take", seat: 2 }] });
    const written = await runner.serialize(result.dirty);
    expect(JSON.parse(written.partitions["room:2"]!)).toMatchObject({
      attributes: { log: ["hello", "again"], lost: 4 },
    });
  });

  it("peeks without taking", async () => {
    const { runner, bytes } = await launched();
    const { result } = await dispatch(runner, bytes, {
      player: "p2",
      name: "peek",
      boxes: new Map([[2, box("hello")]]),
    });
    expect(peeked).toEqual(box("hello"));
    expect(result.notices).toBeUndefined();
  });

  it("refuses a box the walk did not declare", async () => {
    const { runner, bytes } = await launched();
    await expect(
      dispatch(runner, bytes, { player: "p1", name: "grab", args: { seat: 3 } }),
    ).rejects.toMatchObject({ code: "undeclared-notice-box" });
  });

  it("lets the clock's arrival hook name the arriving seat and take its box", async () => {
    const { runner, bytes } = await launched();
    const { result, askedBoxes } = await dispatch(runner, bytes, {
      player: null,
      name: "arrive",
      args: { seat: 3 },
      boxes: new Map([[3, box("while you were away")]]),
    });
    expect(askedBoxes).toEqual([3]);
    const written = await runner.serialize(result.dirty);
    expect(JSON.parse(written.partitions["room:3"]!)).toMatchObject({
      attributes: { log: ["while you were away"] },
    });
  });

  it("refuses a host that answers a different seat's box", async () => {
    const { runner, bytes } = await launched();
    await expect(
      dispatch(runner, bytes, {
        player: "p2",
        name: "read",
        answerBox: (seat) => ({ ...EMPTY_NOTICE_BOX, seat: seat + 1 }),
      }),
    ).rejects.toMatchObject({ code: "notice-box-answered-wrong", owner: "platform" });
  });
});

describe("#521 — what a notice may be", () => {
  it.each([
    ["a seat that is not a whole number", { seat: 1.5, notice: { payload: 1, whenFull: "refuse" } }],
    ["a seat beyond this world", { seat: 5, notice: { payload: 1, whenFull: "dropOldest" } }],
    ["a payload JSON cannot carry", { seat: 2, notice: { payload: undefined, whenFull: "dropOldest" } }],
    [
      "a notice larger than the budget",
      { seat: 2, notice: { payload: "x".repeat(worldBudgets().noticeMaxBytes), whenFull: "dropOldest" } },
    ],
    ["an unknown whenFull", { seat: 2, notice: { payload: 1, whenFull: "sometimes" } }],
  ])("refuses %s", async (_what, call) => {
    const { runner, bytes } = await launched();
    rawCall = call;
    await expect(dispatch(runner, bytes, { player: "p1", name: "raw" })).rejects.toMatchObject({
      code: "invalid-notice",
    });
  });

  it("refuses notify in a world that declares no notice box", async () => {
    const { runner, bytes } = await launched(null);
    rawCall = { seat: 2, notice: { payload: 1, whenFull: "dropOldest" } };
    await expect(dispatch(runner, bytes, { player: "p1", name: "raw" })).rejects.toMatchObject({
      code: "invalid-notice",
      message: expect.stringMatching(/world: \{ notices: \{ perSeat/),
    });
  });

  it("refuses a command that sends more notices than a command may", async () => {
    const { runner, bytes } = await launched();
    const count = worldBudgets().maxNoticesPerCommand + 1;
    await expect(
      dispatch(runner, bytes, { player: "p1", name: "flood", args: { count } }),
    ).rejects.toMatchObject({ code: "notice-batch-cap" });
  });

  it("refuses a world that declares a box read and no notice box, when it is built", () => {
    const definition = definitionWith({ perSeat: PER_SEAT });
    const { notices: _dropped, ...world } = definition.world!;
    expect(() =>
      createWorld({
        definition: { ...definition, world },
        seed: "n",
        seats: SEATS,
      }),
    ).toThrow(expect.objectContaining({ code: "invalid-world-action" }));
  });

  it.each([0, 1.5, worldBudgets().maxNoticesPerSeat + 1])(
    "refuses a world declaring %s notices per seat when it is built",
    (perSeat) => {
      expect(() =>
        createWorld({ definition: definitionWith({ perSeat }), seed: "n", seats: SEATS }),
      ).toThrow(expect.objectContaining({ code: "bundle-not-a-world" }));
    },
  );

  it("reserves the notice scope, so no partition can be addressed by it", () => {
    expect(() => assertStorablePartitionName(NOTICE_SCOPE)).toThrow(
      expect.objectContaining({ code: "invalid-partition-name" }),
    );
  });
});

describe("#521 — applyNoticeWrites is the one rule every host writes boxes with", () => {
  const send = (seat: number, text: string, whenFull: "refuse" | "dropOldest") => ({
    kind: "send" as const,
    seat,
    whenFull,
    notice: { at: NOW, payload: null, text },
  });

  it("appends, drops the oldest past the limit and counts it, and empties on take", async () => {
    const stored = new Map([[2, box("a", "b")]]);
    const after = await applyNoticeWrites(
      { perSeat: PER_SEAT, writes: [send(2, "c", "dropOldest"), send(2, "d", "dropOldest"), send(3, "x", "refuse")] },
      (seat) => stored.get(seat) ?? EMPTY_NOTICE_BOX,
    );
    expect(after).toEqual([
      { seat: 2, box: { entries: ["b", "c", "d"].map((text) => ({ at: expect.any(Number), payload: null, text })), dropped: 1 } },
      { seat: 3, box: { entries: [{ at: NOW, payload: null, text: "x" }], dropped: 0 } },
    ]);
  });

  it("applies a take and a send in the order the handler wrote them", async () => {
    const after = await applyNoticeWrites(
      { perSeat: PER_SEAT, writes: [{ kind: "take", seat: 2 }, send(2, "new", "dropOldest")] },
      () => box("old"),
    );
    expect(after).toEqual([
      { seat: 2, box: { entries: [{ at: NOW, payload: null, text: "new" }], dropped: 0 } },
    ]);
  });

  it("refuses a `refuse` send that does not fit, rather than evicting", async () => {
    await expect(
      applyNoticeWrites({ perSeat: 1, writes: [send(2, "b", "refuse")] }, () => box("a")),
    ).rejects.toMatchObject({ code: "notice-box-full" });
  });

  it("reads each seat's box once, however many writes it has", async () => {
    const reads: number[] = [];
    await applyNoticeWrites(
      { perSeat: PER_SEAT, writes: [send(2, "a", "dropOldest"), send(2, "b", "dropOldest")] },
      (seat) => {
        reads.push(seat);
        return EMPTY_NOTICE_BOX;
      },
    );
    expect(reads).toEqual([2]);
  });
});
