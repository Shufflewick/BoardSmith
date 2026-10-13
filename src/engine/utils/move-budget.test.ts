/**
 * Enumeration's budget across an action's selections (#691).
 *
 * Each selection is capped on its own, but an action's moves are the product
 * of its selections: 13 number inputs of 1 to 7 are 7^13 moves. Enumeration
 * tries at most MAX_MULTISELECT_COMBINATIONS values per action, counting each
 * value of each selection under every pick before it, refused ones too, and
 * stops there: a caller that wants every move gets a
 * MoveListTooLargeError naming the action, and the MCTS bot, which samples
 * anyway, draws its sample at random instead.
 */
import { describe, it, expect, vi } from 'vitest';
import { Game, Player, Action, loop, eachPlayer, actionStep, MoveListTooLargeError, type GameOptions } from '../index.js';
import { MCTSBot } from '../../bot/mcts-bot.js';
import { playGame } from '../../sim/play-game.js';
import { greedy, random } from '../../sim/index.js';
import { SeededRandom } from '../../utils/random.js';
import { _clearShownWarnings } from '../../utils/dev.js';
import { enumerateActionMoves, enumerateLegalMoves, MAX_MULTISELECT_COMBINATIONS } from './enumerate-moves.js';

const AFFINITIES = Array.from({ length: 13 }, (_, i) => `affinity${i}`);
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const sumOf = (args: Record<string, unknown>) => AFFINITIES.reduce((sum, key) => sum + ((args[key] as number) ?? 0), 0);

/**
 * Distinct picks from `lower` + `upper` numbers, one at a time, ending with the
 * first pick of one of the top `upper`. 5 + 3 is 978 moves, found through 1,304
 * partial moves holding 6,198 picks; 6 + 6 is 11,742 moves.
 */
function chain(name: string, lower: number, upper: number) {
  return Action.create<BudgetGame>(name)
    .chooseFrom('symbols', {
      choices: (ctx) => range(lower + upper).filter((v) => !((ctx.args.symbols as number[] | undefined) ?? []).includes(v)),
      repeat: { until: (_ctx, v: number) => v >= lower },
    })
    .execute((_args, ctx) => {
      ctx.game.finish([]);
      return { success: true };
    });
}

/** A chain move: distinct picks, every one but the last below `lower`. */
function isChainMove(picks: unknown, lower: number): boolean {
  if (!Array.isArray(picks) || new Set(picks).size !== picks.length) return false;
  return picks.every((v, i) => Number.isInteger(v) && (v >= lower) === (i === picks.length - 1));
}

/** Every repeat pick made by a `climb` or `endless` action, on any copy of the game. */
let repeatPicks = 0;

/** `inc` any number of times, then `done`: one move per length, and partial moves as long as the walk goes. */
function climb(name: string, ends: boolean) {
  return Action.create<BudgetGame>(name)
    .chooseFrom('steps', {
      choices: ['inc', 'done'],
      repeat: { until: (_ctx, last: string) => (repeatPicks++, ends && last === 'done') },
    })
    .execute(() => ({ success: true }));
}

/** Offers one action, named by the `offer` option (`species` by default). Counts every number-input validate call. */
class BudgetGame extends Game<BudgetGame, Player> {
  validateCalls = 0;

