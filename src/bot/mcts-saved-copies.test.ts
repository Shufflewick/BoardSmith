/**
 * The search keeps saved copies of the search game at tree nodes it passes
 * through, and a search step resumes from the deepest saved copy on its path
 * instead of rebuilding the root and making every move down the path again
 * (#633).
 *
 * A saved copy changes how fast the search runs and nothing else: a seeded,
 * fixed-step search must visit and score the same moves with copies as
 * without them. Copies stay within the bot's memory budget, and once the
 * budget is spent the search makes the moves again from the deepest copy it
 * has, or from the root, as it did before copies existed.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  loop,
  eachPlayer,
  actionStep,
  sequence,
  execute,
  simultaneousActionStep,
  type GameOptions,
} from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';
import type { BotConfig, BotMove, BotStrategy, MCTSNode } from './types.js';

interface StoneRules {
  /** Cells per side of the square board. */
  size: number;
  /** A placement in a row this says yes to draws from the game's random source. */
  drawsOnRow?: (row: number) => boolean;
  /** Each round opens with a step every seat takes at once. */
  simultaneousBids?: boolean;
}

/**
 * A Hex-like game: seats take turns putting a stone in an empty cell of a
 * square board until it is full. Each placement creates a new element, so a
 * restored copy has to carry the element id counter as well as the board.
 */
function stoneGame(rules: StoneRules) {
  class Stone extends Piece<StoneGame> {
    seat!: number;
  }
  class Cell extends Space<StoneGame> {
    declare row: number;
    declare col: number;
  }
  class StoneGame extends Game<StoneGame, Player> {
    lastDraw = 0;
    bids: Record<number, number> = {};

    constructor(options: GameOptions) {
      super(options);
      this.registerElements([Stone, Cell]);
      for (let row = 0; row < rules.size; row++) {
        for (let col = 0; col < rules.size; col++) {
          this.create(Cell, `cell-${row}-${col}`, { row, col });
        }
      }

      this.registerAction(
        Action.create<StoneGame>('place')
          .chooseElement('cell', { elementClass: Cell, filter: (cell) => (cell as Cell).isEmpty() })
          .execute((args, ctx) => {
            const game = ctx.game as StoneGame;
            const cell = args.cell as Cell;
            cell.create(Stone, 'stone', { seat: ctx.player.seat });
            if (rules.drawsOnRow?.(cell.row)) game.lastDraw = game.random();
            return { success: true };
          }),
      );
      this.registerAction(
        Action.create<StoneGame>('bid')
          .chooseFrom('amount', { choices: [1, 2, 3] })
          .execute((args, ctx) => {
            (ctx.game as StoneGame).bids[ctx.player.seat] = args.amount as number;
            return { success: true };
          }),
      );

      const boardOpen = (game: StoneGame) => game.all(Cell).some((cell) => cell.isEmpty());
      const placements = eachPlayer<StoneGame>({
        do: actionStep({ actions: ['place'], skipIf: (ctx) => !boardOpen(ctx.game as StoneGame) }),
      });
      this.setFlow({
        root: loop<StoneGame>({
          maxIterations: rules.size * rules.size,
          while: (ctx) => boardOpen(ctx.game as StoneGame),
          do: rules.simultaneousBids
            ? sequence(
                simultaneousActionStep<StoneGame>({
                  actions: ['bid'],
                  playerDone: (ctx, player) => (ctx.game as StoneGame).bids[player.seat] !== undefined,
                }),
                placements,
              )
            : placements,
        }),
      });
    }

    /** How much of row `row` a seat holds, as a share of the row. */
    rowShare(seat: number, row: number): number {
      const held = this.all(Cell).filter((cell) => cell.row === row && cell.first(Stone)?.seat === seat);
      return held.length / rules.size;
    }
  }
  return StoneGame;
}

type StoneGameClass = ReturnType<typeof stoneGame>;
type StoneGame = InstanceType<StoneGameClass>;

/** Each seat wants the top row and the middle row: enough to give moves different values. */
const strategy: BotStrategy = {
  objectives: (game, seat) => ({
    top: { checker: (g) => (g as StoneGame).rowShare(seat, 0), weight: 2 },
    middle: { checker: (g) => (g as StoneGame).rowShare(seat, 2), weight: 1 },
  }),
};

