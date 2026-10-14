/**
 * The `start` op hands the runner the declarations its bundle carries, so a
 * start that reaches the game without a declared option is refused, naming it
 * (#708). Filling defaults is mocked away here to stand for a host path that
 * skipped it; with filling in place, no declared option can be missing.
 */
import { describe, it, expect, vi } from 'vitest';
import { Game, Player, Action, actionStep, type GameOptions } from '../engine/index.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import { withDeclaredGameOptions } from './game-option-selection.js';

vi.mock('./game-option-selection.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./game-option-selection.js')>()),
  fillGameOptionDefaults: <O>(_declared: unknown, options: O): O => options,
}));

class OptionsGame extends Game<OptionsGame, Player> {
  constructor(options: GameOptions & { rounds?: number }) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({ root: actionStep({ actions: ['pass'], player: (ctx) => ctx.game.getPlayer(1)! }) });
  }
}

const def: GameDefinitionLike = withDeclaredGameOptions(
  { gameClass: OptionsGame, gameType: 'options', minPlayers: 1, maxPlayers: 2 },
  [{ id: 'rounds', type: 'number', label: 'Rounds', default: 3 }],
);

describe('the start op refuses a new game missing a declared option (#708)', () => {
  it('names the option', async () => {
    const result = await executeOp(def, { playerCount: 1, seed: 's' }, null, null, { type: 'start' });
    expect(result.success).toBe(false);
    expect(result.success ? '' : result.error).toContain(
      'Game option "rounds" is declared in boardsmith.json but was not passed to the game.',
    );
  });

  it('starts when the host passed every declared option', async () => {
    const result = await executeOp(def, { playerCount: 1, seed: 's', rounds: 4 }, null, null, { type: 'start' });
    expect(result.success).toBe(true);
  });
});
