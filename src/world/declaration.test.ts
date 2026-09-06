// Issue #122's loop, driven directly: `settleDeclaration` is the one place the
// two-round declaration's termination rule lives, and both the command road
// and the view road run through it.
//
// What is proved here is the thing neither caller's own suite can see: the
// SHAPE of the record it hands back to `declare`. A partition name comes from
// an untrusted bundle, so the record it keys has to be a map rather than an
// object whose prototype the name can reach.
import { describe, expect, it } from "vitest";
import { settleDeclaration } from "./declaration.js";
import type { StoredPartition } from "./contract.js";

/** A subtree in the shape the store holds one. The contents do not matter
 *  here: what is under test is which key it arrives under. */
function partition(name: string): StoredPartition {
  return { parentId: 1, json: { className: "Space", name, _id: 7 } };
}

describe("settleDeclaration", () => {
  it("stops as soon as a round asks for nothing", async () => {
    const supplied: Record<string, StoredPartition>[] = [];
    await settleDeclaration(
      async (given) => {
        supplied.push(given);
        return [];
      },
      async () => {
        throw new Error("nothing was needed, so nothing should have been read");
      },
      "the fixture command",
    );

    expect(supplied).toHaveLength(1);
    expect(Object.keys(supplied[0]!)).toEqual([]);
  });

  it("hands the next round a partition named __proto__ as an OWN property (#190)", async () => {
    // `supplied[name] = bytes` on a plain object assigns THROUGH the inherited
    // `__proto__` setter: the record's prototype is swapped and no entry is
    // stored, so the child never receives the partition, keeps asking for it,
    // and after four rounds the player is told the declaration named something
    // new every round -- which is false, and unactionable.
    const rounds: Record<string, StoredPartition>[] = [];
    await settleDeclaration(
      async (given) => {
        rounds.push(given);
        return rounds.length === 1 ? ["__proto__"] : [];
      },
      async (name) => partition(name),
      "the fixture command",
    );

    const second = rounds[1]!;
    expect(Object.prototype.hasOwnProperty.call(second, "__proto__")).toBe(true);
    expect(Object.keys(second)).toEqual(["__proto__"]);
  });

  it("refuses a declaration that names something new every round", async () => {
    await expect(
      settleDeclaration(
        async () => [`room:${Math.random()}`],
        async (name) => partition(name),
        "the fixture command",
      ),
    ).rejects.toThrow(/did not settle/);
  });
});
