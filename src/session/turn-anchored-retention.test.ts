/**
 * #504: CHECKPOINT RETENTION IS BOUNDED BY DEFAULT, BACK TO THE TURN START.
 *
 * Each per-action checkpoint is a full copy of the element tree. Retaining all
 * of them made a saved game grow by one tree per action for its whole life, so
 * every long game walked toward its host's state budget and each game set
 * `checkpoints: { max }` by hand. The default now keeps checkpoints back to the
 * oldest point any seat's undo can still restore (the start of the current
 * action-step frame) and drops everything older. `max` stays as an optional
 * hard cap. `boardsmith dev` and debug sessions keep the full history, because
 * time travel reads it.
 *
 * Driven through `executeOp`, the path a host runs, with no debug flag: what a
 * hosted table gets.
 */
import { describe, expect, it } from 'vitest';

import {
  Action,
  Card as BaseCard,
  Game,
  Player,
  Space,
  actionStep,
  eachPlayer,
  execute,
  flowBoundaryKey,
  ifThen,
  loop,
  sequence,
  simultaneousActionStep,
  type BoundaryKeyState,
  type GameOptions,
} from '../engine/index.js';
import type { GameStateSnapshot } from '../runtime/index.js';
import { runnerFromSnapshot } from './runner-from-snapshot.js';
import { executeOp, type ExecuteOpHostOptions, type GameDefinitionLike } from './stateless-ops.js';
import type { PlayerGameState } from './types.js';
import { succeeded } from './op-result.test-helper.js';
import { UndoRefusedError, assertUndoAllowed } from './utils.js';

const ACTIONS_PER_TURN = 3;
const SEATS = 3;

class Token extends BaseCard<ShortTurnGame> {}
class Board extends Space<ShortTurnGame> {}

/**
 * Three seats, each turn exactly three `step` actions by one seat, forever. A
 * board of tokens makes each checkpoint cost a measurable tree.
 */
class ShortTurnGame extends Game<ShortTurnGame, Player> {
  steps = 0;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Token, Board]);
    const board = this.create(Board, 'board');
    for (let i = 0; i < 30; i++) board.create(Token, `token-${i}`);
    this.registerAction(
      Action.create('step').execute(() => {
        this.steps += 1;
      }),
    );
    this.setFlow({
      root: loop({
        while: () => true,
        maxIterations: 10_000,
        do: eachPlayer({ do: actionStep({ actions: ['step'], maxMoves: ACTIONS_PER_TURN }) }),
      }),
    });
  }
}

const shortTurns: GameDefinitionLike = {
  gameClass: ShortTurnGame,
  gameType: 'short-turns',
  minPlayers: SEATS,
  maxPlayers: SEATS,
};

const options = { playerCount: SEATS, seed: 'turn-anchored' };

interface Table {
  snapshot: GameStateSnapshot;
  views: unknown[];
}

async function start(def: GameDefinitionLike, host?: ExecuteOpHostOptions): Promise<Table> {
  const result = succeeded(await executeOp(def, options, null, null, { type: 'start' }, host));
  return { snapshot: result.snapshot, views: result.playerViews };
}

/** The seat whose turn it is in `table`. */
function currentSeat(table: Table): number {
  return table.snapshot.flowState!.currentPlayer as number;
}

/** Actions the current seat has taken this turn. */
function moveCountOf(table: Table): number {
  return table.snapshot.flowState!.moveCount as number;
}

function canUndo(table: Table, seat: number): boolean {
  return (table.views[seat - 1] as { state: PlayerGameState }).state.canUndo === true;
}

async function step(def: GameDefinitionLike, table: Table, host?: ExecuteOpHostOptions): Promise<Table> {
  const result = succeeded(
    await executeOp(
      def,
      options,
      table.snapshot,
      null,
      {
        type: 'action',
        actionName: 'step',
        player: currentSeat(table),
        args: {},
        boundaryKey: flowBoundaryKey(table.snapshot.flowState as BoundaryKeyState),
      },
      host,
    ),
  );
  return { snapshot: result.snapshot, views: result.playerViews };
}

