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
 * GameRunner, the live session host (`SnapshotSessionHost`, which holds each
 * seat's pending state between ops; it replaced the stateful GameSession,
 * #529), and the stateless `selectionStep` op.
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
  type GameClass,
} from '../engine/index.js';
import { GameRunner } from '../runtime/runner.js';
import { createHeadlessSession } from './headless-session.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import { boundaryKeyOf } from './testing/boundary-stamp.js';
import { historyLabels } from './testing/history-labels.js';
import { succeeded } from './op-result.test-helper.js';

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

function def<G extends Game>(GameClass: GameClass<G>) {
  return { gameClass: GameClass, gameType: 'build', minPlayers: 2, maxPlayers: 3 } satisfies GameDefinitionLike;
}

/** A started live-host table of `GameClass`, with the moves these cases make. */
async function session<G extends Game>(GameClass: GameClass<G>) {
  const table = createHeadlessSession<G>(def(GameClass), {
    playerCount: 3,
    playerNames: ['A', 'B', 'C'],
    seed: 'pending-offer',
  });
  await table.start();
  return {
    table,
    act: (actionName: string, player: number) => table.send(player, { type: 'action', actionName, player, args: {} }),
    pick: (player: number, selectionName: string, value: string, actionName?: string) =>
      table.send(player, { type: 'selectionStep', player, selectionName, value, actionName }),
    async historyLength() {
      return succeeded(await table.send(1, { type: 'debugHistory' })).actionHistory.length;
    },
  };
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

describe('live session host', () => {
  it('refuses to complete a pending action once another seat has finished the game', async () => {
    const s = await session(SimultaneousBuildGame);
    expect((await s.pick(2, 'where', 'north', 'build')).success).toBe(true);

    expect((await s.act('win', 1)).success).toBe(true);
    const historyAtEnd = await s.historyLength();

    const step = await s.pick(2, 'what', 'farm');

    expect(step.success).toBe(false);
    expect(step.error).toBe('The game is finished.');
    expect(s.table.readGame().built).toEqual([]);
    expect(await s.historyLength()).toBe(historyAtEnd);
  });

  it('refuses a pending action from a seat whose turn it is not', async () => {
    const s = await session(TurnBuildGame);

    const step = await s.pick(3, 'where', 'north', 'build');

    expect(step.success).toBe(false);
    expect(step.error).toBe("It's not your turn.");
    expect(s.table.readGame().built).toEqual([]);
    expect(s.table.host.flowState?.currentPlayer).toBe(1);
  });
});

describe('stateless selectionStep op', () => {
  async function start(GameClass: typeof BuildGame) {
    return executeOp(def(GameClass), gameOptions, null, {}, { type: 'start' });
  }

  it('refuses to complete a pending action once another seat has finished the game', async () => {
    const gameDef = def(SimultaneousBuildGame);
    const started = succeeded(await start(SimultaneousBuildGame));
    const step1 = succeeded(await executeOp(gameDef, gameOptions, started.snapshot, null, {
      type: 'selectionStep', player: 2, selectionName: 'where', value: 'north', actionName: 'build',
      boundaryKey: boundaryKeyOf(started.snapshot),
    }));
    expect(step1.success).toBe(true);

    const won = succeeded(await executeOp(gameDef, gameOptions, step1.snapshot, null, {
      type: 'action', actionName: 'win', player: 1, args: {}, boundaryKey: boundaryKeyOf(step1.snapshot),
    }));
    expect(won.snapshot.flowState?.complete).toBe(true);

    const step2 = await executeOp(gameDef, gameOptions, won.snapshot, step1.pendingState, {
      type: 'selectionStep', player: 2, selectionName: 'what', value: 'farm', actionName: 'build',
      initialArgs: { where: 'north' }, boundaryKey: boundaryKeyOf(won.snapshot),
    });

    expect(step2.success).toBe(false);
    expect(step2.error).toBe('The game is finished.');
  });

  it('refuses a pending action from a seat whose turn it is not', async () => {
    const gameDef = def(TurnBuildGame);
    const started = succeeded(await start(TurnBuildGame));

    const step = await executeOp(gameDef, gameOptions, started.snapshot, null, {
      type: 'selectionStep', player: 3, selectionName: 'where', value: 'north', actionName: 'build',
      boundaryKey: boundaryKeyOf(started.snapshot),
    });

    expect(step.success).toBe(false);
    expect(step.error).toBe("It's not your turn.");
    expect(step.errorCode).toBe('NOT_YOUR_TURN');
  });
});

/**
 * A follow-up belongs to the seat whose action returned it (#492 review). In a
 * simultaneous step every seat may act, so the follow-up's name alone must not
 * let another seat take it: seat 1's `scout` publishes `loot`, and only seat 1
 * may loot.
 */
class ScoutGame extends Game<ScoutGame, Player> {
  /** Every loot that actually ran, by seat. */
  looted: number[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<ScoutGame>('scout').prompt('Scout').execute(() => ({
        success: true,
        followUp: { action: 'loot' },
      })),
      // Two selections, so it is collected as a pending action. Not offered by
      // the step: only a follow-up reaches it.
      Action.create<ScoutGame>('loot')
        .prompt('Loot')
        .chooseFrom('where', { choices: ['north', 'south'] })
        .chooseFrom('what', { choices: ['gold', 'gems'] })
        .execute((_a, ctx) => {
          (ctx.game as ScoutGame).looted.push(ctx.player.seat);
        }),
    );
    this.setFlow(defineFlow({
      root: loop({ maxIterations: 10, do: simultaneousActionStep({ actions: ['scout'] }) }),
    }));
  }
}

