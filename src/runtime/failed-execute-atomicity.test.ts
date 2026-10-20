/**
 * A game action that throws part-way through execute() must leave nothing
 * behind (#44).
 *
 * The engine turned any throw out of author code into a plain failure result,
 * the flow engine recorded the message and stayed put, and the runner returned
 * that failure without restoring anything. So an execute() that moved three
 * cards and then threw left those three cards moved, recorded nothing in
 * actionHistory, and told the player nothing had happened. Live state then
 * disagreed with both the history and the message on screen — and the next
 * snapshot persisted the disagreement.
 *
 * The runner already keeps a per-action checkpoint whose head is exactly the
 * pre-action state, so the rollback costs no extra serialization.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
  Action,
  PlayerFacingError,
  loop,
  eachPlayer,
  actionStep,
  type FlowContext,
  type GameOptions,
} from '../engine/index.js';
import { GameRunner } from './runner.js';
import { PendingActionManager } from '../session/pending-action-manager.js';
import { snapshotTree } from '../engine/utils/index.js';
import { TestGame } from '../testing/test-game.js';

const AUTHOR_REFUSAL = 'The bell has rung. Nothing was changed. Replan next round.';

class Token extends Piece<HalfwayGame, Player> {}
class Zone extends Space<HalfwayGame, Player> {}

class HalfwayGame extends Game<HalfwayGame, Player> {
  source!: Zone;
  target!: Zone;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Token, Zone]);
    this.source = this.create(Zone, 'source');
    this.target = this.create(Zone, 'target');
    this.source.createMany(5, Token, 'token');

    this.registerActions(
      // Moves three tokens, writes a message, then throws — the shape the
      // ticket describes.
      Action.create('halfMove')
        .prompt('Move, then fail')
        .execute((_args, ctx) => {
          const game = ctx.game as HalfwayGame;
          for (const token of game.source.all(Token).slice(0, 3)) {
            token.putInto(game.target);
          }
          game.message('halfway through');
          throw new Error('rules bug: undefined is not a suit');
        }),
      // Animates for everyone and privately for seat 1, then throws (#751).
      Action.create('animateThenFail')
        .prompt('Animate, then fail')
        .execute((_args, ctx) => {
          const game = ctx.game as HalfwayGame;
          game.animate('combat', { damage: 3 });
          game.animateTo(1, 'private-peek', { card: 'ace' });
          throw new Error('rules bug after animating');
        }),
      // The same throw, reached one pick at a time (#801).
      Action.create('pickThenFail')
        .prompt('Pick, then fail')
        .chooseFrom('how', { choices: ['all'] })
        .execute((_args, ctx) => {
          const game = ctx.game as HalfwayGame;
          for (const token of game.source.all(Token).slice(0, 3)) {
            token.putInto(game.target);
          }
          game.message('halfway through');
          game.animate('combat', { damage: 3 });
          throw new Error('rules bug after a pick');
        }),
      // A pick that moves a token, then an execute() that throws (#802).
      Action.create('movingPickThenFail')
        .prompt('Pick and move, then fail')
        .chooseFrom('how', {
          choices: ['all'],
          onSelect: () => { this.source.first(Token)!.putInto(this.target); },
        })
        .execute(() => {
          throw new Error('rules bug after a moving pick');
        }),
      // A refusal written for the player, thrown after moving a token, whose own
      // text happens to hold the runner's sentence (#989).
      Action.create('moveThenRefuse')
        .prompt('Move, then refuse')
        .execute((_args, ctx) => {
          const game = ctx.game as HalfwayGame;
          game.source.first(Token)!.putInto(game.target);
          throw new PlayerFacingError(AUTHOR_REFUSAL);
        }),
      Action.create('cleanMove')
        .prompt('Move one')
        .execute((_args, ctx) => {
          const game = ctx.game as HalfwayGame;
          game.source.first(Token)!.putInto(game.target);
        }),
      // A validation-style refusal: returns failure without mutating anything.
      Action.create('refuse')
        .prompt('Refuse')
        .execute(() => ({ success: false, error: 'not allowed right now' })),
    );

    this.setFlow(
      {
        root: loop({
          while: (ctx) => (ctx.get<number>('round') ?? 1) <= 20,
          maxIterations: 50,
          do: eachPlayer({ do: actionStep({ actions: ['halfMove', 'animateThenFail', 'pickThenFail', 'movingPickThenFail', 'moveThenRefuse', 'cleanMove', 'refuse'] }) }),
        }),
        setup: (ctx) => ctx.set('round', 1),
      }
    );
  }
}

function makeRunner(checkpoints?: { enabled: boolean }) {
  const runner = new GameRunner({
    GameClass: HalfwayGame,
    gameType: 'halfway',
    gameOptions: { playerCount: 2, playerNames: ['A', 'B'], seed: 'atomic' },
    checkpoints,
  });
  runner.start();
  return runner;
}

describe('an execute() that throws half-way through', () => {
  it('reports failure, and says nothing was changed only once the runner has rolled it back (#989)', () => {
    const runner = makeRunner();
    const result = runner.performAction('halfMove', 1, {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/could not be completed.* Nothing was changed\.$/);
  });

  it('adds the sentence after a PlayerFacingError once rolled back (#989)', () => {
    const runner = makeRunner();
    const result = runner.performAction('moveThenRefuse', 1, {});
    expect(result.error).toBe(`${AUTHOR_REFUSAL} Nothing was changed.`);
    expect(runner.game.target.all(Token)).toHaveLength(0);
  });

  it('leaves the element tree exactly as it was', () => {
    const runner = makeRunner();
    expect(runner.game.source.all(Token)).toHaveLength(5);

    runner.performAction('halfMove', 1, {});

    expect(runner.game.source.all(Token)).toHaveLength(5);
    expect(runner.game.target.all(Token)).toHaveLength(0);
  });

  it('leaves the message log as it was — no half-written narration', () => {
    const runner = makeRunner();
    const before = runner.game.messages.length;
    runner.performAction('halfMove', 1, {});
    expect(runner.game.messages.length).toBe(before);
  });

  it('records nothing in actionHistory, matching the state it restored', () => {
    const runner = makeRunner();
    runner.performAction('halfMove', 1, {});
    expect(runner.actionHistory).toHaveLength(0);
  });

  it('leaves the seat able to act, so the game does not wedge', () => {
    const runner = makeRunner();
    runner.performAction('halfMove', 1, {});

    const after = runner.performAction('cleanMove', 1, {});
    expect(after.success).toBe(true);
    expect(runner.game.target.all(Token)).toHaveLength(1);
    expect(runner.actionHistory).toHaveLength(1);
  });

  it('surfaces the failure in a snapshot that matches the restored state', () => {
    const runner = makeRunner();
    runner.performAction('halfMove', 1, {});

    const snapshot = runner.getSnapshot();
    expect(snapshot.actionHistory).toHaveLength(0);
    const restored = GameRunner.fromSnapshot(snapshot, HalfwayGame);
    expect(restored.game.source.all(Token)).toHaveLength(5);
  });
});

describe('an execute() that throws half-way with no checkpoint to roll back to (#808)', () => {
  function runnerWithoutCheckpoints() {
    const runner = new GameRunner({
      GameClass: HalfwayGame,
      gameType: 'halfway',
      gameOptions: { playerCount: 2, playerNames: ['A', 'B'], seed: 'atomic' },
      checkpoints: { enabled: false },
    });
    runner.start();
    return runner;
  }

  function expectPartialChangesReported(error: string | undefined) {
    expect(error).toContain('could not be completed');
    expect(error).not.toContain('Nothing was changed');
    expect(error).toMatch(/failed part way.*may still hold its partial changes.*checkpoints are turned off/);
  }

  it('says the game may hold the partial changes and what to do, never that nothing changed', () => {
    const runner = runnerWithoutCheckpoints();
    const result = runner.performAction('halfMove', 1, {});
    expect(result.success).toBe(false);
    expect(runner.game.target.all(Token)).toHaveLength(3);
    expectPartialChangesReported(result.error);
  });

  it('leaves a PlayerFacingError\'s own text whole and adds the warning (#989)', () => {
    const runner = runnerWithoutCheckpoints();
    const result = runner.performAction('moveThenRefuse', 1, {});
    expect(result.error).toMatch(new RegExp(`^${AUTHOR_REFUSAL} The action failed part way`));
  });

  it('says the same on the pick-by-pick path', async () => {
    const runner = runnerWithoutCheckpoints();
    const result = await new PendingActionManager(runner).processSelectionStep(1, 'how', 'all', 'pickThenFail');
    expect(result.success).toBe(false);
    expect(runner.game.target.all(Token)).toHaveLength(3);
    expectPartialChangesReported(result.error);
  });
});

describe('an execute() that animates and then throws (#751)', () => {
  it('leaves no animation event in either seat\'s view or the saved snapshot', () => {
    const runner = makeRunner();
    expect(runner.game.pendingAnimationEvents).toEqual([]);

    expect(runner.performAction('animateThenFail', 1, {}).success).toBe(false);

    expect(runner.game.pendingAnimationEvents).toEqual([]);
    for (const seat of [1, 2]) {
      expect(runner.getPlayerView(seat).state.animationEvents ?? []).toEqual([]);
    }
    expect(snapshotTree(runner.getSnapshot()).animationEvents ?? []).toEqual([]);
  });
});

describe('an execute() that throws after its picks were taken one at a time (#801)', () => {
  function expectNothingMoved(runner: GameRunner<HalfwayGame>, messagesBefore: number) {
    expect(runner.game.source.all(Token)).toHaveLength(5);
    expect(runner.game.target.all(Token)).toHaveLength(0);
    expect(runner.game.messages.length).toBe(messagesBefore);
    expect(runner.game.pendingAnimationEvents).toEqual([]);
    expect(runner.actionHistory).toHaveLength(0);
    const snapshot = runner.getSnapshot();
    expect(snapshotTree(snapshot).animationEvents ?? []).toEqual([]);
    const restored = GameRunner.fromSnapshot(snapshot, HalfwayGame);
    expect(restored.game.source.all(Token)).toHaveLength(5);
    expect(restored.game.target.all(Token)).toHaveLength(0);
  }

  it('the session\'s pending-action path leaves the game as it was', async () => {
    const runner = makeRunner();
    const messagesBefore = runner.game.messages.length;
    const manager = new PendingActionManager(runner);
    manager.startPendingAction('pickThenFail', 1);

    const result = await manager.processSelectionStep(1, 'how', 'all');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Nothing was changed');
    expectNothingMoved(runner, messagesBefore);
  });
});

describe('an action that refuses without mutating', () => {
  it('still reports failure and still changes nothing', () => {
    const runner = makeRunner();
    const result = runner.performAction('refuse', 1, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('not allowed right now');
    expect(runner.game.source.all(Token)).toHaveLength(5);
    expect(runner.actionHistory).toHaveLength(0);
  });

  it('lets the seat go on to act normally', () => {
    const runner = makeRunner();
    runner.performAction('refuse', 1, {});
    expect(runner.performAction('cleanMove', 1, {}).success).toBe(true);
  });
});

// performAction alone never wrote a checkpoint, so a second action had none to
// roll back to unless something called getSnapshot in between (#802).
describe('a second action that throws half-way, with no snapshot taken between (#802)', () => {
  function expectAfterFirstAction(runner: GameRunner<HalfwayGame>, messagesBefore: number, error?: string) {
    expect(error).not.toContain('checkpoints are turned off');
    expect(runner.game.source.all(Token)).toHaveLength(4);
    expect(runner.game.target.all(Token)).toHaveLength(1);
    expect(runner.game.messages.length).toBe(messagesBefore);
    expect(runner.actionHistory).toHaveLength(1);
  }

  it('performAction rolls back to the state after the first action', () => {
    const runner = makeRunner();
    expect(runner.performAction('cleanMove', 1, {}).success).toBe(true);
    const messagesBefore = runner.game.messages.length;

    const result = runner.performAction('halfMove', 2, {});

    expect(result.success).toBe(false);
    expectAfterFirstAction(runner, messagesBefore, result.error);
  });

  it('TestGame.tryAction rolls back to the state after the first action', () => {
    const testGame = TestGame.create(HalfwayGame, { playerCount: 2, seed: 'atomic' });
    testGame.doAction(1, 'cleanMove', {});
    const messagesBefore = testGame.game.messages.length;

    const result = testGame.tryAction(2, 'halfMove', {});

    expect(result.success).toBe(false);
    expectAfterFirstAction(testGame.runner, messagesBefore, result.error);
  });

  it('the session\'s pending-action completion rolls back to the state after the first action', async () => {
    const runner = makeRunner();
    expect(runner.performAction('cleanMove', 1, {}).success).toBe(true);
    const messagesBefore = runner.game.messages.length;
    const manager = new PendingActionManager(runner);
    manager.startPendingAction('pickThenFail', 2);

    const result = await manager.processSelectionStep(2, 'how', 'all');

    expect(result.success).toBe(false);
    expectAfterFirstAction(runner, messagesBefore, result.error);
  });

  it('the session\'s pending-action path also undoes what a pick changed', async () => {
    const runner = makeRunner();
    expect(runner.performAction('cleanMove', 1, {}).success).toBe(true);
    const messagesBefore = runner.game.messages.length;

    const result = await new PendingActionManager(runner).processSelectionStep(2, 'how', 'all', 'movingPickThenFail');

    expect(result.success).toBe(false);
    expectAfterFirstAction(runner, messagesBefore, result.error);
  });

  it('takes no extra checkpoint when a snapshot already captured one', () => {
    const runner = makeRunner();
    runner.performAction('cleanMove', 1, {});
    runner.getSnapshot();
    const capture = vi.spyOn(runner, 'captureCheckpoint');

    runner.performAction('halfMove', 2, {});

    expect(capture).not.toHaveBeenCalled();
  });

  it('says checkpoints are disabled only when they are', () => {
    const runner = makeRunner({ enabled: false });
    runner.performAction('cleanMove', 1, {});

    const result = runner.performAction('halfMove', 2, {});

    expect(result.error).toContain('per-action checkpoints are turned off');
  });
});
