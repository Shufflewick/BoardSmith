import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  actionStep,
  loop,
  dueSeats,
  canSeatAct,
  availableActionsForSeat,
  type GameOptions,
  type FlowState,
} from '../engine/index.js';
import { isPlayersTurn } from './utils.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';

// ---------------------------------------------------------------------------
// These tests pin the canonical "who can act now?" predicates that collapse
// FlowState's two representations (awaitingPlayers[] for simultaneous steps,
// currentPlayer for sequential steps). Before centralization each consumer
// re-derived this branch by hand and they drifted; here we assert the single
// source of truth handles both modes and that the boolean predicates
// (isPlayersTurn / Game.canPlayerAct) agree with it.
// ---------------------------------------------------------------------------

function sequentialState(currentPlayer: number, actions: string[]): FlowState {
  return {
    position: {} as FlowState['position'],
    complete: false,
    awaitingInput: true,
    currentPlayer,
    availableActions: actions,
  };
}

function simultaneousState(
  players: Array<{ playerIndex: number; availableActions: string[]; completed: boolean }>,
): FlowState {
  return {
    position: {} as FlowState['position'],
    complete: false,
    awaitingInput: true,
    awaitingPlayers: players,
  };
}

describe('canonical seat-activity predicates', () => {
  it('reports the sequential current player as the only due seat', () => {
    const fs = sequentialState(2, ['move']);
    expect(dueSeats(fs)).toEqual([2]);
    expect(canSeatAct(fs, 2)).toBe(true);
    expect(canSeatAct(fs, 1)).toBe(false);
    expect(availableActionsForSeat(fs, 2)).toEqual(['move']);
    expect(availableActionsForSeat(fs, 1)).toEqual([]);
  });

  it('reports every incomplete awaiting seat in simultaneous steps', () => {
    const fs = simultaneousState([
      { playerIndex: 1, availableActions: ['play'], completed: false },
      { playerIndex: 2, availableActions: ['play'], completed: true },
      { playerIndex: 3, availableActions: ['play'], completed: false },
    ]);
    expect(dueSeats(fs)).toEqual([1, 3]);
    expect(canSeatAct(fs, 1)).toBe(true);
    expect(canSeatAct(fs, 2)).toBe(false); // completed
    expect(canSeatAct(fs, 3)).toBe(true);
    expect(availableActionsForSeat(fs, 1)).toEqual(['play']);
    expect(availableActionsForSeat(fs, 2)).toEqual([]); // completed -> no actions
  });

  it('reports no due seats when not awaiting input', () => {
    const fs: FlowState = {
      position: {} as FlowState['position'],
      complete: false,
      awaitingInput: false,
      currentPlayer: 1,
      availableActions: ['move'],
    };
    expect(dueSeats(fs)).toEqual([]);
    expect(canSeatAct(fs, 1)).toBe(false);
    expect(availableActionsForSeat(fs, 1)).toEqual([]);
  });

  it('treats undefined/null flow state as nobody can act', () => {
    expect(dueSeats(undefined)).toEqual([]);
    expect(canSeatAct(undefined, 1)).toBe(false);
    expect(availableActionsForSeat(null, 1)).toEqual([]);
  });

  it('isPlayersTurn delegates to the canonical predicate in both modes', () => {
    const seq = sequentialState(2, ['move']);
    expect(isPlayersTurn(seq, 2)).toBe(canSeatAct(seq, 2));
    expect(isPlayersTurn(seq, 1)).toBe(canSeatAct(seq, 1));

    const sim = simultaneousState([
      { playerIndex: 1, availableActions: ['play'], completed: false },
      { playerIndex: 2, availableActions: ['play'], completed: true },
    ]);
    expect(isPlayersTurn(sim, 1)).toBe(canSeatAct(sim, 1));
    expect(isPlayersTurn(sim, 2)).toBe(canSeatAct(sim, 2));
  });
});

// ---------------------------------------------------------------------------
// Consumer regression: debug action traces must report a seat that cannot act
// as having NO flow-allowed actions. Before centralization the sequential
// branch leaked the *current* player's available actions to every other seat,
// so seat 2 (not its turn) incorrectly reported the current player's actions.
// ---------------------------------------------------------------------------

class PassGame extends Game<PassGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 1000,
          do: actionStep({ actions: ['pass'], player: (ctx) => ctx.game.getPlayer(1)! }),
        }),
      }),
    );
  }
}

const passDef: GameDefinitionLike = {
  gameClass: PassGame as new (...args: unknown[]) => unknown,
  gameType: 'pass',
  minPlayers: 1,
  maxPlayers: 4,
};
const passOptions = { playerCount: 2, seed: 'seat-activity-seed' };

describe('debug action traces use the canonical predicate', () => {
  it('reports no flow-allowed actions for a seat that is not its turn', async () => {
    const start = await executeOp(passDef, passOptions, null, null, { type: 'start' });

    // Seat 1 is the current (sequential) player.
    const seat1 = await executeOp(passDef, passOptions, start.snapshot, null, {
      type: 'debugActionTraces',
      player: 1,
    });
    const flow1 = seat1.flowContext as { isMyTurn: boolean; flowAllowedActions: string[] };
    expect(flow1.isMyTurn).toBe(true);
    expect(flow1.flowAllowedActions).toEqual(['pass']);

    // Seat 2 cannot act -> it must NOT inherit seat 1's allowed actions.
    const seat2 = await executeOp(passDef, passOptions, start.snapshot, null, {
      type: 'debugActionTraces',
      player: 2,
    });
    const flow2 = seat2.flowContext as { isMyTurn: boolean; flowAllowedActions: string[] };
    expect(flow2.isMyTurn).toBe(false);
    expect(flow2.flowAllowedActions).toEqual([]);
  });
});
