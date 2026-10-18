/**
 * A decision point's choices are worked out once per game state (#631).
 *
 * The game's candidate code (`choices`, `elements`, `from` and `filter`) runs
 * once for a pick in a given state, and every caller that asks about that pick
 * again before the state changes reuses the answer: the flow's offer, move
 * enumeration, validation, resolving a submitted value, and the UI's request.
 * A state version that every change advances says when the answer is stale.
 *
 * Production reuses answers. Development mode works every answer out again, so
 * a test that writes to a game directly between two questions always sees its
 * change.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Game, Player, Piece, Space, Action, actionTempState, actionStep, execute, loop, phase, sequence, enumerateLegalMoves, type GameOptions } from '../index.js';
import { enumerateActionMoves } from '../utils/enumerate-moves.js';
import { GameRunner } from '../../runtime/runner.js';
import { createSnapshot } from '../utils/snapshot.js';
import { Card, CardsGame, DuelGame, Pawn, type PawnMove } from './choice-cache-fixtures.test-helper.js';
import { TEST_WORLD_ELEMENT_ID_KEY } from '../element/world-element-id-key.test-helper.js';
import { snapshotTree } from '../utils/index.js';

const devMode = vi.hoisted(() => ({ override: null as boolean | null }));
vi.mock('../../utils/dev.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/dev.js')>();
  return { ...actual, isDevMode: () => devMode.override ?? actual.isDevMode() };
});

afterEach(() => {
  devMode.override = null;
});

function start<G extends Game>(GameClass: new (options: GameOptions) => G, playerCount = 2): GameRunner<G> {
  const runner = new GameRunner<G>({ GameClass, gameType: 'bs631', gameOptions: { playerCount, seed: 'bs631' } });
  runner.start();
  return runner;
}

/**
 * A game whose every kind of game code that may change the game asks a
 * question, writes, and asks again, recording whether the second answer saw
 * the write.
 */
class ProbeGame extends Game<ProbeGame, Player> {
  level = 0;
  ended = false;
  /** `<code>:<saw its own write>`, in the order the code ran. */
  probes: string[] = [];

  constructor(options: GameOptions) {
    super(options);
    const probe = (code: string) => () => this.probe(code);
    this.registerAction(
      Action.create<ProbeGame>('peek')
        .chooseFrom('level', { choices: (ctx) => [ctx.game.level] })
        .execute(() => ({ success: true })),
    );
    this.registerAction(
      Action.create<ProbeGame>('act')
        .chooseFrom('x', { choices: [1, 2], onSelect: probe('onSelect'), onCancel: probe('onCancel') })
        .chooseFrom('z', { choices: [1, 2] })
        .execute(probe('execute')),
    );
    this.registerAction(
      Action.create<ProbeGame>('gather')
        .chooseFrom('y', {
          choices: [1, 2, 3],
          onSelect: probe('onSelect'),
          repeat: { until: (_ctx, y) => y === 3, onEach: probe('onEach') },
        })
        .execute(() => ({ success: true })),
    );
    this.registerAction(
      Action.create<ProbeGame>('risky')
        .chooseFrom('a', { choices: [1], onSelect: () => {}, onCancel: probe('onCancel') })
        .chooseFrom('b', {
          choices: [1],
          onSelect: () => {
            throw new Error('refused');
          },
        })
        .execute(() => ({ success: true })),
    );
    this.registerAction(
      Action.create<ProbeGame>('end').execute((_args, ctx) => {
        ctx.game.ended = true;
        return { success: true };
      }),
    );
    this.registerElements([Space, Piece]);
    this.create(Space, 'there').onEnter(probe('onEnter'));
    this.create(Piece, 'token');
    this.setFlow({
      setup: probe('setup'),
      onEnterPhase: probe('onEnterPhase'),
      onExitPhase: probe('onExitPhase'),
      root: sequence(
        phase('main', {
          do: sequence(
            execute(probe('flow execute')),
            loop({
              while: (ctx) => !(ctx.game as ProbeGame).ended,
              maxIterations: 20,
              do: actionStep({ actions: ['act', 'gather', 'risky', 'end'], player: (ctx) => ctx.game.getPlayer(1)! }),
            }),
          ),
        }),
        actionStep({ actions: ['peek'], player: (ctx) => ctx.game.getPlayer(1)! }),
      ),
    });
  }

