/**
 * A WORLD'S CHOICES CAN BE GROUPED IN THE ACTION PANEL (#1441).
 *
 * #1439 gave the engine's `chooseFrom` and `chooseElement` a `group` option.
 * A world's verbs have their own option types, so the option has to be
 * forwarded, and the element form's callback handed the world context its
 * other callbacks get.
 */
import { describe, it, expect } from "vitest";
import { worldAction } from "./index.js";
import { offersFor, PARTITION } from "./offer-fixture.test-helper.js";

const recruit = worldAction("recruit")
  .needs(() => [PARTITION])
  .chooseFrom("unit", {
    choices: ["Scout", "Rifleman", "Tank"],
    group: (unit) => (unit === "Scout" ? [] : unit === "Tank" ? ["Vehicles", "Heavy"] : ["Infantry"]),
  })
  .execute(() => {});

const visit = worldAction("visit")
  .needs(() => [PARTITION])
  .chooseElement("place", {
    elements: (ctx) => [ctx.world.partition(PARTITION)],
    group: (place, ctx) => [`${place.name} at ${ctx.world.now}`],
  })
  .execute(() => {});

describe("grouped choices on a world's verbs (#1441)", () => {
  it("puts each chooseFrom choice on the offer under its category", async () => {
    const [offer] = await offersFor([recruit], "groups-choice");
    expect(offer!.selections[0]!.choices!.map((c) => c.group)).toEqual([
      undefined,
      ["Infantry"],
      ["Vehicles", "Heavy"],
    ]);
  });

  it("hands chooseElement's group the world context", async () => {
    const [offer] = await offersFor([visit], "groups-element");
    expect(offer!.selections[0]!.validElements!.map((e) => e.group)).toEqual([[`${PARTITION} at 1`]]);
  });

  it("refuses group on a multiSelect choice when the action is declared", () => {
    expect(() =>
      worldAction("muster").chooseFrom("units", {
        choices: ["Scout", "Tank"],
        // @ts-expect-error no overload takes group with multiSelect: group only arranges a pick that takes one choice
        multiSelect: 2,
        group: () => ["Army"],
      }),
    ).toThrow(/group/);
  });

  it("does not take group on chooseElements", () => {
    worldAction("crew").chooseElements("members", {
      elements: [],
      // @ts-expect-error a many-element pick has no categories
      group: () => ["Crew"],
    });
  });
});