function startedGame(GameClass: StoneGameClass, placements: number): StoneGame {
  const game = new GameClass({ playerCount: 2, playerNames: ['A', 'B'], seed: 'saved-copies', elementIdKey: '0633063306330633' });
  game.startFlow();
  // Play a few fixed moves so the root is not the opening position.
  for (let i = 0; i < placements; i++) {
    const flow = game.getFlowState()!;
    const seat = flow.currentPlayer!;
    const empty = game.all(Space).filter((cell) => cell.isEmpty() && (cell.name?.startsWith('cell-') ?? false));
    game.continueFlow('place', { cell: empty[(i * 7) % empty.length].id }, seat);
  }
  return game;
}

/** The bot's own search counters, read through its private fields. */
interface SearchProbe {
  /** Moves made again down the tree path (`applyMoveToSearchGame`). */
  remade: number;
  /** The most bytes of saved copies the bot held after any step's selection. */
  peakBytes: number;
  /** Whether a copy was ever left unsaved because it would not fit the budget. */
  full: boolean;
  /** Every node the bot held a saved copy for, after any step's selection. */
  savedNodes: Set<MCTSNode>;
}

interface BotInternals {
  savedCopyBudget: number;
  savedCopyBytes: number | undefined;
  savedCopiesFull: boolean | undefined;
  savedCopies: Map<MCTSNode, string> | undefined;
  applyMoveToSearchGame: (...args: unknown[]) => unknown;
  selectWithPath: (...args: unknown[]) => unknown;
}

/**
 * Run one seeded fixed-step search on `game` for the seat to move, with the
 * saved-copy budget set to `budget` bytes (the bot's own default when absent),
 * and report what it chose, its root statistics, and what it did.
 */
async function search(
  GameClass: new (options: GameOptions) => Game,
  game: Game,
  options: { budget?: number; config?: Partial<BotConfig>; botStrategy?: BotStrategy } = {},
): Promise<{ move: BotMove | null; stats: unknown; probe: SearchProbe; budget: number }> {
  const seat = game.getFlowState()!.currentPlayer ?? 1;
  const bot = new MCTSBot(game, GameClass, 'stone-game', seat, [], {
    iterations: 150,
    timeout: Infinity,
    async: false,
    seed: 'saved-copies-search',
    ...options.config,
  }, options.botStrategy ?? strategy);
  const internals = bot as unknown as BotInternals;
  if (options.budget !== undefined) internals.savedCopyBudget = options.budget;

  const probe: SearchProbe = { remade: 0, peakBytes: 0, full: false, savedNodes: new Set() };
  const remake = internals.applyMoveToSearchGame;
  internals.applyMoveToSearchGame = function (this: unknown, ...args: unknown[]) {
    probe.remade++;
    return remake.apply(this, args);
  };
  const select = internals.selectWithPath;
  internals.selectWithPath = function (this: unknown, ...args: unknown[]) {
    const result = select.apply(this, args);
    probe.peakBytes = Math.max(probe.peakBytes, internals.savedCopyBytes ?? 0);
    probe.full ||= internals.savedCopiesFull ?? false;
    for (const node of internals.savedCopies?.keys() ?? []) probe.savedNodes.add(node);
    return result;
  };

  const { move, stats } = await bot.playWithStats();
  return { move, stats, probe, budget: internals.savedCopyBudget };
}

