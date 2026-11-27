/**
 * Steps the host times (#300, #1830).
 *
 * `DeployGame` is Windup Warfare's shape: two seats deploy at once, a round
 * closes when both have committed, and the round loops. Whether it is timed is
 * a constructor argument, so the same flow can be declared timed or not and
 * nothing else differs between them. `TimedTurnGame` is the same game played
 * one seat after another, so the sequential `actionStep` is covered by the
 * same fixture. The `Watch*`, `NoBattle*` and `BadWatch*` games open each turn
 * on watch time (#1831).
 *
 * Consumers: `src/engine/flow/timed-step.test.ts` (the flow state and every
 * restore path), `src/session/timed-step-boundary.test.ts` (the turn
 * boundary a host broadcasts), the build and validate suites (a timed step
 * needs an `idleAction`), and `flow-state-clone.test.ts`, which drives every
 * definition exported here. `PlaybackTurnGame` is played by the simulator and
 * the bot trainer's benchmark (`src/sim/play-game.test.ts`,
 * `src/bot-trainer/benchmark.test.ts`), which need a game that ends.
 * `ValidateGatedGame` and `DisabledGatedGame`, played with `levelUpWhenAllowed`,
 * have a bot that waits for the playback to level up (#1537), for
 * `src/session/step-clock.test.ts` and the dev host's deadline suite, and for
 * the simulator and the benchmark, which move their clock to the instant the
 * bot waits for (#1541). `CommitRoundGame`, played
 * with `seatOneWaitsForSeatTwo`, has a seat that waits with no instant while the
 * other can move, which the simulator and the benchmark hold as a host does (#1719).
 */
import {
  Game,
  Player,
  Action,
  loop,
  eachPlayer,
  actionStep,
  simultaneousActionStep,
  type FlowNode,
  type GameOptions,
  type StepTiming,
} from '../../../engine/index.js';
import type { GameDefinitionLike } from '../../stateless-ops.js';
import type { BotStrategy } from '../../../bot/types.js';

/** The step a round is made of: every seat at once, or one seat after another. */
type Shape = 'simultaneous' | 'sequential';

function roundStep(shape: Shape, timed: StepTiming<DeployGame> | false, actions: string[]): FlowNode<DeployGame> {
  const mark = timed === false ? {} : { timed };
  if (shape === 'sequential') {
    return eachPlayer<DeployGame>({ do: actionStep<DeployGame>({ name: 'turn', actions, ...mark }) });
  }
  return simultaneousActionStep<DeployGame>({
    name: 'deploy',
    actions,
    playerDone: (ctx, player) => ctx.game.committed.includes(player.seat),
    allDone: (ctx) => {
      if (ctx.game.committed.length < 2) return false;
      ctx.game.committed = [];
      return true;
    },
    ...mark,
  });
}

export class DeployGame extends Game<DeployGame, Player> {
  /** Every commit ever made. */
  commits = 0;
  /** Seats that committed in the current round. */
  committed: number[] = [];

  constructor(options: GameOptions, timed: StepTiming<DeployGame> | false = false, shape: Shape = 'simultaneous', actions = ['commit']) {
    super(options);
    this.registerAction(
      Action.create('commit').execute((_args, ctx) => {
        const game = ctx.game as DeployGame;
        game.commits += 1;
        game.committed = [...game.committed, ctx.player.seat];
        return { success: true };
      }),
    );
    this.setFlow({
      root: loop({ name: 'rounds', maxIterations: 3, do: roundStep(shape, timed, actions) }),
    });
  }
}

/** Timed, every round. */
export class FixedDeployGame extends DeployGame {
  constructor(options: GameOptions) {
    super(options, true);
  }
}

/** The same flow, untimed. */
export class UntimedDeployGame extends DeployGame {
  constructor(options: GameOptions) {
    super(options);
  }
}

/** Sequential turns, one seat after another, each timed. */
export class TimedTurnGame extends DeployGame {
  constructor(options: GameOptions) {
    super(options, true, 'sequential');
  }
}

function twoSeat(gameClass: GameDefinitionLike['gameClass'], gameType: string): GameDefinitionLike {
  return { gameClass, gameType, minPlayers: 2, maxPlayers: 2 };
}

/**
 * Timed, every round opening on a battle both seats watch (#1831): 40 seconds
 * plus 10 for every commit made before the round, so a commit inside the round
 * would move it if it were resolved again.
 */
export class WatchDeployGame extends DeployGame {
  constructor(options: GameOptions) {
    super(options, { watchSeconds: (ctx) => 40 + 10 * ctx.game.commits });
  }
}

/** Sequential turns, each opening on a 40-second replay the seat watches. */
export class WatchTurnGame extends DeployGame {
  constructor(options: GameOptions) {
    super(options, { watchSeconds: () => 40 }, 'sequential');
  }
}

/** Timed with watch time that reports 0, as a turn with no battle does. */
export class NoBattleDeployGame extends DeployGame {
  constructor(options: GameOptions) {
    super(options, { watchSeconds: () => 0 });
  }
}

/** A step whose watch time is not a number of seconds. */
export class BadWatchDeployGame extends DeployGame {
  constructor(options: GameOptions) {
    super(options, { watchSeconds: () => -5 });
  }
}

