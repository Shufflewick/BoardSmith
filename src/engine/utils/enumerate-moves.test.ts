/**
 * Tests for enumerateLegalMoves — the public engine utility extracted from MCTSBot.
 *
 * INTRO-04: Full enumeration + in-process element objects + maxPerAction + bot parity.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  GameElement,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../index.js';
import { MCTSBot } from '../../bot/mcts-bot.js';
import { GameRunner } from '../../runtime/runner.js';
import { followUpForSeat } from '../flow/seat-activity.js';
import { _clearShownWarnings } from '../../utils/dev.js';
import {
  enumerateActionMoves,
  enumerateLegalMoves,
  numberInputValues,
  MAX_MULTISELECT_COMBINATIONS,
} from './enumerate-moves.js';

// ============================================================================
// Test game: 3 Piece tokens on a board, action picks one via chooseElement.
// ≥2 choices satisfies the MCTS memory note (bot short-circuits with only 1 move).
// ============================================================================

class TokenGame extends Game<TokenGame, Player> {
  board!: Space<TokenGame>;

  constructor(options: GameOptions) {
    super(options);
    this.board = this.create(Space<TokenGame>, 'board');

    // 3 tokens → 3 concrete moves for the pick action
    this.board.create(Piece<TokenGame>, 'token-a');
    this.board.create(Piece<TokenGame>, 'token-b');
    this.board.create(Piece<TokenGame>, 'token-c');

    this.registerAction(
      Action.create<TokenGame>('pick')
        .chooseElement('target', {
          prompt: 'Choose a token',
          elementClass: Piece,
        })
        .execute(() => ({ success: true })),
    );

    this.setFlow({
      root: loop({
        maxIterations: 10,
        do: eachPlayer({
          do: actionStep({ actions: ['pick'] }),
        }),
      }),
    });
  }
}

function createTokenGame(): TokenGame {
  const game = new TokenGame({
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    seed: 'enumerate-test',
  });
  game.startFlow();
  return game;
}

describe('enumerateLegalMoves', () => {
  let game: TokenGame;

  beforeEach(() => {
    game = createTokenGame();
  });

  // ─── Test 1: Full enumeration returns all concrete moves ───────────────────

  it('returns one move per legal target element (full enumeration default)', () => {
    const moves = enumerateLegalMoves(game, 1);

    // 3 tokens → 3 moves for action 'pick'
    expect(moves).toHaveLength(3);
    expect(moves.every(m => m.action === 'pick')).toBe(true);
  });

  // ─── Test 2: Args contain in-process element objects, NOT numeric IDs ──────

  it('returns element objects in args (not serialized IDs)', () => {
    const moves = enumerateLegalMoves(game, 1);

    for (const move of moves) {
      const target = move.args.target;

      // CRITICAL INVARIANT: must be a GameElement object, not a bare number
      expect(typeof target).not.toBe('number');
      expect(target).toBeInstanceOf(GameElement);

      // Element objects carry expected structural fields
      const el = target as GameElement;
      expect(typeof el.id).toBe('number');
      expect(el.name).toBeDefined();
    }
  });

  // ─── Test 3: maxPerAction truncates per-action move count ──────────────────

  it('maxPerAction truncates moves per action when provided', () => {
    const moves = enumerateLegalMoves(game, 1, { maxPerAction: 2 });

    // With maxPerAction: 2, only 2 of the 3 token moves should be returned
    expect(moves.length).toBeLessThanOrEqual(2);
    expect(moves.every(m => m.action === 'pick')).toBe(true);
  });

  it('returns all moves when maxPerAction exceeds available count', () => {
    const moves = enumerateLegalMoves(game, 1, { maxPerAction: 10 });

    // 3 tokens < 10 cap → still 3
    expect(moves).toHaveLength(3);
  });

  // ─── Test 4: Parity with MCTSBot enumeration on identical state ────────────
  //
  // After extraction, enumerateLegalMoves must surface the same concrete moves
  // as the bot's full (unsampled) enumeration. The bot serializes element
  // args to numeric IDs; we project our element-object args to IDs for the
  // set-equality comparison.

  it('returns the same move set as the MCTSBot root enumeration on identical state', () => {
    const flowState = game.getFlowState()!;

    // Seed the bot so its results are deterministic (though noSampling path is used here)
    const bot = new MCTSBot(game, TokenGame, 'token-game', 1, [], {
      iterations: 1,
      playoutDepth: 1,
      seed: 'parity-test',
    });

    // The bot's unsampled enumeration for its own seat, as its root uses it
    const botMoves: Array<{ action: string; args: Record<string, unknown> }> =
      (bot as any).movesFor(game, flowState, 1, { sample: false });

    // Project enumerateLegalMoves results: element → numeric ID for comparison
    const coreMoves = enumerateLegalMoves(game, 1);

    const coreNormalized = coreMoves
      .map(m => ({
        action: m.action,
        targetId: (m.args.target as GameElement).id,
      }))
      .sort((a, b) => a.targetId - b.targetId);

    const botNormalized = botMoves
      .map(m => ({
        action: m.action,
        targetId: m.args.target as number,
      }))
      .sort((a, b) => a.targetId - b.targetId);

    expect(coreNormalized).toEqual(botNormalized);
  });

  // ─── Test 5: No moves available returns empty array ───────────────────────

  it('returns empty array when seat has no available actions', () => {
    // Seat 2 is not the active player on the first turn
    const moves = enumerateLegalMoves(game, 2);
    expect(moves).toHaveLength(0);
  });
});

// ============================================================================
// Function-valued multiSelect resolution (bot-01 / D9).
//
// Pre-fix: `_enumerateRecursive` treats ANY function-valued `multiSelect` as
// "cannot be statically enumerated" and unconditionally skips it (devWarn,
// then skip-if-optional / `[]`-if-required) WITHOUT ever invoking the
// function. Post-fix it routes through the shared `resolveMultiSelect`
// helper into the existing `generateCombinations` machinery.
// ============================================================================

class DynamicMultiSelectGame extends Game<DynamicMultiSelectGame, Player> {
  board!: Space<DynamicMultiSelectGame>;

  constructor(options: GameOptions) {
    super(options);
    this.board = this.create(Space<DynamicMultiSelectGame>, 'board');
    this.board.create(Piece<DynamicMultiSelectGame>, 'token-a');
    this.board.create(Piece<DynamicMultiSelectGame>, 'token-b');
    this.board.create(Piece<DynamicMultiSelectGame>, 'token-c');

    this.registerAction(
      Action.create<DynamicMultiSelectGame>('pick')
        .chooseElements('items', {
          prompt: 'Choose two tokens',
          elements: (ctx) => [...(ctx.game as DynamicMultiSelectGame).board.all(Piece)],
          multiSelect: () => ({ min: 2, max: 2 }),
        })
        .execute(() => ({ success: true })),
    );

    this.setFlow({
      root: loop({
        maxIterations: 10,
        do: eachPlayer({
          do: actionStep({ actions: ['pick'] }),
        }),
      }),
    });
  }
}

describe('enumerateLegalMoves: function-valued multiSelect', () => {
  it('routes a function multiSelect resolving to a concrete config into generateCombinations (C(3,2) = 3 combos)', () => {
    const game = new DynamicMultiSelectGame({
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'dynamic-multiselect-test',
    });
    game.startFlow();

    const moves = enumerateLegalMoves(game, 1);

    expect(moves).toHaveLength(3);
    for (const move of moves) {
      expect(move.action).toBe('pick');
      expect(Array.isArray(move.args.items)).toBe(true);
      expect((move.args.items as unknown[]).length).toBe(2);
    }
  });
});

// ============================================================================
// A required selection whose choices resolve to `undefined` must not produce a
// "move". This is the 1-2 Punch stall: the second selection's `choices` closure
// derived its options from the OPPONENT'S HAND, which is redacted inside the
// MCTS search sandbox, so every option came back `undefined`. Enumeration
// happily built `{ownDiscard: el, namedType: undefined}`, serialization dropped
// the undefined key, and the engine then rejected the "complete" move with
// "Missing required selection: namedType" — a bot seat that stopped driving the
// flow for a reason nothing upstream could see.
// ============================================================================

class UndefinedChoiceGame extends Game<UndefinedChoiceGame, Player> {
  board!: Space<UndefinedChoiceGame>;

  constructor(options: GameOptions) {
    super(options);
    this.board = this.create(Space<UndefinedChoiceGame>, 'board');
    this.board.create(Piece<UndefinedChoiceGame>, 'token-a');
    this.board.create(Piece<UndefinedChoiceGame>, 'token-b');

    this.registerAction(
      Action.create<UndefinedChoiceGame>('pick')
        .chooseElement('target', { prompt: 'Choose a token', elementClass: Piece })
        // Stands in for a choices closure reading redacted state: it offers an
        // option, but the option's VALUE is undefined.
        .chooseFrom('label', { prompt: 'Name it', choices: () => [undefined as unknown as string] })
        .execute(() => ({ success: true })),
    );

    this.setFlow({
      root: loop({
        maxIterations: 10,
        do: eachPlayer({ do: actionStep({ actions: ['pick'] }) }),
      }),
    });
  }
}

describe('enumerateLegalMoves: choices with an undefined value', () => {
  it('yields NO moves for a required selection whose only choice value is undefined — never a move missing that arg', () => {
    const game = new UndefinedChoiceGame({
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'undefined-choice-test',
    });
    game.startFlow();

    const moves = enumerateLegalMoves(game, 1);

    // The honest answer is "this seat has no legal move for this action" — NOT
    // two structurally-invalid moves that die at performAction.
    expect(moves).toHaveLength(0);
    // Belt and braces: no move may ever carry the key with an undefined value,
    // nor omit it while claiming to be a complete move for this action.
    for (const move of moves) {
      expect(Object.prototype.hasOwnProperty.call(move.args, 'label')).toBe(true);
      expect(move.args.label).not.toBeUndefined();
    }
  });
});

// ============================================================================
// #249 — an ordered, repeatable list is enumerated one ENTRY at a time
// ============================================================================

describe('enumerateLegalMoves with an orderedList selection (#249)', () => {
  /** A game whose one action asks for an ordered list with the given bounds. */
  function repairGame(bounds: { min?: number; max?: number }, choices: string[]): Game {
    class RepairGame extends Game<RepairGame, Player> {
      constructor(options: GameOptions) {
        super(options);
        this.registerAction(
          Action.create<RepairGame>('repair')
            .chooseFrom('buildings', { choices, orderedList: bounds })
            .execute(() => ({ success: true })),
        );
        this.setFlow({
          root: loop({
            maxIterations: 10,
            do: eachPlayer({ do: actionStep({ actions: ['repair'] }) }),
          }),
        });
      }
    }
    const game = new RepairGame({ playerCount: 2, seed: 'repair' });
    game.startFlow();
    return game;
  }

  it('offers one single-entry list per choice, and every one is a LEGAL move', () => {
    // Not every possible list, deliberately: with repeats allowed there are
    // choices^max of them, so there is no cap under which "all of them" is
    // tractable and no honest truncation either. What it offers must therefore be
    // real -- an array, not a bare value, or performAction refuses it.
    const game = repairGame({ min: 1, max: 3 }, ['university', 'shipyard']);

    const moves = enumerateLegalMoves(game, 1);

    expect(moves.map((move) => move.args.buildings)).toEqual([
      ['university'],
      ['shipyard'],
    ]);
    for (const move of moves) {
      expect(game.getActionExecutor().validateAction(
        game.getAction('repair')!,
        game.getPlayer(1)!,
        move.args,
      ).valid).toBe(true);
    }
  });

  it('includes the EMPTY list when the rules allow one', () => {
    const game = repairGame({ min: 0, max: 2 }, ['university']);

    const moves = enumerateLegalMoves(game, 1);

    expect(moves.map((move) => move.args.buildings)).toEqual([[], ['university']]);
  });
});