describe('MCTS saved copies (#633)', () => {
  it('chooses the same move with the same statistics as a search with no copies, and makes fewer moves again', async () => {
    const GameClass = stoneGame({ size: 5 });
    for (const placements of [0, 6, 13]) {
      const without = await search(GameClass, startedGame(GameClass, placements), { budget: 0 });
      const withCopies = await search(GameClass, startedGame(GameClass, placements));

      expect(withCopies.move).toEqual(without.move);
      expect(withCopies.stats).toEqual(without.stats);
      expect(without.probe.peakBytes).toBe(0);
      expect(withCopies.probe.peakBytes).toBeGreaterThan(0);
      expect(withCopies.probe.remade).toBeLessThan(without.probe.remade / 2);
    }
  });

  it('matches a search with no copies in an ensemble search and with deeper playouts', async () => {
    const GameClass = stoneGame({ size: 5 });
    for (const config of [{ parallel: 3, iterations: 240 }, { playoutDepth: 8 }, { useRAVE: false, usePNS: false }]) {
      const without = await search(GameClass, startedGame(GameClass, 4), { budget: 0, config });
      const withCopies = await search(GameClass, startedGame(GameClass, 4), { config });
      expect(withCopies.move).toEqual(without.move);
      expect(withCopies.stats).toEqual(without.stats);
    }
  });

  it('keeps no copy below a move that drew on the game\'s random source, and still matches', async () => {
    const GameClass = stoneGame({ size: 5, drawsOnRow: () => true });
    const without = await search(GameClass, startedGame(GameClass, 4), { budget: 0 });
    const withCopies = await search(GameClass, startedGame(GameClass, 4));

    expect(withCopies.move).toEqual(without.move);
    expect(withCopies.stats).toEqual(without.stats);
    expect(withCopies.probe.peakBytes).toBe(0);
    expect(withCopies.probe.remade).toBe(without.probe.remade);
  });

  it('keeps copies above a move that drew on the random source and none below it, and still matches', async () => {
    // Only placements in the top row draw.
    const GameClass = stoneGame({ size: 5, drawsOnRow: (row) => row === 0 });
    const game = startedGame(GameClass, 4);
    const without = await search(GameClass, startedGame(GameClass, 4), { budget: 0 });
    const withCopies = await search(GameClass, game);

    expect(withCopies.move).toEqual(without.move);
    expect(withCopies.stats).toEqual(without.stats);
    expect(withCopies.probe.remade).toBeLessThan(without.probe.remade);
    const drewOnTheWay = (node: MCTSNode) => {
      for (let at: MCTSNode | null = node; at?.parentMove; at = at.parent) {
        const cell = game.getElementById(at.parentMove.args.cell as number) as unknown as { row: number };
        if (cell.row === 0) return true;
      }
      return false;
    };
    const saved = [...withCopies.probe.savedNodes];
    expect(saved.length).toBeGreaterThan(0);
    expect(saved.filter(drewOnTheWay)).toEqual([]);
    // The search did reach below a drawing move: some node it saved above has a child that drew.
    expect(saved.some((node) => node.children.some(drewOnTheWay))).toBe(true);
  });

  it('keeps no copy inside a step every seat takes at once, where a seat\'s moves depend on the picks before it', async () => {
    const without = await search(ClaimGame, startedClaimGame(), { budget: 0, config: claimConfig, botStrategy: claimStrategy });
    const withCopies = await search(ClaimGame, startedClaimGame(), { config: claimConfig, botStrategy: claimStrategy });

    expect(withCopies.move).toEqual(without.move);
    expect(withCopies.stats).toEqual(without.stats);
    // Every position in this game is inside such a step, so no copy is kept.
    expect([...withCopies.probe.savedNodes]).toEqual([]);
    // Yet the walk went through nodes in the middle of a step again and again.
    expect(withCopies.probe.remade).toBeGreaterThan(100);
  });

  it('keeps no copy for a game that samples hidden worlds, and still matches', async () => {
    const GameClass = stoneGame({ size: 5 });
    const botStrategy: BotStrategy = { ...strategy, determinize: () => {} };
    const without = await search(GameClass, startedGame(GameClass, 4), { budget: 0, botStrategy });
    const withCopies = await search(GameClass, startedGame(GameClass, 4), { botStrategy });

    expect(withCopies.move).toEqual(without.move);
    expect(withCopies.stats).toEqual(without.stats);
    expect(withCopies.probe.peakBytes).toBe(0);
  });

  it('matches a search with no copies when a step every seat takes at once sits on the path', async () => {
    const GameClass = stoneGame({ size: 4, simultaneousBids: true });
    const game = new GameClass({ playerCount: 2, playerNames: ['A', 'B'], seed: 'bids', elementIdKey: '0633063306330633' });
    game.startFlow();
    game.continueFlow('bid', { amount: 2 }, 1);
    game.continueFlow('bid', { amount: 1 }, 2);
    const without = await search(GameClass, game, { budget: 0, config: { playoutDepth: 6 } });
    const withCopies = await search(GameClass, game, { config: { playoutDepth: 6 } });

    expect(withCopies.move).toEqual(without.move);
    expect(withCopies.stats).toEqual(without.stats);
    expect(withCopies.probe.peakBytes).toBeGreaterThan(0);
  });

  it('on a 19x19 board stays within its default budget, then makes moves again once the budget is spent', async () => {
    const GameClass = stoneGame({ size: 19 });
    const game = startedGame(GameClass, 40);
    // Short playouts keep each step cheap; enough steps to spend the whole budget.
    const config = { iterations: 6000, playoutDepth: 0 };
    const withDefault = await search(GameClass, game, { config });

    expect(withDefault.budget).toBe(32 * 1024 * 1024);
    expect(withDefault.probe.full).toBe(true);
    expect(withDefault.probe.peakBytes).toBeGreaterThan(withDefault.budget - 2 * approxCopyBytes(game));
    expect(withDefault.probe.peakBytes).toBeLessThanOrEqual(withDefault.budget);
  }, 120_000);

  it('on a 19x19 board with a budget of a few copies, holds the budget, falls back to making moves again, and matches', async () => {
    const GameClass = stoneGame({ size: 19 });
    const budget = Math.floor(approxCopyBytes(startedGame(GameClass, 40)) * 3.5);
    const config = { iterations: 200, playoutDepth: 1 };
    const without = await search(GameClass, startedGame(GameClass, 40), { budget: 0, config });
    const capped = await search(GameClass, startedGame(GameClass, 40), { budget, config });
    const uncapped = await search(GameClass, startedGame(GameClass, 40), { config });

    expect(capped.probe.full).toBe(true);
    expect(capped.probe.peakBytes).toBeGreaterThan(0);
    expect(capped.probe.peakBytes).toBeLessThanOrEqual(budget);
    expect(capped.move).toEqual(without.move);
    expect(capped.stats).toEqual(without.stats);
    // Past the budget it makes moves again, more than with room to spare.
    expect(capped.probe.remade).toBeLessThan(without.probe.remade);
    expect(capped.probe.remade).toBeGreaterThan(uncapped.probe.remade);
  }, 60_000);
});

