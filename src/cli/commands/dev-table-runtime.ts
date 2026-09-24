/**
 * A TABLE'S RULES, AS THE `boardsmith dev` HOST RUNS THEM.
 *
 * The table road's `loadWorldRuntime`: the author's `gameDefinition`, the
 * `executeOp` that runs it, and the reload step that carries a running game
 * onto edited rules (#343), all out of ONE esbuild bundle so they share a
 * single engine. The Node host runs the game with `executeOp(gameClass, ...)`;
 * if `executeOp` came from the CLI's own bundle instead it would be a different
 * engine module from the rules' base classes, and cross-instance identity
 * (instanceof, registries) would break -- the same reason production
 * externalizes a single boardsmith for the executor.
 *
 * The import is cache-busted, so loading again after a save is a genuine
 * re-read of the author's edited source.
 */
import type { GameStateSnapshot } from '../../engine/index.js';
import type { executeOp as sessionExecuteOp, GameDefinition, GameDefinitionLike } from '../../session/index.js';
import type { TableRules } from '../dev-host/multiplayer-host.js';
import type { reloadTableRules } from '../dev-host/table-rules-reload.js';
import { cliSourceFile, importRuntimeBundle, toPosix } from './game-runtime.js';

export interface TableRuntime {
  readonly gameDefinition: GameDefinition;
  /** The rules bound to that definition, ready for `MultiplayerHost`. */
  readonly rules: TableRules;
}

/** Bundle and load a table project's rules with what runs them. */
export async function loadTableRuntime(
  rulesPath: string,
  tempDir: string,
  context: 'monorepo' | 'standalone',
): Promise<TableRuntime> {
  const module = await importRuntimeBundle({
    rulesPath,
    tempDir,
    name: 'runtime',
    context,
    exports: [
      `export { executeOp } from 'boardsmith/session';`,
      `export { reloadTableRules } from ${JSON.stringify(toPosix(cliSourceFile('dev-host/table-rules-reload.ts')))};`,
    ],
  });
  if (typeof module.executeOp !== 'function') {
    throw new Error("Could not load executeOp from 'boardsmith/session'.");
  }
  if (typeof module.reloadTableRules !== 'function') {
    throw new Error('Could not load the table rules reload from this BoardSmith install. Reinstall boardsmith.');
  }
  const executeOp = module.executeOp as typeof sessionExecuteOp;
  const reload = module.reloadTableRules as typeof reloadTableRules;
  const { gameDefinition } = module;

  const def: GameDefinitionLike = {
    gameClass: gameDefinition.gameClass,
    gameType: gameDefinition.gameType,
    minPlayers: gameDefinition.minPlayers,
    maxPlayers: gameDefinition.maxPlayers,
    // Threaded un-serialized (mirrors game-session.ts): buildPlayerState emits
    // hasTutorial from it, and the startTutorial op reads def.tutorial.
    tutorial: gameDefinition.tutorial,
    // hint/heatmapToggle run MCTS with the game's bot config.
    bot: gameDefinition.bot,
  };
  return {
    gameDefinition,
    rules: {
      executeOp: (gameOptions, snapshot, pendingState, op, hostOptions) =>
        executeOp(def, gameOptions, snapshot, pendingState, op, hostOptions),
      carry: (gameOptions, snapshot, hostOptions) =>
        reload(def, gameOptions, snapshot as GameStateSnapshot, hostOptions),
    },
  };
}
