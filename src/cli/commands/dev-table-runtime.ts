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
import chalk from 'chalk';

import type { GameStateSnapshot } from '../../engine/index.js';
import type { executeOp as sessionExecuteOp, GameDefinition, RulesReload } from '../../session/index.js';
import type { MultiplayerHost, TableRules } from '../dev-host/multiplayer-host.js';
import { createRulesReloadQueue, type RulesReloadQueue } from '../dev-host/rules-reload-queue.js';
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

  // Ops get the WHOLE definition, exactly as the platform's executor hands it
  // over, so every field an op reads (undo and checkpoint policy, tutorial,
  // bot) holds here as it does there. A hand-picked copy drops whatever it
  // does not name (#361).
  return {
    gameDefinition,
    rules: {
      executeOp: (gameOptions, snapshot, pendingState, op, hostOptions) =>
        executeOp(gameDefinition, gameOptions, snapshot, pendingState, op, hostOptions),
      carry: (gameOptions, snapshot, hostOptions) =>
        reload(gameDefinition, gameOptions, snapshot as GameStateSnapshot, hostOptions),
    },
  };
}

/**
 * What a rules edit changed that a running table host cannot take (#343).
 *
 * The seat range and the game type were read once at startup: the lobby, the
 * seat map and every start op were built from them. An edit that changes one is
 * refused by name, and the table keeps the rules it had, because running new
 * rules against a table shaped for the old ones fails somewhere much less clear.
 * Returns null when the edit is one the host can take.
 */
export function tableShapeChange(
  running: Pick<GameDefinition, 'gameType' | 'minPlayers' | 'maxPlayers'>,
  edited: Pick<GameDefinition, 'gameType' | 'minPlayers' | 'maxPlayers'>,
): string | null {
  const changed: string[] = [];
  if (edited.gameType !== running.gameType) {
    changed.push(`gameType (from "${running.gameType}" to "${edited.gameType}")`);
  }
  if (edited.minPlayers !== running.minPlayers || edited.maxPlayers !== running.maxPlayers) {
    changed.push(
      `the seat range (from ${running.minPlayers}-${running.maxPlayers} to ${edited.minPlayers}-${edited.maxPlayers})`,
    );
  }
  if (changed.length === 0) return null;
  return (
    `This edit changes ${changed.join(' and ')}, which the running table was set up from, so it ` +
    'is still running the rules it had. Stop `boardsmith dev` and start it again to use them.'
  );
}

/** The terminal's line for a rules reload the table took, or null when there was no game to carry. */
export function describeTableReload(outcome: RulesReload | null): string | null {
  if (outcome === null) return 'Reloaded. The next game starts on the edited rules.';
  switch (outcome.kind) {
    case 'restored':
      return 'Reloaded. The game goes on from where it was, on the edited rules.';
    case 'replayed':
      return (
        `Reloaded. The game's saved position does not fit the edited rules (${outcome.restoreError}), ` +
        `so it was rebuilt by replaying its ${outcome.moves} move${outcome.moves === 1 ? '' : 's'} on them. ` +
        'Any half-finished selection was dropped.'
      );
    case 'failed':
      // MultiplayerHost has already said so, to the terminal and every page.
      return null;
  }
}

/**
 * THE TABLE ROAD'S RULES RELOAD QUEUE (#343, #379).
 *
 * `load` bundles the rules again; the queue holds every page's messages from
 * the save until the table runs what it loaded (see `rules-reload-queue.ts`).
 * An edit that changes the table's shape is refused by name, and the held moves
 * are refused with the same words.
 */
export function tableRulesReloadQueue(args: {
  host: Pick<MultiplayerHost, 'reloadRules' | 'tellRulesReload'>;
  /** The definition the running table was set up from. */
  running: Pick<GameDefinition, 'gameType' | 'minPlayers' | 'maxPlayers'>;
  load: () => Promise<TableRuntime>;
}): RulesReloadQueue {
  return createRulesReloadQueue<TableRuntime>({
    what: 'table',
    load: args.load,
    adopt: async (runtime) => {
      const refusal = tableShapeChange(args.running, runtime.gameDefinition);
      if (refusal !== null) throw new Error(refusal);
      const said = describeTableReload(await args.host.reloadRules(runtime.rules));
      if (said !== null) console.log(chalk.green(`  ${said}\n`));
    },
    tell: (notice) => args.host.tellRulesReload(notice),
  });
}