export const fixedDeployDefinition = twoSeat(FixedDeployGame, 'timed-step-fixed');
export const watchDeployDefinition = twoSeat(WatchDeployGame, 'timed-step-watch');
export const untimedDeployDefinition = twoSeat(UntimedDeployGame, 'timed-step-untimed');
export const timedTurnDefinition = twoSeat(TimedTurnGame, 'timed-step-turn');

/** One untimed round of `DeployGame`'s deploy step, so the game ends once both seats commit. */
class CommitRoundGame extends DeployGame {
  constructor(options: GameOptions) {
    super(options);
    this.setFlow({ root: roundStep('simultaneous', false, ['commit']) });
  }
}

export const commitRoundDefinition = twoSeat(CommitRoundGame, 'timed-step-commit-round');

/** For `CommitRoundGame`: seat 1 waits, reading no clock, until seat 2 has committed (#1719). */
export const seatOneWaitsForSeatTwo: BotStrategy = {
  candidateMoves: (game, seat, listMoves) => (seat === 1 && !(game as DeployGame).committed.includes(2) ? [] : listMoves()),
};

/** How long `PlaybackGame`'s battle plays back once a deploy step opens. */
export const PLAYBACK_MS = 30_000;
const PLAYBACK_REASON = 'The battle is still playing back.';

/** `levelUp`, refused until the battle has played back, measured on the step's own clock. */
function levelUp<G extends Game & { levelUps: number }>() {
  return Action.create<G>('levelUp')
    .disabled((ctx) => !ctx.game.stepOpenFor(PLAYBACK_MS) && PLAYBACK_REASON)
    .execute((_args, ctx) => {
      ctx.game.levelUps += 1;
    });
}

/**
 * Windup Warfare's level-up rule (#1532): each timed deploy round opens on a
 * battle both screens play back, and `levelUp` is refused until the playback
 * has ended, measured on the step's own clock rather than on a client's word.
 */
export class PlaybackGame extends DeployGame {
  levelUps = 0;

  constructor(options: GameOptions) {
    super(options, true, 'simultaneous', ['levelUp', 'commit']);
    this.registerAction(levelUp());
  }
}

export const playbackDefinition = twoSeat(PlaybackGame, 'timed-step-playback');

/**
 * The level-up rule in a game that ends (#1535): each seat takes one timed
 * turn, and either levels up, once the playback has ended, or commits.
 */
export class PlaybackTurnGame extends Game<PlaybackTurnGame, Player> {
  levelUps = 0;

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(levelUp());
    this.registerAction(Action.create('commit').execute(() => {}));
    this.setFlow({
      root: eachPlayer<PlaybackTurnGame>({ do: actionStep({ name: 'turn', actions: ['levelUp', 'commit'], timed: true }) }),
    });
  }
}

export const playbackTurnDefinition = twoSeat(PlaybackTurnGame, 'timed-step-playback-turn');

/** A bot strategy for the gated games: level up once it may, wait while it is refused, then be done (#1537). */
export const levelUpWhenAllowed: BotStrategy = {
  candidateMoves: (game, seat, listMoves) => {
    const moves = listMoves();
    const up = moves.filter((move) => move.action === 'levelUp');
    if (up.length > 0) return up;
    if (!(game as ClockGatedGame).levelledUp.includes(seat)) return [];
    return moves.filter((move) => move.action === 'done');
  },
};

/**
 * A timed round of `levelUp` and `done`, where `levelUp` waits for the
 * playback (#1537), refused by `validate` or greyed by `disabled`. A seat that
 * is done is out of the round; the round waits for both.
 */
class ClockGatedGame extends Game<ClockGatedGame, Player> {
  levelledUp: number[] = [];
  done: number[] = [];

  constructor(options: GameOptions, gate: 'validate' | 'disabled') {
    super(options);
    const offered = Action.create<ClockGatedGame>('levelUp')
      .condition({ 'not levelled up yet': (ctx) => !ctx.game.levelledUp.includes(ctx.player.seat) });
    const gated = gate === 'validate'
      ? offered.validate((_args, ctx) => ctx.game.stepOpenFor(PLAYBACK_MS) || PLAYBACK_REASON)
      : offered.disabled((ctx) => !ctx.game.stepOpenFor(PLAYBACK_MS) && PLAYBACK_REASON);
    this.registerAction(
      gated.execute((_args, ctx) => {
        ctx.game.levelledUp = [...ctx.game.levelledUp, ctx.player.seat];
      }),
    );
    this.registerAction(
      Action.create<ClockGatedGame>('done').execute((_args, ctx) => {
        ctx.game.done = [...ctx.game.done, ctx.player.seat];
      }),
    );
    this.setFlow({
      root: simultaneousActionStep<ClockGatedGame>({
        name: 'deploy',
        actions: ['levelUp', 'done'],
        playerDone: (ctx, player) => ctx.game.done.includes(player.seat),
        allDone: (ctx) => ctx.game.done.length === 2,
        timed: true,
      }),
    });
  }
}

class ValidateGatedGame extends ClockGatedGame {
  constructor(options: GameOptions) {
    super(options, 'validate');
  }
}

class DisabledGatedGame extends ClockGatedGame {
  constructor(options: GameOptions) {
    super(options, 'disabled');
  }
}

export const validateGatedDefinition = twoSeat(ValidateGatedGame, 'timed-step-validate-gated');
export const disabledGatedDefinition = twoSeat(DisabledGatedGame, 'timed-step-disabled-gated');
