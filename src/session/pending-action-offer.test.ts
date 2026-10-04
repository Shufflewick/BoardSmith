/**
 * A multi-step action completes only when the flow offers it to that seat
 * (#492 review).
 *
 * A multi-step action is collected one selection at a time and executed when
 * the last one arrives. That completion path used to run the action first and
 * ask the flow afterwards, so:
 *
 * - a seat whose pending action was still open when ANOTHER seat finished the
 *   game could still complete it: the action body ran on the finished game,
 *   was saved to actionHistory, and then the flow threw "Flow is not awaiting
 *   input" as a raw error;
 * - a seat whose turn it was not could complete one, and the flow counted it
 *   as the CURRENT seat's move.
 *
 * Each case is driven through all three completion paths: the session-free
 * GameRunner, a GameSession, and the stateless `selectionStep` op.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  simultaneousActionStep,
  type FlowNode,
  type GameOptions,
} from '../engine/index.js';
import { GameRunner } from '../runtime/runner.js';
import { GameSession } from './game-session.js';
import { executeOp, type GameDefinitionLike, type OpResult } from './stateless-ops.js';
import { boundaryKeyOf } from './testing/boundary-stamp.js';

class BuildGame extends Game<BuildGame, Player> {
  /** Every build that actually ran, so a test can see a refused one did not. */
  built: number[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      // Two selections, so it is collected as a pending action.
      Action.create<BuildGame>('build')
        .prompt('Build')
        .chooseFrom('where', { choices: ['north', 'south'] })
        .chooseFrom('what', { choices: ['farm', 'mill'] })
        .execute((_a, ctx) => {
          (ctx.game as BuildGame).built.push(ctx.player.seat);
        }),
      Action.create<BuildGame>('win').prompt('Win').execute((_a, ctx) => {
        ctx.game.finish([ctx.player]);
      }),
    );
  }
}

const ACTIONS = ['build', 'win'];

const shapes: Record<string, () => FlowNode<BuildGame>> = {
  simultaneous: () => loop({ maxIterations: 10, do: simultaneousActionStep({ actions: ACTIONS }) }),
  eachPlayer: () => loop({
    maxIterations: 10,
    do: eachPlayer({ do: actionStep({ actions: ACTIONS, turnScope: 'restart' }) }),
  }),
};

class SimultaneousBuildGame extends BuildGame {
  constructor(options: GameOptions) {
    super(options);
    this.setFlow(defineFlow({ root: shapes.simultaneous() }));
  }
}

class TurnBuildGame extends BuildGame {
  constructor(options: GameOptions) {
    super(options);
    this.setFlow(defineFlow({ root: shapes.eachPlayer() }));
  }
}

const gameOptions = { playerCount: 3, seed: 'pending-offer' };

function runner(GameClass: typeof BuildGame): GameRunner<BuildGame> {
  const r = new GameRunner({ GameClass, gameType: 'build', gameOptions });
  r.start();
  return r;
}

function session(GameClass: typeof BuildGame): GameSession<BuildGame> {
  return GameSession.create({
    gameType: 'build',
    GameClass,
    playerCount: 3,
    playerNames: ['A', 'B', 'C'],
    seed: 'pending-offer',
  });
}

function def(GameClass: typeof BuildGame): GameDefinitionLike {
  return { gameClass: GameClass, gameType: 'build', minPlayers: 2, maxPlayers: 3 };
}

