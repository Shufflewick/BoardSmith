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
import { boundaryKeyOf } from './testing/boundary-stamp.js';

class OptionsGame extends Game<OptionsGame, Player> {
  /** The `rounds` the latest construction was handed, restores included. */
  static constructedWithRounds: unknown;
  constructor(options: GameOptions & { rounds?: number }) {
    super(options);
    OptionsGame.constructedWithRounds = options.rounds;
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

  it('a restored game keeps the options it started with: an option missing from its snapshot stays missing', async () => {
    const bare: GameDefinitionLike = { gameClass: OptionsGame, gameType: 'options', minPlayers: 1, maxPlayers: 2 };
    const started = succeeded(await executeOp(bare, { playerCount: 1, seed: 's' }, null, null, { type: 'start' }));
    const moved = succeeded(
      await executeOp(def, { playerCount: 1, seed: 's' }, started.snapshot, null, {
        type: 'action',
        actionName: 'pass',
        player: 1,
        args: {},
        boundaryKey: boundaryKeyOf(started.snapshot),
      }),
    );
    expect(OptionsGame.constructedWithRounds).toBeUndefined();
    expect((moved.snapshot as { gameOptions: Record<string, unknown> }).gameOptions).not.toHaveProperty('rounds');
  });

  it('a start from a saved position keeps its options, even one saved before an option was declared (#708)', async () => {
    const bare: GameDefinitionLike = { gameClass: OptionsGame, gameType: 'options', minPlayers: 1, maxPlayers: 2 };
    const saved = succeeded(await executeOp(bare, { playerCount: 1, seed: 's' }, null, null, { type: 'start' }));
    const restarted = succeeded(
      await executeOp(def, { playerCount: 1, seed: 's' }, null, null, { type: 'start' }, { seedSnapshot: saved.snapshot }),
    );
    expect((restarted.snapshot as { gameOptions: Record<string, unknown> }).gameOptions).not.toHaveProperty('rounds');
  });
});
