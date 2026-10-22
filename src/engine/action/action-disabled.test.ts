/**
 * Action-level `.disabled()` — the reason IS the disabled state (issue #4).
 *
 * An action can be offered but blocked. When it is, the player must be told
 * why, and the block must be real rather than cosmetic. These tests pin both
 * halves of that contract:
 *
 *   1. `getDisabledActions(seat)` reports the reason, and the action STAYS in
 *      `getAvailableActions` — a vanished button explains nothing.
 *   2. `performAction` refuses the action with the same reason, so a client
 *      that submits it anyway (or an old tab, or a bot) gets the same answer
 *      the button gave.
 *   3. Tutorial gate reasons and `.disabled()` reasons arrive through the one
 *      channel, with the tutorial's more immediate instruction winning.
 *   4. Only what the seat is offered is checked: its step's actions and a
 *      follow-up it holds (#1432).
 *
 * Uses a minimal in-test Game subclass; no external game packages.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Game, Player, Action, actionStep, simultaneousActionStep } from '../index.js';
import type { TutorialDefinition } from '../tutorial/types.js';
import { dueSeatOffers } from '../flow/seat-activity.js';

class DisabledTestGame extends Game<DisabledTestGame, Player> {
  /** Wood available to seat 1; drives the `build` action's disabled rule. */
  wood = 1;
  /** Set by `build` so the tests can prove execution really was blocked. */
  built = 0;
  /** Set by `start`, which is then refused, so a seat holding its follow-up has nothing else to take. */
  started = false;
}

const NOT_ENOUGH_WOOD = 'You need 3 wood to build; you have 1.';

/** Opens one step that offers `actions` to both seats at once. */
function offerToBothSeats(game: DisabledTestGame, actions: string[]): void {
  game.setFlow({ root: simultaneousActionStep({ actions }) });
  game.startFlow();
}

/** `build`, `pass` and `start`, whose follow-up is `rebuild`, offered as `offer` says. */
function makeGame(offer: (game: DisabledTestGame) => void = (game) => offerToBothSeats(game, ['build', 'pass'])): DisabledTestGame {
  const game = new DisabledTestGame({ playerCount: 2 });
  game.registerActions(
    Action.create<DisabledTestGame>('build')
      .disabled(ctx => (ctx.game.wood < 3 ? `You need 3 wood to build; you have ${ctx.game.wood}.` : false))
      .execute((_args, ctx) => {
        ctx.game.built += 1;
      }),
    Action.create<DisabledTestGame>('pass').execute(() => {}),
    Action.create<DisabledTestGame>('start')
      .disabled(ctx => (ctx.game.started ? 'You have already started.' : false))
      .execute((_args, ctx) => {
        ctx.game.started = true;
        return { success: true, followUp: { action: 'rebuild', args: {} } };
      }),
    // Reached only as a follow-up, which skips the condition, as performAction does.
    Action.create<DisabledTestGame>('rebuild')
      .condition({ 'only as a follow-up': () => false })
      .disabled(ctx => (ctx.game.wood < 3 ? `You need 3 wood to build; you have ${ctx.game.wood}.` : false))
      .execute(() => {}),
  );
  offer(game);
  return game;
}

/** Seat 1 has taken `start` and holds its follow-up, `rebuild`. */
function holdingRebuild(): DisabledTestGame {
  const held = makeGame((game) => {
    game.setFlow({ root: actionStep({ actions: ['start'] }) });
    game.startFlow();
  });
  held.continueFlow('start', {}, 1);
  return held;
}

