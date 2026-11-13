/**
 * A WORLD'S PICKS BIND SUBJECT TYPES TOO (#1640).
 *
 * A world's offer already carries its first-pick lists, so nothing new travels
 * but each row's thing. The type's callbacks are handed the world context, as
 * every other world callback is, and a thing the offer did not hydrate may go
 * unnamed: the panel takes its name from another row that has it.
 */
import { describe, it, expect } from "vitest";
import { worldAction, type WorldActionContext } from "./index.js";
import { subjectType, type GameElement } from "../engine/index.js";
import { offersFor, PARTITION } from "./offer-fixture.test-helper.js";

const COLONIES = subjectType<string, WorldActionContext>({
  name: "Colonies",
  onBoard: true,
  key: (colony) => colony,
  // Only the open colony's name is resident in this offer.
  label: (colony, ctx) => (colony === "home" ? `Aster at ${ctx.world.now}` : undefined),
});

const abandon = worldAction("abandon")
  .needs(() => [PARTITION])
  .chooseFrom("colony", { choices: ["home", "far"], subject: COLONIES })
  .execute(() => {});

const visit = worldAction("visit")
  .needs(() => [PARTITION])
  .chooseElement("place", {
    elements: (ctx) => [ctx.world.partition(PARTITION)],
    subject: subjectType<GameElement, WorldActionContext>({ name: "Places", onBoard: true, label: (place, ctx) => `${place.name} at ${ctx.world.now}` }),
  })
  .execute(() => {});

const rename = worldAction("rename")
  .needs(() => [PARTITION])
  .enterText("colony", { subject: COLONIES })
  .execute(() => {});

describe("subject types on a world's verbs (#1640)", () => {
  it("puts each row's thing on the offer, handing the type the world context, and leaves an unhydrated one unnamed", async () => {
    const [offer] = await offersFor([abandon], "subjects-choice");
    expect(offer!.selections[0]!.subjectTypes).toEqual([{ name: "Colonies", onBoard: true }]);
    expect(offer!.selections[0]!.choices!.map((row) => row.subject)).toEqual([
      { type: "Colonies", key: "home", label: "Aster at 1" },
      { type: "Colonies", key: "far" },
    ]);
  });

  it("forwards subject on chooseElement and enterText", async () => {
    const offers = await offersFor([visit, rename], "subjects-element");
    const placed = offers.find((offer) => offer.name === "visit");
    const typed = offers.find((offer) => offer.name === "rename");
    expect(placed!.selections[0]!.validElements![0]!.subject).toMatchObject({ type: "Places", label: `${PARTITION} at 1` });
    expect(typed!.selections[0]!.subjectTypes).toEqual([{ name: "Colonies", onBoard: true }]);
  });
});