  /** The level the `peek` pick offers seat 1. */
  peek(): number {
    const selection = this.getAction('peek')!.selections[0];
    return this.getActionExecutor().getChoices(selection, this.getPlayer(1)!, {}, 'peek')[0].value as number;
  }

  probe(code: string): void {
    const before = this.peek();
    this.level++;
    this.probes.push(`${code}:${this.peek() === before + 1}`);
  }
}

/** A game with no flow, whose one pick offers the game's phase. */
class LifecycleGame extends Game<LifecycleGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<LifecycleGame>('look')
        .chooseFrom('phase', { choices: (ctx) => [ctx.game.phase] })
        .execute(() => ({ success: true })),
    );
  }

  phaseOffered(): unknown {
    return this.getActionExecutor().getChoices(this.getAction('look')!.selections[0], this.getPlayer(1)!, {}, 'look')[0].value;
  }
}

/** The destinations a pawn is offered, as square numbers. */
function destinations(game: DuelGame, seat: number, pawn: Pawn): number[] {
  const action = game.getAction('move')!;
  return game
    .getActionExecutor()
    .getChoices(action.selections[1], game.getPlayer(seat)!, { piece: pawn }, 'move')
    .map((choice) => (choice.value as PawnMove).to);
}

/** The pawns a seat is offered to move, by name. */
function movable(game: DuelGame, seat: number): string[] {
  const action = game.getAction('move')!;
  return game
    .getActionExecutor()
    .getChoices(action.selections[0], game.getPlayer(seat)!, {}, 'move')
    .map((choice) => (choice.value as Pawn).name!);
}

/** A seat's moves, with elements by name, comparable across a restore. */
function describeMoves(game: Game, seat: number): string[] {
  return enumerateLegalMoves(game, seat).map(({ action, args }) =>
    [action, ...Object.entries(args).map(([key, value]) => `${key}=${value instanceof Pawn ? value.name : JSON.stringify(value)}`)].join(' '),
  );
}

describe('a decision point is worked out once per game state (#631)', () => {
  it('every caller in one state shares one evaluation of the choices', () => {
    devMode.override = false;
    const runner = start(DuelGame);
    const game = runner.game;
    // A move's whole cost: in the new state seat 2's choices are worked out
    // once for the flow's offer, the piece filter once per pawn and the
    // destinations once, whichever pawn they were asked for. performAction
    // builds no player view (#695), so seat 1's are not asked for.
    const perSeat = game.all(Pawn).length + 1;
    const before = game.legalMovesRuns;
    expect(runner.performAction('pass', 1, {}).success).toBe(true);
    expect(game.legalMovesRuns).toBe(before + perSeat);

    // The platform's action op then builds every seat's view: seat 2's reuses the
    // flow's offer, and seat 1's choices are worked out once.
    runner.getAllPlayerViews();
    expect(game.legalMovesRuns).toBe(before + 2 * perSeat);

    // Every other question about this state reuses them.
    const asked = game.legalMovesRuns;
    const player = game.getPlayer(2)!;
    const move = game.getAction('move')!;
    const executor = game.getActionExecutor();
    enumerateLegalMoves(game, 2);
    executor.isActionAvailable(move, player);
    executor.getChoices(move.selections[0], player, {}, 'move');
    for (const pawn of game.all(Pawn)) executor.getChoices(move.selections[1], player, { piece: pawn }, 'move');
    const [first] = enumerateActionMoves(game, move, player);
    expect(game.legalMovesRuns).toBe(asked);

    // So do validating and resolving the move; then it changes the board, and
    // only the next offer, seat 1's, is worked out in the new state.
    expect(runner.performAction('move', 2, first).success).toBe(true);
    expect(game.legalMovesRuns).toBe(asked + perSeat);
  });

  it('works every answer out again in development mode', () => {
    devMode.override = true;
    const runner = start(DuelGame);
    const game = runner.game;
    const before = game.legalMovesRuns;
    movable(game, 1);
    expect(game.legalMovesRuns).toBe(before + game.all(Pawn).length);
  });

  it('keys an answer by the earlier picks its callback reads', () => {
    devMode.override = false;
    const runner = start(CardsGame, 3);
    const game = runner.game;
    const ask = game.getAction('ask')!;
    const asker = game.getPlayer(1)!;
    const rank = game.handOf(asker).first(Card)!.rank;
    const ranks = (target: number) =>
      game.getActionExecutor().getChoices(ask.selections[1], asker, { target }, 'ask').map((c) => c.value);
    expect(ranks(2)).toContain(rank);
    expect(ranks(3)).toContain(rank);

    expect(runner.performAction('ask', 1, { target: 2, rank }).success).toBe(true);
    // Seat 1 has asked seat 2 for that rank, not seat 3.
    expect(ranks(2)).not.toContain(rank);
    expect(ranks(3)).toContain(rank);
  });
});

