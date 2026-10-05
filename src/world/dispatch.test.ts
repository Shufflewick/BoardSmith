/**
 * #539: THE ONE DISPATCH ORDER EVERY WORLD HOST RUNS.
 *
 * Walk the declaration, read the owner's schedule allowance ONCE, apply with
 * it, plan the command's schedules against the same allowance. Driven here
 * with a host made of plain functions, so what is proved is the order and the
 * single read rather than any one host's storage.
 */
import { describe, expect, it } from "vitest";
import { dispatchStep, type WorldDispatchHost } from "./dispatch.js";
import { worldBudgets } from "./budgets.js";
import { WorldRefusal } from "./refusals.js";
import { WORLD_OWNER, type ScheduleAllowance, type ScheduleRequest } from "./schedule-api.js";
import type { StoredPartition, WorldDispatchWhen } from "./contract.js";

const BUDGETS = worldBudgets();
const ROOM: StoredPartition = { parentId: 1, json: { id: 2 } };
const EMPTY: ScheduleAllowance = { unkeyed: 0, keys: [], worldPending: 0 };

/** A host that records every call in order and answers from what it is given. */
function recordingHost(options: {
  schedules?: readonly ScheduleRequest[];
  allowance?: ScheduleAllowance;
} = {}) {
  const log: string[] = [];
  const whens: WorldDispatchWhen[] = [];
  let allowanceReads = 0;
  let round = 0;
  const host: WorldDispatchHost<{ schedules: readonly ScheduleRequest[] }> = {
    async declare(supplied, when) {
      whens.push(when);
      log.push(`declare:${Object.keys(supplied).join(",")}`);
      // Round one asks for a room; round two is satisfied.
      return round++ === 0
        ? { partitions: ["room"], seats: [], noticeBoxes: [] }
        : { partitions: [], seats: [], noticeBoxes: [] };
    },
    async readPartition(name) {
      log.push(`read:${name}`);
      return ROOM;
    },
    async readActivity() {
      throw new Error("no chair is named in these cases");
    },
    async readNoticeBox() {
      throw new Error("no notice box is named in these cases");
    },
    async allowance(owner) {
      allowanceReads += 1;
      log.push(`allowance:${owner}`);
      return options.allowance ?? EMPTY;
    },
    async apply({ allowance }) {
      log.push(`apply:${allowance.worldPending}`);
      return { schedules: options.schedules ?? [] };
    },
    async planning(owner) {
      log.push(`planning:${owner}`);
      let minted = 0;
      return { nextSeq: 7, mintId: () => `event-${++minted}`, replaces: () => undefined };
    },
  };
  return { host, log, whens, allowanceReads: () => allowanceReads };
}

const COMMAND = { name: "build", args: {} } as const;

describe("dispatchStep (#539)", () => {
  it("walks, reads the allowance once, applies, then plans", async () => {
    const { host, log, allowanceReads } = recordingHost();
    const { plan } = await dispatchStep(
      { player: "p1", command: COMMAND, timing: null, arrivedAt: 1_000 },
      host,
      BUDGETS,
    );
    expect(log).toEqual([
      "declare:",
      "read:room",
      "declare:room",
      "allowance:p1",
      "apply:0",
      "planning:p1",
    ]);
    expect(allowanceReads()).toBe(1);
    expect(plan).toEqual({ events: [], replaced: [] });
  });

  it("reads the allowance ONCE for a command that schedules, and plans against it", async () => {
    // The owner already holds the whole world's queue. If the plan judged
    // against a second read, a host whose queue moved between the two could
    // admit what the handler was told it could not have.
    const full: ScheduleAllowance = { unkeyed: 0, keys: [], worldPending: BUDGETS.maxPendingEvents };
    const { host, allowanceReads } = recordingHost({
      schedules: [{ delayMs: 1_000, action: "tick" }],
      allowance: full,
    });
    const refusal = await dispatchStep(
      { player: "p1", command: COMMAND, timing: null, arrivedAt: 1_000 },
      host,
      BUDGETS,
    ).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(WorldRefusal);
    expect(allowanceReads()).toBe(1);
  });

  it("plans a scheduling command's events with the host's sequence and ids", async () => {
    const { host, allowanceReads } = recordingHost({
      schedules: [{ key: "t", delayMs: 1_000, action: "tick" }],
    });
    const { plan } = await dispatchStep(
      { player: "p1", command: COMMAND, timing: null, arrivedAt: 1_000 },
      host,
      BUDGETS,
    );
    expect(allowanceReads()).toBe(1);
    expect(plan.events).toMatchObject([
      { id: "event-1", seq: 7, due: 2_000, key: "t", owner: "p1", action: "tick" },
    ]);
  });

  it("charges the clock's own dispatch to the world, and declares it at its occurrence", async () => {
    const { host, log, whens } = recordingHost();
    await dispatchStep(
      {
        player: null,
        command: COMMAND,
        timing: { due: 5_000, missedCount: 2 },
        arrivedAt: 5_000,
      },
      host,
      BUDGETS,
    );
    expect(log).toContain(`allowance:${WORLD_OWNER}`);
    expect(whens[0]).toEqual({ kind: "scheduled", timing: { due: 5_000, missedCount: 2 } });
  });

  it("declares a seat's command at its arrival", async () => {
    const { host, whens } = recordingHost();
    await dispatchStep(
      { player: "p1", command: COMMAND, timing: null, arrivedAt: 1_000 },
      host,
      BUDGETS,
    );
    expect(whens[0]).toEqual({ kind: "arrival", now: 1_000 });
  });
});
