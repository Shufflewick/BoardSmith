/**
 * THE TWO RULES EVERY PARTITION STORE ENFORCES, WITHOUT A STORE (#165).
 *
 * ShufflewickPub tested these through a Durable Object, which is where its one
 * store lived. They are not facts about a Durable Object: a partition name that
 * is legal on one host and illegal on another, or a byte ceiling only one host
 * applies, is exactly the divergence that would make a game's local behaviour
 * stop predicting its published behaviour. So the rules are pure functions and
 * these cases drive them directly; a store composes them before it writes.
 */
import { describe, expect, it } from "vitest";
import {
  assertPartitionWithinBudget,
  assertStorablePartitionName,
  partitionBytes,
} from "./partition-store.js";
import { WorldRefusal } from "./refusals.js";
import { worldBudgets } from "./budgets.js";

describe("what a partition may be named", () => {
  it("admits the names a game actually writes", () => {
    for (const name of ["room", "room:1", "room/cellar", "market.listings", "a-b_c@d"]) {
      expect(() => assertStorablePartitionName(name)).not.toThrow();
    }
  });

  it("REFUSES a name that would make a keyspace ambiguous", () => {
    // Every one of these becomes part of a storage key on some host, so a name
    // that needs escaping somewhere is a name that stores differently in two
    // places.
    expect(() => assertStorablePartitionName("")).toThrow(/cannot be empty/);
    expect(() => assertStorablePartitionName("room one")).toThrow(
      /characters a partition name may not/,
    );
    expect(() => assertStorablePartitionName("r".repeat(129))).toThrow(
      /over the 128-character limit/,
    );
  });

  it("REFUSES a partition named __proto__, constructor or prototype", () => {
    // These names come from an untrusted bundle and end up as keys in plain
    // objects on both sides of a host boundary, where assigning through an
    // inherited setter is a silent no-op and assigning an object swaps the
    // record's prototype. A partition named `__proto__` would vanish from
    // every checkpoint with no error anywhere, which is the silently-reverting
    // write this whole layer is built to make impossible.
    for (const name of ["__proto__", "constructor", "prototype"]) {
      expect(() => assertStorablePartitionName(name)).toThrow(/reserved by JavaScript objects/);
    }
  });

  it("classifies every refusal as the GAME's, because a game chose the name", () => {
    // A bad partition name is deterministic -- the same bundle writes the same
    // one next time -- so it must never climb a host's park ladder and end a
    // season 499 other players are in.
    for (const name of ["", "room one", "__proto__"]) {
      try {
        assertStorablePartitionName(name);
        expect.unreachable(`${JSON.stringify(name)} was admitted`);
      } catch (error) {
        expect(error).toBeInstanceOf(WorldRefusal);
        expect((error as WorldRefusal).code).toBe("invalid-partition-name");
        expect((error as WorldRefusal).owner).toBe("game");
      }
    }
  });
});

describe("how large one partition may be", () => {
  const budgets = worldBudgets();

  it("admits a partition inside the budget and answers its byte cost", () => {
    const json = JSON.stringify({ className: "Space", name: "cellar", _id: 7 });
    expect(assertPartitionWithinBudget("room:1", json, budgets)).toBe(partitionBytes(json));
  });

  it("REFUSES a partition over the budget, and says how to fix it", () => {
    // The refusal is the only thing that will ever tell an author their room
    // outgrew a limit. It has to name the remedy they can actually apply --
    // split the partition -- which is also what makes a command touching it
    // cost one room again instead of the whole collection.
    const oversized = JSON.stringify({
      className: "Space",
      name: "x".repeat(budgets.partitionMaxBytes),
      _id: 7,
    });
    expect(() => assertPartitionWithinBudget("room:1", oversized, budgets)).toThrow(/split/i);
  });

  it("is GAME-owned, so one oversized room cannot park a world", () => {
    // The budget is the host's; what a partition CONTAINS is entirely the
    // bundle's. Charging this to the host would let one bundle's accreting room
    // end a live world's season after two checkpoints.
    const oversized = "x".repeat(budgets.partitionMaxBytes + 1);
    try {
      assertPartitionWithinBudget("room:1", oversized, budgets);
      expect.unreachable("an oversized partition was admitted");
    } catch (error) {
      expect((error as WorldRefusal).code).toBe("partition-too-large");
      expect((error as WorldRefusal).owner).toBe("game");
    }
  });

  it("measures UTF-8 BYTES, not UTF-16 length", () => {
    // A world whose players write in Japanese is up to three times bigger on
    // the wire than its `String.length` says. A guard that counted length
    // against a byte wall would refuse some worlds and admit others for the
    // identical content.
    const japanese = "あ".repeat(200);
    expect(partitionBytes(japanese)).toBe(600);
    expect(japanese.length).toBe(200);
    const tight = worldBudgets({ partitionMaxBytes: 400 });
    expect(() => assertPartitionWithinBudget("room:1", japanese, tight)).toThrow(/600 bytes/);
  });

  it("is the HOST's number, so a host may run a different one", () => {
    // The whole reason this is a parameter. A laptop host and a hosting
    // platform sit behind different storage walls; what they must not do is
    // disagree silently, which is what a module constant read at the point of
    // enforcement would let them do.
    const json = "x".repeat(1024);
    expect(() =>
      assertPartitionWithinBudget("room:1", json, worldBudgets({ partitionMaxBytes: 2048 })),
    ).not.toThrow();
    expect(() =>
      assertPartitionWithinBudget("room:1", json, worldBudgets({ partitionMaxBytes: 512 })),
    ).toThrow(/512-byte limit/);
  });
});
