/**
 * #1207: SEATS SHOWN THE SAME COUNT-ONLY PILE SHARE ONE BODY AGAIN.
 *
 * #715 gave each seat placeholder ids of its own for a card it cannot see, so
 * every seat shown a placeholder held a body of its own, and a world with one
 * shared count-only pile lost the one-body-per-group saving of #413: a plaza
 * with a face-down deck was a body per watcher. The body is shared again, with
 * each placeholder's id taken out, and each seat is sent only its own ids.
 *
 * Measured in bytes and bodies, never in time.
 */
import { describe, it, expect, expectTypeOf } from "vitest";
import { Game, Piece, Player, Space } from "../engine/index.js";
import type { ElementJSON, GameOptions } from "../engine/index.js";
import { TEST_WORLD_ELEMENT_ID_KEY } from "../engine/element/world-element-id-key.test-helper.js";
import { sharePlaceholders } from "../engine/element/seat-placeholders.js";
import { BoardSmithWorldEngine } from "./engine.js";
import { seatView } from "./index.js";
import type { StoredPartition, WorldAudienceViews, WorldPartitionSource } from "./contract.js";
import type { WorldViews } from "./runner.js";

class Plaza extends Space<DeckWorld> {}
class Stall extends Piece<DeckWorld> {}
class Deck extends Space<DeckWorld> {}
class Card extends Piece<DeckWorld> {
  suit = "";
}

class DeckWorld extends Game<DeckWorld, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Plaza, Stall, Deck, Card]);
  }
}

const SEATS = 500;
const CARDS = 52;
const PLAZA = "plaza";
const BACKROOM = "backroom";

const players = Array.from({ length: SEATS }, (_unused, index) => `p${index + 1}`);

const newGame = (): DeckWorld =>
  new DeckWorld({ playerCount: SEATS, seed: "deck-world", worldMode: true, elementIdKey: TEST_WORLD_ELEMENT_ID_KEY });

/** A plaza of public stalls with a face-down deck everybody can count, and a back room holding another. */
function stored(): Map<string, StoredPartition> {
  const game = newGame();
  const plaza = game.create(Plaza, PLAZA);
  for (let stall = 0; stall < 30; stall += 1) plaza.create(Stall, `stall-${stall}`);
  const deck = plaza.create(Deck, "deck");
  deck.contentsCountOnly();
  for (let card = 0; card < CARDS; card += 1) deck.create(Card, `card-${card}`, { suit: "spades" });
  const backroom = game.create(Plaza, BACKROOM);
  const stash = backroom.create(Deck, "stash");
  stash.contentsCountOnly();
  for (let card = 0; card < 3; card += 1) stash.create(Card, `stashed-${card}`, { suit: "hearts" });
  const bytes = (json: ElementJSON) => JSON.parse(JSON.stringify(json)) as ElementJSON;
  return new Map([
    [PLAZA, { parentId: game.id, json: bytes(plaza.toJSON()) }],
    [BACKROOM, { parentId: game.id, json: bytes(backroom.toJSON()) }],
  ]);
}

class Store implements WorldPartitionSource {
  constructor(private readonly rows: Map<string, StoredPartition>) {}
  async read(name: string): Promise<StoredPartition | undefined> {
    return this.rows.get(name);
  }
  forget(): void {}
}

/** Every seat looks at the plaza; seat 2 also has the back room resident through its own view. */
function engine(view: (seat: number) => readonly string[] = () => [PLAZA]): BoardSmithWorldEngine {
  return new BoardSmithWorldEngine({
    game: newGame(),
    seats: new Map(players.map((player, index) => [player, index + 1])),
    store: new Store(stored()),
    actions: [],
    view,
  });
}

/** One seat's view out of a batch, filled in with its own placeholder ids. */
function viewOf(answered: WorldAudienceViews, player: string): unknown {
  const seat = answered.seats.find((held) => held.player === player)!;
  if (seat.refused) throw new Error(`${player} was refused`);
  return seatView(answered.bodies[seat.at], seat.placeholders);
}

function placeholdersOf(answered: WorldAudienceViews, player: string): readonly number[] {
  const seat = answered.seats.find((held) => held.player === player)!;
  if (seat.refused) throw new Error(`${player} was refused`);
  return seat.placeholders;
}

