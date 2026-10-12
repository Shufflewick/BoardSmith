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
  flowBoundaryKey,
  loop,
  type BoundaryKeyState,
  type GameOptions,
} from '../engine/index.js';
import type { GameStateSnapshot } from '../runtime/index.js';
import { executeOp, type ExecuteOpHostOptions, type GameDefinitionLike } from './stateless-ops.js';
import type { PlayerGameState } from './types.js';
import { succeeded } from './op-result.test-helper.js';

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

  it('a debug session keeps every checkpoint, so time travel reaches the first action', async () => {
    const debug = { debug: true };
    const table = await play(shortTurns, 20, debug);
    expect(table.snapshot.actionCheckpoints!.entries).toHaveLength(21);
    const at = succeeded(
      await executeOp(shortTurns, options, table.snapshot, null, { type: 'debugStateAt', actionIndex: 1, player: 1 }, debug),
    );
    expect(at.success).toBe(true);
  });

  it('`max` still caps a full-history session', async () => {
    const capped: GameDefinitionLike = { ...shortTurns, gameType: 'short-turns-capped', checkpoints: { max: 4 } };
    const table = await play(capped, 20, { fullHistory: true });
    expect(table.snapshot.actionCheckpoints!.entries).toHaveLength(4);
  });
});
