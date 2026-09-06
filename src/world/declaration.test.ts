// Issue #122's loop, driven directly -- and since #169 there are TWO of them,
// which is the whole of what this file now holds apart.
//
// `settleDeclaration` is the VIEW road. "What is this seat looking at?" is
// answered by the world's own state -- the room the player is standing in -- so
// it genuinely has to be asked, loaded, and asked again until it stops changing
// its mind. Nothing bounds that but a ceiling, and the ceiling and its
// `declaration-unsettled` refusal are still here for exactly that reason.
//
// `walkDeclaration` is the WRITE and OFFER road. A world's verbs are Actions,
// and an action is a SEQUENCE: round one, then each selection's own round, then
// the execute round. The number of rounds is the action's own selection count,
// which is a fact in the game's source rather than a number somebody chose, so
// this loop has no ceiling at all -- and a five-selection verb that would have
// been refused on its fifth honest round under the view's ceiling now runs.
//
// What is proved of BOTH is the thing neither caller's own suite can see: the
// SHAPE of the record they hand back to `declare`. A partition name comes from
// an untrusted bundle, so the record it keys has to be a map rather than an
// object whose prototype the name can reach.
import { describe, expect, it } from "vitest";
import { settleDeclaration, walkDeclaration } from "./declaration.js";
import type { StoredPartition } from "./contract.js";

/** A subtree in the shape the store holds one. The contents do not matter
 *  here: what is under test is which key it arrives under. */
function partition(name: string): StoredPartition {
  return { parentId: 1, json: { className: "Space", name, _id: 7 } };
}

describe("settleDeclaration — a VIEW, which can only be asked until it settles", () => {
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
      "the fixture view",
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
      "the fixture view",
    );

    const second = rounds[1]!;
    expect(Object.prototype.hasOwnProperty.call(second, "__proto__")).toBe(true);
    expect(Object.keys(second)).toEqual(["__proto__"]);
  });

  it("refuses a view that names something new every round", async () => {
    // The ceiling, and it is a VIEW'S ceiling now. A view has no steps to count,
    // so a declaration that walks the world one partition at a time is
    // indistinguishable from one that is nearly finished -- and the O(world)
    // read is the thing the whole partitioned model exists to delete. Four
    // rounds is the deepest chain a view has a reason to have (an index, the
    // partition it names, and one thing that partition names in turn) plus the
    // round that comes back empty and proves it.
    await expect(
      settleDeclaration(
        async () => [`room:${Math.random()}`],
        async (name) => partition(name),
        "the fixture view",
      ),
    ).rejects.toThrow(/did not settle/);
  });
});

describe("walkDeclaration — an ACTION, whose length is its own source", () => {
  it("stops as soon as a round asks for nothing", async () => {
    const supplied: Record<string, StoredPartition>[] = [];
    await walkDeclaration(
      async (given) => {
        supplied.push(given);
        return [];
      },
      async () => {
        throw new Error("nothing was needed, so nothing should have been read");
      },
    );

    expect(supplied).toHaveLength(1);
    expect(Object.keys(supplied[0]!)).toEqual([]);
  });

  it("hands the next round a partition named __proto__ as an OWN property (#190)", async () => {
    // The same untrusted key on the same road, and it has to be defended twice
    // because there are two loops: a null-prototype record in one of them and a
    // plain `{}` in the other is precisely how a partition would go missing on
    // the write path alone, with the read path looking perfectly correct.
    const rounds: Record<string, StoredPartition>[] = [];
    await walkDeclaration(
      async (given) => {
        rounds.push(given);
        return rounds.length === 1 ? ["__proto__"] : [];
      },
      async (name) => partition(name),
    );

    const second = rounds[1]!;
    expect(Object.prototype.hasOwnProperty.call(second, "__proto__")).toBe(true);
    expect(Object.keys(second)).toEqual(["__proto__"]);
  });

  it("has NO ceiling, because an action's walk is bounded by its own steps", async () => {
    // The case that says what #169 changed, and it is written as the shape the
    // view's ceiling would refuse: six honest rounds, one per step, each naming
    // a partition the last one made reachable. Under `settleDeclaration` the
    // fifth would raise `declaration-unsettled` and a perfectly ordinary
    // five-selection verb would be unwritable -- a limit read off the wrong
    // question. Here the loop simply ends when the action runs out of steps.
    const asked: string[][] = [];
    let step = 0;
    await walkDeclaration(
      async () => {
        step += 1;
        const needs = step > 6 ? [] : [`room:${step}`];
        asked.push([...needs]);
        return needs;
      },
      async (name) => partition(name),
    );

    expect(asked).toHaveLength(7);
    expect(asked.slice(0, 6).flat()).toEqual([
      "room:1",
      "room:2",
      "room:3",
      "room:4",
      "room:5",
      "room:6",
    ]);
  });
});