  constructor(options: GameOptions & { offer?: string }) {
    super(options);
    const offer = options.offer ?? 'species';
    const countCall = () => {
      this.validateCalls++;
      return true as const;
    };
    const numbers = (name: string, keys: string[]) => {
      const action = Action.create<BudgetGame>(name);
      for (const key of keys) action.enterNumber(key, { min: 1, max: 7, integer: true, validate: countCall });
      return action;
    };
    const actions: Record<string, () => Parameters<BudgetGame['registerAction']>[0]> = {
      species: () =>
        numbers('species', AFFINITIES)
          .validate((args) => sumOf(args) % 7 !== 0 || 'The affinities must not add up to a multiple of 7.')
          .execute((_args, ctx) => {
            ctx.game.finish([]);
            return { success: true };
          }),
      deadEnd: () =>
        numbers('deadEnd', AFFINITIES.slice(0, 12))
          .chooseFrom('nothing', { choices: () => [] as number[] })
          .execute(() => ({ success: true })),
      // 100 picks, each with 1,000 numbers judged and refused: 100,100 values tried, no move.
      refused: () =>
        Action.create<BudgetGame>('refused')
          .chooseFrom('first', { choices: range(100) })
          .enterNumber('n', { min: 1, max: 1000, integer: true, validate: () => (countCall(), 'Never.') })
          .execute(() => ({ success: true })),
      // 10 picks, each with 15 choices whose 1,940 combinations of up to 4 are what cross the budget.
      hand: () =>
        Action.create<BudgetGame>('hand')
          .chooseFrom('first', { choices: range(10) })
          .chooseFrom('cards', { choices: range(15), multiSelect: { min: 1, max: 4 } })
          .execute(() => ({ success: true })),
      // A first selection that alone judges the whole budget, so one draw of a sample costs that much.
      wide: () =>
        Action.create<BudgetGame>('wide')
          .chooseFrom('first', { choices: range(MAX_MULTISELECT_COMBINATIONS) })
          .chooseFrom('second', { choices: range(2) })
          .execute(() => ({ success: true })),
      // 100 rows, and 99 columns under each: 10,000 values tried in all.
      grid: () =>
        Action.create<BudgetGame>('grid')
          .chooseFrom('row', { choices: range(100) })
          .chooseFrom('col', { choices: range(99) })
          .execute(() => ({ success: true })),
      // 14 choices and no max: 16,383 combinations, past the budget on their own.
      pile: () =>
        Action.create<BudgetGame>('pile')
          .chooseFrom('tokens', { choices: range(14), multiSelect: { min: 1 } })
          .execute(() => ({ success: true })),
      // 13 choices and no max: 8,191 combinations, every one listed.
      smallPile: () =>
        Action.create<BudgetGame>('smallPile')
          .chooseFrom('tokens', { choices: range(13), multiSelect: { min: 1 } })
          .execute(() => ({ success: true })),
      // 978 moves, found through 1,304 partial ones: past the old 500, within the budget.
      chain10: () => chain('chain10', 5, 3),
      // 11,742 moves: past the budget.
      chain12: () => chain('chain12', 6, 6),
      // A repeat that ends at any pick, and one that never ends.
      climb: () => climb('climb', true),
      endless: () => climb('endless', false),
      gridOver: () =>
        Action.create<BudgetGame>('gridOver')
          .chooseFrom('row', { choices: range(100) })
          .chooseFrom('col', { choices: range(100) })
          .execute(() => ({ success: true })),
    };
    this.registerAction(actions[offer]());

    this.setFlow({
      root: loop({
        while: (ctx) => !ctx.game.isFinished(),
        maxIterations: 10,
        do: eachPlayer({ do: actionStep({ actions: [offer] }) }),
      }),
    });
  }
}

function started(offer: string): BudgetGame {
  const game = new BudgetGame({ playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'budget', offer });
  game.startFlow();
  return game;
}

