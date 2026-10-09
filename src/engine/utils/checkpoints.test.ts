/**
 * `createActionCheckpoint` — the per-action checkpoint carried inside the
 * authoritative snapshot, powering undo. It previously had existence-only
 * coverage (`typeof x === 'function'`).
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
    // Token is created inside an action, so it must be registered (#496).
    this.registerElements([Tray, Token]);
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
          while: (ctx) => ctx.game.total < 30,
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
    const sequenceNow = () => {
      const { sequence } = createActionCheckpoint(runner.game);
      if (sequence === undefined) throw new Error('createActionCheckpoint recorded no element sequence counter');
      return sequence;
    };
    const before = sequenceNow();
    runner.performAction('add', 1, { value: 1 });
    expect(sequenceNow()).toBeGreaterThan(before);
  });

  it('captures the RNG position, so a restore need not replay to re-advance it', () => {
    expect(createActionCheckpoint(runner.game).randomState)
      .toBe(runner.game.getRandomState());
  });

  it('records the message-log watermark rather than copying the log', () => {
    runner.performAction('add', 1, { value: 1 });
    const checkpoint = createActionCheckpoint(runner.game);
    // The log's ABSOLUTE length — entries ever written (#25). The old form was
    // `messages.length`, a prefix watermark over an array the engine assumed
    // was append-only, so a game that pruned its log corrupted every earlier
    // checkpoint's restore.
    expect(checkpoint.messageCount).toBe(runner.game.messageCount);
    // The log itself is stored once at snapshot level; duplicating it per
    // action is what the watermark exists to avoid.
    expect(checkpoint).not.toHaveProperty('messages');
  });

  it('moves its watermark forward as messages accumulate', () => {
    const first = createActionCheckpoint(runner.game).messageCount!;
    runner.performAction('add', 1, { value: 1 });
    expect(createActionCheckpoint(runner.game).messageCount!).toBeGreaterThan(first);
  });

  it('keeps its watermark meaningful after the log is pruned', () => {
    runner.performAction('add', 1, { value: 1 });
    const watermark = createActionCheckpoint(runner.game).messageCount!;

    runner.performAction('add', 2, { value: 3 });
    runner.game.pruneMessages({ keepLast: 1 });

    // The watermark still counts entries EVER WRITTEN, so it is unchanged by
    // the prune; the eviction offset is what turns it back into a position.
    // A current-length watermark would now name a line from after the boundary.
    expect(createActionCheckpoint(runner.game).messageCount!).toBeGreaterThan(watermark);
    expect(watermark - runner.game.messagesEvicted).toBeLessThanOrEqual(runner.game.messages.length);
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
