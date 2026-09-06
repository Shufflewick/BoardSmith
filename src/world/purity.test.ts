/**
 * #165: NOTHING IN `boardsmith/world` MAY REACH AN ENVIRONMENT.
 *
 * The same rule `boardsmith/persistence` keeps, and for a sharper reason. A
 * hosting platform imports this module INSIDE A CLOUDFLARE WORKER BUNDLE, where
 * `node:fs` does not exist; `boardsmith dev` imports it inside a Node process,
 * where `cloudflare:workers` does not exist. One import of either makes the
 * module unloadable on the other host, and #164's whole promise is that the two
 * run the same world.
 *
 * A TIMER OR A CLOCK IS THE SUBTLER HALF, and it is the one worth a test rather
 * than a comment. A world's arithmetic is drift-free precisely because every
 * instant arrives as an argument -- a command's stamped `arrivedAt`, a
 * scheduled event's own `due`. A single `Date.now()` in here would make a
 * world's state depend on how busy its host happened to be, which is a
 * divergence no test downstream could attribute.
 *
 * Checked by reading the source rather than by trusting review, because this is
 * the class of mistake that compiles, passes every other test, and is found in
 * production on the host nobody ran locally.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Every SHIPPED source file in this module.
 *
 * A test may read the disk -- this one does -- and so may a helper a test
 * imports, which is why `*.test-helper.ts` is excluded by name rather than
 * being allowed to smuggle `vitest` into the shipped graph.
 */
const SOURCES = readdirSync(HERE, { recursive: true, encoding: "utf-8" }).filter(
  (path) =>
    path.endsWith(".ts") && !path.endsWith(".test.ts") && !path.endsWith(".test-helper.ts"),
);

/**
 * The file with its comments removed.
 *
 * Every rule below is about what the CODE does. This module's docblocks discuss
 * `Date.now()` at length -- explaining why a handler must never call one is a
 * large part of why the file is trustworthy -- and a scanner that could not
 * tell prose from a call would either fail on the explanation or force the
 * explanation to be deleted.
 */
function code(relative: string): string {
  return readFileSync(join(HERE, relative), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** What a module importable from both a Worker and a Node process may not name. */
const FORBIDDEN_IMPORTS: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern: /from\s+["']node:/,
    why: "a Cloudflare Worker bundle has no Node built-ins, and the platform imports this module inside one",
  },
  {
    pattern: /from\s+["']cloudflare:/,
    why: "`boardsmith dev` imports this module inside a plain Node process, which has no Cloudflare bindings",
  },
  {
    pattern: /from\s+["']ws["']/,
    why: "transport is the host's. A world that opened its own socket could not be driven by a test, let alone by two different hosts",
  },
  {
    pattern: /from\s+["'](fs|path|crypto|http|https|net|worker_threads)["']/,
    why: "a bare Node built-in is the same hazard as a `node:`-prefixed one",
  },
];

/** What a module whose arithmetic must be drift-free may not call. */
const FORBIDDEN_CLOCKS: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern: /\bDate\.now\(/,
    why: "an instant must arrive as an argument -- a command's stamped `arrivedAt` or a scheduled event's own `due` -- or a world drained late computes a different state from one drained on time",
  },
  {
    pattern: /\bnew Date\(\s*\)/,
    why: "same as Date.now(): the wall clock is the host's to read and the world's to be told",
  },
  {
    pattern: /\bperformance\.now\(/,
    why: "a world's decisions may not depend on how fast the machine was running",
  },
  {
    pattern: /\bsetTimeout\(|\bsetInterval\(/,
    why: "a world is woken by its host's alarm or timer, never by one it armed itself -- an isolate that could sleep would keep a world resident for the sake of a wait",
  },
  {
    pattern: /\bMath\.random\(/,
    why: "a world's randomness is the engine's seeded generator, so the same seed rebuilds the same world on every wake",
  },
];

describe("#165: boardsmith/world reaches no environment", () => {
  it("is reading the source tree it thinks it is reading", () => {
    expect(SOURCES.length).toBeGreaterThan(8);
    expect(SOURCES).toContain("index.ts");
  });

  it.each(SOURCES)("%s imports nothing environment-specific", (relative) => {
    const source = code(relative);
    for (const { pattern, why } of FORBIDDEN_IMPORTS) {
      expect(pattern.test(source), `${relative} imports something it may not: ${why}`).toBe(false);
    }
  });

  it.each(SOURCES)("%s reads no clock and rolls no dice of its own", (relative) => {
    const source = code(relative);
    for (const { pattern, why } of FORBIDDEN_CLOCKS) {
      expect(pattern.test(source), `${relative} reaches for a nondeterministic value: ${why}`).toBe(
        false,
      );
    }
  });

  it.each(SOURCES)("%s brings in nothing at runtime but this module and the engine", (relative) => {
    // The reachability half. A clean file that imports a dirty one is dirty,
    // and the cheapest way to keep the whole graph honest is to keep the graph
    // small: `boardsmith/world` depends on the engine and on itself.
    //
    // WHAT COUNTS IS WHAT SURVIVES THE COMPILE, and since #169 that distinction
    // is doing real work rather than being a technicality. A world's offer IS
    // the table's `ActionMetadata` and a world action IS an `ActionDefinition`,
    // so `contract.ts` and `engine.ts` name shapes that live in
    // `../session/types.js`. An `import type` of one emits NO import at all:
    // there is nothing left in the built file for a Cloudflare Worker to fail
    // to resolve, and nothing for `node:fs` to arrive one hop behind. A VALUE
    // import of the same file would be exactly the hazard this case is about,
    // which is why the two are told apart here rather than both waved through.
    //
    // The engine itself is reachable by whatever door the importer needs.
    // `engine.ts` reaches `../engine/element/action-metadata.js` for
    // `buildPickMetadata` -- the very function that builds a TABLE's pick
    // metadata, which is the whole point: a world's picks and a table's are the
    // same shape by construction rather than by inspection. Insisting on the
    // barrel would only mean re-exporting an internal to satisfy a regex.
    const source = code(relative);
    const imports = [...source.matchAll(/(^|\n)\s*import\s+(type\s+)?([\s\S]*?)from\s+["']([^"']+)["']/g)];
    for (const match of imports) {
      const specifier = match[4]!;
      const local = specifier.startsWith("./");
      const engine = specifier.startsWith("../engine/");
      const erased = match[2] !== undefined || everyBindingIsAType(match[3]!);
      expect(
        local || engine || erased,
        `${relative} imports "${specifier}" for a VALUE. This module may reach the engine and ` +
          "itself at runtime, and nothing else -- every other runtime dependency is a chance for " +
          "something environment-specific to arrive one import away from a file that looks " +
          "clean. A shape it only needs to NAME may come from anywhere, because `import type` " +
          "leaves nothing behind to resolve.",
      ).toBe(true);
    }
  });
});

/**
 * Whether an import clause brings in only types, written binding by binding.
 *
 * `import type { X } from` is the whole-clause form; `import { type X, type Y }`
 * is the per-binding one, and both erase completely. A clause with a default
 * binding, a namespace binding or one bare name is a value import and is not
 * this function's business to forgive.
 */
function everyBindingIsAType(clause: string): boolean {
  const braced = clause.trim();
  if (!braced.startsWith("{") || !braced.endsWith("}")) return false;
  const bindings = braced.slice(1, -1).split(",").map((binding) => binding.trim()).filter(Boolean);
  return bindings.length > 0 && bindings.every((binding) => binding.startsWith("type "));
}