// #627: a follow-up may pre-fill an optional pick as `null`, meaning skipped.
// The runner binds that null back when the follow-up runs, so enumeration must
// treat the pick as answered on both of its paths, not offer it again.
describe('a follow-up that pre-fills an optional pick as null (#627)', () => {
  /** Declares 'chained' in its constructor, so the scratch copy a repeating pick is enumerated on has it too. */
  class SkipGame extends Game<SkipGame, Player> {
    constructor(options: GameOptions & { repeating?: boolean }) {
      super(options);
      const base = Action.create<SkipGame>('chained').chooseFrom('a', { choices: [1, 2], optional: true });
      this.registerAction(
        (options.repeating
          ? base.chooseFrom('b', { choices: ['x', 'y'], repeat: { until: () => true } })
          : base.chooseFrom('b', { choices: ['x', 'y'] })
        ).execute(() => ({ success: true })),
      );
    }
  }

  it.each([
    ['an ordinary action', false],
    ['an action with a repeating pick', true],
  ])('treats the pick as answered for %s', (_kind, repeating) => {
    const game = new SkipGame({ playerCount: 2, repeating });
    const moves = enumerateActionMoves(game, game.getAction('chained')!, game.getPlayer(1)!, {
      followUp: { action: 'chained', args: { a: null } },
    });
    expect(moves).toHaveLength(2);
    expect(moves.every((move) => move.a === null)).toBe(true);
  });
});

