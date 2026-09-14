/**
 * A WORLD'S OFFER CARRIES ITS DESTRUCTIVE EMPHASIS (#268).
 *
 * Emphasis is metadata on the action, and a world's offer IS that metadata:
 * `WorldActionOffer extends ActionMetadata`. But `offerOf` names the fields it
 * forwards one by one, so a field the table path emits and the world builder
 * does not name is dropped silently -- the shape #258 was about. A world is also
 * the mode the ticket was filed from: a resident survivor's "end this survivor"
 * verb is exactly the button that must not look like "look around".
 *
 * IT HAS TO SURVIVE JSON too, which is why the assertion is made on a frame that
 * has been through a serialize/parse round trip rather than on the object the
 * engine built.
 */
import { describe, it, expect } from "vitest";
import { worldAction } from "./index.js";
import { offersFor, PARTITION } from "./offer-fixture.test-helper.js";

const endSurvivor = worldAction("endSurvivor")
  .prompt("Careful: end this survivor, scattering everything you carry across the map")
  .destructive()
  .needs(() => [PARTITION])
  .execute(() => {});

const lookAround = worldAction("lookAround")
  .prompt("Look around the sector you are standing in")
  .needs(() => [PARTITION])
  .execute(() => {});

const offers = () => offersFor([endSurvivor, lookAround], "destructive");

describe("a world offer's destructive emphasis (#268)", () => {
  it("carries destructive:true across the wire for the verb that declared it, and nothing for the one that did not", async () => {
    const wire = JSON.parse(JSON.stringify(await offers())) as Array<Record<string, unknown>>;
    const byName = new Map(wire.map((offer) => [offer.name as string, offer]));

    expect(byName.get("endSurvivor")?.destructive).toBe(true);
    expect("destructive" in byName.get("lookAround")!).toBe(false);
  });
});