describe('action-level .disabled()', () => {
  let game: DisabledTestGame;
  let player1: Player;

  beforeEach(() => {
    game = makeGame();
    player1 = game.getPlayer(1)!;
  });

  it('reports the reason for the blocked action and nothing for the others', () => {
    expect(game.getDisabledActions(1)).toEqual({ build: NOT_ENOUGH_WOOD });
  });

  it('keeps the blocked action AVAILABLE so the UI can show it greyed out', () => {
    const names = game.getAvailableActions(player1).map(a => a.name);
    expect(names).toContain('build');
  });

  it('returns nothing once the rule stops holding', () => {
    game.wood = 5;
    expect(game.getDisabledActions(1)).toEqual({});
  });

  it('refuses execution with the reason, and does not run the handler', () => {
    const result = game.performAction('build', player1, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain(NOT_ENOUGH_WOOD);
    expect(game.built).toBe(0);
  });

  it('allows execution once the rule stops holding', () => {
    game.wood = 5;
    const result = game.performAction('build', player1, {});

    expect(result.success).toBe(true);
    expect(game.built).toBe(1);
  });

  it('leaves an action with no .disabled() rule completely untouched', () => {
    expect(game.getDisabledActions(1)['pass']).toBeUndefined();
    expect(game.performAction('pass', player1, {}).success).toBe(true);
  });

  it('evaluates the rule per seat, from that seat\'s own context', () => {
    const perSeat = new DisabledTestGame({ playerCount: 2 });
    perSeat.registerActions(
      Action.create<DisabledTestGame>('act')
        .disabled(ctx => (ctx.player.seat === 2 ? 'Only the first player may act.' : false))
        .execute(() => {}),
    );
    offerToBothSeats(perSeat, ['act']);

    expect(perSeat.getDisabledActions(1)).toEqual({});
    expect(perSeat.getDisabledActions(2)).toEqual({ act: 'Only the first player may act.' });
  });

  it('reports nothing for a seat that does not exist', () => {
    expect(game.getDisabledActions(99)).toEqual({});
  });

  it('reports nothing for an action the seat is not offered, and never runs its rule', () => {
    const unoffered = makeGame((game) => offerToBothSeats(game, ['pass']));

    expect(unoffered.getDisabledActions(1)).toEqual({});
  });

  it('reports the reason for a follow-up the seat holds, whose condition the server skips', () => {
    const held = holdingRebuild();

    expect(held.getDisabledActions(1)).toEqual({ start: 'You have already started.', rebuild: NOT_ENOUGH_WOOD });
    expect(held.performAction('rebuild', held.getPlayer(1)!, {}, { followUp: { action: 'rebuild', args: {} } }).error).toContain(NOT_ENOUGH_WOOD);
  });

  it('gives a seat holding only a refused follow-up no move', () => {
    const held = holdingRebuild();

    expect(dueSeatOffers(held.getFlowState(), held)).toEqual([
      { seat: 1, enabled: [], refused: { start: 'You have already started.', rebuild: NOT_ENOUGH_WOOD }, canMove: false },
    ]);
  });
});

describe('action-level .disabled() alongside a tutorial gate', () => {
  const tutorialDef: TutorialDefinition = {
    learnerSeat: 1,
    steps: [{ id: 'step1', gate: { action: 'pass' } }],
  };

  function makeGatedGame(): DisabledTestGame {
    const game = makeGame();
    game.tutorialDefinition = tutorialDef;
    game.tutorialProgress.set(1, { stepId: 'step1', status: 'running' });
    return game;
  }

  it('surfaces both sources through the one channel', () => {
    const disabled = makeGatedGame().getDisabledActions(1);

    // `build` is blocked by BOTH; `pass` only by neither (it is the allowed action).
    expect(Object.keys(disabled)).toEqual(['build']);
    expect(disabled['build']).toContain('pass');
  });

  it('lets the tutorial reason win, since it is the more immediate instruction', () => {
    const disabled = makeGatedGame().getDisabledActions(1);
    expect(disabled['build']).not.toBe(NOT_ENOUGH_WOOD);
  });

  it('still refuses execution when only the .disabled() rule applies', () => {
    const game = makeGatedGame();
    // Seat 2 has no tutorial running, so only the wood rule is in play.
    const result = game.performAction('build', game.getPlayer(2)!, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain(NOT_ENOUGH_WOOD);
  });
});
