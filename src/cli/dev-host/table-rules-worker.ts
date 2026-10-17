/**
 * A TABLE'S RULES, INSIDE THEIR WORKER (#885).
 *
 * Bundled beside the rules (`dev-table-runtime.ts` writes the entry that calls
 * {@link serveTableRules}), so `executeOp` and the reload step run on the
 * engine the rules were built with. The host sends ops with their snapshot and
 * gets results back; nothing from the bundle reaches it but plain data.
 */
import type { GameStateSnapshot } from '../../engine/utils/index.js';
import { declaredGameOptionsOf, withDeclaredGameOptions } from '../../session/game-option-selection.js';
import { executeOp, type GameDefinition } from '../../session/index.js';
import type { MultiplayerHostOptions, TableRules } from './multiplayer-host.js';
import { serveRules } from './rules-worker.js';
import { reloadTableRules } from './table-rules-reload.js';

/**
 * WHAT THE HOST READS OF A TABLE'S `gameDefinition`: its seat range, lobby and
 * persistence, as plain data. `declaredGameOptions` are `boardsmith.json`'s
 * game options, which the bundle's definition carries (#701).
 */
export type TableDefinition = Pick<
  GameDefinition,
  'gameType' | 'displayName' | 'minPlayers' | 'maxPlayers' | 'presets' | 'playerOptions' | 'colorPalette' | 'persistence'
> & { readonly declaredGameOptions?: ReturnType<typeof declaredGameOptionsOf> };

/** The calls the host makes, by type, with what each carries. */
export interface TableCalls {
  executeOp: Parameters<MultiplayerHostOptions['executeOp']>;
  carry: Parameters<TableRules['carry']>;
}

/** Serve the table's rules to the host; `rules` is the bundle's `gameDefinition`. */
// Called from the bundle entry `bundleTableRules` writes, which fallow cannot see.
// fallow-ignore-next-line unused-export
export function serveTableRules(rules: GameDefinition | undefined): void {
  serveRules(rules, (gameDefinition, gameOptions) => {
    // Ops get the WHOLE definition, exactly as the platform's executor hands it
    // over, so every field an op reads (undo and checkpoint policy, tutorial,
    // bot) holds here as it does there (#361).
    const definition = withDeclaredGameOptions(gameDefinition, gameOptions);
    const ready: TableDefinition = {
      gameType: definition.gameType,
      displayName: definition.displayName,
      minPlayers: definition.minPlayers,
      maxPlayers: definition.maxPlayers,
      presets: definition.presets,
      playerOptions: definition.playerOptions,
      colorPalette: definition.colorPalette,
      persistence: definition.persistence,
      declaredGameOptions: declaredGameOptionsOf(definition),
    };
    return {
      ready,
      handlers: {
        executeOp: ([options, snapshot, pendingState, op, hostOptions]: TableCalls['executeOp']) =>
          executeOp(definition, options, snapshot, pendingState, op, hostOptions),
        carry: ([options, snapshot, hostOptions]: TableCalls['carry']) =>
          reloadTableRules(definition, options, snapshot as GameStateSnapshot, hostOptions),
      },
    };
  });
}
