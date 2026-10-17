/**
 * A TABLE'S RULES, AS THE `boardsmith dev` HOST RUNS THEM.
 *
 * The author's `gameDefinition`, the `executeOp` that runs it, and the reload
 * step that carries a running game onto edited rules (#343), all out of ONE
 * esbuild bundle so they share a single engine; if `executeOp` came from the
 * CLI's own bundle instead it would be a different engine module from the
 * rules' base classes, and cross-instance identity (instanceof, registries)
 * would break -- the same reason production externalizes a single boardsmith
 * for the executor.
 *
 * The bundle runs in a worker the host calls by message (#885,
 * `../dev-host/rules-worker.ts`), and a reload throws the old one away, so no
 * rules bundle is ever imported into this process.
 */
import chalk from 'chalk';

import type { GameDefinition, RulesReload } from '../../session/index.js';
import type { MultiplayerHost, TableRules } from '../dev-host/multiplayer-host.js';
import { createRulesReloadQueue, type RulesReloadQueue } from '../dev-host/rules-reload-queue.js';
import { startRulesWorker } from '../dev-host/rules-worker.js';
import type { TableCalls, TableDefinition } from '../dev-host/table-rules-worker.js';
import { buildRuntimeBundle, cliSourceFile, toPosix } from './game-runtime.js';

export interface TableRuntime {
  /** What the host reads of the rules' `gameDefinition`. */
  readonly gameDefinition: TableDefinition;
  /** The rules bound to that definition, ready for `MultiplayerHost`. */
  readonly rules: TableRules;
  /** Stop the worker the rules run in, once every op already sent has answered. */
  close(): Promise<void>;
}

/** Bundle a table project's rules with what runs them; answers the bundle's path, for {@link startTableRuntime}. */
export function bundleTableRules(rulesPath: string, tempDir: string, context: 'monorepo' | 'standalone'): Promise<string> {
  const worker = JSON.stringify(toPosix(cliSourceFile('dev-host/table-rules-worker.ts')));
  return buildRuntimeBundle({
    rulesPath,
    tempDir,
    name: 'runtime',
    context,
    exports: [`import { serveTableRules } from ${worker};`, 'serveTableRules(gameDefinition);'],
  });
}

/** Start a worker on a bundle from {@link bundleTableRules}, with `boardsmith.json`'s game options. */
export async function startTableRuntime(bundlePath: string, declaredOptions: unknown): Promise<TableRuntime> {
  const { worker, ready } = await startRulesWorker(bundlePath, declaredOptions);
  const call = <T extends keyof TableCalls>(type: T, args: TableCalls[T]) => worker.call<never>(type, args);
  return {
    gameDefinition: ready as TableDefinition,
    rules: {
      executeOp: (...args) => call('executeOp', args),
      carry: (...args) => call('carry', args),
    },
    close: () => worker.close(),
  };
}

/** Bundle a table project's rules and start them. */
export async function loadTableRuntime(
  rulesPath: string,
  tempDir: string,
  context: 'monorepo' | 'standalone',
  declaredOptions: unknown,
): Promise<TableRuntime> {
  return startTableRuntime(await bundleTableRules(rulesPath, tempDir, context), declaredOptions);
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
 * are refused with the same words. Whichever rules the table is not running
 * afterwards, the refused or the replaced, have their worker stopped (#885).
 */
export function tableRulesReloadQueue(args: {
  host: Pick<MultiplayerHost, 'reloadRules' | 'tellRulesReload'>;
  /** The rules the running table was set up from. */
  running: TableRuntime;
  load: () => Promise<TableRuntime>;
}): RulesReloadQueue & {
  /** Stop the worker of the rules the table runs now, for when the host stops. */
  closeRules(): Promise<void>;
} {
  let running = args.running;
  const queue = createRulesReloadQueue<TableRuntime>({
    what: 'table',
    load: args.load,
    adopt: async (runtime) => {
      const refusal = tableShapeChange(args.running.gameDefinition, runtime.gameDefinition);
      if (refusal !== null) {
        await runtime.close();
        throw new Error(refusal);
      }
      let outcome: RulesReload | null;
      try {
        outcome = await args.host.reloadRules(runtime.rules);
      } finally {
        // The host runs the edited rules from here, even when the game could not be
        // carried onto them, or `carry` itself failed: it swaps `executeOp` first.
        const replaced = running;
        running = runtime;
        await replaced.close();
      }
      const said = describeTableReload(outcome);
      if (said !== null) console.log(chalk.green(`  ${said}\n`));
    },
    tell: (notice) => args.host.tellRulesReload(notice),
  });
  return Object.assign(queue, { closeRules: () => running.close() });
}