async function play(def: GameDefinitionLike, actions: number, host?: ExecuteOpHostOptions): Promise<Table> {
  let table = await start(def, host);
  for (let i = 0; i < actions; i++) table = await step(def, table, host);
  return table;
}

describe('#504: turn-anchored checkpoint retention', () => {
  it('a game with no policy keeps only the checkpoints back to the turn start, across 500 actions', async () => {
    let table = await start(shortTurns);
    for (let i = 0; i < 500; i++) {
      table = await step(shortTurns, table);
      const history = table.snapshot.actionHistory.length;
      const turnStart = history - moveCountOf(table);
      const window = table.snapshot.actionCheckpoints!;
      // Exactly the range undo can reach: the turn start up to now.
      expect(window.baseIndex).toBe(turnStart);
      expect(window.entries).toHaveLength(history - turnStart + 1);
      // And the seat whose turn it is is offered its undo whenever it has acted.
      expect(canUndo(table, currentSeat(table))).toBe(moveCountOf(table) > 0);
    }
    expect(table.snapshot.actionHistory).toHaveLength(500);
  });

  it('every seat can still undo its own turn after 500 actions', async () => {
    // 500 actions leaves seat 2 two actions into its turn (500 = 166 * 3 + 2).
    let table = await play(shortTurns, 500);
    const seat = currentSeat(table);
    expect(moveCountOf(table)).toBe(2);

    const undo = succeeded(await executeOp(shortTurns, options, table.snapshot, null, { type: 'undo', player: seat }));
    table = { snapshot: undo.snapshot, views: undo.playerViews };
    expect(table.snapshot.actionHistory).toHaveLength(498);
    expect(currentSeat(table)).toBe(seat);

    // Finish that turn, then each seat in turn takes one action of its own
    // turn and takes it back.
    for (let i = 0; i < ACTIONS_PER_TURN; i++) table = await step(shortTurns, table);
    for (let turn = 0; turn < SEATS; turn++) {
      const acting = currentSeat(table);
      const before = table.snapshot.actionHistory.length;
      table = await step(shortTurns, table);
      expect(canUndo(table, acting)).toBe(true);
      const back = succeeded(
        await executeOp(shortTurns, options, table.snapshot, null, { type: 'undo', player: acting }),
      );
      table = { snapshot: back.snapshot, views: back.playerViews };
      expect(table.snapshot.actionHistory).toHaveLength(before);
      // Move on to the next seat.
      for (let i = 0; i < ACTIONS_PER_TURN; i++) table = await step(shortTurns, table);
    }
  });

  it('the saved game stops growing with the action count', async () => {
    const short = (await play(shortTurns, 30)).snapshot.actionCheckpoints!;
    const long = (await play(shortTurns, 300)).snapshot.actionCheckpoints!;
    // Both are at the same point in a turn (30 and 300 are whole rounds), so
    // the retained windows hold the same number of trees. The bytes differ only
    // by the digits of the larger counters inside each checkpoint.
    expect(long.entries).toHaveLength(short.entries.length);
    expect(JSON.stringify(long).length).toBeLessThan(JSON.stringify(short).length * 1.01);
  });

  it('a turn longer than `max` is still capped by it', async () => {
    const capped: GameDefinitionLike = { ...shortTurns, gameType: 'short-turns-capped', checkpoints: { max: 2 } };
    // Two actions into a turn: the turn start is three checkpoints back.
    const table = await play(capped, 2);
    expect(moveCountOf(table)).toBe(2);
    const window = table.snapshot.actionCheckpoints!;
    expect(window.entries).toHaveLength(2);
    expect(window.baseIndex).toBe(1);
    // So the undo that needs the turn start is not offered, and is refused.
    const seat = currentSeat(table);
    expect(canUndo(table, seat)).toBe(false);
    const undo = await executeOp(capped, options, table.snapshot, null, { type: 'undo', player: seat });
    expect(undo.success).toBe(false);
  });

  it('a session with full history keeps every checkpoint', async () => {
    const table = await play(shortTurns, 20, { fullHistory: true });
    const window = table.snapshot.actionCheckpoints!;
    expect(window.baseIndex).toBe(0);
    expect(window.entries).toHaveLength(21);
  });

  it('debugging alone does not keep full history: time travel behind the turn is refused with the reason', async () => {
    const debug = { debug: true };
    const table = await play(shortTurns, 20, debug);
    expect(table.snapshot.actionCheckpoints!.baseIndex).toBe(18);
    const at = await executeOp(shortTurns, options, table.snapshot, null, { type: 'debugStateAt', actionIndex: 1, player: 1 }, debug);
    expect(at.success).toBe(false);
    expect(at.success ? '' : at.error).toMatch(/action 1 is older than .*start of the current turn.*fullHistory/);
  });

  it('a debug session with full history reaches the first action', async () => {
    const dev = { debug: true, fullHistory: true };
    const table = await play(shortTurns, 20, dev);
    expect(table.snapshot.actionCheckpoints!.entries).toHaveLength(21);
    succeeded(
      await executeOp(shortTurns, options, table.snapshot, null, { type: 'debugStateAt', actionIndex: 1, player: 1 }, dev),
    );
  });

  it('`max` still caps a full-history session', async () => {
    const capped: GameDefinitionLike = { ...shortTurns, gameType: 'short-turns-capped', checkpoints: { max: 4 } };
    const table = await play(capped, 20, { fullHistory: true });
    expect(table.snapshot.actionCheckpoints!.entries).toHaveLength(4);
  });

  it('a simultaneous step keeps the whole step: seat A undoes, then seat B undoes', async () => {
    // Undo in a simultaneous step restores the start of the asking seat's
    // trailing run, which is never before the step's start. The window keeps
    // from the step's start and drops the turns before it, so each undo in
    // turn finds its checkpoint.
    let table = await startTwoSeats(simultaneous);
    table = await act(simultaneous, table, 'prepare');
    table = await act(simultaneous, table, 'prepare');
    table = await order(table, 2);
    table = await order(table, 1);
    table = await order(table, 1);
    const window = table.snapshot.actionCheckpoints!;
    // The step starts at action 2: the checkpoints at 0 and 1 are gone.
    expect(window.baseIndex).toBe(2);
    expect(window.entries).toHaveLength(4);

    table = await undo(simultaneous, table, 1);
    expect(table.snapshot.actionHistory.map((entry) => entry.player)).toEqual([1, 2, 2]);
    table = await undo(simultaneous, table, 2);
    expect(table.snapshot.actionHistory).toHaveLength(2);
  });

  it("a turnScope: 'continue' run keeps the whole turn across re-entered steps", async () => {
    let table = await startTwoSeats(continuedTurns);
    // Seat 1 ends its turn at once; seat 2 takes three steps, each in a newly
    // entered action step that continues the same turn.
    table = await act(continuedTurns, table, 'end');
    for (let i = 0; i < 3; i++) table = await act(continuedTurns, table, 'step');
    expect(currentSeat(table)).toBe(2);
    const window = table.snapshot.actionCheckpoints!;
    expect(window.baseIndex).toBe(1);
    expect(window.entries).toHaveLength(4);
    expect(canUndo(table, 2)).toBe(true);

    table = await undo(continuedTurns, table, 2);
    expect(table.snapshot.actionHistory).toHaveLength(1);
    expect(currentSeat(table)).toBe(2);
  });
});

