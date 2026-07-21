/**
 * Tests for dynamic (function-valued) multiSelect enumeration — AI-01 / D9.
 *
 * Pre-fix: `enumerate-moves.ts` treats ANY function-valued `multiSelect` as
 * "cannot be statically enumerated" and skips it (devWarn + skip-if-optional /
 * `[]`-if-required). For a required chooseElements selection this means the
 * action contributes ZERO moves, and MCTSBot.play() throws "No available
 * moves" even though the function would resolve to a perfectly enumerable
 * concrete config.
 *
 * Post-fix: enumeration resolves the function via the shared
 * `resolveMultiSelect` helper before deciding how to enumerate:
 *   - concrete `{min,max}` -> real combinations (generateCombinations)
 *   - `undefined`          -> single-select fallback (valid, not an error)
 *   - throws               -> propagates loudly (never silently skipped)
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';
import { enumerateLegalMoves } from '../engine/utils/enumerate-moves.js';

// ============================================================================
// Test games — each registers a single `chooseElements` action over 3 pieces
// (>=3 so C(3,2) yields multiple combos) whose `multiSelect` is function-valued.
// Each game exposes only ONE action so bot.play()'s enumerateAllMoves result
// is driven entirely by that action's multiSelect resolution.
// ============================================================================

function makeFlow() {
  return defineFlow({
    root: loop({
      maxIterations: 10,
      do: eachPlayer({
        do: actionStep({ actions: ['pick'] }),
      }),
    }),
  });
}

/** multiSelect function resolves to a concrete { min: 2, max: 2 } config. */
class ConcretePairGame extends Game<ConcretePairGame, Player> {
  board!: Space<ConcretePairGame>;

  constructor(options: GameOptions) {
    super(options);
    this.board = this.create(Space<ConcretePairGame>, 'board');
    this.board.create(Piece<ConcretePairGame>, 'token-a');
    this.board.create(Piece<ConcretePairGame>, 'token-b');
    this.board.create(Piece<ConcretePairGame>, 'token-c');

    this.registerAction(
      Action.create<ConcretePairGame>('pick')
        .chooseElements('items', {
          prompt: 'Choose two tokens',
          elements: (ctx) => [...(ctx.game as ConcretePairGame).board.all(Piece)],
          multiSelect: () => ({ min: 2, max: 2 }),
        })
        .execute(() => ({ success: true })),
    );

    this.setFlow(makeFlow());
  }
}

/** multiSelect function resolves to a variable range { min: 1, max: 3 }. */
class VariableRangeGame extends Game<VariableRangeGame, Player> {
  board!: Space<VariableRangeGame>;

  constructor(options: GameOptions) {
    super(options);
    this.board = this.create(Space<VariableRangeGame>, 'board');
    this.board.create(Piece<VariableRangeGame>, 'token-a');
    this.board.create(Piece<VariableRangeGame>, 'token-b');
    this.board.create(Piece<VariableRangeGame>, 'token-c');

    this.registerAction(
      Action.create<VariableRangeGame>('pick')
        .chooseElements('items', {
          prompt: 'Choose one to three tokens',
          elements: (ctx) => [...(ctx.game as VariableRangeGame).board.all(Piece)],
          multiSelect: () => ({ min: 1, max: 3 }),
        })
        .execute(() => ({ success: true })),
    );

    this.setFlow(makeFlow());
  }
}

/** multiSelect function legitimately returns undefined -> single-select. */
class UndefinedResolutionGame extends Game<UndefinedResolutionGame, Player> {
  board!: Space<UndefinedResolutionGame>;

  constructor(options: GameOptions) {
    super(options);
    this.board = this.create(Space<UndefinedResolutionGame>, 'board');
    this.board.create(Piece<UndefinedResolutionGame>, 'token-a');
    this.board.create(Piece<UndefinedResolutionGame>, 'token-b');
    this.board.create(Piece<UndefinedResolutionGame>, 'token-c');

    this.registerAction(
      Action.create<UndefinedResolutionGame>('pick')
        .chooseElements('items', {
          prompt: 'Choose a token',
          elements: (ctx) => [...(ctx.game as UndefinedResolutionGame).board.all(Piece)],
          multiSelect: () => undefined,
        })
        .execute(() => ({ success: true })),
    );

    this.setFlow(makeFlow());
  }
}

/** multiSelect function throws -> must fail loud, never silently skip. */
class ThrowingResolutionGame extends Game<ThrowingResolutionGame, Player> {
  board!: Space<ThrowingResolutionGame>;