describe('GameRunner', () => {
  it('refuses to complete a pending action once another seat has finished the game', () => {
    const r = runner(SimultaneousBuildGame);
    r.startPendingAction('build', 2);
    expect(r.processSelectionStep(2, 'where', 'north').success).toBe(true);

    expect(r.performAction('win', 1, {}).success).toBe(true);
    const historyAtEnd = r.actionHistory.length;

    const step = r.processSelectionStep(2, 'what', 'farm');

    expect(step.success).toBe(false);
    expect(step.error).toBe('The game is finished.');
    expect(r.game.built).toEqual([]);
    expect(r.actionHistory.length).toBe(historyAtEnd);
    expect(r.isComplete()).toBe(true);
  });

  it('refuses a pending action from a seat whose turn it is not, before it runs', () => {
    const r = runner(TurnBuildGame);
    r.startPendingAction('build', 3);

    const step = r.processSelectionStep(3, 'where', 'north');

    expect(step.success).toBe(false);
    expect(step.error).toBe("It's not your turn.");
    expect(r.game.built).toEqual([]);
    expect(r.actionHistory).toEqual([]);
    // Seat 1 is still up, with its move uncounted.
    expect(r.getFlowState()?.currentPlayer).toBe(1);
    expect(r.getFlowState()?.moveCount ?? 0).toBe(0);
  });

  it('still completes a pending action the flow offers', () => {
    const r = runner(TurnBuildGame);
    r.startPendingAction('build', 1);
    r.processSelectionStep(1, 'where', 'north');
    const step = r.processSelectionStep(1, 'what', 'farm');

    expect(step).toMatchObject({ success: true, actionComplete: true });
    expect(r.game.built).toEqual([1]);
    expect(r.getFlowState()?.currentPlayer).toBe(2);
  });
});

describe('GameSession', () => {
  it('refuses to complete a pending action once another seat has finished the game', async () => {
    const s = session(SimultaneousBuildGame);
    expect((await s.processSelectionStep(2, 'where', 'north', 'build')).success).toBe(true);

    expect((await s.performAction('win', 1, {})).success).toBe(true);
    const historyAtEnd = s.runner.actionHistory.length;

    const step = await s.processSelectionStep(2, 'what', 'farm');

    expect(step.success).toBe(false);
    expect(step.error).toBe('The game is finished.');
    expect(s.runner.game.built).toEqual([]);
    expect(s.runner.actionHistory.length).toBe(historyAtEnd);
  });

  it('refuses a pending action from a seat whose turn it is not', async () => {
    const s = session(TurnBuildGame);

    const step = await s.processSelectionStep(3, 'where', 'north', 'build');

    expect(step.success).toBe(false);
    expect(step.error).toBe("It's not your turn.");
    expect(s.runner.game.built).toEqual([]);
    expect(s.runner.getFlowState()?.currentPlayer).toBe(1);
  });
});

describe('stateless selectionStep op', () => {
  async function start(GameClass: typeof BuildGame): Promise<OpResult> {
    return executeOp(def(GameClass), gameOptions, null, {}, { type: 'start' });
  }

  it('refuses to complete a pending action once another seat has finished the game', async () => {
    const gameDef = def(SimultaneousBuildGame);
    const started = await start(SimultaneousBuildGame);
    const step1 = await executeOp(gameDef, gameOptions, started.snapshot, null, {
      type: 'selectionStep', player: 2, selectionName: 'where', value: 'north', actionName: 'build',
      boundaryKey: boundaryKeyOf(started.snapshot),
    });
    expect(step1.success).toBe(true);

    const won = await executeOp(gameDef, gameOptions, step1.snapshot, null, {
      type: 'action', actionName: 'win', player: 1, args: {}, boundaryKey: boundaryKeyOf(step1.snapshot),
    });
    expect(won.isComplete).toBe(true);

    const step2 = await executeOp(gameDef, gameOptions, won.snapshot, step1.pendingState, {
      type: 'selectionStep', player: 2, selectionName: 'what', value: 'farm', actionName: 'build',
      initialArgs: { where: 'north' }, boundaryKey: boundaryKeyOf(won.snapshot),
    });

    expect(step2.success).toBe(false);
    expect(step2.error).toBe('The game is finished.');
  });

  it('refuses a pending action from a seat whose turn it is not', async () => {
    const gameDef = def(TurnBuildGame);
    const started = await start(TurnBuildGame);

    const step = await executeOp(gameDef, gameOptions, started.snapshot, null, {
      type: 'selectionStep', player: 3, selectionName: 'where', value: 'north', actionName: 'build',
      boundaryKey: boundaryKeyOf(started.snapshot),
    });

    expect(step.success).toBe(false);
    expect(step.error).toBe("It's not your turn.");
    expect(step.errorCode).toBe('NOT_YOUR_TURN');
  });
});
