import { describe, it, expect } from 'vitest';
import { createSnapshot, enumerateLegalMoves } from '../utils/index.js';
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
 * The open timed step's clock (#1532): `game.stepOpenFor(ms)` answers whether
 * the host's instant for the op being run is at least `ms` past the host's
 * instant when the step opened. The engine reads no clock; the host stamps
 * each op with `runner.setNow`, and the opening instant is kept on the step's
 * frame so every restore path measures from the same moment. Each "not yet"
 * names the instant its answer changes, which the runner reports as
 * `reofferAt()` so a host can offer again then (#1536).
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

describe('game.stepOpenFor()', () => {
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
    expect(runner.game.stepOpenFor(25_000)).toBe(true);
    expect(runner.game.stepOpenFor(25_001)).toBe(false);
  });

  it('starts again when the next round opens the step afresh', () => {
    const runner = startedAt(START);
    act(runner, START + 40_000, 'commit', 1);
    act(runner, START + 50_000, 'commit', 2);

    runner.setNow(START + 60_000);
    expect(runner.game.stepOpenFor(10_000)).toBe(true);
    expect(runner.game.stepOpenFor(10_001)).toBe(false);
  });

  it('offers the action greyed with its reason while the step is young', () => {
    const runner = startedAt(START);
    expect(runner.getPlayerView(1).disabledActions).toEqual({ levelUp: 'The battle is still playing back.' });

    runner.setNow(START + PLAYBACK_MS);
    expect(runner.getPlayerView(1).disabledActions).toBeUndefined();
  });

  it('reports the instant an offer it greyed lapses, and nothing once none is greyed (#1536)', () => {
    const runner = startedAt(START);
    runner.getPlayerView(1);
    expect(runner.reofferAt()).toBe(START + PLAYBACK_MS);

    runner.setNow(START + PLAYBACK_MS);
    runner.getPlayerView(1);
    expect(runner.reofferAt()).toBeUndefined();
  });

  it('reports the earliest of several clock reads that answered "not yet"', () => {
    const runner = startedAt(START);
    runner.game.stepOpenFor(50_000);
    runner.game.stepOpenFor(20_000);
    runner.game.stepOpenFor(1);
    runner.setNow(START + 10);
    runner.game.stepOpenFor(50_000);
    runner.game.stepOpenFor(20_000);
    expect(runner.reofferAt()).toBe(START + 20_000);
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
    expect(() => runner.game.stepOpenFor(1)).toThrow(/no step with timeLimitMs is open/);
  });
});

/** A game that hides an action with a `condition` reading the clock, which is never asked again as time passes. */
class ConditionClockGame extends DeployGame {
  constructor(options: GameOptions) {
    super(options, 120_000, 'simultaneous', ['peek', 'commit']);
    this.registerAction(
      Action.create<ConditionClockGame>('peek')
        .condition({ 'playback over': (ctx) => ctx.game.stepOpenFor(PLAYBACK_MS) })
        .execute(() => {}),
    );
  }
}

describe('where a rule may read the step clock', () => {
  it('refuses a condition that reads it, naming disabled and validate instead', () => {
    const runner = new GameRunner({ GameClass: ConditionClockGame, gameType: 'step-clock', gameOptions: opts });
    runner.setNow(START);
    expect(() => runner.start()).toThrow(/stepOpenFor\(\) was read in a condition.*\.disabled\(\).*\.validate\(\)/s);
  });

  it('lets a TestGame stamp the instant its opening step opens at', () => {
    const testGame = TestGame.create(PlaybackGame, { playerCount: 2, now: START });
    expect(testGame.runner.performAction('levelUp', 1, {}).success).toBe(false);

    testGame.runner.setNow(START + PLAYBACK_MS);
    expect(testGame.runner.performAction('levelUp', 1, {}).success).toBe(true);
  });
});

/** A game whose `pack` has a repeating pick, so enumeration judges it on a scratch copy, refused until the playback ends. */
class RepeatingClockGame extends DeployGame {
  constructor(options: GameOptions) {
    super(options, 120_000, 'simultaneous', ['pack', 'commit']);
    this.registerAction(
      Action.create<RepeatingClockGame>('pack')
        .chooseFrom('item', { choices: ['a', 'b'], repeat: { until: () => true } })
        .validate((_args, ctx) => ctx.game.stepOpenFor(PLAYBACK_MS) || 'The battle is still playing back.')
        .execute(() => {}),
    );
  }
}

describe('a step-clock read on a copy of the game (#1537)', () => {
  it("reports on the game it copied when move enumeration's scratch copy reads it", () => {
    const runner = new GameRunner({ GameClass: RepeatingClockGame, gameType: 'step-clock', gameOptions: opts });
    runner.setNow(START);
    runner.start();
    runner.setNow(START);

    expect(enumerateLegalMoves(runner.game, 1).map((move) => move.action)).toEqual(['commit']);
    expect(runner.reofferAt()).toBe(START + PLAYBACK_MS);
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
    expect([restored.game.stepOpenFor(12_000), restored.game.stepOpenFor(12_001)]).toEqual([true, false]);

    restored.setNow(START + 31_000);
    expect([restored.game.stepOpenFor(31_000), restored.game.stepOpenFor(31_001)]).toEqual([true, false]);
  });

  it('survives an undo checkpoint restore', () => {
    const restored = GameRunner.fromCheckpoint(midRound().getSnapshot(), 1, PlaybackGame);
    expect([restored!.game.stepOpenFor(12_000), restored!.game.stepOpenFor(12_001)]).toEqual([true, false]);
  });

  it('survives an MCTS clone', () => {
    const runner = midRound();
    const bot = new MCTSBot(runner.game, PlaybackGame, 'step-clock', 2, { iterations: 1, playoutDepth: 1 });
    const snapshot = createSnapshot(runner.game, 'step-clock', runner.actionHistory, opts.seed);
    const clone = (bot as unknown as { restoreGame(s: typeof snapshot): Game }).restoreGame(snapshot);
    expect([clone.stepOpenFor(12_000), clone.stepOpenFor(12_001)]).toEqual([true, false]);
  });
});

