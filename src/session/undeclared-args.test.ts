/**
 * A client may send only the picks an action declares (#662).
 *
 * An action's args are its picks. A follow-up's other args (`.followUpArgs<...>()`)
 * are the engine's: they come from the follow-up the seat holds, never from a
 * client. A key that names no pick is refused, with the key named and the picks
 * the action takes listed, on every path a client's args enter: a whole
 * submission (the `action` op, `GameRunner.performAction`), a selection step and
 * its `initialArgs`, and a pick's choices. A pick a held follow-up answered is
 * the engine's too: a client's value for it is not used.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  actionStep,
  enumerateLegalMoves,
  type GameOptions,
} from '../engine/index.js';
import { GameRunner } from '../runtime/index.js';
import { PendingActionManager } from './pending-action-manager.js';
import { PickHandler } from './pick-handler.js';
import { ErrorCode } from './types.js';

class Stone extends Piece<DuelGame> {}
class Pile extends Space<DuelGame> {}

/** One completed action, as its `execute` saw it. */
type Run = Record<string, unknown>;

class DuelGame extends Game<DuelGame, Player> {
  runs: Run[] = [];
  /** The picks whose onSelect ran, in order. */
  selected: string[] = [];

  constructor(options: GameOptions) {
    super(options);
    const pile = this.create(Pile, 'pile');
    pile.create(Stone, 'A');
    pile.create(Stone, 'B');

    this.registerActions(
      Action.create<DuelGame>('buy')
        .chooseFrom('color', { choices: ['red', 'blue'] })
        .chooseFrom('pay', { choices: (ctx) => ('discount' in ctx.args ? ['nothing'] : ['gold']) })
        .execute((args) => {
          this.runs.push({ action: 'buy', ...args });
        }),
      Action.create<DuelGame>('gather')
        // Each coin once, so its moves can be listed (#692): an unbounded repeat is too many.
        .chooseFrom('coins', {
          choices: (ctx) => ['a', 'b', 'stop'].filter((coin) => !((ctx.args.coins as string[] | undefined) ?? []).includes(coin)),
          repeat: { until: (_ctx, last) => last === 'stop' },
        })
        .execute((args) => {
          this.runs.push({ action: 'gather', ...args });
        }),
      Action.create<DuelGame>('rest').execute((args) => {
        this.runs.push({ action: 'rest', ...args });
      }),
      // Checkers' multi-jump in small: a jump chains to another jump with the
      // same stone, and counts the jumps of the chain in `chain`.
      Action.create<DuelGame>('jump')
        .followUpArgs<{ chain: number }>()
        .chooseElement('stone', {
          elementClass: Stone,
          onSelect: (stone) => { this.selected.push(`stone:${stone.name}`); },
        })
        .chooseFrom('to', { choices: (ctx) => [`${ctx.args.stone?.name}-to-${ctx.args.chain ?? 0}`] })
        .execute((args) => {
          this.runs.push({ action: 'jump', stone: args.stone.name, to: args.to, chain: args.chain });
          const chain = (args.chain ?? 0) + 1;
          return chain < 3
            ? { success: true, followUp: { action: 'jump', args: { stone: args.stone.id, chain } } }
            : { success: true };
        }),
      Action.create<DuelGame>('start').execute(() => ({
        success: true,
        followUp: { action: 'sweep', args: { by: 'engine' } },
      })),
      Action.create<DuelGame>('sweep')
        .followUpArgs<{ by: string }>()
        .condition({ 'only as a follow-up': () => false })
        .chooseFrom('coins', { choices: ['a', 'stop'], repeat: { until: (_ctx, last) => last === 'stop' } })
        .execute((args) => {
          this.runs.push({ action: 'sweep', coins: args.coins, by: args.by });
        }),
    );

    this.setFlow({
      root: actionStep({
        actions: ['buy', 'gather', 'rest', 'jump', 'start'],
        player: (ctx) => ctx.game.getPlayer(1)!,
        repeatUntil: () => false,
        maxMoves: 50,
      }),
    });
  }
}

function duel() {
  const runner = new GameRunner({
    GameClass: DuelGame,
    gameType: 'duel',
    gameOptions: { playerCount: 1, playerNames: ['Alice'], seed: 'test' },
  });
  runner.start();
  const game = runner.game as DuelGame;
  const stoneId = (name: string) => game.first(Stone, name)!.id;
  return { runner, game, stoneId, manager: new PendingActionManager(runner), picks: new PickHandler(runner) };
}