const NOT_YOURS = "'loot' is not one of your actions right now.";

describe('a follow-up belongs to the seat that published it', () => {
  it('GameRunner: another seat is refused it; the publishing seat takes it', () => {
    const r = new GameRunner({ GameClass: ScoutGame, gameType: 'scout', gameOptions });
    r.start();
    expect(r.performAction('scout', 1, {}).success).toBe(true);
    expect(r.getFlowState()?.followUps).toEqual([{ action: 'loot', seat: 1 }]);

    expect(r.refusalToAct('loot', 2)).toEqual({ error: NOT_YOURS, errorCode: 'ACTION_NOT_AVAILABLE' });
    r.startPendingAction('loot', 2);
    const stolen = r.processSelectionStep(2, 'where', 'north');
    expect(stolen).toMatchObject({ success: false, error: NOT_YOURS });
    expect(r.game.looted).toEqual([]);

    expect(r.refusalToAct('loot', 1)).toBeUndefined();
    r.startPendingAction('loot', 1);
    expect(r.processSelectionStep(1, 'where', 'north').success).toBe(true);
    expect(r.processSelectionStep(1, 'what', 'gold')).toMatchObject({ success: true, actionComplete: true });
    expect(r.game.looted).toEqual([1]);
    expect(historyLabels(r.actionHistory)).toEqual(['scout:1', 'loot:1']);
  });

  it('live session host: another seat is refused it; the publishing seat takes it', async () => {
    const s = await session(ScoutGame);
    const scouted = succeeded(await s.act('scout', 1));
    expect(scouted.followUp?.action).toBe('loot');

    const stolen = await s.pick(2, 'where', 'north', 'loot');
    expect(stolen).toMatchObject({ success: false, error: NOT_YOURS, errorCode: 'ACTION_NOT_AVAILABLE' });
    expect(s.table.readGame().looted).toEqual([]);

    expect((await s.pick(1, 'where', 'north', 'loot')).success).toBe(true);
    const done = await s.pick(1, 'what', 'gold');
    expect(done).toMatchObject({ success: true, actionComplete: true });
    expect(s.table.readGame().looted).toEqual([1]);
  });

  it('stateless selectionStep op: another seat is refused it; the publishing seat takes it', async () => {
    const gameDef: GameDefinitionLike = { gameClass: ScoutGame, gameType: 'scout', minPlayers: 2, maxPlayers: 3 };
    const started = succeeded(await executeOp(gameDef, gameOptions, null, {}, { type: 'start' }));
    const scouted = succeeded(await executeOp(gameDef, gameOptions, started.snapshot, null, {
      type: 'action', actionName: 'scout', player: 1, args: {}, boundaryKey: boundaryKeyOf(started.snapshot),
    }));
    expect(scouted.followUp?.action).toBe('loot');

    const stolen = await executeOp(gameDef, gameOptions, scouted.snapshot, null, {
      type: 'selectionStep', player: 2, selectionName: 'where', value: 'north', actionName: 'loot',
      boundaryKey: boundaryKeyOf(scouted.snapshot),
    });
    expect(stolen).toMatchObject({ success: false, error: NOT_YOURS, errorCode: 'ACTION_NOT_AVAILABLE' });

    const first = succeeded(await executeOp(gameDef, gameOptions, scouted.snapshot, null, {
      type: 'selectionStep', player: 1, selectionName: 'where', value: 'north', actionName: 'loot',
      boundaryKey: boundaryKeyOf(scouted.snapshot),
    }));
    expect(first.success).toBe(true);
    const done = await executeOp(gameDef, gameOptions, first.snapshot, first.pendingState, {
      type: 'selectionStep', player: 1, selectionName: 'what', value: 'gold', actionName: 'loot',
      initialArgs: { where: 'north' }, boundaryKey: boundaryKeyOf(first.snapshot),
    });
    expect(done).toMatchObject({ success: true, actionComplete: true });
  });
});
