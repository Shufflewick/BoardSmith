/**
 * What a PERSISTENT-WORLD PROJECT is to this CLI -- one module, because for
 * three architectures it was two and they disagreed (#304).
 *
 * A world is what a game IS, not something a run selects, so `boardsmith.json`'s
 * `"backend": "world"` is the single declaration and NO COMMAND TAKES A FLAG TO
 * SAY SO. `boardsmith init --world` is not an exception to that: it is what
 * WRITES the declaration, once, into a project that does not exist yet. Every
 * command after it reads it and nothing asks again.
 *
 * ## WHAT THE BLOCK CAUSES, AS OF #167
 *
 * `boardsmith dev` RUNS THE WORLD. It opens the project's durable local store,
 * runs the bundle's genesis once, serves `world.html` (or the shell's own
 * surface for a project that has not written one), dispatches commands through
 * `partitions(args, seat)` and then `run`, projects `view(seat)` per attached
 * seat, fires scheduled events on their due time, and reports presence from the
 * seats it has open. It does NOT play the project's table half; a world project
 * with no table half is not a problem for it, which is the shape
 * `boardsmith init --world` scaffolds.
 *
 * That is a change of fact and not of wording. Until #167 the dev host served
 * the TABLE game constructed with `worldMode`, and this file's job was to stop
 * a notice claiming otherwise -- because a sentence claiming a world had run
 * sends an author away believing they exercised a contract that never executed.
 * The claim is now true, so the notice that denied it is gone rather than
 * softened, and what says what a world run does is `dev-world.ts:worldDevBanner`,
 * beside the code that does it.
 *
 * The runtime under all of it is `boardsmith/world` (#165): the same library the
 * hosting platform drives in production, driven on a laptop by
 * `cli/dev-host/world-host.ts` over `cli/dev-host/world-store.ts`.
 */

/**
 * The one page every CLI surface sends a world author to. Named rather than
 * spelled at each call site so a moved doc is one edit, and so
 * `docs/persistent-world-claims.test.ts` can hold the page itself to what the
 * CLI promises is in it.
 */
export const WORLD_AUTHORING_DOC = 'docs/persistent-worlds.md';

/**
 * Is this project a persistent world (#158, #171)?
 *
 * READ FROM THE DECLARED BACKEND, not from the presence of a block. Until #171
 * the answer was "boardsmith.json has a `world` key", which made the backend a
 * thing every reader inferred rather than a thing the project stated -- and it
 * left a world's capacity restated in two files free to disagree. The block is
 * gone from `boardsmith.json`: `backend` says which backend runs, and the
 * world's own `maxPlayers` lives in the compiled `gameDefinition.world`, which
 * is the number the runtime actually enforces.
 *
 * This is the one place the CLI is allowed to branch on the backend NAME, and
 * it branches on it to pick a HOST -- which host to start is the one question a
 * capability set cannot answer, and it has to be answered before any rules are
 * loaded. Everything a game may PROMISE is `capabilities`, never this.
 */
export function resolveWorldMode(config: { backend?: unknown }): boolean {
  return config.backend === 'world';
}
