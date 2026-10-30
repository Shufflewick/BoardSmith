import { describe, it, expect } from 'vitest';
import { Action, Game, Player, sequence, simultaneousActionStep, actionStep, type GameOptions } from '../engine/index.js';
import { snapshotTree } from '../engine/utils/index.js';
import { GameRunner, type RunnerCheckpointPolicy } from './runner.js';
import { decideUndo } from '../session/utils.js';

// #1526: a simultaneous step declared `seatUndo: true`, at the runner. Every
// action changes only its seat's own player, and `place` chains to `confirm`,
// a follow-up the seat holds until it takes it or does something else.

class Seat extends Player<PlanGame, Seat> {
  placed = 0;
  confirmed = 0;
}

class PlanGame extends Game<PlanGame, Seat> {
  static PlayerClass = Seat;

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<PlanGame>('place').execute((_args, ctx) => {
        ctx.player.placed += 1;
        return { success: true, followUp: { action: 'confirm' } };
      }),
      Action.create<PlanGame>('confirm').execute((_args, ctx) => {
        ctx.player.confirmed += 1;
        return { success: true };
      }),
      Action.create<PlanGame>('pass').execute(() => ({ success: true })),
    );
    this.setFlow({
      root: sequence(
        simultaneousActionStep({ name: 'plan', actions: ['place'], seatUndo: true }),
        actionStep({ name: 'after', actions: ['pass'], player: (ctx) => ctx.game.getPlayer(1)! }),
      ),
    });
  }
}

function runner(checkpoints?: RunnerCheckpointPolicy): GameRunner<PlanGame> {
  const r = new GameRunner({ GameClass: PlanGame, gameType: 'plan-game', gameOptions: { playerCount: 2, seed: 'seat-undo', elementIdKey: '0000000000001526' }, checkpoints });
  r.start();
  return r;
}

function act(r: GameRunner<PlanGame>, seat: number, action: string): void {
  const result = r.performAction(action, seat, {});
  expect(result.success, result.error).toBe(true);
}

const seat = (r: GameRunner<PlanGame>, n: number) => r.game.getPlayer(n)!;
const heldFollowUp = (r: GameRunner<PlanGame>, n: number) => r.getFlowState()?.followUps?.find((f) => f.seat === n)?.action;

describe('GameRunner per-seat undo (#1526)', () => {
  it("puts back the follow-up the seat held before the action it takes back", () => {
    const r = runner();
    act(r, 1, 'place');
    act(r, 1, 'confirm');
    expect(heldFollowUp(r, 1)).toBeUndefined();
    r.undoSeatAction(1);
    expect(seat(r, 1).confirmed).toBe(0);
    expect(heldFollowUp(r, 1)).toBe('confirm');
    r.undoSeatAction(1);
    expect(seat(r, 1).placed).toBe(0);
    expect(heldFollowUp(r, 1)).toBeUndefined();
  });

  it('records the undo in the history, and a replay of that history reaches the same game', () => {
    const r = runner();
    act(r, 1, 'place');
    act(r, 2, 'place');
    r.undoSeatAction(1);
    act(r, 1, 'place');
    act(r, 1, 'confirm');
    expect(r.actionHistory.map((e) => ('name' in e ? e.name : e.kind))).toEqual(['place', 'place', 'seatUndo', 'place', 'confirm']);

    const replayed = GameRunner.replay(
      { GameClass: PlanGame, gameType: 'plan-game', gameOptions: { playerCount: 2, seed: 'seat-undo', elementIdKey: '0000000000001526' } },
      r.getSnapshot(),
    );
    expect(snapshotTree(replayed.getSnapshot())).toEqual(snapshotTree(r.getSnapshot()));
  });

  it('carries each seat\'s undo across a snapshot, and drops it once the step is over', () => {
    let r = runner();
    act(r, 1, 'place');
    act(r, 2, 'place');
    r = GameRunner.fromSnapshot(JSON.parse(JSON.stringify(r.getSnapshot())), PlanGame);
    expect(decideUndo(r, 1).allowed).toBe(true);
    r.undoSeatAction(1);
    expect(seat(r, 1).placed).toBe(0);
    expect(seat(r, 2).placed).toBe(1);
  });

  it('keeps no checkpoint behind the head while the step is open, however many actions it takes', () => {
    const r = runner();
    for (let i = 0; i < 6; i++) act(r, (i % 2) + 1, i % 4 < 2 ? 'place' : 'confirm');
    expect(r.getSnapshot().actionCheckpoints?.entries).toHaveLength(1);
  });

  it("stops a seat's undo at the time its host closed its part of the step", () => {
    const r = runner();
    act(r, 1, 'place');
    act(r, 2, 'place');
    expect(r.closeExpiredHeldSeat(1, 'pass')).toBeDefined();
    expect(decideUndo(r, 1)).toMatchObject({ allowed: false, error: expect.stringContaining("seat 1's time ran out") });
    expect(decideUndo(r, 2).allowed).toBe(true);
  });

  it('keeps at most checkpoints.max undo steps for a seat, and says so', () => {
    const r = runner({ max: 2 });
    act(r, 1, 'place');
    act(r, 1, 'confirm');
    act(r, 1, 'place');
    r.undoSeatAction(1);
    r.undoSeatAction(1);
    expect(seat(r, 1).placed).toBe(1);
    expect(decideUndo(r, 1)).toMatchObject({ allowed: false, error: expect.stringContaining('at most 2 undo steps') });
  });

  it('offers no undo in a game that turns checkpoints off', () => {
    const r = runner({ enabled: false });
    act(r, 1, 'place');
    expect(decideUndo(r, 1)).toMatchObject({ allowed: false, error: expect.stringContaining('Cannot undo') });
    expect(r.getSnapshot().seatUndo).toBeUndefined();
  });
});