/** Take the first jump with stone A, so the seat holds a jump chained from it. */
function holdJump(runner: GameRunner<DuelGame>, stoneId: (name: string) => number) {
  expect(runner.performAction('jump', 1, { stone: stoneId('A'), to: 'A-to-0' }).success).toBe(true);
  expect(runner.getFlowState()?.followUps).toEqual([{ action: 'jump', args: { stone: stoneId('A'), chain: 1 }, seat: 1 }]);
}

describe('a whole submission carries only declared picks (#662)', () => {
  it('refuses a key no pick declares, naming it and the picks the action takes', () => {
    const { runner, game } = duel();

    const result = runner.performAction('buy', 1, { color: 'red', pay: 'gold', discount: 100 });

    expect(result).toMatchObject({
      success: false,
      error: "'buy' was sent 'discount', which is not one of its picks. It takes: color, pay.",
    });
    expect(game.runs).toEqual([]);
  });

  it('refuses one on an action with a repeating pick the same way', () => {
    const { runner, game } = duel();

    const result = runner.performAction('gather', 1, { coins: ['a', 'stop'], bonus: 1 });

    expect(result).toMatchObject({
      success: false,
      error: "'gather' was sent 'bonus', which is not one of its picks. It takes: coins.",
    });
    expect(game.runs).toEqual([]);
  });

  it('refuses any key on an action with no picks', () => {
    const { runner, game } = duel();

    const result = runner.performAction('rest', 1, { hours: 8 });

    expect(result).toMatchObject({ success: false, error: "'rest' was sent 'hours', but it takes no picks." });
    expect(game.runs).toEqual([]);
  });

  it('refuses a follow-up arg a client sends when no follow-up is held', () => {
    const { runner, game, stoneId } = duel();

    const result = runner.performAction('jump', 1, { stone: stoneId('A'), to: 'A-to-0', chain: 2 });

    expect(result).toMatchObject({
      success: false,
      error: "'jump' was sent 'chain', which is not one of its picks. It takes: stone, to.",
    });
    expect(game.runs).toEqual([]);
  });

  it('refuses a follow-up arg a client sends while the follow-up is held: the engine supplies it', () => {
    const { runner, game, stoneId } = duel();
    holdJump(runner, stoneId);

    const result = runner.performAction('jump', 1, { stone: stoneId('A'), to: 'A-to-1', chain: 1 });

    expect(result).toMatchObject({ success: false, error: expect.stringContaining("was sent 'chain'") });
    expect(game.runs).toHaveLength(1);
  });

  it("runs a held follow-up with the engine's value for a pick it answered, not the client's", () => {
    const { runner, game, stoneId } = duel();
    holdJump(runner, stoneId);

    // The client names stone B; the follow-up answered A, so `to` is judged
    // against A's choices and execute gets A.
    expect(runner.performAction('jump', 1, { stone: stoneId('B'), to: 'A-to-1' }).success).toBe(true);
    expect(runner.performAction('jump', 1, { to: 'A-to-2' }).success).toBe(true);

    expect(game.runs).toEqual([
      { action: 'jump', stone: 'A', to: 'A-to-0', chain: undefined },
      { action: 'jump', stone: 'A', to: 'A-to-1', chain: 1 },
      { action: 'jump', stone: 'A', to: 'A-to-2', chain: 2 },
    ]);
    expect(runner.getFlowState()?.followUps ?? []).toEqual([]);
  });

  it("gives a held follow-up with a repeating pick its engine args", () => {
    const { runner, game } = duel();
    expect(runner.performAction('start', 1, {}).success).toBe(true);

    expect(runner.performAction('sweep', 1, { coins: ['a', 'stop'] }).success).toBe(true);

    expect(game.runs).toEqual([{ action: 'sweep', coins: ['a', 'stop'], by: 'engine' }]);
  });
});