describe('#680: the window starts after the last point undo cannot cross', () => {
  /** The refusal `seat` gets when it asks to undo in `table`. */
  async function refusedUndo(def: GameDefinitionLike, table: Table, seat: number): Promise<string> {
    const result = await executeOp(def, options2, table.snapshot, null, { type: 'undo', player: seat });
    expect(result.success).toBe(false);
    return result.success ? '' : result.error;
  }

  async function actAll(def: GameDefinitionLike, table: Table, actions: string[]): Promise<Table> {
    for (const actionName of actions) table = await act(def, table, actionName);
    return table;
  }

  it('a notUndoable action part way through a turn drops the checkpoints before it, and undo is still refused across it', async () => {
    let table = await actAll(commitTurns, await startTwoSeats(commitTurns), ['step', 'step', 'commit', 'step']);
    expect(currentSeat(table)).toBe(1);
    expect(moveCountOf(table)).toBe(4);
    const window = table.snapshot.actionCheckpoints!;
    // The commit is action 2, so no undo restores anything before action 3.
    expect(window.baseIndex).toBe(3);
    expect(window.entries).toHaveLength(2);
    expect(canUndo(table, 1)).toBe(false);
    expect(await refusedUndo(commitTurns, table, 1)).toMatch(/commit is marked notUndoable/);

    // The next turn's undo reaches its own start.
    table = await actAll(commitTurns, table, ['end', 'step', 'step']);
    expect(currentSeat(table)).toBe(2);
    expect(table.snapshot.actionCheckpoints!.baseIndex).toBe(5);
    expect(canUndo(table, 2)).toBe(true);
    table = await undo(commitTurns, table, 2);
    expect(table.snapshot.actionHistory).toHaveLength(5);
    expect(currentSeat(table)).toBe(2);
  });

  it('an irreversible execute part way through a turn drops the checkpoints before it, and undo is still refused across it', async () => {
    let table = await actAll(commitTurns, await startTwoSeats(commitTurns), ['step', 'reveal', 'step']);
    expect(currentSeat(table)).toBe(1);
    expect(moveCountOf(table)).toBe(3);
    const window = table.snapshot.actionCheckpoints!;
    // The irreversible execute ran after action 1, so the window starts at 2.
    expect(window.baseIndex).toBe(2);
    expect(window.entries).toHaveLength(2);
    expect(canUndo(table, 1)).toBe(false);
    expect(await refusedUndo(commitTurns, table, 1)).toMatch(/irreversible/);

    table = await actAll(commitTurns, table, ['end', 'step']);
    expect(currentSeat(table)).toBe(2);
    expect(table.snapshot.actionCheckpoints!.baseIndex).toBe(4);
    table = await undo(commitTurns, table, 2);
    expect(table.snapshot.actionHistory).toHaveLength(4);
    expect(currentSeat(table)).toBe(2);
  });

  it('a simultaneous step drops the checkpoints before a notUndoable action, and the seat after it still undoes to its run', async () => {
    let table = await startTwoSeats(simultaneous);
    table = await act(simultaneous, table, 'prepare');
    table = await act(simultaneous, table, 'prepare');
    table = await order(table, 1);
    table = await order(table, 2, 'commit');
    table = await order(table, 1);
    table = await order(table, 1);
    const window = table.snapshot.actionCheckpoints!;
    // The step starts at action 2 and the commit is action 3.
    expect(window.baseIndex).toBe(4);
    expect(window.entries).toHaveLength(3);

    expect(canUndo(table, 1)).toBe(true);
    table = await undo(simultaneous, table, 1);
    expect(table.snapshot.actionHistory.map((entry) => entry.player)).toEqual([1, 2, 1, 2]);
    expect(canUndo(table, 2)).toBe(false);
    expect(await refusedUndo(simultaneous, table, 2)).toMatch(/commit is marked notUndoable/);
  });

  it('a step made only of notUndoable actions keeps one checkpoint, and every seat is refused', async () => {
    let table = await startTwoSeats(simultaneous);
    table = await act(simultaneous, table, 'prepare');
    table = await act(simultaneous, table, 'prepare');
    for (const seat of [1, 2, 1, 2]) {
      table = await order(table, seat, 'commit');
      const window = table.snapshot.actionCheckpoints!;
      // Every action in the step is a commit, so undo can restore only the present.
      expect(window.baseIndex).toBe(table.snapshot.actionHistory.length);
      expect(window.entries).toHaveLength(1);

      // The seat that acted last is refused by its commit. The other seat is
      // refused because only the last actor's run can be undone in a
      // simultaneous step.
      const other = seat === 1 ? 2 : 1;
      expect(canUndo(table, seat)).toBe(false);
      expect(await refusedUndo(simultaneous, table, seat)).toMatch(/commit is marked notUndoable/);
      expect(canUndo(table, other)).toBe(false);
      expect(await refusedUndo(simultaneous, table, other)).toBe('No actions to undo');
    }
  });

  it('a session with full history still keeps the checkpoints before a notUndoable action', async () => {
    let table = envelope(succeeded(await executeOp(commitTurns, options2, null, null, { type: 'start' }, { fullHistory: true })));
    for (const actionName of ['step', 'commit', 'step']) {
      table = envelope(succeeded(await executeOp(commitTurns, options2, table.snapshot, null, {
        type: 'action',
        actionName,
        player: currentSeat(table),
        args: {},
        boundaryKey: flowBoundaryKey(table.snapshot.flowState as BoundaryKeyState),
      }, { fullHistory: true })));
    }
    expect(table.snapshot.actionCheckpoints!.baseIndex).toBe(0);
    expect(table.snapshot.actionCheckpoints!.entries).toHaveLength(4);
  });
});