// #648: execution validates the resolved args, where the skipped pick is
// absent, so enumeration must validate the same args or it drops a move the
// engine accepts.
describe('an action-level validate sees a pre-filled null pick as absent (#648)', () => {
  class SkipValidateGame extends Game<SkipValidateGame, Player> {
    constructor(options: GameOptions & { repeating?: boolean }) {
      super(options);
      const base = Action.create<SkipValidateGame>('chained').chooseFrom('a', { choices: [1, 2], optional: true });
      this.registerAction(
        (options.repeating
          ? base.chooseFrom('b', { choices: ['x', 'y'], repeat: { until: () => true } })
          : base.chooseFrom('b', { choices: ['x', 'y'] })
        )
          .validate((args) => args.a === undefined || (args.a as number) > 0)
          .execute(() => ({ success: true })),
      );
    }
  }

  it.each([
    ['an ordinary action', false],
    ['an action with a repeating pick', true],
  ])('enumerates the move execution accepts for %s', (_kind, repeating) => {
    const game = new SkipValidateGame({ playerCount: 2, repeating });
    const action = game.getAction('chained')!;
    const player = game.getPlayer(1)!;
    const followUp = { action: 'chained', args: { a: null } };
    const moves = enumerateActionMoves(game, action, player, { followUp });
    expect(moves).toHaveLength(2);
    for (const move of moves) {
      expect(move.a).toBe(null);
      expect(game.getActionExecutor().executeAction(action, player, move, { followUp }).success).toBe(true);
    }
  });
});

