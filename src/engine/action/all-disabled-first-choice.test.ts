/**
 * An action whose own `.disabled()` blocks it stays offered with that reason
 * even when every candidate of its first required choice is disabled too
 * (#1090). Availability used to walk the choice path first, find no enabled
 * pick, and drop the action, so the panel lost the reason and a submitted
 * attempt in a simultaneous step got "Action ... is not available".
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Action, actionStep, simultaneousActionStep, loop, type GameOptions } from '../index.js';
import { createTestGame } from '../../testing/test-game.js';

const ACTION_REASON = 'Upgrades start at 150 supply; you have 0.';
const CHOICE_REASON = 'This upgrade costs 150 supply; you have 0.';

function makeGameClass(step: 'sequential' | 'simultaneous') {
  return class UpgradeGame extends Game<UpgradeGame, Player> {
    supply = 0;
    upgrades = 0;

    constructor(options: GameOptions) {
      super(options);
      this.registerActions(
        Action.create<UpgradeGame>('upgrade')
          .disabled((ctx) => (ctx.game.supply < 150 ? ACTION_REASON : false))
          .chooseFrom('tower', {
            choices: [1, 2],
            disabled: (_tower, ctx) => ((ctx.game as UpgradeGame).supply < 150 ? CHOICE_REASON : false),
          })
          .execute((_args, ctx) => {
            ctx.game.upgrades += 1;
          }),
        Action.create<UpgradeGame>('checkIn').execute(() => {}),
      );
      const actions = ['upgrade', 'checkIn'];
      this.setFlow({
        root: loop({
          while: () => true,
          maxIterations: 10,
          do: step === 'sequential' ? actionStep({ actions }) : simultaneousActionStep({ actions }),
        }),
      });
    }
  };
}

describe.each(['sequential', 'simultaneous'] as const)('all first choices disabled, %s step (#1090)', (step) => {
  it('keeps the action available with its own reason', () => {
    const testGame = createTestGame(makeGameClass(step), { playerCount: 2 });
    const view = testGame.getPlayerView(1);

    expect(view.flowState?.availableActions).toContain('upgrade');
    expect(view.disabledActions).toEqual({ upgrade: ACTION_REASON });
    const { game } = testGame;
    expect(game.getActionExecutor().traceActionAvailability(game.getAction('upgrade')!, game.getPlayer(1)!).available).toBe(true);
  });

  it('refuses a submitted attempt with the action reason and runs nothing', () => {
    const testGame = createTestGame(makeGameClass(step), { playerCount: 2 });
    const result = testGame.tryAction(1, 'upgrade', { tower: 1 });

    expect(result.success).toBe(false);
    expect(result.error).toContain(ACTION_REASON);
    expect(testGame.game.upgrades).toBe(0);
    expect(testGame.getActionHistory()).toHaveLength(0);
  });
});
