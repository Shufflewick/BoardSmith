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
import { describe, it, expect } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
  Action,
  loop,
  eachPlayer,
  actionStep,
  type FlowContext,
  type GameOptions,
} from '../engine/index.js';
import { GameRunner } from './runner.js';
import { PendingActionManager } from '../session/pending-action-manager.js';

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
          do: eachPlayer({ do: actionStep({ actions: ['halfMove', 'animateThenFail', 'pickThenFail', 'cleanMove', 'refuse'] }) }),
        }),
        setup: (ctx) => ctx.set('round', 1),
      }
    );
  }
}

function makeRunner() {
  const runner = new GameRunner({
    GameClass: HalfwayGame,
    gameType: 'halfway',
    gameOptions: { playerCount: 2, playerNames: ['A', 'B'], seed: 'atomic' },
  });
  runner.start();
  return runner;
}

describe('an execute() that throws half-way through', () => {
  it('reports failure', () => {
    const runner = makeRunner();
    const result = runner.performAction('halfMove', 1, {});
    expect(result.success).toBe(false);
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

describe('an execute() that animates and then throws (#751)', () => {
  it('leaves no animation event in either seat\'s view or the saved snapshot', () => {
    const runner = makeRunner();
    expect(runner.game.pendingAnimationEvents).toEqual([]);

    expect(runner.performAction('animateThenFail', 1, {}).success).toBe(false);

    expect(runner.game.pendingAnimationEvents).toEqual([]);
    for (const seat of [1, 2]) {
      expect(runner.getPlayerView(seat).state.animationEvents ?? []).toEqual([]);
    }
    expect(runner.getSnapshot().state.animationEvents ?? []).toEqual([]);
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
    expect(snapshot.state.animationEvents ?? []).toEqual([]);
    const restored = GameRunner.fromSnapshot(snapshot, HalfwayGame);
    expect(restored.game.source.all(Token)).toHaveLength(5);
    expect(restored.game.target.all(Token)).toHaveLength(0);
  }

  it('the runner\'s selection path leaves the game as it was', () => {
    const runner = makeRunner();
    const messagesBefore = runner.game.messages.length;
    runner.startPendingAction('pickThenFail', 1);

    const result = runner.processSelectionStep(1, 'how', 'all');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Nothing was changed');
    expectNothingMoved(runner, messagesBefore);
  });

  it('the session\'s pending-action path leaves the game as it was', async () => {
    const runner = makeRunner();
    const messagesBefore = runner.game.messages.length;
    const manager = new PendingActionManager(runner, 2);
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