describe('every change to the game is seen by the next question', () => {
  it('an attribute written by an action', () => {
    devMode.override = false;
    const runner = start(DuelGame);
    const game = runner.game;
    const pawn = game.first(Pawn, 'p2-6')!;
    expect(destinations(game, 2, pawn)).toEqual([5]);
    // `pass` doubles the stride by an attribute write alone.
    expect(runner.performAction('pass', 1, {}).success).toBe(true);
    expect(destinations(game, 2, pawn)).toEqual([4]);
  });

  it('an attribute written by a flow step', () => {
    devMode.override = false;
    const runner = start(DuelGame);
    const game = runner.game;
    const pawn = game.first(Pawn, 'p1-1')!;
    // Three rounds of passes: the stride flips each time, and the third
    // round's end sets it back to 1 in the flow's own execute step.
    for (let pass = 0; pass < 5; pass++) runner.performAction('pass', (pass % 2) + 1, {});
    expect(game.stride).toBe(2);
    expect(destinations(game, 1, pawn)).toEqual([3]);
    runner.performAction('pass', 2, {});
    expect(game.round).toBe(3);
    expect(game.stride).toBe(1);
    expect(destinations(game, 1, pawn)).toEqual([2]);
  });

  it('an attribute written by a pick\'s onSelect', () => {
    devMode.override = false;
    const runner = start(DuelGame);
    const game = runner.game;
    expect(movable(game, 2)).toContain('p2-6');
    runner.startPendingAction('stun', 1);
    expect(runner.processSelectionStep(1, 'target', game.first(Pawn, 'p2-6')!).success).toBe(true);
    expect(movable(game, 2)).not.toContain('p2-6');
  });

  it('game code that changes the game sees its own change when it asks again', () => {
    devMode.override = false;
    const runner = start(ProbeGame, 1);
    const game = runner.game;
    const act = game.getAction('act')!;

    // One submission, then pick by pick, then a cancelled pick.
    expect(runner.performAction('act', 1, { x: 1, z: 1 }).success).toBe(true);
    runner.startPendingAction('act', 1);
    runner.processSelectionStep(1, 'x', 1);
    runner.processSelectionStep(1, 'z', 2);
    const cancelled = runner.startPendingAction('act', 1)!;
    runner.processSelectionStep(1, 'x', 2);
    game.getActionExecutor().fireOnCancelCallbacks(act, cancelled);
    expect(runner.performAction('gather', 1, { y: [1, 3] }).success).toBe(true);
    // An onSelect that throws: the picks before it are cancelled.
    expect(runner.performAction('risky', 1, { a: 1, b: 1 }).success).toBe(false);
    expect(runner.performAction('end', 1, {}).success).toBe(true);
    // A space's handler, for a move made by code outside the game.
    game.first(Piece, 'token')!.putInto(game.first(Space, 'there')!);

    expect(game.probes).toEqual([
      'setup:true',
      'onEnterPhase:true',
      'flow execute:true',
      'onSelect:true',
      'execute:true',
      'onSelect:true',
      'execute:true',
      'onSelect:true',
      'onCancel:true',
      'onSelect:true',
      'onEach:true',
      'onEach:true',
      'onCancel:true',
      'onExitPhase:true',
      'onEnter:true',
    ]);
  });

  it('an action run outside the flow', () => {
    devMode.override = false;
    const runner = start(ProbeGame, 1);
    const game = runner.game;
    const level = game.peek();
    game.getActionExecutor().executeAction(game.getAction('act')!, game.getPlayer(1)!, { x: 1, z: 1 });
    expect(game.peek()).toBe(level + 2);
  });

  it('an element moved by code outside the game', () => {
    devMode.override = false;
    const runner = start(DuelGame);
    const game = runner.game;
    const pawn = game.first(Pawn, 'p1-1')!;
    expect(destinations(game, 1, pawn)).toEqual([2]);
    pawn.putInto(game.squares[4]);
    expect(destinations(game, 1, pawn)).toEqual([5]);
  });

  it('a restore into the same game', () => {
    devMode.override = false;
    const runner = start(DuelGame);
    const game = runner.game;
    const opening = createSnapshot(game, 'bs631');
    const openingMoves = describeMoves(game, 1);
    const [first] = enumerateLegalMoves(game, 1).filter((m) => m.action === 'move');
    expect(runner.performAction(first.action, 1, first.args).success).toBe(true);
    expect(describeMoves(game, 2).length).toBeGreaterThan(0);

    game.loadSerializedState(snapshotTree(opening));
    game.setRandomState(opening.randomState);
    game.restoreFlowState(opening.flowState!);
    expect(describeMoves(game, 1)).toEqual(openingMoves);
  });

  it('a restore of the tree alone', () => {
    devMode.override = false;
    const runner = start(DuelGame);
    const game = runner.game;
    const opening = createSnapshot(game, 'bs631');
    const pawn = game.first(Pawn, 'p1-1')!;
    pawn.putInto(game.squares[4]);
    expect(destinations(game, 1, pawn)).toEqual([5]);
    game.loadSerializedState(snapshotTree(opening));
    expect(destinations(game, 1, game.first(Pawn, 'p1-1')!)).toEqual([2]);
  });

  it('the game\'s phase, which the engine writes as the flow starts and ends', () => {
    const phaseOffered = (game: Game) =>
      game.getActionExecutor().getChoices(game.getAction('mark')!.selections[0], game.getPlayer(1)!, {}, 'mark')[0].value;
    class PhaseGame extends Game<PhaseGame, Player> {
      marked = false;
      constructor(options: GameOptions) {
        super(options);
        this.registerAction(
          Action.create<PhaseGame>('mark')
            .chooseFrom('phase', { choices: (ctx) => [ctx.game.phase] })
            .execute((_args, ctx) => {
              ctx.game.marked = true;
              return { success: true };
            }),
        );
        // The loop's condition asks the question too, just before the flow ends.
        this.setFlow({
          root: loop({
            while: (ctx) => phaseOffered(ctx.game) !== undefined && !(ctx.game as PhaseGame).marked,
            maxIterations: 2,
            do: actionStep({ actions: ['mark'], player: (ctx) => ctx.game.getPlayer(1)! }),
          }),
        });
      }
    }
    devMode.override = false;
    const runner = start(PhaseGame, 1);
    const game = runner.game;
    const phase = () => phaseOffered(game);
    expect(phase()).toBe('started');
    expect(runner.performAction('mark', 1, { phase: 'started' }).success).toBe(true);
    expect(phase()).toBe('finished');
  });

  it('a restore of the flow alone, which moves the turn', () => {
    devMode.override = false;
    const runner = start(DuelGame);
    const game = runner.game;
    const opening = createSnapshot(game, 'bs631');
    runner.performAction('pass', 1, {});
    // `stun` offers the pawns of every seat but the one whose turn it is.
    const targets = () => game.getActionExecutor()
      .getChoices(game.getAction('stun')!.selections[0], game.getPlayer(1)!, {}, 'stun')
      .map((choice) => (choice.value as Pawn).name);
    expect(targets()).toEqual(['p1-0', 'p1-1']);
    game.restoreFlowState(opening.flowState!);
    expect(targets()).toEqual(['p2-6', 'p2-7']);
  });

  it('a candidate callback that draws from the game\'s random source is run every time, as without reuse', () => {
    class RollGame extends Game<RollGame, Player> {
      constructor(options: GameOptions) {
        super(options);
        this.registerAction(
          Action.create<RollGame>('roll')
            .chooseFrom('face', { choices: (ctx) => [1 + Math.floor(ctx.game.random() * 6)] })
            .execute(() => ({ success: true })),
        );
        this.setFlow({ root: actionStep({ actions: ['roll'] }) });
      }
    }
    const randomStateAfterAsking = (dev: boolean) => {
      devMode.override = dev;
      const game = start(RollGame).game;
      const roll = game.getAction('roll')!;
      for (let ask = 0; ask < 3; ask++) game.getActionExecutor().getChoices(roll.selections[0], game.getPlayer(1)!, {}, 'roll');
      return game.getRandomState();
    };
    expect(randomStateAfterAsking(false)).toBe(randomStateAfterAsking(true));
  });

  it('the game\'s phase, written by start() and finish() outside the flow', () => {
    devMode.override = false;
    const game = new LifecycleGame({ playerCount: 1, seed: 'bs631' });
    expect(game.phaseOffered()).toBe('setup');
    game.start();
    expect(game.phaseOffered()).toBe('started');
    game.finish();
    expect(game.phaseOffered()).toBe('finished');
  });

  it('the last action\'s result, which a restore of the flow clears', () => {
    class NoteGame extends Game<NoteGame, Player> {
      constructor(options: GameOptions) {
        super(options);
        this.registerAction(
          Action.create<NoteGame>('note')
            .chooseFrom('n', { choices: [1, 2] })
            .execute((args) => ({ success: true, data: { n: args.n } })),
        );
        this.registerAction(
          Action.create<NoteGame>('recall')
            .chooseFrom('last', { choices: (ctx) => [ctx.game.getLastActionResult()?.data?.n ?? 'none'] })
            .execute(() => ({ success: true })),
        );
        this.setFlow({ root: loop({ while: () => true, maxIterations: 10, do: actionStep({ actions: ['note', 'recall'] }) }) });
      }
    }
    devMode.override = false;
    const runner = start(NoteGame, 1);
    const game = runner.game;
    const opening = createSnapshot(game, 'bs631');
    const recalled = () => game.getActionExecutor().getChoices(game.getAction('recall')!.selections[0], game.getPlayer(1)!, {}, 'recall')[0].value;
    expect(runner.performAction('note', 1, { n: 2 }).success).toBe(true);
    expect(recalled()).toBe(2);
    game.restoreFlowState(opening.flowState!);
    expect(recalled()).toBe('none');
  });

  it('a restore of the tree that fails part way', () => {
    devMode.override = false;
    const game = new LifecycleGame({ playerCount: 1, seed: 'bs631' });
    expect(game.phaseOffered()).toBe('setup');
    // The phase is restored first; the tree after it fails.
    const json = game.toJSON();
    const state = { ...json, phase: 'finished', children: [...json.children!, { className: 'NoSuchClass' }] } as typeof json;
    expect(() => game.loadSerializedState(state)).toThrow();
    expect(game.phase).toBe('finished');
    expect(game.phaseOffered()).toBe('finished');
  });
});

