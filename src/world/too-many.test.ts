/**
 * #1542: A PICK REFUSES AN OVER-WIDE LIST AT THE PANEL IN THE GAME'S OWN WORDS,
 * AND STILL TAKES A SUBMITTED COMMAND THAT NAMES ONE VALID CHOICE.
 *
 * A `choices` callback answers both the panel's enumeration and a submitted
 * command's validation, and cannot tell them apart, so a game that threw its own
 * "type more of it" sentence also refused a command naming one real recipient.
 * `tooMany` is that sentence, said where the host's candidate budget is enforced
 * and nowhere else.
 */
import { describe, expect, it } from "vitest";
import { Game, Player, PlayerFacingError, Space } from "../engine/index.js";
import type { ElementJSON, GameOptions } from "../engine/index.js";
import { BoardSmithWorldEngine } from "./engine.js";
import { worldAction } from "./action.js";
import { worldBudgets } from "./budgets.js";
import type { StoredPartition } from "./contract.js";
import { MapStore, offerStamp } from "./stored-world.test-helper.js";
import { STAMP as COMMAND_STAMP } from "./village.test-helper.js";
import { TEST_WORLD_ELEMENT_ID_KEY } from "../engine/element/world-element-id-key.test-helper.js";

class Post extends Space<MailGame> {}

class MailGame extends Game<MailGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Post]);
  }
}

const POST = "post:1";
const STAMP = offerStamp(1_700_000_000_000);
const NAMES = ["Pat", "Peg", "Pip", "Sam"];
const TOO_MANY = "Too many players match that name. Type more of it.";

function sendAction(sent: string[], tooMany?: string) {
  return worldAction<MailGame>("send")
    .needs(() => [POST])
    .enterText("to", { maxLength: 40 })
    .chooseFrom("recipient", {
      choices: ({ args }) => NAMES.filter((name) => name.toLowerCase().startsWith(String(args.to).toLowerCase())),
      optional: "skip",
      tooMany,
    })
    .execute(({ recipient }) => {
      sent.push(String(recipient));
    });
}

function newGame(): MailGame {
  return new MailGame({ playerCount: 1, seed: "mail", worldMode: true, elementIdKey: TEST_WORLD_ELEMENT_ID_KEY });
}

async function engineFor(sent: string[], tooMany?: string): Promise<BoardSmithWorldEngine> {
  const post = newGame().create(Post, "post");
  const engine = new BoardSmithWorldEngine({
    game: newGame(),
    seats: new Map([["player-a", 1]]),
    store: new MapStore(new Map<string, StoredPartition>([
      [POST, { parentId: newGame().id, json: JSON.parse(JSON.stringify(post.toJSON())) as ElementJSON }],
    ])),
    actions: [sendAction(sent, tooMany)],
    view: () => [POST],
    // Below the floor `worldBudgets()` enforces, as action.test.ts does, so four names are too many.
    budgets: { ...worldBudgets(), maxCandidatesPerSelection: 2 },
  });
  await engine.hydrate([POST]);
  return engine;
}

describe("#1542: a pick's own sentence for an over-wide list", () => {
  it("refuses the panel's over-wide list with the game's sentence", async () => {
    const engine = await engineFor([], TOO_MANY);

    const refused = engine.resolvePick("player-a", "send", "recipient", { to: "p" }, STAMP);

    await expect(refused).rejects.toBeInstanceOf(PlayerFacingError);
    await expect(refused).rejects.toHaveProperty("message", TOO_MANY);
  });

  it("still answers a narrow list", async () => {
    const engine = await engineFor([], TOO_MANY);

    const pick = await engine.resolvePick("player-a", "send", "recipient", { to: "s" }, STAMP);

    expect(pick.choices?.map((choice) => choice.value)).toEqual(["Sam"]);
  });

  it("takes a submitted command that names one valid choice from the same wide list", async () => {
    const sent: string[] = [];
    const engine = await engineFor(sent, TOO_MANY);

    await engine.applyCommand("player-a", { name: "send", args: { to: "p", recipient: "Pip" } }, COMMAND_STAMP);

    expect(sent).toEqual(["Pip"]);
  });

  it("says the host's own sentence when the pick gives none", async () => {
    const engine = await engineFor([]);

    await expect(engine.resolvePick("player-a", "send", "recipient", { to: "p" }, STAMP)).rejects.toThrow(
      /allows 2 per selection/,
    );
  });

  it("refuses a tooMany on the first pick, which the player has nothing earlier to narrow with", () => {
    expect(() =>
      worldAction<MailGame>("everyone")
        .needs(() => [POST])
        .chooseFrom("recipient", { choices: () => NAMES, tooMany: TOO_MANY }),
    ).toThrow(/"everyone" action's "recipient" selection is the first.*Ask an earlier selection/);
  });

  it("refuses an empty tooMany, which would show the player a blank refusal", () => {
    expect(() =>
      worldAction<MailGame>("blank")
        .needs(() => [POST])
        .enterText("to")
        .chooseFrom("recipient", { choices: () => NAMES, tooMany: " " }),
    ).toThrow(/"blank" action's "recipient" selection has an empty tooMany/);
  });
});
