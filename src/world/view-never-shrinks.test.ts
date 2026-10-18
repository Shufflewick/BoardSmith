/**
 * #936: A VIEW MAY NAME MORE AS MORE IS LOADED, NEVER FEWER.
 *
 * #717 tells a seat about an event when its view, run against only what the
 * command declared, names the event's partition. That is only right if a view
 * never drops a name once more is loaded: a view that names the lobby until the
 * index loads and then only a room would be told about lobby events its
 * settled view does not show. Driven here the way every host drives a look:
 * `settleDeclaration` over `declareViews`, on a cold world, then `viewsFor`.
 */
import { describe, expect, it } from "vitest";
import { Game, Space, type GameElement, type GameOptions } from "../engine/index.js";
import { createWorld } from "./definition.js";
import { settleDeclaration } from "./declaration.js";
import type { StoredPartition, WorldResidency } from "./contract.js";
import type { WorldRunnerHandle, WorldViewRefusal } from "./runner.js";
import { storedWorld, worldOptions } from "./stored-world.test-helper.js";

class Room extends Space<Hall> {}

class Hall extends Game<Hall> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Room]);
  }
}

/** How each seat's view answers once the index is loaded. */
let withIndex: Record<number, readonly string[]> = {};
const GROWS = ["lobby", "index", "room"];
/** Every run of the bundle's `world.view`, counted by what each run cost. */
let viewCalls = 0;

const definition = {
  gameClass: Hall,
  gameType: "hall",
  world: {
    maxPlayers: 2,
    actions: [],
    genesis: (game: Game) =>
      ({
        lobby: game.create(Room, "lobby"),
        index: game.create(Room, "index"),
        room: game.create(Room, "room"),
      }) as Record<string, GameElement>,
    view: (seat: number, world: WorldResidency) => {
      viewCalls += 1;
      return world.partition("index") === undefined ? ["lobby", "index"] : withIndex[seat]!;
    },
  },
} as Parameters<typeof worldOptions>[0];

/** A world just woken: born in the store, nothing resident. */
async function coldWorld(): Promise<{ runner: WorldRunnerHandle; rows: Record<string, StoredPartition> }> {
  const { rows, nextElementId } = await storedWorld(definition, "view-never-shrinks");
  const runner = createWorld({
    ...worldOptions(definition, "view-never-shrinks", nextElementId),
    seats: new Map([
      ["p1", 1],
      ["p2", 2],
    ]),
  }).runner;
  return { runner, rows };
}

/** One look by `players`, as a host takes it: settle, then project. */
async function look(
  runner: WorldRunnerHandle,
  rows: Record<string, StoredPartition>,
  players: readonly string[],
): Promise<{ declined: Readonly<Record<string, WorldViewRefusal>>; projected: readonly string[] }> {
  let declined: Readonly<Record<string, WorldViewRefusal>> = {};
  await settleDeclaration(
    async (supplied) => {
      const declared = await runner.declareViews(players, supplied);
      declined = declared.refused;
      return declared.needs;
    },
    async (name) => rows[name]!,
    "the fixture's `world.view`",
  );
  const { of } = await runner.viewsFor(players.filter((player) => declined[player] === undefined));
  return { declined, projected: Object.keys(of) };
}

describe("#936: a view names more as more is loaded, never fewer", () => {
  it("refuses a view that drops a name once more is loaded, naming the partition", async () => {
    withIndex = { 1: ["room"], 2: GROWS };
    const { runner, rows } = await coldWorld();

    const { declined, projected } = await look(runner, rows, ["p1", "p2"]);

    // Seat 2 needs a third round to load "room". Seat 1 dropped its names in
    // round two, and the round after it must not forget that.
    expect(projected).toEqual(["p2"]);
    expect(declined.p1?.code).toBe("view-dropped-partition");
    expect(declined.p1?.message).toContain('"lobby"');
    expect(declined.p1?.message).toContain('"index"');
    expect(declined.p1?.message).toMatch(/keep naming/i);
  });

  it("settles a view that only grows, and refuses nobody", async () => {
    withIndex = { 1: GROWS, 2: GROWS };
    const { runner, rows } = await coldWorld();

    const { declined, projected } = await look(runner, rows, ["p1", "p2"]);

    expect(declined).toEqual({});
    expect(projected).toEqual(["p1", "p2"]);
  });

  it("runs no extra view once settled: one declaration round and one projection per seat", async () => {
    withIndex = { 1: GROWS, 2: GROWS };
    const { runner, rows } = await coldWorld();
    await look(runner, rows, ["p1", "p2"]);

    viewCalls = 0;
    await look(runner, rows, ["p1", "p2"]);
    expect(viewCalls).toBe(4);
  });

  it("runs no extra view while loading either: one per seat per round, plus the projection", async () => {
    withIndex = { 1: GROWS, 2: GROWS };
    const { runner, rows } = await coldWorld();

    viewCalls = 0;
    await look(runner, rows, ["p1", "p2"]);
    // Rounds: lobby+index, then room, then nothing new; then the projection.
    expect(viewCalls).toBe(8);
  });

  it("asks afresh on the next look, so a view that moved between looks is not refused", async () => {
    withIndex = { 1: GROWS, 2: GROWS };
    const { runner, rows } = await coldWorld();
    await look(runner, rows, ["p1"]);

    // Everything is resident now, and the view names only the room: nothing
    // was loaded during this look, so there is no earlier round to compare to.
    withIndex = { 1: ["room"], 2: GROWS };
    const { declined, projected } = await look(runner, rows, ["p1"]);
    expect(declined).toEqual({});
    expect(projected).toEqual(["p1"]);
  });
});