describe('what a candidate callback writes', () => {
  it('temp state written by choices is the one execute reads, whichever earlier pick was asked about last', () => {
    class OfferGame extends Game<OfferGame, Player> {
      executedWith: unknown[] = [];
      constructor(options: GameOptions) {
        super(options);
        this.registerAction(
          Action.create<OfferGame>('trade')
            .chooseFrom('target', { choices: [2, 3] })
            .chooseFrom('offer', {
              choices: (ctx) => {
                const offer = (ctx.args.target as number) * 10;
                actionTempState(ctx, 'trade').set('offer', offer);
                return [offer];
              },
            })
            .execute((_args, ctx) => {
              this.executedWith.push(actionTempState(ctx, 'trade').get('offer'));
              return { success: true };
            }),
        );
        this.setFlow({ root: actionStep({ actions: ['trade'] }) });
      }
    }
    devMode.override = false;
    const runner = start(OfferGame, 1);
    const game = runner.game;
    const offer = game.getAction('trade')!.selections[1];
    const ask = (target: number) => game.getActionExecutor().getChoices(offer, game.getPlayer(1)!, { target }, 'trade');
    ask(2);
    ask(3);
    expect(runner.performAction('trade', 1, { target: 2, offer: 20 }).success).toBe(true);
    expect(game.executedWith).toEqual([20]);
  });
});

describe('world mode', () => {
  it('marks the partition of every element a pick hands out, each time it is asked', () => {
    class Token extends Piece<WorldGame> {}
    class WorldGame extends Game<WorldGame, Player> {
      constructor(options: GameOptions) {
        super(options);
        this.registerElements([Space, Token]);
        this.registerAction(
          Action.create<WorldGame>('take')
            .chooseElement('token', { elements: (ctx) => ctx.game.all(Token) })
            .execute(() => ({ success: true })),
        );
      }
    }
    devMode.override = false;
    const game = new WorldGame({ playerCount: 1, seed: 'bs631', worldMode: true, elementIdKey: TEST_WORLD_ELEMENT_ID_KEY });
    const room = game.create(Space, 'room');
    room.create(Token, 'token');
    game.definePartition(room.id);
    const take = game.getAction('take')!;
    const ask = () => game.getActionExecutor().getChoices(take.selections[0], game.getPlayer(1)!, {}, 'take');
    ask();
    game.takeTouchedPartitions();
    ask();
    expect([...game._ctx._reachedPartitions!.partitions]).toEqual([room.id]);
  });
});

