/**
 * #200: A WORLD ANYBODY IS IN CAN STILL GAIN A FEATURE.
 *
 * `stateVersion` was a veto and nothing else, so a season somebody was playing
 * could never move onto rules that read its state differently -- however
 * plainly the author could say how. Every fact below is one sentence of that
 * ticket, on the DECISION both hosts make: which gaps may be crossed, which
 * are refused, and in whose name.
 */
import { describe, expect, it } from "vitest";

import type { GameElement } from "../engine/index.js";
import { WorldRefusal } from "./refusals.js";
import {
  assertWorldMigration,
  assertCreatedRoots,
  migratedArgs,
  planMigration,
  type WorldMigration,
} from "./migration.js";

const from1: WorldMigration = { from: 1, partition: () => {} };

describe("whether a world may run a bundle", () => {
  it("is CURRENT when the versions agree, migration or no migration", () => {
    expect(planMigration({ stored: 2, declared: 2, migration: undefined }).kind).toBe("current");
    expect(planMigration({ stored: 0, declared: 0, migration: undefined }).kind).toBe("current");
  });

  it("MIGRATES when the bundle declares a migration from exactly this world's version", () => {
    const plan = planMigration({ stored: 1, declared: 2, migration: from1 });
    expect(plan).toMatchObject({ kind: "migrate", from: 1, to: 2 });
  });

  it("REFUSES a version gap with no migration at all, and says both numbers", () => {
    const plan = planMigration({ stored: 1, declared: 2, migration: undefined });
    expect(plan.kind).toBe("refuse");
    if (plan.kind !== "refuse") return;
    expect(plan.refusal.message).toContain("state version 1");
    expect(plan.refusal.message).toContain("declare no migration");
    expect(plan.refusal.message).toContain("world.migration: { from: 1");
    expect(plan.refusal.message).toContain("The world was not changed");
  });

  it("REFUSES a migration written for a different version rather than running it anyway", () => {
    // A migration is written against a world its author has seen. Running one
    // two steps back is running it against a world nobody has.
    const plan = planMigration({ stored: 0, declared: 2, migration: from1 });
    expect(plan.kind).toBe("refuse");
    if (plan.kind !== "refuse") return;
    expect(plan.refusal.message).toContain("one step");
  });

  it("REFUSES a bundle older than the world, in both directions of the same rule", () => {
    const plan = planMigration({ stored: 3, declared: 1, migration: from1 });
    expect(plan.kind).toBe("refuse");
    if (plan.kind !== "refuse") return;
    expect(plan.refusal.message).toContain("never migrated backwards");
  });

  it("classifies every refusal as the GAME's, so an unmigratable world is not a sick one", () => {
    const plan = planMigration({ stored: 1, declared: 2, migration: undefined });
    if (plan.kind !== "refuse") return expect.unreachable("expected a refusal");
    expect(plan.refusal.code).toBe("world-migration-unavailable");
    expect((plan.refusal as WorldRefusal).owner).toBe("game");
  });
});

describe("what a migration may declare", () => {
  it("accepts a partition-only, an event-only and a both migration", () => {
    expect(() => assertWorldMigration({ from: 1, partition: () => {} }, 2)).not.toThrow();
    expect(() => assertWorldMigration({ from: 1, event: () => ({}) }, 2)).not.toThrow();
    expect(() =>
      assertWorldMigration({ from: 0, partition: () => {}, event: () => ({}) }, 1),
    ).not.toThrow();
  });

  it.each([undefined, -1, 1.5, "1"])("refuses %p as a `from`", (bad) => {
    expect(() => assertWorldMigration({ from: bad as number }, 2)).toThrow(/usable `from`/);
  });

  it("refuses a migration that does not move the world forward", () => {
    expect(() => assertWorldMigration({ from: 2 }, 2)).toThrow(/moves a world FORWARD/);
    expect(() => assertWorldMigration({ from: 3 }, 2)).toThrow(/moves a world FORWARD/);
  });

  it("refuses a hook that is not a function, naming which one", () => {
    expect(() => assertWorldMigration({ from: 1, partition: 7 }, 2)).toThrow(
      /migration\.partition` is not a function/,
    );
    expect(() => assertWorldMigration({ from: 1, event: 7 }, 2)).toThrow(
      /migration\.event` is not a function/,
    );
    expect(() => assertWorldMigration({ from: 1, create: 7 }, 2)).toThrow(
      /migration\.create` is not a function/,
    );
  });

  it("accepts a create-only migration, for a version that only adds roots (#218)", () => {
    expect(() => assertWorldMigration({ from: 1, create: () => ({}) }, 2)).not.toThrow();
  });
});

describe("a queued event's arguments under new rules", () => {
  const event = { action: "grow", args: { plot: 3 } };

  it("are copied unchanged when the migration declares no event hook", () => {
    expect(migratedArgs({ from: 1 }, event)).toEqual({ plot: 3 });
    // A COPY, so a host that stores the answer cannot be storing the caller's
    // own object.
    expect(migratedArgs({ from: 1 }, event)).not.toBe(event.args);
  });

  it("are whatever the hook answers", () => {
    const migration: WorldMigration = {
      from: 1,
      event: (queued) => ({ ...queued.args, tier: 1 }),
    };
    expect(migratedArgs(migration, event)).toEqual({ plot: 3, tier: 1 });
  });

  it("refuse an answer a world cannot store, rather than storing it", () => {
    for (const bad of [null, 7, "args", [1, 2]]) {
      const migration = { from: 1, event: () => bad } as unknown as WorldMigration;
      expect(() => migratedArgs(migration, event)).toThrow(/object of named values/);
    }
  });
});

/**
 * #218: the roots an upgrade adds, checked before anything is written.
 *
 * Every refusal here leaves the world on its old rules with its old roots,
 * because the whole check runs before the host opens its transaction.
 */
describe("the partition roots a migration creates", () => {
  const anElement = { name: "region" } as unknown as GameElement;

  it("accepts an empty answer, which is a version that adds no roots", () => {
    expect(() => assertCreatedRoots({}, ["sector"])).not.toThrow();
  });

  it("accepts roots whose names the world does not already hold", () => {
    expect(() =>
      assertCreatedRoots({ "region:1": anElement, "region:2": anElement }, ["sector"]),
    ).not.toThrow();
  });

  it("refuses a name the world already holds, because that is a deletion", () => {
    expect(() => assertCreatedRoots({ sector: anElement }, ["sector"])).toThrow(
      /already holds/,
    );
  });

  it("refuses two entries under one name inside a single answer", () => {
    // Object keys cannot repeat, so the only way to collide within one answer
    // is against `existing` -- which the case above covers. What this pins is
    // that the running set GROWS, so a later host that batches several hooks
    // meets the same refusal.
    expect(() => assertCreatedRoots({ "region:1": anElement }, ["region:1"])).toThrow(
      /already holds/,
    );
  });

  it("refuses a nameless root, which nothing could ever reach again", () => {
    expect(() => assertCreatedRoots({ "": anElement }, [])).toThrow(/empty name/);
  });

  it.each([null, 7, "region", []])("refuses %p as the whole answer", (bad) => {
    expect(() => assertCreatedRoots(bad, [])).toThrow(/name -> element/);
  });

  it("refuses an entry that is not an element", () => {
    expect(() => assertCreatedRoots({ "region:1": 7 }, [])).toThrow(/is the ELEMENT/);
  });
});
