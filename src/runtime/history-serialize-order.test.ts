import { describe, it, expect, vi, afterEach } from 'vitest';
import { Action, Game, Player, simultaneousActionStep, type GameOptions } from '../engine/index.js';
import { createSnapshot } from './index.js';
import { GameRunner } from './runner.js';
import { TestGame } from '../testing/test-game.js';

// #1128: performAction encoded a submission for history before the action's
// condition and its picks were checked, running choice callbacks on picks
// nobody had checked and on attributes a false condition guards, and threw.

const catalog: Record<string, string[]> = { Scuttlers: ['Drill'] };
let trace: string[] = [];

class Buyer extends Player<PurchaseGame, Buyer> {
  static override visibleAttributes = [];
  owned: string[] = [];
}

const ownershipKnown = {
  'ownership is known': (ctx: { player: Buyer }) => {
    trace.push('condition');
    return !ctx.player.isAttributeRedacted('owned');
  },
};

class PurchaseGame extends Game<PurchaseGame, Buyer> {
  static PlayerClass = Buyer;

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<PurchaseGame>('buy')
        .condition(ownershipKnown)
        .chooseFrom('unit', { choices: ['Scuttlers'] })
        .chooseFrom('technology', {
          dependsOn: 'unit',
          choices: (ctx) => {
            trace.push('technology choices');
            if (ctx.args.unit === undefined) return [];
            return catalog[ctx.args.unit as string].map((value) => ({
              value,
              label: `${value} (${ctx.player.owned.length} prior purchases)`,
            }));
          },
        })
        .execute(({ technology }, ctx) => {
          ctx.player.owned = [...ctx.player.owned, technology as string];
          return { success: true };
        }),
      // The comment's case: the first pick's own labels read the guarded field.
      Action.create<PurchaseGame>('sell')
        .condition(ownershipKnown)
        .chooseFrom('pack', {
          choices: (ctx) => {
            trace.push('pack choices');
            return [{ value: 'fielded:1', label: `Pack (${ctx.player.owned.length} owned)` }];
          },
        })
        .execute(() => ({ success: true })),
      // The same guard in front of a repeating pick, judged pick by pick (#1101).
      Action.create<PurchaseGame>('salvage')
        .condition(ownershipKnown)
        .chooseFrom('part', {
          choices: (ctx) => {
            trace.push('part choices');
            return [{ value: 'gear', label: `Gear (${ctx.player.owned.length} owned)` }];
          },
          repeat: { until: () => true },
        })
        .execute(() => ({ success: true })),
      Action.create<PurchaseGame>('pass').execute(() => ({ success: true })),
    );
    this.setFlow({
      root: simultaneousActionStep({
        name: 'shopping',
        actions: ['buy', 'sell', 'salvage', 'pass'],
        playerDone: () => false,
      }),
    });
  }
}

const gameOptions = { playerCount: 2, seed: 'history-serialize-order' };

function runner(): GameRunner<PurchaseGame> {
  const value = new GameRunner({ GameClass: PurchaseGame, gameType: 'history-serialize-order', gameOptions });
  value.start();
  return value;
}

function seatTwoCopy(): GameRunner<PurchaseGame> {
  const snapshot = createSnapshot(runner().game, 'history-serialize-order', [], 'history-serialize-order', {
    forSeat: 2, reseed: 'history-serialize-order-seat-two',
  });
  return GameRunner.fromSnapshot(snapshot, PurchaseGame);
}

/** performAction's result, with the trace of callbacks it ran and whether it left the game and its history as they were. */
function perform(target: GameRunner<PurchaseGame>, action: string, args: Record<string, unknown>) {
  const state = () => JSON.stringify([target.game.toJSON(), target.actionHistory]);
  const before = state();
  trace = [];
  const result = target.performAction(action, 1, args);
  return { result, trace, unchanged: state() === before };
}

describe('history is encoded only for a submission its checks accept (#1128)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses a missing earlier pick, as before', () => {
    const { result, unchanged } = perform(runner(), 'buy', { technology: 'Drill' });

    expect(result).toMatchObject({ success: false, error: 'Missing required selection: unit' });
    expect(unchanged).toBe(true);
  });

  it('refuses an earlier pick that is not offered without running the pick that depends on it', () => {
    const { result, trace: ran, unchanged } = perform(runner(), 'buy', { unit: 'Unknown', technology: 'Drill' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^That choice is no longer available/);
    expect(ran).not.toContain('technology choices');
    expect(unchanged).toBe(true);
  });

  it('still takes and records a submission its checks accept', () => {
    const target = runner();

    const { result } = perform(target, 'buy', { unit: 'Scuttlers', technology: 'Drill' });

    expect(result.success).toBe(true);
    expect(target.actionHistory.map((entry) => entry.args)).toEqual([{ unit: 'Scuttlers', technology: 'Drill' }]);
    expect(target.game.getPlayer(1)!.owned).toEqual(['Drill']);
  });

  it.each([
    ['a dependent labelled pick', 'buy', { unit: 'Scuttlers', technology: 'Drill' }, 'technology choices'],
    ['a first labelled pick', 'sell', { pack: 'fielded:1' }, 'pack choices'],
    ['a repeating labelled pick', 'salvage', { part: ['gear'] }, 'part choices'],
  ])('in a redacted seat copy, a false condition refuses %s before its labels read the hidden field', (_name, action, args, choices) => {
    const redacted = seatTwoCopy();
    expect(redacted.game.getPlayer(1)!.isAttributeRedacted('owned')).toBe(true);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result, trace: ran, unchanged } = perform(redacted, action, args);

    expect(result).toMatchObject({ success: false, error: 'Action is not available' });
    expect(ran[0]).toBe('condition');
    expect(ran).not.toContain(choices);
    expect(logged).not.toHaveBeenCalled();
    expect(unchanged).toBe(true);
  });

  it('reaches TestGame.tryAction as a refusal, never a throw', () => {
    const testGame = TestGame.create(PurchaseGame, { playerCount: 2, seed: 'history-serialize-order' });
    trace = [];

    const result = testGame.tryAction(1, 'buy', { unit: 'Unknown', technology: 'Drill' });

    expect(result.success).toBe(false);
    expect(trace).not.toContain('technology choices');
  });
});
