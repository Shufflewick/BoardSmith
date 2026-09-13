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
  assertAnsweredAllocations,
  assertWorldMigration,
  assertCreatedRoots,
  migratedArgs,
  planMigration,
  worldMigration,
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

  it("REFUSES a `derive` that is not a function (#246)", () => {
    expect(() => assertWorldMigration({ from: 1, derive: 7 }, 2)).toThrow(
      /migration\.derive` is not a function/,
    );
  });

  it("accepts a derive-only migration, for a version whose roots fan out (#246)", () => {
    expect(() => assertWorldMigration({ from: 1, derive: () => ({}) }, 2)).not.toThrow();
  });
});

/**
 * #246: an allocation a hook made and never answered is a REFUSAL.
 *
 * It used to be a dropped element: nothing serialized it, the host never heard
 * of it, and a header the same hook had rewritten to reference it pointed at
 * bytes that never reached storage -- and the migration reported success.
 */
describe("an allocation a migration hook never answered", () => {
  it("passes when a hook answered everything it allocated", () => {
    expect(() => assertAnsweredAllocations("derive", [])).not.toThrow();
  });

  it("NAMES what would have been discarded, and the hook that discarded it", () => {
    expect(() => assertAnsweredAllocations("partition", ['"owner-1/page-0" (id 12)'])).toThrow(
      /"owner-1\/page-0" \(id 12\)/,
    );
    expect(() => assertAnsweredAllocations("partition", ['"page" (id 12)'])).toThrow(
      /`partition` hook/,
    );
  });

  it("tells a `partition` hook which hook may answer a root instead", () => {
    let message = "";
    try {
      assertAnsweredAllocations("partition", ['"page" (id 12)']);
    } catch (refusal) {
      message = (refusal as WorldRefusal).message;
    }
    expect(message).toContain("`derive`");
    expect(message).toContain("`create`");
    expect(message).toContain("The world was not changed.");
  });

  it("counts them, so an author sees how much would have been lost", () => {
    expect(() =>
      assertAnsweredAllocations("create", ['"a" (id 1)', '"b" (id 2)']),
    ).toThrow(/2 top-level elements/);
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

/**
 * ShufflewickPub #449: THE BOUNDED FORM OF A CROSS-ROOT MIGRATION.
 *
 * `finalize` needs every root resident at once, which a host with a measured
 * memory ceiling cannot grant a world of 662 roots and 4.5 MB. `survey` is the
 * other way to say the same thing: fold the whole world into a BOUNDED digest
 * one page at a time, and only then transform, so every write is a pure
 * function of (that root, the completed digest) and residency stays one page.
 */
describe("what a survey may declare (#449)", () => {
  const survey = { initial: () => ({}), root: (digest: unknown) => digest, maxBytes: 4_096 };

  it("accepts a survey beside `partition` and `create`", () => {
    expect(() =>
      assertWorldMigration({ from: 1, survey, partition: () => {}, create: () => ({}) }, 2),
    ).not.toThrow();
  });

  it("REFUSES a migration that declares both `survey` and `finalize`", () => {
    // The two are the same intent at different costs, and declaring both says
    // nothing about which one the host should run.
    expect(() => assertWorldMigration({ from: 1, survey, finalize: () => {} }, 2)).toThrow(
      /`survey` is the bounded form/,
    );
    expect(() => assertWorldMigration({ from: 1, survey, finalize: () => {} }, 2)).toThrow(
      /`finalize` is the whole-world form/,
    );
  });

  it.each([7, "survey", null, []])("refuses %p as the whole survey block", (bad) => {
    expect(() => assertWorldMigration({ from: 1, survey: bad }, 2)).toThrow(
      /migration\.survey` is not a survey/,
    );
  });

  it("refuses a survey whose `initial` or `root` is not a function", () => {
    expect(() => assertWorldMigration({ from: 1, survey: { ...survey, initial: 7 } }, 2)).toThrow(
      /survey\.initial` is not a function/,
    );
    expect(() => assertWorldMigration({ from: 1, survey: { ...survey, root: 7 } }, 2)).toThrow(
      /survey\.root` is not a function/,
    );
  });

  it.each([undefined, 0, -1, 1.5, "4096"])("refuses %p as `survey.maxBytes`", (bad) => {
    // REQUIRED, because an unbounded accumulator is exactly what this refuses
    // to allow: a digest with no stated ceiling is `finalize` wearing a
    // pageable migration's clothes.
    expect(() =>
      assertWorldMigration({ from: 1, survey: { ...survey, maxBytes: bad } }, 2),
    ).toThrow(/survey\.maxBytes`/);
  });
});

/**
 * The digest type has to REACH the hooks, or every author casts (#449).
 *
 * A world's definition cannot be generic without every reader of it becoming
 * generic too, so the slot holds `WorldMigration<unknown>` -- and a migration
 * written straight into it would hand `partition` an `unknown` to cast, which
 * is the pit of failure this helper exists to fill in.
 */
describe("worldMigration() (#449)", () => {
  it("flows the digest type from `survey.initial` into `partition` and `create`", () => {
    const seen: number[] = [];
    const declared = worldMigration({
      from: 1,
      survey: {
        initial: () => ({ total: 0 }),
        root: (digest, _element, name) => ({ total: digest.total + name.length }),
        maxBytes: 64,
      },
      // No annotation and no cast: `digest.total` is a number here because
      // `initial` said so, and `digest.missing` would not compile.
      partition: (_element, ctx) => {
        seen.push(ctx.digest.total);
      },
      create: (_game, ctx) => {
        seen.push(ctx.digest.total);
        return {};
      },
    });

    declared.partition!({} as GameElement, { name: "a", from: 1, to: 2, digest: { total: 7 } });
    expect(seen).toEqual([7]);
    expect(() => assertWorldMigration(declared, 2)).not.toThrow();
  });

  it("is what a world definition's `migration` slot accepts", () => {
    // The assignment this whole design turns on: a migration carrying a real
    // digest type goes into the slot that erases it, so `WorldDefinition` stays
    // the plain interface every host reads.
    const slot: { readonly migration?: WorldMigration } = {
      migration: worldMigration({
        from: 1,
        survey: { initial: () => ({ total: 0 }), root: (digest) => digest, maxBytes: 64 },
        partition: (_element, ctx) => void ctx.digest,
      }),
    };
    expect(slot.migration?.from).toBe(1);
  });
});
