import { describe, it, expect } from 'vitest';
import {
  Action,
  Game,
  Piece,
  Player,
  Space,
  actionStep,
  eachPlayer,
  execute,
  loop,
  sequence,
  simultaneousActionStep,
  type GameOptions,
} from '../engine/index.js';
import { availableActionsForSeat } from '../engine/flow/seat-activity.js';
import { GameRunner, type RunnerCheckpointPolicy } from './runner.js';
import { decideUndo } from '../session/utils.js';

// #997: a game may keep only the action history undo reads, so a step of
// repeatable not-undoable moves (WindupWarfare's deployment) has a finite
// saved size however many moves are made.

class Track extends Space<PackGame, Seat> {}
class Pack extends Piece<PackGame, Seat> {}

class Seat extends Player<PackGame, Seat> {
  checkedIn = false;
  nudges = 0;
}

class PackGame extends Game<PackGame, Seat> {
  static PlayerClass = Seat;
  left!: Track;
  right!: Track;
  turnPassed = false;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Track, Pack]);
    this.left = this.create(Track, 'left');
    this.right = this.create(Track, 'right');
    for (const player of this.players) this.left.create(Pack, `pack-${player.seat}`).player = player;

    this.registerActions(
      // The repeatable command: move your pack to the other track, any number of times.
      Action.create<PackGame>('move').notUndoable().execute((_args, ctx) => {
        const pack = ctx.game.all(Pack).find((p) => p.player === ctx.player)!;
        pack.putInto(pack.parent === ctx.game.left ? ctx.game.right : ctx.game.left);
        return { success: true };
      }),
      Action.create<PackGame>('nudge').execute((_args, ctx) => {
        ctx.player.nudges += 1;
        return { success: true };
      }),
      Action.create<PackGame>('checkIn').notUndoable().execute((_args, ctx) => {
        ctx.player.checkedIn = true;
        return { success: true };
      }),
      Action.create<PackGame>('pass').execute((_args, ctx) => {
        ctx.game.turnPassed = true;
        return { success: true };
      }),
    );

    this.setFlow({
      root: loop({
        name: 'rounds',
        unbounded: true,
        do: sequence(
          simultaneousActionStep({
            name: 'deployment',
            actions: ['move', 'nudge', 'checkIn'],
            playerDone: (_ctx, player) => player.checkedIn,
          }),
          execute((ctx) => {
            for (const player of ctx.game.players) player.checkedIn = false;
          }),
          eachPlayer({
            name: 'turns',
            do: sequence(
              execute((ctx) => {
                ctx.game.turnPassed = false;
              }),
              actionStep({
                name: 'turn',
                actions: ['move', 'nudge', 'pass'],
                repeatUntil: (ctx) => ctx.game.turnPassed,
              }),
              // An irreversible step inside the turn fences undo with no not-undoable entry to name.
              execute((ctx) => {
                ctx.game.turnPassed = false;
              }, { irreversible: true }),
              actionStep({
                name: 'turn-after-commit',
                actions: ['move', 'nudge', 'pass'],
                repeatUntil: (ctx) => ctx.game.turnPassed,
                turnScope: 'continue',
              }),
            ),
          }),
        ),
      }),
    });
  }
}

const UNDO_HISTORY: RunnerCheckpointPolicy = { actionHistory: 'undo' };

function runner(checkpoints: RunnerCheckpointPolicy): GameRunner<PackGame> {
  const r = new GameRunner({
    GameClass: PackGame,
    gameType: 'pack-game',
    gameOptions: { playerCount: 2, seed: 'bounded-history' },
    checkpoints,
  });
  r.start();
  return r;
}

/** Both seats move their packs in turn, `moves` times in all, in the open deployment step. */
function deploy(r: GameRunner<PackGame>, moves: number): void {
  for (let i = 0; i < moves; i++) {
    expect(r.performAction('move', (i % 2) + 1, {}).success).toBe(true);
    r.getSnapshot();
  }
}

/** Where each pack stands and what each seat has done: element ids differ between two games, so compare these. */
function board(r: GameRunner<PackGame>) {
  return {
    right: r.game.right.all(Pack).map((p) => p.name),
    seats: r.game.players.map((p) => [p.nudges, p.checkedIn]),
    flow: r.getFlowState(),
  };
}

/** A small deterministic generator, so a failing run can be reproduced. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** A seat that may act, and one of its actions: mostly moves, as in the game the ticket describes. */
function randomMove(r: GameRunner<PackGame>, next: () => number): { seat: number; action: string } {
  const flowState = r.getFlowState();
  const seats = [1, 2].filter((seat) => availableActionsForSeat(flowState, seat).length > 0);
  const seat = seats[Math.floor(next() * seats.length)];
  const offered = availableActionsForSeat(flowState, seat);
  const roll = next();
  if (roll < 0.6 && offered.includes('move')) return { seat, action: 'move' };
  if (roll < 0.9 && offered.includes('nudge')) return { seat, action: 'nudge' };
  // Check-in and pass end the step or the turn.
  return { seat, action: offered.find((name) => name === 'checkIn' || name === 'pass')! };
}

/** The same undo decision, refusal wording included. */
function expectSameUndo(got: ReturnType<typeof decideUndo>, want: ReturnType<typeof decideUndo>): void {
  expect(got).toEqual(want);
}