  constructor(options: GameOptions) {
    super(options);
    this.board = this.create(Space<ThrowingResolutionGame>, 'board');
    this.board.create(Piece<ThrowingResolutionGame>, 'token-a');
    this.board.create(Piece<ThrowingResolutionGame>, 'token-b');
    this.board.create(Piece<ThrowingResolutionGame>, 'token-c');

    this.registerAction(
      Action.create<ThrowingResolutionGame>('pick')
        .chooseElements('items', {
          prompt: 'Choose a token',
          elements: (ctx) => [...(ctx.game as ThrowingResolutionGame).board.all(Piece)],
          multiSelect: () => {
            throw new Error('cannot resolve here');
          },
        })
        .execute(() => ({ success: true })),
    );

    this.setFlow(makeFlow());
  }
}

function startGame<T extends Game<any, Player>>(GameClass: new (options: GameOptions) => T): T {
  const game = new GameClass({
    playerCount: 2,
    playerNames: ['Alice', 'Bot'],
    seed: 'multiselect-test',
  });
  game.startFlow();
  return game;
}

describe('dynamic (function-valued) multiSelect enumeration', () => {
  it('a concrete-config function multiSelect enumerates the full C(3,2) combination set via enumerateLegalMoves', () => {
    const game = startGame(ConcretePairGame);
    const moves = enumerateLegalMoves(game, 1);

    // C(3,2) = 3 combinations of 2 tokens
    expect(moves).toHaveLength(3);
    for (const move of moves) {
      expect(move.action).toBe('pick');
      expect(Array.isArray(move.args.items)).toBe(true);
      expect((move.args.items as unknown[]).length).toBe(2);
    }
  });

  it('a concrete-config function multiSelect is exercised end-to-end through MCTSBot instead of throwing "No available moves"', async () => {
    const game = startGame(ConcretePairGame);
    const bot = new MCTSBot(game, ConcretePairGame, 'concrete-pair', 1, [], {
      iterations: 4,
      playoutDepth: 1,
      seed: 'multiselect-bot-test',
    });

    const move = await bot.play();
    expect(move.action).toBe('pick');
    expect(Array.isArray(move.args.items)).toBe(true);
    expect((move.args.items as unknown[]).length).toBe(2);
  });

  it('a function multiSelect returning undefined degrades to single-select without error', () => {
    const game = startGame(UndefinedResolutionGame);
    const moves = enumerateLegalMoves(game, 1);

    // Single-select over 3 tokens -> one move per token, one element each
    expect(moves).toHaveLength(3);
    for (const move of moves) {
      expect(move.action).toBe('pick');
      // Single-select for an "elements" selection wraps the choice, not an array
      expect(Array.isArray(move.args.items)).toBe(false);
    }
  });

  it('a throwing function multiSelect fails loud instead of silently skipping to zero moves', async () => {
    const game = startGame(ThrowingResolutionGame);
    const bot = new MCTSBot(game, ThrowingResolutionGame, 'throwing', 1, [], {
      iterations: 1,
      playoutDepth: 1,
      seed: 'multiselect-throw-test',
    });

    // The thrown error must propagate (fail loud) — not be swallowed into
    // "No available moves" (the old silent-skip symptom).
    await expect(bot.play()).rejects.toThrow('cannot resolve here');
  });

  it('a throwing function multiSelect surfaces an actionable message with no leaked internals', async () => {
    const game = startGame(ThrowingResolutionGame);
    const bot = new MCTSBot(game, ThrowingResolutionGame, 'throwing', 1, [], {
      iterations: 1,
      playoutDepth: 1,
      seed: 'multiselect-throw-leak-test',
    });

    try {
      await bot.play();
      expect.fail('expected bot.play() to reject');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain('cannot resolve here');
      expect(message).not.toMatch(/\//); // no file paths
      expect(message).not.toMatch(/:\d+:\d+/); // no line:col references
      expect(message).not.toMatch(/\bat\s+\S+\s*\(/); // no stack frames
    }
  });

  it('a variable-range function multiSelect ({min:1,max:3}) enumerates the union of size-1..3 combos end-to-end', async () => {
    const game = startGame(VariableRangeGame);

    // C(3,1) + C(3,2) + C(3,3) = 3 + 3 + 1 = 7
    const moves = enumerateLegalMoves(game, 1);
    expect(moves).toHaveLength(7);

    const bot = new MCTSBot(game, VariableRangeGame, 'variable-range', 1, [], {
      iterations: 4,
      playoutDepth: 1,
      seed: 'multiselect-variable-test',
    });
    const move = await bot.play();
    expect(move.action).toBe('pick');
    const size = (move.args.items as unknown[]).length;
    expect(size).toBeGreaterThanOrEqual(1);
    expect(size).toBeLessThanOrEqual(3);
  });
});