describe("#1207 -- seats shown the same count-only pile share one body", () => {
  it(`sends ${SEATS} watchers of a plaza with a face-down deck one body and their own ids`, async () => {
    const answered = await engine().viewsFor(players);

    // THE MEASUREMENT. What crosses a host's boundary is the table: each body
    // once, and per seat only what is that seat's own.
    const bodyBytes = answered.bodies.map((body) => JSON.stringify(body).length);
    const idBytes = players.map((player) => JSON.stringify(placeholdersOf(answered, player)).length);
    const sent = bodyBytes.reduce((a, b) => a + b, 0) + idBytes.reduce((a, b) => a + b, 0);
    const perSeat = players
      .map((player) => JSON.stringify(viewOf(answered, player)).length)
      .reduce((a, b) => a + b, 0);
    expect(
      answered.bodies,
      `${SEATS} seats see the same plaza and were sent ${answered.bodies.length} bodies ` +
        `(${sent} bytes; a body per seat is ${perSeat} bytes).`,
    ).toHaveLength(1);
    expect(placeholdersOf(answered, "p1")).toHaveLength(CARDS);
    expect(sent, "the shared body plus every seat's ids").toBeLessThan(perSeat / 10);
  });

  it("gives every seat, filled in, exactly what asking that seat alone gives", async () => {
    const together = await engine().viewsFor(players);
    const apart = engine();
    for (const player of ["p1", "p2", "p250", "p500"]) {
      expect(viewOf(together, player), player).toEqual(await apart.viewFor(player));
    }
  });

  it("puts no seat's placeholder id in the shared body, and gives no seat another's", async () => {
    const answered = await engine().viewsFor(players);
    const body = JSON.stringify(answered.bodies);
    const seen = new Set<number>();
    for (const player of players) {
      for (const id of placeholdersOf(answered, player)) {
        expect(body.includes(String(id)), `${player}'s id ${id} is in the shared body`).toBe(false);
        expect(seen.has(id), `${player}'s id ${id} is another seat's too`).toBe(false);
        seen.add(id);
      }
    }
    expect(body).not.toMatch(/card-\d|spades/);
  });

  it("sends a seat no ids for a pile its own view does not name, though another seat's made it resident", async () => {
    // The prune (#183) is per declaration: a group's ids are for the placeholders
    // left in its body, so a seat is not told how many cards are in a room it
    // is not looking at.
    const world = engine((seat) => (seat === 2 ? [PLAZA, BACKROOM] : [PLAZA]));
    const answered = await world.viewsFor(["p1", "p2", "p3"]);

    expect(placeholdersOf(answered, "p1")).toHaveLength(CARDS);
    expect(placeholdersOf(answered, "p2")).toHaveLength(CARDS + 3);
    expect(viewOf(answered, "p1")).toEqual(await world.viewFor("p1"));
    expect(viewOf(answered, "p2")).toEqual(await world.viewFor("p2"));
    expect(answered.bodies, "p1 and p3 share; p2 named more").toHaveLength(2);
  });

  it("refuses to fill a body with the wrong number of ids", async () => {
    const answered = await engine().viewsFor(["p1"]);
    const seat = answered.seats[0]!;
    if (seat.refused) throw new Error("p1 was refused");
    expect(() => seatView(answered.bodies[seat.at], seat.placeholders.slice(1))).toThrow(
      /52 placeholders.*51 ids/,
    );
  });

  it("hands a runner's reader a seat's body index only beside that seat's ids", () => {
    // A bare index would let a reader send bodies[of[player]] with no ids in it.
    expectTypeOf<WorldViews["of"][string]>().toEqualTypeOf<{
      readonly at: number;
      readonly placeholders: readonly number[];
    }>();
  });

  it("passes on a body with no board as it is, as another engine may answer", () => {
    const body = { state: null, phase: "closed" };
    expect(seatView(body, [])).toBe(body);
  });

  it("does not type a shared body as a seat's tree, since a placeholder in it has no id", () => {
    expectTypeOf<ReturnType<typeof sharePlaceholders>["view"]>().not.toMatchTypeOf<ElementJSON>();
  });
});
