// #283: a finder's predicate on the offer road is asked about ITS CLASS only.
//
// `boardsmith dev` spent 15-30 seconds per command with two seats attached to a
// 1,600-sector world, and a CPU profile put ~90% of it in `readOnlyProjection`,
// reached from `game.first(Character, (c) => c.seat === seat)` inside offer
// declarations. The engine's finder asked that predicate about EVERY element it
// walked -- every sector, item and marker -- before checking the class, and on
// the offer road each of those calls first wraps the element in a read-only
// projection. So a lookup of one character cost a projection per element of
// the resident world, per declaration round, per action, per attached seat.
//
// A COUNT AND NOT A CLOCK (#281): the claim is "the predicate is asked about
// elements of the class it was written for", which is a number of calls.
import { describe, expect, it } from "vitest";
import { Game, Piece, Space } from "../engine/index.js";
import { createWorld, worldAction } from "./index.js";

class Plot extends Space {}
class Marker extends Piece {}
class Hero extends Piece {
  seat = 0;
}
class DigWorld extends Game {
  constructor(options: ConstructorParameters<typeof Game>[0]) {
    super(options);
    this.registerElements([Plot, Marker, Hero]);
  }
}

const PLOTS = 400;
const MARKERS_PER_PLOT = 5;
const SEATS = 2;

describe("offer declarations over a large resident world (#283)", () => {
  it("asks a class finder's predicate about that class only, not every element walked", async () => {
    let asked = 0;
    let strangers = 0;
    const dig = worldAction("dig")
      .needs(() => ["map"])
      .needs(({ game, player }) => {
        const hero = game.first(Hero, (candidate: Hero) => {
          asked += 1;
          if (!(candidate instanceof Hero)) strangers += 1;
          return candidate.seat === player.seat;
        });
        if (hero === undefined) throw new Error(`Seat ${player.seat} has no hero.`);
        return [];
      })
      .execute(() => {});

    const { runner } = createWorld({
      definition: {
        gameClass: DigWorld,
        world: {
          maxPlayers: SEATS,
          actions: [dig],
          view: () => ["map"],
          genesis: (game) => {
            const map = game.create(Plot, "map");
            for (let plot = 0; plot < PLOTS; plot += 1) {
              const here = map.create(Plot, `plot-${plot}`);
              for (let marker = 0; marker < MARKERS_PER_PLOT; marker += 1) {
                here.create(Marker, `marker-${marker}`);
              }
            }
            for (let seat = 1; seat <= SEATS; seat += 1) {
              map.create(Hero, `hero-${seat}`).seat = seat;
            }
            return { map };
          },
        },
      },
      seed: "offer-finder-cost",
      seats: new Map([
        ["p1", 1],
        ["p2", 2],
      ]),
    });
    await runner.genesis();

    // Genesis leaves the map resident, so each seat's walk settles in one call.
    for (const player of ["p1", "p2"]) {
      expect(await runner.declareOffers(player, {}, 1)).toEqual({ needs: [] });
    }
    expect(asked, "The declaration under test never ran, so this proves nothing.").toBeGreaterThan(0);

    expect(
      strangers,
      "A class finder's predicate was handed elements of other classes. It is typed for the " +
        "class it names, so those calls read fields that do not exist -- and on the offer road " +
        "each one wraps an element in a read-only projection first.",
    ).toBe(0);
    expect(
      asked,
      `Two seats' offer walks asked a Hero finder's predicate ${asked} times over a world of ` +
        `${PLOTS * (MARKERS_PER_PLOT + 1) + SEATS + 1} elements holding ${SEATS} heroes. The ` +
        "bill must scale with the heroes, not with the resident world.",
    ).toBeLessThanOrEqual(SEATS * SEATS * 4);
  });
});
