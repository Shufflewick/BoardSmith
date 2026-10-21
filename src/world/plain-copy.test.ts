// #1347: a world callback copies a saved JSON payload with plainCopy, through a
// real engine, and what it does to the copy never reaches the world.
import { describe, expect, it } from "vitest";
import { Game, Player, Space } from "../engine/index.js";
import type { ElementJSON, GameOptions } from "../engine/index.js";
import { BoardSmithWorldEngine } from "./engine.js";
import { worldAction } from "./action.js";
import { plainCopy } from "./index.js";
import { MapStore, offerStamp } from "./stored-world.test-helper.js";
import { TEST_WORLD_ELEMENT_ID_KEY } from "../engine/element/world-element-id-key.test-helper.js";

class Archive extends Space<ArchiveGame> {
  pages: { kind: string; value: { id: string; stock: number[] }[] } = { kind: "value", value: [] };
}

class ArchiveGame extends Game<ArchiveGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Archive]);
  }
}

const ARCHIVE = "archive:1";
const SAVED = { kind: "value", value: [{ id: "body:1", stock: [1, 2] }] };

const peek = worldAction<ArchiveGame>("peek")
  .needs(() => [ARCHIVE])
  .chooseFrom("what", { choices: ["pages"] })
  .quote((_args, { game }) => {
    const copy = plainCopy(game.first(Archive, "archive")!.pages);
    const before = JSON.stringify(copy);
    copy.value[0].stock.push(3);
    return [before];
  })
  .execute(() => {});

function newGame(): ArchiveGame {
  return new ArchiveGame({ playerCount: 1, seed: "archive", worldMode: true, elementIdKey: TEST_WORLD_ELEMENT_ID_KEY });
}

function genesis(): MapStore {
  const game = newGame();
  const archive = game.create(Archive, "archive");
  archive.pages = structuredClone(SAVED);
  return new MapStore(
    new Map([[ARCHIVE, { parentId: game.id, json: JSON.parse(JSON.stringify(archive.toJSON())) as ElementJSON }]]),
  );
}

describe("plainCopy in a world callback (#1347)", () => {
  it("hands a quote the saved payload as its own plain data, and leaves the world as it was", async () => {
    const engine = new BoardSmithWorldEngine({
      game: newGame(),
      seats: new Map([["player-a", 1]]),
      store: genesis(),
      actions: [peek],
      view: () => [ARCHIVE],
    });
    await engine.hydrate([ARCHIVE]);
    const stamp = offerStamp(Date.UTC(2026, 8, 14), [1]);

    const first = await engine.resolveQuote("player-a", "peek", { what: "pages" }, stamp);
    const second = await engine.resolveQuote("player-a", "peek", { what: "pages" }, stamp);

    expect(first).toEqual([JSON.stringify(SAVED)]);
    expect(second).toEqual(first);
  });
});
