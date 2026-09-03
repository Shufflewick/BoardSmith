/**
 * What a PERSISTENT-WORLD PROJECT is to this CLI, and what the CLI says about
 * one -- both in a single module, because for three architectures they were in
 * two and disagreed (#304).
 *
 * A world is what a game IS, not something a run selects, so `boardsmith.json`'s
 * `world` block is the single declaration and there is no `--world` flag. What
 * the block causes here is narrow and worth stating exactly once: the dev host
 * constructs the game with `GameOptions.worldMode`, the engine's residency
 * model (docs/core-concepts.md, "Snapshot Mode and World Mode"), and runs the
 * project's TABLE game under it.
 *
 * It does NOT run the world half of the game definition. Commands, genesis, the
 * per-seat view, scheduled events and presence are called by the hosting
 * platform's world runner, which is not in this repo -- so a sentence claiming
 * otherwise sends an author away believing they have exercised a contract that
 * never executed. That is what the old notice did, and why the accurate one
 * lives here with a test on its wording.
 */

/**
 * The one page every CLI surface sends a world author to. Named rather than
 * spelled at each call site so a moved doc is one edit, and so
 * `docs/persistent-world-claims.test.ts` can hold the page itself to what the
 * CLI promises is in it.
 */
export const WORLD_AUTHORING_DOC = 'docs/persistent-worlds.md';

/** The `world` block, as `boardsmith.json` carries it. */
export interface WorldManifestBlock {
  maxPlayers?: number;
}

/**
 * Is this project a persistent world (#158)?
 *
 * The block's PRESENCE is the declaration; its absence means "this game is not
 * a persistent world".
 */
export function resolveWorldMode(config: { world?: unknown }): boolean {
  return config.world !== undefined && config.world !== null;
}

/**
 * The lines `boardsmith dev` prints for a world project, or none at all for a
 * game that is not one.
 *
 * Returned rather than printed so the wording is testable, which is the whole
 * point: the sentence this replaces was the defect.
 */
export function worldModeNotice(config: { world?: WorldManifestBlock | null }): string[] {
  if (!resolveWorldMode(config)) return [];
  const capacity =
    typeof config.world?.maxPlayers === 'number'
      ? `world.maxPlayers ${config.world.maxPlayers}`
      : 'no world.maxPlayers declared, which `boardsmith validate` requires';
  return [
    `Persistent world project (${capacity}).`,
    `  \`boardsmith dev\` plays this project's TABLE game, constructed with worldMode --`,
    '  the engine residency model a world uses, which unlocks the partition APIs and',
    '  changes nothing about how ops run.',
    '  The world half of your game definition is run by the hosting platform, not by',
    '  this CLI: nothing here dispatches a world command, runs its genesis, projects a',
    '  world view, fires a scheduled event or reports presence.',
    `  BoardSmith ${WORLD_AUTHORING_DOC} says where a world runs and who owns that contract.`,
  ];
}