describe('actionHistory: "undo" keeps only the history undo reads (#997)', () => {
  it('holds the history and the saved bytes flat while seats move without limit', () => {
    const r = runner(UNDO_HISTORY);
    deploy(r, 200);
    const short = JSON.stringify(r.getSnapshot()).length;
    deploy(r, 700);

    const snapshot = r.getSnapshot();
    expect(snapshot.actionHistory).toHaveLength(1);
    expect(snapshot.actionHistoryBase).toBe(899);
    expect(r.actionCount).toBe(900);
    expect(JSON.stringify(snapshot).length).toBe(short);

    // Falsification: the default keeps every entry.
    const all = runner({});
    deploy(all, 900);
    expect(all.getSnapshot().actionHistory).toHaveLength(900);
  });

  it('restores the latest state exactly, and the restored game plays on', () => {
    const live = runner(UNDO_HISTORY);
    deploy(live, 301);
    const snapshot = live.getSnapshot();

    const restored = GameRunner.fromSnapshot(snapshot, PackGame, { checkpoints: UNDO_HISTORY });
    const again = restored.getSnapshot();
    for (const field of ['state', 'actionHistory', 'actionHistoryBase', 'randomState', 'sequence', 'messageLog', 'executeBarrierIndex'] as const) {
      expect(again[field]).toEqual(snapshot[field]);
    }
    expect(restored.game.right.all(Pack).map((p) => p.name)).toEqual(['pack-1']);

    expect(restored.performAction('move', 2, {}).success).toBe(true);
    expect(restored.actionCount).toBe(302);
    expect(restored.getSnapshot().actionHistory).toHaveLength(1);
  });

  it('keeps the undo a seat can still take, and refuses one a not-undoable move fences, naming it', () => {
    const r = runner(UNDO_HISTORY);
    deploy(r, 51);
    // Seat 1's trailing run is its last move and this nudge: the move fences it.
    expect(r.performAction('nudge', 1, {}).success).toBe(true);
    r.getSnapshot();
    const fenced = decideUndo(r, 1);
    expect(fenced).toMatchObject({ allowed: false, error: 'Cannot undo: move is marked notUndoable.' });

    // Seat 2's own trailing run is one nudge after the last move: undo takes back just that.
    expect(r.performAction('nudge', 2, {}).success).toBe(true);
    const snapshot = r.getSnapshot();
    const allowed = decideUndo(r, 2);
    expect(allowed).toMatchObject({ allowed: true, turnStartActionIndex: 52 });
    const undone = GameRunner.fromCheckpoint(snapshot, 52, PackGame, { checkpoints: UNDO_HISTORY })!;
    expect(undone.game.getPlayer(2)!.nudges).toBe(0);
    expect(undone.game.getPlayer(1)!.nudges).toBe(1);
    expect(undone.actionCount).toBe(52);
    expect(undone.actionHistory.at(-1)).toMatchObject({ name: 'nudge', player: 1 });
  });

  it('decides every undo exactly as the full history does, over a long random game', () => {
    const next = lcg(997);
    let full = runner({});
    let trimmed = runner(UNDO_HISTORY);
    let undos = 0;
    let longestKept = 0;
    for (let step = 0; step < 1200; step++) {
      const { seat, action } = randomMove(full, next);
      expect(full.performAction(action, seat, {}).success).toBe(true);
      expect(trimmed.performAction(action, seat, {}).success).toBe(true);
      const fullSnapshot = full.getSnapshot();
      const trimmedSnapshot = trimmed.getSnapshot();

      longestKept = Math.max(longestKept, trimmedSnapshot.actionHistory.length);
      expect(trimmed.actionCount).toBe(full.actionCount);
      expect(trimmed.actionHistory).toEqual(full.actionHistory.slice(trimmed.actionHistoryBase));
      for (const asker of [1, 2]) expectSameUndo(decideUndo(trimmed, asker), decideUndo(full, asker));

      // Take an allowed undo now and then, in both games alike.
      const undo = decideUndo(full, seat);
      if (undo.allowed && next() < 0.5) {
        full = GameRunner.fromCheckpoint(fullSnapshot, undo.turnStartActionIndex, PackGame)!;
        trimmed = GameRunner.fromCheckpoint(trimmedSnapshot, undo.turnStartActionIndex, PackGame, { checkpoints: UNDO_HISTORY })!;
        expect(board(trimmed)).toEqual(board(full));
        undos += 1;
      }
    }
    expect(longestKept).toBeLessThan(20);
    expect(undos).toBeGreaterThan(10);
    expect(trimmed.actionHistoryBase).toBeGreaterThan(400);
  });

  it('keeps every entry under full history, which boardsmith dev uses', () => {
    const r = runner({ ...UNDO_HISTORY, history: 'full' });
    deploy(r, 40);
    const snapshot = r.getSnapshot();
    expect(snapshot.actionHistory).toHaveLength(40);
    expect(snapshot.actionHistoryBase).toBeUndefined();
  });

  it('replays a whole history, and refuses one that does not start at action 0, naming the policy', () => {
    const options = { GameClass: PackGame, gameType: 'pack-game', gameOptions: { playerCount: 2, seed: 'bounded-history' } };
    const all = runner({});
    deploy(all, 9);
    expect(board(GameRunner.replay(options, all.getSnapshot()))).toEqual(board(all));

    const kept = runner(UNDO_HISTORY);
    deploy(kept, 9);
    expect(() => GameRunner.replay(options, kept.getSnapshot())).toThrow(
      'Cannot replay this game: its history starts at action 8, because the game keeps only the history undo needs ' +
      "(checkpoints: { actionHistory: 'undo' }). Replay needs every action from the start.",
    );
  });
});