/** Sequential turns of `promote`, greyed until the playback ends with its one rank never open, and a `recheck` each seat takes once. */
class PromoteTurnGame extends DeployGame {
  rechecked: number[] = [];

  constructor(options: GameOptions) {
    super(options, 120_000, 'sequential', ['promote', 'recheck']);
    this.registerAction(
      Action.create<PromoteTurnGame>('promote')
        .disabled((ctx) => !ctx.game.stepOpenFor(PLAYBACK_MS) && 'The battle is still playing back.')
        .chooseFrom('rank', { choices: [2], disabled: () => 'No pack can level.' })
        .execute(() => {}),
    );
    this.registerAction(
      Action.create<PromoteTurnGame>('recheck')
        .condition({ 'not rechecked yet': (ctx) => !ctx.game.rechecked.includes(ctx.player.seat) })
        .execute((_args, ctx) => {
          ctx.game.rechecked = [...ctx.game.rechecked, ctx.player.seat];
          ctx.game.refreshAwaitingActions();
        }),
    );
  }
}

describe('game.refreshAwaitingActions() in an action step (#1545)', () => {
  function turnAt(now: number): GameRunner<PromoteTurnGame> {
    const runner = new GameRunner({ GameClass: PromoteTurnGame, gameType: 'promote-turn', gameOptions: opts });
    runner.setNow(START);
    runner.start();
    runner.setNow(now);
    return runner;
  }

  it('offers the seat what the step offers it now, once the clock has changed that', () => {
    const runner = turnAt(START + PLAYBACK_MS);
    expect(runner.game.getFlowState()?.availableActions).toEqual(['promote', 'recheck']);
    runner.game.refreshAwaitingActions(2);
    expect(runner.game.getFlowState()?.availableActions).toEqual(['promote', 'recheck']);
    runner.game.refreshAwaitingActions();
    expect(runner.game.getFlowState()).toMatchObject({ currentPlayer: 1, availableActions: ['recheck'] });
  });

  it('leaves the step to the running action when called from inside it, which ends the turn once nothing is left', () => {
    const runner = turnAt(START + PLAYBACK_MS);
    expect(runner.performAction('recheck', 1, {}).success).toBe(true);
    expect(runner.game.getFlowState()).toMatchObject({ currentPlayer: 2 });
  });
});

/** A `vote` that records the step's elapsed host time in `execute`, as Windup Warfare's 2x vote records its tick (#1550). */
class VoteClockGame extends DeployGame {
  votedAt: number[] = [];

  constructor(options: GameOptions) {
    super(options, 120_000, 'simultaneous', ['vote', 'commit']);
    this.registerAction(
      Action.create<VoteClockGame>('vote').execute((_args, ctx) => {
        ctx.game.votedAt = [...ctx.game.votedAt, ctx.game.stepOpenMs()];
      }),
    );
  }
}

/** A `peek` greyed by a number read from the clock in `disabled`, which no host could offer again on time. */
class DisabledMsGame extends DeployGame {
  constructor(options: GameOptions) {
    super(options, 120_000, 'simultaneous', ['peek', 'commit']);
    this.registerAction(
      Action.create<DisabledMsGame>('peek')
        .disabled((ctx) => ctx.game.stepOpenMs() < PLAYBACK_MS && 'Still playing back.')
        .execute(() => {}),
    );
  }
}

describe('game.stepOpenMs() in execute (#1550)', () => {
  function voteAt(now: number): GameRunner<VoteClockGame> {
    const runner = new GameRunner({ GameClass: VoteClockGame, gameType: 'vote-clock', gameOptions: opts });
    runner.setNow(START);
    runner.start();
    runner.setNow(now);
    return runner;
  }

  it('reads how long the step has been open, as a number, without arming a re-offer', () => {
    const runner = voteAt(START + 2_350);
    expect(runner.performAction('vote', 1, {}).success).toBe(true);
    expect(runner.game.votedAt).toEqual([2_350]);
    expect(runner.reofferAt()).toBeUndefined();
  });

  it('refuses a read outside execute, naming stepOpenFor for an offer', () => {
    const runner = voteAt(START + 2_350);
    expect(() => runner.game.stepOpenMs()).toThrow(/stepOpenMs\(\) was read outside an action's execute.*stepOpenFor/s);
  });

  it('refuses a read in disabled, where the offer would never be worked out again as time passes', () => {
    const runner = new GameRunner({ GameClass: DisabledMsGame, gameType: 'disabled-ms', gameOptions: opts });
    runner.setNow(START);
    expect(() => runner.start()).toThrow(/stepOpenMs\(\) was read outside an action's execute/);
  });
});
