/**
 * Two checkpoint families that are easy to confuse and are deliberately
 * unrelated (see the note in dev-state.ts):
 *
 * - `createActionCheckpoint` — the per-action ACTION checkpoint carried inside
 *   the authoritative snapshot, powering undo.
 * - `createDevCheckpoint` / `restoreFromDevCheckpoint` — the dev-only, in-memory
 *   HMR recovery mechanism that restores a point and replays what came after.
 *
 * Both previously had existence-only coverage (`typeof x === 'function'`).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  createActionCheckpoint,
  createDevCheckpoint,
  restoreFromDevCheckpoint,
  type GameOptions,
  type FlowContext,
} from '../index.js';
import { GameRunner } from '../../runtime/index.js';

class Token extends Piece<CheckGame> {
  value = 0;
}
class Tray extends Space<CheckGame> {}

class CheckGame extends Game<CheckGame, Player> {
  total = 0;
  tray!: Tray;

  constructor(options: GameOptions) {
    super(options);
    this.tray = this.create(Tray, 'tray');

    this.registerAction(
      Action.create<CheckGame>('add')
        .chooseFrom('value', { choices: [1, 2, 3] })
        .execute((args, ctx) => {
          const game = ctx.game as CheckGame;
          const value = args.value as number;
          game.total += value;
          game.tray.create(Token, `t${game.total}`, { value });
          game.message(`added ${value}`);
          return { success: true };
        }),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          while: (ctx: FlowContext) => (ctx.game as CheckGame).total < 30,
          maxIterations: 100,
          do: eachPlayer({ do: actionStep({ actions: ['add'] }) }),
        }),
      }),
    );
  }
}

const newRunner = (seed = 'checkpoint-seed') => {
  const runner = new GameRunner({
    GameClass: CheckGame,
    gameType: 'check',
    gameOptions: { playerCount: 2, seed },
  });
  runner.start();
  return runner;
};

describe('createActionCheckpoint', () => {
  let runner: ReturnType<typeof newRunner>;

  beforeEach(() => {
    runner = newRunner();
  });

  it('captures the element tree as it stands', () => {
    runner.performAction('add', 1, { value: 2 });
    const checkpoint = createActionCheckpoint(runner.game);
    expect(checkpoint.state).toBeDefined();
    expect(JSON.stringify(checkpoint.state)).toContain('Token');
  });

  it('captures the flow position', () => {
    const checkpoint = createActionCheckpoint(runner.game);
    expect(checkpoint.flowState).toBeDefined();
    expect(checkpoint.flowState!.awaitingInput).toBe(true);
  });

  it('captures the element sequence counter', () => {
    const before = createActionCheckpoint(runner.game).sequence;
    runner.performAction('add', 1, { value: 1 });
    expect(createActionCheckpoint(runner.game).sequence).toBeGreaterThan(before);
  });

  it('captures the RNG position, so a restore need not replay to re-advance it', () => {
    expect(createActionCheckpoint(runner.game).randomState)
      .toBe(runner.game.getRandomState());
  });

  it('records the message-log watermark rather than copying the log', () => {
    runner.performAction('add', 1, { value: 1 });
    const checkpoint = createActionCheckpoint(runner.game);
    expect(checkpoint.messageCount).toBe(runner.game.messages.length);
    // The log itself is stored once at snapshot level; duplicating it per
    // action is what the watermark exists to avoid.
    expect(checkpoint).not.toHaveProperty('messages');
  });

  it('moves its watermark forward as messages accumulate', () => {
    const first = createActionCheckpoint(runner.game).messageCount!;
    runner.performAction('add', 1, { value: 1 });
    expect(createActionCheckpoint(runner.game).messageCount!).toBeGreaterThan(first);
  });

  it('is a point-in-time copy — later play does not alter it', () => {
    runner.performAction('add', 1, { value: 1 });
    const checkpoint = createActionCheckpoint(runner.game);
    const captured = JSON.stringify(checkpoint.state);
    runner.performAction('add', 2, { value: 3 });
    expect(JSON.stringify(checkpoint.state)).toBe(captured);
  });

  it('carries no action history — that lives in the enclosing snapshot', () => {
    // Keeping the history per action is exactly the cost this shape avoids.
    expect(createActionCheckpoint(runner.game)).not.toHaveProperty('actionHistory');
  });

  it('does not disturb the game it captures', () => {
    const before = JSON.stringify(runner.game.toJSON());
    createActionCheckpoint(runner.game);
    expect(JSON.stringify(runner.game.toJSON())).toBe(before);
  });
});

describe('createDevCheckpoint / restoreFromDevCheckpoint', () => {
  let runner: ReturnType<typeof newRunner>;

  const restoreOptions = () => ({
    GameClass: CheckGame,
    gameOptions: { playerCount: 2, seed: 'checkpoint-seed' },
    classRegistry: runner.game._ctx.classRegistry,
  });

  beforeEach(() => {
    runner = newRunner();
  });

  it('stamps the checkpoint with the action index it was taken at', () => {
    runner.performAction('add', 1, { value: 1 });
    const checkpoint = createDevCheckpoint(runner.game, 1);
    expect(checkpoint.actionIndex).toBe(1);
    expect(checkpoint.actionCount).toBe(1);
  });

  it('captures the state alongside the index', () => {
    runner.performAction('add', 1, { value: 2 });
    const checkpoint = createDevCheckpoint(runner.game, 1);
    expect(checkpoint.elements).toBeDefined();
    expect(checkpoint.flowPosition).toBeDefined();
  });

  it('restores the captured state with no actions to replay', () => {
    runner.performAction('add', 1, { value: 2 });
    const checkpoint = createDevCheckpoint(runner.game, 1);

    const { game, actionsReplayed } = restoreFromDevCheckpoint(checkpoint, [], restoreOptions());
    expect(actionsReplayed).toBe(0);
    expect(game.total).toBe(2);
    expect(game.tray.all(Token)).toHaveLength(1);
  });

  it('replays the actions taken after the checkpoint', () => {
    runner.performAction('add', 1, { value: 2 });
    const checkpoint = createDevCheckpoint(runner.game, 1);
    runner.performAction('add', 2, { value: 3 });

    const { game, actionsReplayed } = restoreFromDevCheckpoint(
      checkpoint,
      [{ name: 'add', player: 2, args: { value: 3 } }],
      restoreOptions(),
    );
    expect(actionsReplayed).toBe(1);
    expect(game.total).toBe(5);
  });

  it('lands on the same state the live game reached', () => {
    runner.performAction('add', 1, { value: 2 });
    const checkpoint = createDevCheckpoint(runner.game, 1);
    runner.performAction('add', 2, { value: 3 });
    runner.performAction('add', 1, { value: 1 });

    const { game } = restoreFromDevCheckpoint(
      checkpoint,
      [
        { name: 'add', player: 2, args: { value: 3 } },
        { name: 'add', player: 1, args: { value: 1 } },
      ],
      restoreOptions(),
    );
    expect(game.total).toBe(runner.game.total);
    expect(game.tray.all(Token)).toHaveLength(runner.game.tray.all(Token).length);
  });

  it('counts every action it replayed', () => {
    const checkpoint = createDevCheckpoint(runner.game, 0);
    const { actionsReplayed } = restoreFromDevCheckpoint(
      checkpoint,
      [
        { name: 'add', player: 1, args: { value: 1 } },
        { name: 'add', player: 2, args: { value: 1 } },
      ],
      restoreOptions(),
    );
    expect(actionsReplayed).toBe(2);
  });

  it('leaves the live game alone — the restore builds a separate instance', () => {
    runner.performAction('add', 1, { value: 2 });
    const checkpoint = createDevCheckpoint(runner.game, 1);
    const { game } = restoreFromDevCheckpoint(
      checkpoint,
      [{ name: 'add', player: 2, args: { value: 3 } }],
      restoreOptions(),
    );
    expect(game).not.toBe(runner.game);
    expect(runner.game.total).toBe(2);
  });

  it('fails loudly, naming the action and index, when a replay cannot apply', () => {
    const checkpoint = createDevCheckpoint(runner.game, 0);
    expect(() => restoreFromDevCheckpoint(
      checkpoint,
      [{ name: 'noSuchAction', player: 1, args: {} }],
      restoreOptions(),
    )).toThrow(/\[DevCheckpoint\].*noSuchAction/s);
  });

  it('names the index a failed replay stopped at', () => {
    const checkpoint = createDevCheckpoint(runner.game, 5);
    expect(() => restoreFromDevCheckpoint(
      checkpoint,
      [{ name: 'noSuchAction', player: 1, args: {} }],
      restoreOptions(),
    )).toThrow(/index 5/);
  });

  it('refuses a replay whose args the action rejects, rather than dropping it', () => {
    // `continueFlow` does not throw when the flow refuses an action, so an
    // unapplied action used to be counted as replayed: a "successful" restore
    // of a game that had silently lost a move.
    const checkpoint = createDevCheckpoint(runner.game, 0);
    expect(() => restoreFromDevCheckpoint(
      checkpoint,
      [{ name: 'add', player: 1, args: { value: 99 } }],
      restoreOptions(),
    )).toThrow(/did not apply/);
  });

  it('says what to do when a replay cannot be trusted', () => {
    const checkpoint = createDevCheckpoint(runner.game, 0);
    expect(() => restoreFromDevCheckpoint(
      checkpoint,
      [{ name: 'add', player: 1, args: { value: 99 } }],
      restoreOptions(),
    )).toThrow(/full replay/);
  });

  it('never reports more replayed actions than actually applied', () => {
    const checkpoint = createDevCheckpoint(runner.game, 0);
    const { game, actionsReplayed } = restoreFromDevCheckpoint(
      checkpoint,
      [
        { name: 'add', player: 1, args: { value: 2 } },
        { name: 'add', player: 2, args: { value: 3 } },
      ],
      restoreOptions(),
    );
    expect(actionsReplayed).toBe(2);
    expect(game.total).toBe(5);
  });

  describe('seeded RNG continuity across a hot reload', () => {
    it('resumes the generator where the live game left it', () => {
      const checkpoint = createDevCheckpoint(runner.game, 0);
      const { game } = restoreFromDevCheckpoint(checkpoint, [], restoreOptions());
      expect(game.getRandomState()).toBe(runner.game.getRandomState());
    });

    it('does not rewind the generator to its seed-initial position', () => {
      // The restore rebuilds the game with `new GameClass({ seed })`. Without
      // the captured position the generator restarts from the seed while the
      // element tree comes back fully advanced, so the next draw REPLAYS values
      // the game already consumed.
      runner.game.random();
      runner.game.random();
      const advanced = runner.game.getRandomState();
      const virgin = new CheckGame({ playerCount: 2, seed: 'checkpoint-seed' }).getRandomState();
      expect(advanced).not.toBe(virgin);

      const checkpoint = createDevCheckpoint(runner.game, 0);
      const { game } = restoreFromDevCheckpoint(checkpoint, [], restoreOptions());
      expect(game.getRandomState()).toBe(advanced);
      expect(game.getRandomState()).not.toBe(virgin);
    });

    it('continues the draw sequence rather than repeating it', () => {
      const live = new CheckGame({ playerCount: 2, seed: 'draw-seed' });
      live.start();
      live.startFlow();
      const consumed = [live.random(), live.random(), live.random()];

      const { game } = restoreFromDevCheckpoint(
        createDevCheckpoint(live, 0),
        [],
        { ...restoreOptions(), gameOptions: { playerCount: 2, seed: 'draw-seed' } },
      );
      const next = [game.random(), game.random(), game.random()];

      expect(next).not.toEqual(consumed);
      // And it matches what the live game would have drawn had it kept going.
      expect(next).toEqual([live.random(), live.random(), live.random()]);
    });

    it('a deck shuffled after the reload does not reproduce the opening shuffle', () => {
      const live = new CheckGame({ playerCount: 2, seed: 'shuffle-seed' });
      live.start();
      live.startFlow();
      for (let i = 0; i < 10; i++) live.tray.create(Token, `c${i}`, { value: i });
      live.tray.shuffle();
      const openingOrder = live.tray.all(Token).map((t) => t.name);

      const { game } = restoreFromDevCheckpoint(
        createDevCheckpoint(live, 0),
        [],
        {
          GameClass: CheckGame,
          gameOptions: { playerCount: 2, seed: 'shuffle-seed' },
          classRegistry: live._ctx.classRegistry,
        },
      );
      expect(game.tray.all(Token).map((t) => t.name)).toEqual(openingOrder);

      game.tray.shuffle();
      expect(game.tray.all(Token).map((t) => t.name)).not.toEqual(openingOrder);
    });

    it('still restores a snapshot captured before the position was recorded', () => {
      // Older in-memory snapshots carry no randomState; they must degrade to
      // the previous behaviour rather than throw.
      const checkpoint = createDevCheckpoint(runner.game, 0);
      delete (checkpoint as { randomState?: number }).randomState;
      expect(() => restoreFromDevCheckpoint(checkpoint, [], restoreOptions())).not.toThrow();
    });
  });

  it('restores a game that is ready to accept the next action', () => {
    // Restoring the flow POSITION alone left the game not awaiting input, which
    // made every replay — and the session's whole checkpoint fast-path —
    // impossible. The full flow state has to come back too.
    runner.performAction('add', 1, { value: 2 });
    const checkpoint = createDevCheckpoint(runner.game, 1);
    const { game } = restoreFromDevCheckpoint(checkpoint, [], restoreOptions());
    expect(game.getFlowState()?.awaitingInput).toBe(true);
  });
});