// #659: execution shows every callback the resolved args, where the skipped
// pick is absent, so a later pick's choices, disabled and multiSelect must see
// the same args in enumeration, or the bot is offered moves the engine refuses
// and misses ones it accepts.
describe("a later pick's callbacks see a pre-filled null pick as absent (#659)", () => {
  type Shape = 'choices' | 'disabled' | 'multiSelect';
  const skipped = (ctx: { args: Record<string, unknown> }) => ctx.args.a === undefined;

  class SkipCallbackGame extends Game<SkipCallbackGame, Player> {
    constructor(options: GameOptions & { shape: Shape; repeating: boolean }) {
      super(options);
      const { shape, repeating } = options;
      type Ctx = { args: Record<string, unknown> };
      const base = Action.create<SkipCallbackGame>('chained').chooseFrom('a', { choices: [1, 2], optional: true });
      const pick = {
        choices: shape === 'choices' ? (ctx: Ctx) => (skipped(ctx) ? ['x', 'y'] : ['z']) : ['x', 'y', 'z'],
        disabled: (choice: string, ctx: Ctx) =>
          (shape === 'multiSelect' ? choice === 'z' : shape === 'disabled' && skipped(ctx) === (choice === 'z'))
            ? 'not now'
            : false,
      };
      this.registerAction(
        (shape === 'multiSelect'
          ? base.chooseFrom('b', { ...pick, multiSelect: (ctx) => (skipped(ctx) ? { min: 1, max: 1 } : { min: 2, max: 2 }) })
          : repeating
            ? base.chooseFrom('b', { ...pick, repeat: { until: () => true } })
            : base.chooseFrom('b', pick)
        )
          .execute(() => ({ success: true })),
      );
    }
  }

  // Every value `b` could be sent as, for checking no accepted move is missing.
  const singles = ['x', 'y', 'z'];
  const lists = [['x'], ['y'], ['z'], ['x', 'y']];

  it.each([
    ['choices', false],
    ['choices', true],
    ['disabled', false],
    ['disabled', true],
    ['multiSelect', false],
  ] as const)('enumerates exactly what execution accepts when b uses %s (repeating: %s)', (shape, repeating) => {
    const game = new SkipCallbackGame({ playerCount: 2, shape, repeating });
    const action = game.getAction('chained')!;
    const player = game.getPlayer(1)!;
    const followUp = { action: 'chained', args: { a: null } };
    const moves = enumerateActionMoves(game, action, player, { followUp });
    const accepts = (b: unknown) =>
      game.getActionExecutor().executeAction(action, player, { a: null, b: repeating ? [b] : b }, { followUp })
        .success;

    for (const move of moves) expect(move.a).toBe(null);
    const offered = moves.map((move) => (repeating ? (move.b as unknown[])[0] : move.b));
    const expected = shape === 'multiSelect' ? [['x'], ['y']] : ['x', 'y'];
    expect(offered).toEqual(expected);
    expect((shape === 'multiSelect' ? lists : singles).filter(accepts)).toEqual(expected);
  });
});