describe('#683: the retained window and the undo refusal agree on the floor', () => {
  /**
   * The oldest point in the current step that `assertUndoAllowed` lets an undo
   * restore. Under turn-anchored retention this must be exactly where the
   * window starts: one later and an allowed undo finds no checkpoint, one
   * earlier and the window keeps checkpoints nothing can reach.
   */
  function smallestAllowedTarget(def: GameDefinitionLike, table: Table): number {
    // 'allowed' is what executeOp runs with when the host sets no policy.
    const runner = runnerFromSnapshot(table.snapshot, { ...def, randomness: 'allowed' });
    const length = runner.actionHistory.length;
    for (let target = length - moveCountOf(table); target < length; target++) {
      try {
        assertUndoAllowed({ runner, turnStartActionIndex: target, fenceRandomRewind: false });
        return target;
      } catch (err) {
        if (!(err instanceof UndoRefusedError)) throw err;
      }
    }
    return length;
  }

  /** A small seeded generator, so a failing history can be replayed. */
  function picker(seed: number): (choices: readonly string[]) => string {
    let state = seed;
    return (choices) => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return choices[(state >>> 16) % choices.length];
    };
  }

  it('across generated turns of steps, notUndoable commits and irreversible reveals', async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const pick = picker(seed);
      let table = await startTwoSeats(commitTurns);
      for (let i = 0; i < 12; i++) {
        table = await act(commitTurns, table, pick(['step', 'step', 'commit', 'reveal', 'end']));
        expect(smallestAllowedTarget(commitTurns, table), `seed ${seed}, action ${i}`).toBe(
          table.snapshot.actionCheckpoints!.baseIndex,
        );
      }
    }
  });

  it('across generated simultaneous steps, including steps of only notUndoable actions', async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const pick = picker(seed);
      let table = await startTwoSeats(simultaneous);
      table = await act(simultaneous, table, 'prepare');
      table = await act(simultaneous, table, 'prepare');
      for (let i = 0; i < 10; i++) {
        table = await order(table, Number(pick(['1', '2'])), pick(['order', 'commit']));
        expect(smallestAllowedTarget(simultaneous, table), `seed ${seed}, action ${i}`).toBe(
          table.snapshot.actionCheckpoints!.baseIndex,
        );
      }
    }
  });
});

