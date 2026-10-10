import { describe, it, expect } from 'vitest';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import { Game, Player, Action, actionStep, loop, type GameOptions } from '../engine/index.js';
import { succeeded } from './op-result.test-helper.js';

// #480: the pick handler resolves a step's ordered-list bounds against the
// selections already made (#249), and the client reads them from the choices
// reply. The op result has to carry them, or every host that runs ops through
// executeOp hands the client only the static bounds, resolved with no args.

class BudgetGame extends Game<BudgetGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<BudgetGame>('repair')
        .chooseFrom('budget', { choices: [1, 2, 3] })
        .chooseFrom('buildings', {
          choices: ['university', 'shipyard'],
          orderedList: (ctx) => ({ min: 1, max: Number(ctx.args.budget) }),
        })
        .execute(() => ({ success: true })),
    );
    this.setFlow({
      root: loop({
        maxIterations: 100,
        do: actionStep({ actions: ['repair'], player: (ctx) => ctx.game.getPlayer(1)!, turnScope: 'restart' }),
      }),
    });
  }
}

const budgetDefinition: GameDefinitionLike = { gameClass: BudgetGame, gameType: 'budget', minPlayers: 1, maxPlayers: 2 };

describe('the resolveChoices op result carries the resolved ordered-list bounds (#480)', () => {
  it('forwards bounds that read an earlier selection', async () => {
    const options = { playerCount: 2, seed: 'bs480' };
    const started = succeeded(await executeOp(budgetDefinition, options, null, null, { type: 'start' }));
    expect(started.success).toBe(true);

    for (const budget of [2, 3]) {
      const res = succeeded(await executeOp(budgetDefinition, options, started.snapshot, null, {
        type: 'resolveChoices',
        actionName: 'repair',
        selectionName: 'buildings',
        player: 1,
        args: { budget },
      }));

      expect(res.success).toBe(true);
      expect(res.orderedList).toEqual({ min: 1, max: budget });
      // Still the answer and nothing else (#450).
      expect(res).not.toHaveProperty('snapshot');
      expect(res).not.toHaveProperty('playerViews');
    }
  });

  it('leaves orderedList absent on a step that is not an ordered list', async () => {
    const options = { playerCount: 2, seed: 'bs480' };
    const started = succeeded(await executeOp(budgetDefinition, options, null, null, { type: 'start' }));
    const res = succeeded(await executeOp(budgetDefinition, options, started.snapshot, null, {
      type: 'resolveChoices',
      actionName: 'repair',
      selectionName: 'budget',
      player: 1,
      args: {},
    }));
    expect(res.success).toBe(true);
    expect(res.orderedList).toBeUndefined();
  });
});
