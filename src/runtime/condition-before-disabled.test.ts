import { describe, it, expect, vi, afterEach } from 'vitest';
import { Action, Game, Player, simultaneousActionStep, type GameOptions } from '../engine/index.js';
import { createSnapshot } from './index.js';
import { GameRunner } from './runner.js';
import { ErrorCode } from '../types/protocol.js';
import { enumerateActionMoves } from '../engine/utils/enumerate-moves.js';

// #1129: a false condition guards the disabled rule on submission, as it does
// on offer. In a redacted seat copy the rule reads an attribute the copy was
// never told, so evaluating it first threw instead of refusing.

let trace: string[] = [];

class Buyer extends Player<RecoveryGame, Buyer> {
  static override visibleAttributes = [];
  owned = false;
}

class RecoveryGame extends Game<RecoveryGame, Buyer> {
  static PlayerClass = Buyer;

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<RecoveryGame>('buy')
        .condition({
          'ownership is known': (ctx) => {
            trace.push('condition');
            return !ctx.player.isAttributeRedacted('owned');
          },
        })
        .disabled((ctx) => {
          trace.push('disabled');
          return ctx.player.owned ? 'Already owned.' : false;
        })
        .execute((_args, ctx) => {
          ctx.player.owned = true;
          return { success: true };
        }),
      Action.create<RecoveryGame>('pass').execute(() => ({ success: true })),
    );
    this.setFlow({
      root: simultaneousActionStep({
        name: 'shopping',
        actions: ['buy', 'pass'],
        playerDone: () => false,
      }),
    });
  }
}

function seatTwoCopy(): GameRunner<RecoveryGame> {
  const truth = new GameRunner({
    GameClass: RecoveryGame,
    gameType: 'condition-before-disabled',
    gameOptions: { playerCount: 2, seed: 'condition-before-disabled' },
  });
  truth.start();
  const snapshot = createSnapshot(truth.game, 'condition-before-disabled', [], 'condition-before-disabled', {
    forSeat: 2, reseed: 'condition-before-disabled-seat-two',
  });
  return GameRunner.fromSnapshot(snapshot, RecoveryGame);
}

describe('a false condition is checked before the disabled rule (#1129)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses a submission as unavailable without running the disabled rule', () => {
    const redacted = seatTwoCopy();
    const hiddenOwner = redacted.game.getPlayer(1)!;
    expect(hiddenOwner.isAttributeRedacted('owned')).toBe(true);
    expect(redacted.game.getAvailableActions(hiddenOwner).map((a) => a.name)).toEqual(['pass']);

    const state = JSON.stringify(redacted.game.toJSON());
    const history = JSON.stringify(redacted.getSnapshot().actionHistory);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    trace = [];

    const result = redacted.performAction('buy', 1, {});

    expect(trace[0]).toBe('condition');
    expect(trace).not.toContain('disabled');
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(ErrorCode.ACTION_EXECUTION_ERROR);
    expect(result.error).toBe('Action is not available');
    expect(logged).not.toHaveBeenCalled();
    expect(JSON.stringify(redacted.game.toJSON())).toBe(state);
    expect(JSON.stringify(redacted.getSnapshot().actionHistory)).toBe(history);
    expect(hiddenOwner.isAttributeRedacted('owned')).toBe(true);
  });

  it('still refuses with the disabled reason once the condition holds', () => {
    const runner = new GameRunner({
      GameClass: RecoveryGame,
      gameType: 'condition-before-disabled',
      gameOptions: { playerCount: 2, seed: 'condition-before-disabled' },
    });
    runner.start();
    expect(runner.performAction('buy', 1, {}).success).toBe(true);
    trace = [];

    const result = runner.performAction('buy', 1, {});

    expect(trace.slice(0, 2)).toEqual(['condition', 'disabled']);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Action 'buy' is disabled: Already owned.");
  });

  it('leaves the action out of a bot\'s moves without running the disabled rule', () => {
    const redacted = seatTwoCopy();
    trace = [];

    const moves = enumerateActionMoves(redacted.game, redacted.game.getAction('buy')!, redacted.game.getPlayer(1)!);

    expect(moves).toEqual([]);
    expect(trace).toEqual(['condition']);
  });
});