/**
 * A turn of re-entered steps ended by `end`. `commit` cannot be undone, and
 * `reveal` is followed by an irreversible `execute()`, both part way through
 * the turn.
 */
class CommitTurnGame extends Game<CommitTurnGame, Player> {
  turnEnded = false;
  revealPending = false;

  constructor(gameOptions: GameOptions) {
    super(gameOptions);
    this.registerAction(Action.create('step').execute(() => {}));
    this.registerAction(Action.create('commit').notUndoable().execute(() => {}));
    this.registerAction(
      Action.create('reveal').execute(() => {
        this.revealPending = true;
      }),
    );
    this.registerAction(
      Action.create('end').execute(() => {
        this.turnEnded = true;
      }),
    );
    this.setFlow({
      root: loop({
        while: () => true,
        maxIterations: 100,
        do: eachPlayer({
          do: sequence(
            execute(() => {
              this.turnEnded = false;
            }),
            loop({
              while: () => !this.turnEnded,
              maxIterations: 20,
              do: sequence(
                actionStep({ name: 'act', actions: ['step', 'commit', 'reveal', 'end'], turnScope: 'continue' }),
                ifThen({
                  condition: () => this.revealPending,
                  then: execute(() => {
                    this.revealPending = false;
                  }, { irreversible: true }),
                }),
              ),
            }),
          ),
        }),
      }),
    });
  }
}