// ============================================================================
// #690: a move the server refuses is not a legal move. An action's own
// `.disabled()` rule and the tutorial gate keep it offered (greyed, with a
// reason) but performAction refuses it, so enumeration must leave it out.
// ============================================================================

class GatedGame extends Game<GatedGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<GatedGame>('move')
        .chooseFrom('dest', { choices: ['a', 'b'] })
        .execute(() => ({ success: true })),
      Action.create<GatedGame>('build')
        .chooseFrom('site', { choices: ['x', 'y'] })
        .disabled(() => 'Two wood short.')
        .execute(() => ({ success: true })),
      Action.create<GatedGame>('pass').execute(() => ({ success: true })),
    );
    this.setFlow({
      root: loop({ maxIterations: 10, do: eachPlayer({ do: actionStep({ actions: ['move', 'build', 'pass'] }) }) }),
    });
  }
}

describe('enumeration leaves out actions the game refuses (#690)', () => {
  let game: GatedGame;
  beforeEach(() => {
    game = new GatedGame({ playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'gated' });
    game.startFlow();
  });

  it("drops an action its own .disabled() rule turns off, and every listed move is accepted", () => {
    const moves = enumerateLegalMoves(game, 1);
    expect(moves.map((m) => m.action).sort()).toEqual(['move', 'move', 'pass']);
    expect(enumerateActionMoves(game, game.getAction('build')!, game.getPlayer(1)!)).toEqual([]);
    expect(game.performAction('build', game.getPlayer(1)!, { site: 'x' }).error).toMatch(/is disabled: Two wood short/);
  });

  it("never lets the bot search or play a disabled action", async () => {
    const bot = new MCTSBot(game, GatedGame, 'gated', 1, [], { iterations: 20, playoutDepth: 2, seed: 'gated-bot' });
    const rootMoves: Array<{ action: string }> = (bot as any).movesFor(game, game.getFlowState()!, 1, { sample: false });
    expect(rootMoves.map((m) => m.action).sort()).toEqual(['move', 'move', 'pass']);
    expect((await bot.play())?.action).not.toBe('build');
  });

  it('drops an action the active tutorial step gates out', () => {
    game.tutorialDefinition = { learnerSeat: 1, steps: [{ id: 'step-1', gate: { action: 'move' } }] };
    game.tutorialProgress.set(1, { stepId: 'step-1', status: 'running' });
    expect(enumerateLegalMoves(game, 1).map((m) => m.action)).toEqual(['move', 'move']);
  });
});

class FollowUpGatedGame extends Game<FollowUpGatedGame, Player> {
  collectBlocked = false;
  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<FollowUpGatedGame>('start').execute(() => ({ success: true, followUp: { action: 'collect', args: {} } })),
      Action.create<FollowUpGatedGame>('collect')
        .chooseFrom('item', { choices: ['gem', 'coin'] })
        .disabled((ctx) => (ctx.game.collectBlocked ? 'Your bag is full.' : false))
        .execute(() => ({ success: true })),
    );
    this.setFlow({ root: loop({ maxIterations: 10, do: eachPlayer({ do: actionStep({ actions: ['start'] }) }) }) });
  }
}

describe('a held follow-up the game refuses (#690)', () => {
  it('has no moves while its .disabled() rule turns it off, and performAction refuses it', () => {
    const runner = new GameRunner<FollowUpGatedGame>({
      GameClass: FollowUpGatedGame,
      gameType: 'follow-up-gated',
      gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'follow-up-gated' },
    });
    runner.start();
    expect(runner.performAction('start', 1, {}).success).toBe(true);
    const { game } = runner;
    const followUp = followUpForSeat(game.getFlowState(), 1)!;
    expect(followUp.action).toBe('collect');
    const collectMoves = () => enumerateLegalMoves(game, 1).filter((m) => m.action === 'collect');
    expect(collectMoves()).toHaveLength(2);

    game.collectBlocked = true;
    expect(collectMoves()).toEqual([]);
    expect(game.performAction('collect', game.getPlayer(1)!, { item: 'gem' }, { followUp }).error)
      .toMatch(/is disabled: Your bag is full/);
  });
});

