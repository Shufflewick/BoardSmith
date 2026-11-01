import { describe, it, expect } from 'vitest';
import { createSnapshot } from '../utils/index.js';
import { GameRunner } from '../../runtime/runner.js';
import { MCTSBot } from '../../bot/mcts-bot.js';
import { Action, type Game, type GameOptions } from '../index.js';
import { TestGame } from '../../testing/test-game.js';
import {
  DeployGame,
  PLAYBACK_MS,
  PlaybackGame,
  UntimedDeployGame,
} from '../../session/testing/fixtures/timed-step-fixture.js';

/**
 * The open timed step's clock (#1532): `game.stepElapsedMs()` is the host's
 * instant for the op being run, less the host's instant when the step opened.
 * The engine reads no clock; the host stamps each op with `runner.setNow`, and
 * the opening instant is kept on the step's frame so every restore path
 * measures from the same moment.
 */

const opts = { playerCount: 2, seed: 'step-clock' };
const START = 1_700_000_000_000;

function startedAt(now: number): GameRunner<PlaybackGame> {
  const runner = new GameRunner({ GameClass: PlaybackGame, gameType: 'step-clock', gameOptions: opts });
  runner.setNow(now);
  runner.start();
  return runner;
}

function act(runner: GameRunner<PlaybackGame>, now: number, action: string, seat: number) {
  runner.setNow(now);
  const result = runner.performAction(action, seat, {});
  runner.captureCheckpoint();
  return result;
}

describe('game.stepElapsedMs()', () => {
  it('refuses an action during the first part of a timed step and allows it once that has passed', () => {
    const runner = startedAt(START);

    const early = act(runner, START + PLAYBACK_MS - 1, 'levelUp', 1);
    expect(early.success).toBe(false);
    expect(early.error).toContain('The battle is still playing back.');
    expect(runner.game.levelUps).toBe(0);

    expect(act(runner, START + PLAYBACK_MS, 'levelUp', 1).success).toBe(true);
    expect(runner.game.levelUps).toBe(1);
  });

  it('measures from when the step opened, not from when a seat last acted', () => {
    const runner = startedAt(START);
    expect(act(runner, START + 20_000, 'commit', 1).success).toBe(true);

    runner.setNow(START + 25_000);
    expect(runner.game.stepElapsedMs()).toBe(25_000);
  });

  it('starts again when the next round opens the step afresh', () => {
    const runner = startedAt(START);
    act(runner, START + 40_000, 'commit', 1);
    act(runner, START + 50_000, 'commit', 2);

    runner.setNow(START + 60_000);
    expect(runner.game.stepElapsedMs()).toBe(10_000);
  });

  it('offers the action greyed with its reason while the step is young', () => {
    const runner = startedAt(START);
    expect(runner.getPlayerView(1).disabledActions).toEqual({ levelUp: 'The battle is still playing back.' });

    runner.setNow(START + PLAYBACK_MS);
    expect(runner.getPlayerView(1).disabledActions).toBeUndefined();
  });

  it('says the host stamped no instant when it did not', () => {
    const runner = new GameRunner({ GameClass: PlaybackGame, gameType: 'step-clock', gameOptions: opts });
    // The opening offer already reads the clock.
    expect(() => runner.start()).toThrow(/no instant for the op that opened the step/);
  });

  it('says so when no timed step is open', () => {
    const runner = new GameRunner({ GameClass: UntimedDeployGame, gameType: 'step-clock', gameOptions: opts });
    runner.setNow(START);
    runner.start();
    expect(() => runner.game.stepElapsedMs()).toThrow(/no step with timeLimitMs is open/);
  });
});

/** A game that hides an action with a `condition` reading the clock, which is never asked again as time passes. */
class ConditionClockGame extends DeployGame {
  constructor(options: GameOptions) {
    super(options, 120_000, 'simultaneous', ['peek', 'commit']);
    this.registerAction(
      Action.create<ConditionClockGame>('peek')
        .condition({ 'playback over': (ctx) => ctx.game.stepElapsedMs() >= PLAYBACK_MS })
        .execute(() => {}),
    );
  }
}

describe('where a rule may read the step clock', () => {
  it('refuses a condition that reads it, naming disabled and validate instead', () => {
    const runner = new GameRunner({ GameClass: ConditionClockGame, gameType: 'step-clock', gameOptions: opts });
    runner.setNow(START);
    expect(() => runner.start()).toThrow(/stepElapsedMs\(\) was read in a condition.*\.disabled\(\).*\.validate\(\)/s);
  });

  it('lets a TestGame stamp the instant its opening step opens at', () => {
    const testGame = TestGame.create(PlaybackGame, { playerCount: 2, now: START });
    expect(testGame.runner.performAction('levelUp', 1, {}).success).toBe(false);

    testGame.runner.setNow(START + PLAYBACK_MS);
    expect(testGame.runner.performAction('levelUp', 1, {}).success).toBe(true);
  });
});

describe('the step clock survives every restore path', () => {
  function midRound() {
    const runner = startedAt(START);
    act(runner, START + 10_000, 'commit', 1);
    runner.setNow(START + 12_000);
    return runner;
  }

  it('survives restore() from a snapshot, at the instant the snapshot was taken', () => {
    const restored = GameRunner.fromSnapshot(midRound().getSnapshot(), PlaybackGame);
    expect(restored.game.stepElapsedMs()).toBe(12_000);

    restored.setNow(START + 31_000);
    expect(restored.game.stepElapsedMs()).toBe(31_000);
  });

  it('survives an undo checkpoint restore', () => {
    const restored = GameRunner.fromCheckpoint(midRound().getSnapshot(), 1, PlaybackGame);
    expect(restored!.game.stepElapsedMs()).toBe(12_000);
  });

  it('survives an MCTS clone', () => {
    const runner = midRound();
    const bot = new MCTSBot(runner.game, PlaybackGame, 'step-clock', 2, { iterations: 1, playoutDepth: 1 });
    const snapshot = createSnapshot(runner.game, 'step-clock', runner.actionHistory, opts.seed);
    const clone = (bot as unknown as { restoreGame(s: typeof snapshot): Game }).restoreGame(snapshot);
    expect(clone.stepElapsedMs()).toBe(12_000);
  });
});
