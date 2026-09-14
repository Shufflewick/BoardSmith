/**
 * offer-fixture.test-helper.ts -- one resident seat, one partition, and the
 * offers it is shown.
 *
 * Several tests assert that a field a table's action metadata carries also
 * travels on a world's offer frame, and each of them needs the same four steps
 * to get one: build a world around the actions under test, run genesis, declare
 * the seat's offers, then read them back. That boilerplate is the fixture, not
 * the subject, so it lives here once rather than being retyped per ticket.
 */
import { Game, Space } from "../engine/index.js";
import { createWorld } from "./index.js";
import type { ActionDefinition } from "../engine/action/types.js";
import type { WorldActionOffer } from "./contract.js";

/** The one partition every fixture world resides in. */
class FixtureSpace extends Space {}

class FixtureWorld extends Game {
  constructor(options: ConstructorParameters<typeof Game>[0]) {
    super(options);
    this.registerElements([FixtureSpace]);
  }
}

/**
 * The offers a lone seat is shown, for a world built around `actions`.
 *
 * @param actions - The world actions under test; each should `.needs()` the
 *   fixture's single partition, named by `PARTITION`.
 * @param seed - Names the world, so two fixtures in one run cannot collide.
 */
export async function offersFor(
  actions: readonly ActionDefinition[],
  seed: string,
): Promise<readonly WorldActionOffer[]> {
  const { runner } = createWorld({
    definition: {
      gameClass: FixtureWorld,
      world: {
        maxPlayers: 1,
        actions,
        view: () => [PARTITION],
        genesis: (game) => ({ [PARTITION]: game.create(FixtureSpace, PARTITION) }),
      },
    },
    seed,
    seats: new Map([["p1", 1]]),
  });
  await runner.genesis();
  await runner.declareOffers("p1", {}, 1);
  return runner.offersFor("p1", { now: 1, presence: [], activity: null });
}

/** The partition the fixture world resides, and every fixture action needs. */
export const PARTITION = "yard";