const commitTurns: GameDefinitionLike = {
  gameClass: CommitTurnGame,
  gameType: 'commit-turns',
  minPlayers: 2,
  maxPlayers: 2,
};

/** Each seat prepares in turn, then both order in one simultaneous step that never closes. */
class OrdersGame extends Game<OrdersGame, Player> {
  constructor(gameOptions: GameOptions) {
    super(gameOptions);
    this.registerAction(Action.create('prepare').execute(() => {}));
    this.registerAction(Action.create('order').execute(() => {}));
    this.registerAction(Action.create('commit').notUndoable().execute(() => {}));
    this.setFlow({
      root: sequence(
        eachPlayer({ do: actionStep({ actions: ['prepare'] }) }),
        simultaneousActionStep({
          name: 'orders',
          players: () => this.players,
          actions: ['order', 'commit'],
          playerDone: () => false,
          allDone: () => false,
        }),
      ),
    });
  }
}

const simultaneous: GameDefinitionLike = { gameClass: OrdersGame, gameType: 'orders', minPlayers: 2, maxPlayers: 2 };

/** A turn of `step`s ended by `end`, each action in a newly entered step that continues the turn. */
class ContinuedTurnGame extends Game<ContinuedTurnGame, Player> {
  turnEnded = false;

  constructor(gameOptions: GameOptions) {
    super(gameOptions);
    this.registerAction(Action.create('step').execute(() => {}));
    this.registerAction(
      Action.create('end').execute(() => {
        this.turnEnded = true;
      }),
    );
    this.setFlow({
      root: loop({
        while: () => true,
        maxIterations: 100,
        do: eachPlayer({
          do: sequence(
            execute(() => {
              this.turnEnded = false;
            }),
            loop({
              while: () => !this.turnEnded,
              maxIterations: 20,
              do: actionStep({ name: 'act', actions: ['step', 'end'], turnScope: 'continue' }),
            }),
          ),
        }),
      }),
    });
  }
}

const continuedTurns: GameDefinitionLike = {
  gameClass: ContinuedTurnGame,
  gameType: 'continued-turns',
  minPlayers: 2,
  maxPlayers: 2,
};

const options2 = { playerCount: 2, seed: 'turn-anchored' };

async function startTwoSeats(def: GameDefinitionLike): Promise<Table> {
  return envelope(succeeded(await executeOp(def, options2, null, null, { type: 'start' })));
}

function envelope(result: { snapshot: GameStateSnapshot; playerViews: unknown[] }): Table {
  return { snapshot: result.snapshot, views: result.playerViews };
}

async function act(def: GameDefinitionLike, table: Table, actionName: string): Promise<Table> {
  return envelope(succeeded(await executeOp(def, options2, table.snapshot, null, {
    type: 'action',
    actionName,
    player: currentSeat(table),
    args: {},
    boundaryKey: flowBoundaryKey(table.snapshot.flowState as BoundaryKeyState),
  })));
}

async function order(table: Table, seat: number, actionName = 'order'): Promise<Table> {
  return envelope(succeeded(await executeOp(simultaneous, options2, table.snapshot, null, {
    type: 'action',
    actionName,
    player: seat,
    args: {},
    boundaryKey: flowBoundaryKey(table.snapshot.flowState as BoundaryKeyState),
  })));
}

async function undo(def: GameDefinitionLike, table: Table, seat: number): Promise<Table> {
  return envelope(succeeded(await executeOp(def, options2, table.snapshot, null, { type: 'undo', player: seat })));
}