describe('enumeration budget across an action\'s selections (#691)', () => {
  it('lists every move of an action that tries exactly the budget', () => {
    expect(MAX_MULTISELECT_COMBINATIONS).toBe(10000);
    const moves = enumerateLegalMoves(started('grid'), 1);
    expect(moves).toHaveLength(9900);
    expect(moves[9899]).toEqual({ action: 'grid', args: { row: 99, col: 98 } });
  });

  it('refuses, naming the action, one row of values over the budget', () => {
    expect(() => enumerateLegalMoves(started('gridOver'), 1)).toThrow(MoveListTooLargeError);
    expect(() => enumerateLegalMoves(started('gridOver'), 1)).toThrow(
      'Action "gridOver" has too many moves to list: its selections multiply past the 10,000 values ' +
        'enumeration tries for one action (each value of each selection, under every pick before it, refused ' +
        'ones too), and the count crossed it at selection "col". Narrow the choices or ranges of its ' +
        'selections, or split it into two actions.',
    );
  });

  it("counts a multiSelect's combinations, not only its choices", () => {
    expect(() => enumerateLegalMoves(started('hand'), 1)).toThrow(/Action "hand" has too many moves.*at selection "cards"/);
  });

  it('stops at the budget instead of building 7^13 moves', () => {
    const game = started('species');
    expect(() => enumerateLegalMoves(game, 1)).toThrow(/Action "species" has too many moves to list/);
    // Every value judged is counted, so the rules run at most the budget, plus
    // the one input (7 values) judged before the count crossed it.
    expect(game.validateCalls).toBeLessThanOrEqual(MAX_MULTISELECT_COMBINATIONS + 7);
  });

  it('counts partial moves, so selections that dead-end late cannot walk forever', () => {
    const game = started('deadEnd');
    expect(() => enumerateLegalMoves(game, 1)).toThrow(/Action "deadEnd" has too many moves to list/);
    expect(game.validateCalls).toBeLessThanOrEqual(MAX_MULTISELECT_COMBINATIONS + 7);
  });

  it('counts the values its rules refuse, so judging them cannot run on unbounded either', () => {
    const game = started('refused');
    expect(() => enumerateLegalMoves(game, 1)).toThrow(/Action "refused" has too many moves to list/);
    // Every value judged is counted, and one selection judges at most 1,000 before the count is checked.
    expect(game.validateCalls).toBeLessThanOrEqual(MAX_MULTISELECT_COMBINATIONS + 1000);
  });

  describe('a caller that takes a sample above the budget', () => {
    const sample = (game: BudgetGame, seed: string) =>
      enumerateActionMoves(game, game.getAction('species')!, game.getPlayer(1)!, {
        sampleAboveBudget: { count: 20, random: new SeededRandom(seed) },
      });

    it('gets that many legal moves, drawn at random, with bounded work, and says so', () => {
      _clearShownWarnings();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const game = started('species');
      const moves = sample(game, 'one');
      expect(warn.mock.calls.map(([message]) => message)).toEqual([
        expect.stringMatching(/Action "species" has more moves than enumeration lists .* so only 20 of them, drawn at random, are offered/),
      ]);
      warn.mockRestore();
      expect(moves).toHaveLength(20);
      for (const args of moves) {
        expect(AFFINITIES.every((key) => Number.isInteger(args[key]))).toBe(true);
        expect(sumOf(args) % 7).not.toBe(0);
      }
      // The full walk, then at most 2 draws per move asked for, each judging 7 values for each of 13 inputs.
      expect(game.validateCalls).toBeLessThanOrEqual(MAX_MULTISELECT_COMBINATIONS + 7 + 2 * 20 * 13 * 7);
      const fresh = started('species');
      expect(fresh.performAction('species', fresh.getPlayer(1)!, moves[0]).success).toBe(true);
    });

    it('gets them when a single draw judges as many values as the whole list may', () => {
      const game = started('wide');
      const moves = enumerateActionMoves(game, game.getAction('wide')!, game.getPlayer(1)!, {
        sampleAboveBudget: { count: 20, random: new SeededRandom('wide') },
      });
      expect(moves).toHaveLength(20);
    });

    it('stops drawing when every draw is refused, after 2 draws per move asked for', () => {
      const game = started('deadEnd');
      const moves = enumerateActionMoves(game, game.getAction('deadEnd')!, game.getPlayer(1)!, {
        sampleAboveBudget: { count: 20, random: new SeededRandom('dead') },
      });
      expect(moves).toEqual([]);
      // The full walk, then 40 draws, each judging 7 values for each of 12 inputs.
      expect(game.validateCalls).toBeLessThanOrEqual(MAX_MULTISELECT_COMBINATIONS + 7 + 2 * 20 * 12 * 7);
    });

    it('draws the same moves from the same seed, and others from another', () => {
      expect(sample(started('species'), 'one')).toEqual(sample(started('species'), 'one'));
      expect(sample(started('species'), 'one')).not.toEqual(sample(started('species'), 'two'));
    });

    it('still gets every move of an action within the budget', () => {
      const game = started('grid');
      const moves = enumerateActionMoves(game, game.getAction('grid')!, game.getPlayer(1)!, {
        sampleAboveBudget: { count: 20, random: new SeededRandom('grid') },
      });
      expect(moves).toHaveLength(9900);
    });
  });

  it('the MCTS bot searches and plays a sample of an action over the budget, the same move for the same seed', async () => {
    const play = async () => {
      const game = started('species');
      const bot = new MCTSBot(game, BudgetGame, 'budget', 1, [], { iterations: 5, playoutDepth: 1, seed: 'species-bot' });
      const rootMoves: unknown[] = (bot as any).movesFor(game, game.getFlowState()!, 1, { sample: false });
      expect(rootMoves).toHaveLength(20);
      return bot.play();
    };
    const move = await play();
    expect(move?.action).toBe('species');
    expect(await play()).toEqual(move);
    const fresh = started('species');
    expect(fresh.performAction('species', fresh.getPlayer(1)!, move!.args).success).toBe(true);
  });

  it('greedy refuses an action over the budget, naming it', async () => {
    const result = await playGame(
      { gameClass: BudgetGame },
      { playerCount: 2, seed: 'greedy-species', gameOptions: { offer: 'species' }, policies: [greedy(() => 0), greedy(() => 0)], maxActions: 5 },
    );
    expect(result.completed).toBe(false);
    expect(result.error).toMatch(/greedy cannot list player 1's moves: Action "species" has too many moves to list/);
  });
});

describe('the two older caps go through the same budget (#692)', () => {
  const sampleOf = (game: BudgetGame, action: string, seed: string) =>
    enumerateActionMoves(game, game.getAction(action)!, game.getPlayer(1)!, {
      sampleAboveBudget: { count: 20, random: new SeededRandom(seed) },
    });

  it('lists every combination of a multiSelect within the budget', () => {
    expect(enumerateLegalMoves(started('smallPile'), 1)).toHaveLength(8191);
  });

  it('refuses a multiSelect whose combinations pass the budget, rather than offer the first 10,000', () => {
    expect(() => enumerateLegalMoves(started('pile'), 1)).toThrow(
      /Action "pile" has too many moves to list: .* at selection "tokens"/,
    );
  });

  it('samples combinations of that multiSelect for the bot, drawn from the whole set', () => {
    const moves = sampleOf(started('pile'), 'pile', 'pile');
    expect(moves).toHaveLength(20);
    for (const { tokens } of moves) {
      expect(Array.isArray(tokens) && tokens.length >= 1 && new Set(tokens).size === tokens.length).toBe(true);
    }
    // The first 10,000 combinations in order hold at most 5 of the 14 tokens; a draw from all of them holds about 7.
    expect(moves.some(({ tokens }) => (tokens as number[]).length > 5)).toBe(true);
    expect(sampleOf(started('pile'), 'pile', 'pile')).toEqual(moves);
  });

  it('lists every move of a repeating selection within the budget, past the old 500 partial moves', () => {
    const moves = enumerateLegalMoves(started('chain10'), 1);
    expect(moves).toHaveLength(978);
    expect(moves.every(({ args }) => isChainMove(args.symbols, 5))).toBe(true);
    // Shortest first, as before.
    expect(moves.slice(0, 4).map(({ args }) => args.symbols)).toEqual([[5], [6], [7], [0, 5]]);
  });

  it('refuses a repeating selection whose moves pass the budget, naming it, without the old warning', () => {
    _clearShownWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => enumerateLegalMoves(started('chain12'), 1)).toThrow(
      /Action "chain12" has too many moves to list: .* at selection "symbols"/,
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('samples moves of that repeating selection for the bot, the same for the same seed', () => {
    const moves = sampleOf(started('chain12'), 'chain12', 'one');
    expect(moves).toHaveLength(20);
    expect(moves.every(({ symbols }) => isChainMove(symbols, 6))).toBe(true);
    expect(sampleOf(started('chain12'), 'chain12', 'one')).toEqual(moves);
    expect(sampleOf(started('chain12'), 'chain12', 'two')).not.toEqual(moves);
    const fresh = started('chain12');
    expect(fresh.performAction('chain12', fresh.getPlayer(1)!, moves[0]).success).toBe(true);
  });

  it('the MCTS bot plays a sampled repeating move, the same for the same seed', async () => {
    const play = () =>
      new MCTSBot(started('chain12'), BudgetGame, 'budget', 1, [], { iterations: 5, playoutDepth: 1, seed: 'chain-bot' }).play();
    const move = await play();
    expect(move?.action).toBe('chain12');
    expect(await play()).toEqual(move);
  });

  it('random play draws a repeating move past the budget instead of stopping', async () => {
    const result = await playGame(
      { gameClass: BudgetGame },
      { playerCount: 2, seed: 'random-chain', gameOptions: { offer: 'chain12' }, policies: [random(), random()], maxActions: 5 },
    );
    expect(result.error).toBeUndefined();
    expect(result.completed).toBe(true);
  });

  it('greedy refuses a repeating selection past the budget, naming it', async () => {
    const result = await playGame(
      { gameClass: BudgetGame },
      { playerCount: 2, seed: 'greedy-chain', gameOptions: { offer: 'chain12' }, policies: [greedy(() => 0), greedy(() => 0)], maxActions: 5 },
    );
    expect(result.error).toMatch(/greedy cannot list player 1's moves: Action "chain12" has too many moves to list/);
  });

  it('counts each pick it replays, so a deep repeat costs at most the budget in picks', () => {
    repeatPicks = 0;
    expect(() => enumerateLegalMoves(started('climb'), 1)).toThrow(
      /Action "climb" has too many moves to list: .* at selection "steps"\. Give its `until` a pick that ends it sooner/,
    );
    // Each partial move replays its picks from the start, and each replayed pick is counted.
    expect(repeatPicks).toBeLessThanOrEqual(MAX_MULTISELECT_COMBINATIONS + 200);
  });

  it('samples a deep repeat for the bot within one budget of picks for the walk and one for the sample', () => {
    repeatPicks = 0;
    const moves = sampleOf(started('climb'), 'climb', 'climb');
    expect(moves).toHaveLength(20);
    expect(moves.every(({ steps }) => Array.isArray(steps) && steps.at(-1) === 'done')).toBe(true);
    expect(repeatPicks).toBeLessThanOrEqual(2 * MAX_MULTISELECT_COMBINATIONS + 200);
  });

  it('samples no move of a repeat that never ends, and stops when the sample has spent its budget', () => {
    repeatPicks = 0;
    _clearShownWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(sampleOf(started('endless'), 'endless', 'endless')).toEqual([]);
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      expect.stringMatching(/Action "endless" has more moves than enumeration lists .* so only 0 of them, drawn at random, are offered/),
    ]);
    warn.mockRestore();
    expect(repeatPicks).toBeLessThanOrEqual(2 * MAX_MULTISELECT_COMBINATIONS + 200);
  });
});