// ============================================================================
// #689 — a bounded whole-number input is listed like a choice
// ============================================================================

class NumberInputGame extends Game<NumberInputGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<NumberInputGame>('bid')
        .enterNumber('amount', { min: 1, max: 6, integer: true, validate: (amount) => amount % 2 === 0 || 'Bid an even amount.' })
        .execute(() => ({ success: true })),
      Action.create<NumberInputGame>('draw')
        .enterNumber('count', { min: 1, max: 3, integer: true })
        .chooseFrom('pile', { choices: (ctx) => Array.from({ length: ctx.args.count ?? 0 }, (_, i) => i) })
        .execute(() => ({ success: true })),
      Action.create<NumberInputGame>('mark')
        .chooseFrom('symbol', { choices: ['x', 'o'], repeat: { until: () => true } })
        .enterNumber('weight', { min: 1, max: 2, integer: true })
        .execute(() => ({ success: true })),
      Action.create<NumberInputGame>('unbounded')
        .enterNumber('page', { min: 1, integer: true })
        .execute(() => ({ success: true })),
      Action.create<NumberInputGame>('fraction')
        .enterNumber('share', { min: 0, max: 1 })
        .execute(() => ({ success: true })),
      Action.create<NumberInputGame>('huge')
        .enterNumber('credits', { min: 0, max: MAX_MULTISELECT_COMBINATIONS, integer: true })
        .execute(() => ({ success: true })),
      Action.create<NumberInputGame>('maybe')
        .enterNumber('tip', { min: 1, integer: true, optional: true })
        .execute(() => ({ success: true })),
      Action.create<NumberInputGame>('refused')
        .enterNumber('n', { min: 1, max: 3, integer: true, optional: true, validate: () => 'Your hand is empty.' })
        .execute(() => ({ success: true })),
      Action.create<NumberInputGame>('markRefused')
        .chooseFrom('symbol', { choices: ['x'], repeat: { until: () => true } })
        .enterNumber('n', { min: 1, max: 3, integer: true, optional: true, validate: () => 'Your hand is empty.' })
        .execute(() => ({ success: true })),
      Action.create<NumberInputGame>('markHuge')
        .chooseFrom('symbol', { choices: ['x'], repeat: { until: () => true } })
        .enterNumber('credits', { min: 0, max: MAX_MULTISELECT_COMBINATIONS, integer: true })
        .execute(() => ({ success: true })),
    );
    this.setFlow({ root: loop({ maxIterations: 10, do: eachPlayer({ do: actionStep({ actions: ['bid'] }) }) }) });
  }
}

