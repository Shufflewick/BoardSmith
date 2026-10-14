/**
 * The `start` op fills every option a game's bundle declares (#701). The
 * platform admits a player's choice against the manifest, which never lists a
 * designer-only option, so the declarations the bundle carries (attached by
 * every BoardSmith command, and written into the rules `boardsmith build`
 * publishes) are what give such an option its default there.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Action, actionStep, type GameOptions } from '../engine/index.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import { withDeclaredGameOptions } from './game-option-selection.js';
import { succeeded } from './op-result.test-helper.js';

class OptionsGame extends Game<OptionsGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({ root: actionStep({ actions: ['pass'], player: (ctx) => ctx.game.getPlayer(1)! }) });
  }
}

const list = [
  { id: 'rounds', type: 'number', label: 'Rounds', default: 3 },
  { id: 'lootScale', type: 'number', label: 'Loot scale', default: 1, designerOnly: true },
];

const def: GameDefinitionLike = withDeclaredGameOptions(
  { gameClass: OptionsGame, gameType: 'options', minPlayers: 1, maxPlayers: 2 },
  list,
);

async function startedOptions(definition: GameDefinitionLike, options: Record<string, unknown>) {
  const result = succeeded(
    await executeOp(definition, { playerCount: 1, seed: 's', ...options }, null, null, { type: 'start' }),
  );
  return (result.snapshot as { gameOptions: Record<string, unknown> }).gameOptions;
}

describe('the start op fills the options the bundle declares (#701)', () => {
  it('an option the host did not pass, designer-only or not, starts at its default', async () => {
    expect(await startedOptions(def, {})).toMatchObject({ rounds: 3, lootScale: 1 });
  });

  it('a value the host passed is kept', async () => {
    expect(await startedOptions(def, { rounds: 5, lootScale: 2 })).toMatchObject({ rounds: 5, lootScale: 2 });
  });

  it('a definition imported from source, with no declarations, starts with what the host passed', async () => {
    const bare: GameDefinitionLike = { gameClass: OptionsGame, gameType: 'options', minPlayers: 1, maxPlayers: 2 };
    expect(await startedOptions(bare, {})).not.toHaveProperty('rounds');
  });
});