describe('a selection step carries only declared picks (#662)', () => {
  it('refuses initialArgs with a key no pick declares, and starts nothing', async () => {
    const { manager, game } = duel();

    const step = await manager.processSelectionStep(1, 'pay', 'gold', 'buy', { color: 'red', discount: 100 });

    expect(step).toMatchObject({
      success: false,
      error: "'buy' was sent 'discount', which is not one of its picks. It takes: color, pay.",
      errorCode: ErrorCode.INVALID_PICK,
    });
    expect(manager.getPendingAction(1)).toBeUndefined();
    expect(game.runs).toEqual([]);
  });

  it("refuses a held follow-up's arg in initialArgs: the engine supplies it", async () => {
    const { runner, manager, game, stoneId } = duel();
    holdJump(runner, stoneId);

    const step = await manager.processSelectionStep(1, 'to', 'A-to-1', 'jump', { stone: stoneId('A'), chain: 1 });

    expect(step).toMatchObject({ success: false, error: expect.stringContaining("was sent 'chain'") });
    expect(manager.getPendingAction(1)).toBeUndefined();
    expect(game.runs).toHaveLength(1);
  });

  it('keeps the engine\'s value when a step names a pick the held follow-up answered', async () => {
    const { runner, manager, game, stoneId } = duel();
    holdJump(runner, stoneId);
    game.selected = [];

    // The step for `stone` is passed over: B is not taken, its onSelect does
    // not run, and the next pick's choices are A's.
    const named = await manager.processSelectionStep(1, 'stone', stoneId('B'), 'jump');
    expect(named).toMatchObject({ success: true, actionComplete: false });
    expect(game.selected).toEqual([]);

    const step = await manager.processSelectionStep(1, 'to', 'A-to-1');
    expect(step).toMatchObject({ success: true, actionComplete: true });
    expect(game.runs.at(-1)).toEqual({ action: 'jump', stone: 'A', to: 'A-to-1', chain: 1 });
  });

  it('takes a whole multi-jump chain pick by pick, and records only the picks', async () => {
    const { runner, manager, game, stoneId } = duel();
    holdJump(runner, stoneId);

    expect(await manager.processSelectionStep(1, 'to', 'A-to-1', 'jump', { stone: stoneId('A') }))
      .toMatchObject({ success: true, actionComplete: true });
    expect(await manager.processSelectionStep(1, 'to', 'A-to-2', 'jump'))
      .toMatchObject({ success: true, actionComplete: true });

    expect(game.runs.map((run) => run.chain)).toEqual([undefined, 1, 2]);
    // History holds what the seat sent; the engine binds the follow-up's args
    // again when it is replayed.
    for (const entry of runner.actionHistory) {
      expect(Object.keys((entry as { args: Record<string, unknown> }).args).sort()).toEqual(['stone', 'to']);
    }
    const replayed = GameRunner.replay(
      { GameClass: DuelGame, gameType: 'duel', gameOptions: { playerCount: 1, playerNames: ['Alice'], seed: 'test' } },
      runner,
    );
    expect((replayed.game as DuelGame).runs).toEqual(game.runs);
  });
});

describe("a pick's choices are asked only with declared picks (#662)", () => {
  it('refuses a key no pick declares', () => {
    const { picks } = duel();

    const answer = picks.getPickChoices('buy', 'pay', 1, { color: 'red', discount: 100 });

    expect(answer).toMatchObject({
      success: false,
      error: "'buy' was sent 'discount', which is not one of its picks. It takes: color, pay.",
      errorCode: ErrorCode.INVALID_PICK,
    });
  });

  it("answers a held follow-up's pick with the engine's args", () => {
    const { runner, picks, stoneId } = duel();
    holdJump(runner, stoneId);

    const answer = picks.getPickChoices('jump', 'to', 1, { stone: stoneId('B') });

    expect(answer).toMatchObject({ success: true, choices: [expect.objectContaining({ value: 'A-to-1' })] });
  });
});

describe("a bot's moves carry only declared picks (#662)", () => {
  it('enumerates a held follow-up as picks the engine accepts', () => {
    const { runner, game, stoneId } = duel();
    holdJump(runner, stoneId);

    const moves = enumerateLegalMoves(game, 1);

    for (const { action, args } of moves) {
      const picks = game.getAction(action)!.selections.map((s) => s.name);
      expect(Object.keys(args).filter((key) => !picks.includes(key))).toEqual([]);
    }
    const followUp = moves.filter((move) => move.action === 'jump').at(-1)!;
    expect(followUp.args.to).toBe('A-to-1');
    expect(runner.performAction(followUp.action, 1, followUp.args).success).toBe(true);
    expect(game.runs.at(-1)).toMatchObject({ stone: 'A', chain: 1 });
  });
});
