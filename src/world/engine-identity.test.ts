// #283: A WORLD RUNS ON THE ENGINE ITS RULES WERE BUILT ON, OR NOT AT ALL.
//
// `boardsmith dev` bundled a world's rules with esbuild -- engine included --
// and handed the bundle's `gameDefinition` to a world runner loaded from the
// CLI's own copy of the engine. Nothing failed. The read-only projection a
// declaration reads through recognises the engine's own finders by function
// IDENTITY (`ENGINE_READ_DOORS`, ShufflewickPub #409), so against the bundle's
// copy it recognised none of them, and every `first`/`all` in every offer walk
// ran with a proxy as its receiver: a trap per element per step. Commands took
// 15-30 seconds with two seats attached.
//
// Two engines is not a slower way to run a world; it is a wrong one that
// happens to answer, and identity is not the only thing it breaks (`instanceof
// WorldRefusal`, `instanceof GameElement`). So a world built over rules from a
// different engine copy is refused at construction, by name.
//
// The second copy here is a REAL one, made the way `boardsmith dev` made it: an
// esbuild bundle of a small world game with the engine inlined.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import { describe, expect, it } from "vitest";

import { tempTree } from "../testing/temp-tree.test-helper.js";
import { createWorld } from "./index.js";
import { WorldRefusal } from "./refusals.js";
import { TEST_WORLD_ELEMENT_ID_KEY } from "../engine/element/world-element-id-key.test-helper.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

async function rulesOnTheirOwnEngine(): Promise<{ gameClass: unknown; world: unknown }> {
  const dir = tempTree("bs-engine-identity-");
  const entry = join(dir, "rules.ts");
  writeFileSync(
    entry,
    [
      `import { Game, Space } from ${JSON.stringify(join(SRC, "engine", "index.ts"))};`,
      `import { worldAction } from ${JSON.stringify(join(SRC, "world", "index.ts"))};`,
      "class Yard extends Space {}",
      "class YardGame extends Game {",
      "  constructor(options: ConstructorParameters<typeof Game>[0]) {",
      "    super(options);",
      "    this.registerElements([Yard]);",
      "  }",
      "}",
      "export const gameDefinition = {",
      "  gameClass: YardGame,",
      "  gameType: 'engine-identity',",
      "  world: {",
      "    maxPlayers: 1,",
      "    actions: [worldAction('look').needs(() => ['yard']).execute(() => {})],",
      "    view: () => ['yard'],",
      "    genesis: (game: YardGame) => ({ yard: game.create(Yard, 'yard') }),",
      "  },",
      "};",
    ].join("\n"),
  );
  const outfile = join(dir, "rules.mjs");
  await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    logLevel: "silent",
  });
  // Dynamic import: the bundle is built above, at run time.
  const module = (await import(pathToFileURL(outfile).href)) as {
    gameDefinition: { gameClass: unknown; world: unknown };
  };
  return module.gameDefinition;
}

// Built once, while the file is collected: an esbuild bundle and its import
// are slow one-time setup, and no test timeout applies here (#354, #365).
const definition = await rulesOnTheirOwnEngine();

describe("a world and its rules share one engine (#283)", () => {
  it("refuses rules built on a different copy of the engine, and says why", () => {
    let refusal: unknown;
    try {
      createWorld({
        elementIdKey: TEST_WORLD_ELEMENT_ID_KEY,
        definition: definition as Parameters<typeof createWorld>[0]["definition"],
        seed: "engine-identity",
        seats: new Map([["p1", 1]]),
      });
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(WorldRefusal);
    expect((refusal as WorldRefusal).code).toBe("engine-mismatch");
    expect((refusal as WorldRefusal).message).toMatch(/different copy of the BoardSmith engine/);
    expect((refusal as WorldRefusal).message).toMatch(/one bundle/);
  });
});