describe('enumeration lists a bounded whole-number input (#689)', () => {
  let game: NumberInputGame;
  const movesOf = (action: string) => enumerateActionMoves(game, game.getAction(action)!, game.getPlayer(1)!);
  beforeEach(() => {
    game = new NumberInputGame({ playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'numbers' });
    game.startFlow();
  });

  it("lists each whole number from min to max that the input's own validate accepts", () => {
    expect(enumerateLegalMoves(game, 1)).toEqual([2, 4, 6].map((amount) => ({ action: 'bid', args: { amount } })));
  });

  it('enumerates a selection that depends on the number picked before it', () => {
    expect(movesOf('draw')).toEqual([
      { count: 1, pile: 0 },
      { count: 2, pile: 0 }, { count: 2, pile: 1 },
      { count: 3, pile: 0 }, { count: 3, pile: 1 }, { count: 3, pile: 2 },
    ]);
  });

  it('lists a number input that follows a repeating selection', () => {
    expect(movesOf('mark')).toEqual([
      { symbol: ['x'], weight: 1 }, { symbol: ['x'], weight: 2 },
      { symbol: ['o'], weight: 1 }, { symbol: ['o'], weight: 2 },
    ]);
  });

  it('lists no move for a required input without both bounds, a whole-number rule, or with more values than the cap', () => {
    expect(movesOf('unbounded')).toEqual([]);
    expect(movesOf('fraction')).toEqual([]);
    expect(movesOf('huge')).toEqual([]);
  });

  it('skips an optional input it cannot list, as a player may', () => {
    expect(movesOf('maybe')).toEqual([{}]);
  });

  it('skips an optional input whose validate refuses every value, after a repeating selection too', () => {
    expect(game.performAction('refused', game.getPlayer(1)!, {}).success).toBe(true);
    expect(movesOf('refused')).toEqual([{}]);
    expect(movesOf('markRefused')).toEqual([{ symbol: ['x'] }]);
  });

  it('says once why a required input it cannot list contributes no moves, after a repeating selection too', () => {
    _clearShownWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      movesOf('huge');
      movesOf('huge');
      movesOf('markHuge');
      expect(warn.mock.calls.map(([message]) => message)).toEqual([
        `[BoardSmith] Action "huge" contributed no moves because its number input "credits" cannot be listed: ` +
          `its range 0 to ${MAX_MULTISELECT_COMBINATIONS} holds ${MAX_MULTISELECT_COMBINATIONS + 1} values, ` +
          `and at most ${MAX_MULTISELECT_COMBINATIONS} may be listed. Narrow the range.`,
        `[BoardSmith] Action "markHuge" contributed no moves because its number input "credits" cannot be listed: ` +
          `its range 0 to ${MAX_MULTISELECT_COMBINATIONS} holds ${MAX_MULTISELECT_COMBINATIONS + 1} values, ` +
          `and at most ${MAX_MULTISELECT_COMBINATIONS} may be listed. Narrow the range.`,
      ]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('numberInputValues (#689)', () => {
  const values = (range: { min?: number; max?: number; integer?: boolean }) =>
    numberInputValues({ type: 'number', name: 'n', ...range });

  it('is every whole number in the range', () => {
    expect(values({ min: -1, max: 2, integer: true })).toEqual({ values: [-1, 0, 1, 2] });
    expect(values({ min: 0.5, max: 3.5, integer: true })).toEqual({ values: [1, 2, 3] });
  });

  it('says what an input it cannot list is missing', () => {
    expect(values({ min: 1, integer: true })).toEqual({ unlistable: expect.stringMatching(/needs min, max and integer: true/) });
    expect(values({ min: 0, max: 1 })).toEqual({ unlistable: expect.stringMatching(/needs min, max and integer: true/) });
  });

  it('refuses a range with more values than the cap, naming it', () => {
    expect(values({ min: 1, max: MAX_MULTISELECT_COMBINATIONS, integer: true })).toEqual({ values: expect.any(Array) });
    expect(values({ min: 0, max: MAX_MULTISELECT_COMBINATIONS, integer: true })).toEqual({
      unlistable: expect.stringMatching(new RegExp(`${MAX_MULTISELECT_COMBINATIONS + 1} values.*at most ${MAX_MULTISELECT_COMBINATIONS}`)),
    });
    expect(values({ min: 0, max: 1e12, integer: true })).toEqual({ unlistable: expect.any(String) });
  });
});

class PickValidateGame extends Game<PickValidateGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    const board = this.create(Space<PickValidateGame>, 'board');
    board.create(Piece<PickValidateGame>, 'token-a');
    board.create(Piece<PickValidateGame>, 'token-b');
    this.registerActions(
      Action.create<PickValidateGame>('number')
        .chooseFrom('n', { choices: [1, 2, 3], validate: (v) => v !== 2 || 'not 2' })
        .execute(() => ({ success: true })),
      Action.create<PickValidateGame>('token')
        .chooseElement('target', { elementClass: Piece, validate: (el) => el.name !== 'token-b' || 'not b' })
        .execute(() => ({ success: true })),
    );
    this.setFlow({ root: loop({ maxIterations: 10, do: eachPlayer({ do: actionStep({ actions: ['number', 'token'] }) }) }) });
  }
}

describe("enumeration honours a pick's own validate (#768)", () => {
  it('lists no move a choice or element pick validate refuses', () => {
    const game = new PickValidateGame({ playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'pick-validate' });
    game.startFlow();
    const moves = enumerateLegalMoves(game, 1);
    expect(moves.filter((m) => m.action === 'number').map((m) => m.args.n)).toEqual([1, 3]);
    expect(moves.filter((m) => m.action === 'token').map((m) => (m.args.target as Piece).name)).toEqual(['token-a']);
  });
});