/** About what one saved copy of `game` costs: its serialized length, one byte per character. */
function approxCopyBytes(game: StoneGame): number {
  return JSON.stringify(game.toJSON()).length;
}

/**
 * Three seats each claim a value at once, round after round; a value one seat
 * has claimed this round is gone for the seats after it. So the moves a seat
 * may make in the middle of the step depend on the picks committed before it,
 * which the search must not see (T-159-07): it lists them from the position
 * the step started in.
 */
class ClaimGame extends Game<ClaimGame, Player> {
  claimed: string[] = [];
  claimedBy: number[] = [];
  score: Record<number, number> = {};

  constructor(options: GameOptions) {
    super(options);
    const values: Record<string, number> = { a: 1, b: 2, c: 3, d: 4 };
    this.registerAction(
      Action.create<ClaimGame>('claim')
        .chooseFrom('value', { choices: (ctx) => Object.keys(values).filter((v) => !(ctx.game as ClaimGame).claimed.includes(v)) })
        .execute((args, ctx) => {
          const game = ctx.game as ClaimGame;
          const value = args.value as string;
          game.claimed.push(value);
          game.claimedBy.push(ctx.player.seat);
          game.score[ctx.player.seat] = (game.score[ctx.player.seat] ?? 0) + values[value];
          return { success: true };
        }),
    );
    this.setFlow({
      root: loop<ClaimGame>({
        maxIterations: 3,
        do: sequence(
          execute((ctx) => {
            (ctx.game as ClaimGame).claimed = [];
            (ctx.game as ClaimGame).claimedBy = [];
          }),
          simultaneousActionStep<ClaimGame>({
            actions: ['claim'],
            playerDone: (ctx, player) => (ctx.game as ClaimGame).claimedBy.includes(player.seat),
          }),
        ),
      }),
    });
  }
}

function startedClaimGame(): ClaimGame {
  const game = new ClaimGame({ playerCount: 3, playerNames: ['A', 'B', 'C'], seed: 'claims', elementIdKey: '0633063306330633' });
  game.startFlow();
  return game;
}

const claimConfig: Partial<BotConfig> = { iterations: 200, playoutDepth: 4 };
const claimStrategy: BotStrategy = {
  objectives: (_game, seat) => ({ score: { checker: (g) => ((g as ClaimGame).score[seat] ?? 0) / 12, weight: 1 } }),
};
