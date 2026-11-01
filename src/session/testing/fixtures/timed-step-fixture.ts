/**
 * Steps that declare how long they stay open (#300).
 *
 * `DeployGame` is Windup Warfare's shape: two seats deploy at once, a round
 * closes when both have committed, and the round loops. Its limit is a
 * constructor argument so the same flow can be declared with a number, with a
 * function, or with no limit at all, and nothing else differs between them.
 * `TimedTurnGame` is the same game played one seat after another, so the
 * sequential `actionStep` is covered by the same fixture.
 *
 * `GrowingDeployGame`'s function answers 30 s plus one second per commit EVER
 * made, so a limit that was re-resolved after a seat submitted mid-round would
 * be visible, and so would a round that failed to resolve it afresh.
 *
 * Consumers: `src/engine/flow/step-time-limit.test.ts` (the flow state and every
 * restore path), `src/session/step-time-limit-boundary.test.ts` (the turn
 * boundary a host broadcasts), the build and validate suites (a timed step
 * needs an `idleAction`), and `flow-state-clone.test.ts`, which drives every
 * definition exported here. `PlaybackTurnGame` is played by the simulator and
 * the bot trainer's benchmark (`src/sim/play-game.test.ts`,
 * `src/bot-trainer/benchmark.test.ts`), which need a game that ends.
 */
import {
  Game,
  Player,
  Action,
  loop,
  eachPlayer,
  actionStep,
  simultaneousActionStep,
  type FlowContext,
  type FlowNode,
  type GameOptions,
} from '../../../engine/index.js';
import type { GameDefinitionLike } from '../../stateless-ops.js';

type Limit = number | ((ctx: FlowContext<DeployGame>) => number);

/** The step a round is made of: every seat at once, or one seat after another. */
type Shape = 'simultaneous' | 'sequential';

function roundStep(shape: Shape, limit: Limit | undefined, actions: string[]): FlowNode<DeployGame> {
  const timeLimitMs = limit === undefined ? {} : { timeLimitMs: limit };
  if (shape === 'sequential') {
    return eachPlayer<DeployGame>({ do: actionStep<DeployGame>({ name: 'turn', actions, ...timeLimitMs }) });
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
    ...timeLimitMs,
  });
}

export class DeployGame extends Game<DeployGame, Player> {
  /** Every commit ever made. */
  commits = 0;
  /** Seats that committed in the current round. */
  committed: number[] = [];

  constructor(options: GameOptions, limit?: Limit, shape: Shape = 'simultaneous', actions = ['commit']) {
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
      root: loop({ name: 'rounds', maxIterations: 3, do: roundStep(shape, limit, actions) }),
    });
  }
}

/** Open for 120 s, every round. */
export class FixedDeployGame extends DeployGame {
  constructor(options: GameOptions) {
    super(options, 120_000);
  }
}

/** Open for 30 s plus one second per commit ever made, resolved at each round's entry. */
export class GrowingDeployGame extends DeployGame {
  constructor(options: GameOptions) {
    super(options, (ctx) => 30_000 + 1_000 * ctx.game.commits);
  }
}

/** The same flow with no limit declared. */
export class UntimedDeployGame extends DeployGame {
  constructor(options: GameOptions) {
    super(options);
  }
}

/** Sequential turns, one seat after another, each open for 45 s. */
export class TimedTurnGame extends DeployGame {
  constructor(options: GameOptions) {
    super(options, 45_000, 'sequential');
  }
}

function twoSeat(gameClass: GameDefinitionLike['gameClass'], gameType: string): GameDefinitionLike {
  return { gameClass, gameType, minPlayers: 2, maxPlayers: 2 };
}

export const fixedDeployDefinition = twoSeat(FixedDeployGame, 'timed-step-fixed');
export const growingDeployDefinition = twoSeat(GrowingDeployGame, 'timed-step-growing');
export const untimedDeployDefinition = twoSeat(UntimedDeployGame, 'timed-step-untimed');
export const timedTurnDefinition = twoSeat(TimedTurnGame, 'timed-step-turn');

/** How long `PlaybackGame`'s battle plays back once a deploy step opens. */
export const PLAYBACK_MS = 30_000;

/**
 * Windup Warfare's level-up rule (#1532): each 120 s deploy round opens on a
 * battle both screens play back, and `levelUp` is refused until the playback
 * has ended, measured on the step's own clock rather than on a client's word.
 */
export class PlaybackGame extends DeployGame {
  levelUps = 0;

  constructor(options: GameOptions) {
    super(options, 120_000, 'simultaneous', ['levelUp', 'commit']);
    this.registerAction(
      Action.create<PlaybackGame>('levelUp')
        .disabled((ctx) => ctx.game.stepElapsedMs() < PLAYBACK_MS && 'The battle is still playing back.')
        .execute((_args, ctx) => {
          ctx.game.levelUps += 1;
        }),
    );
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
    this.registerAction(
      Action.create<PlaybackTurnGame>('levelUp')
        .disabled((ctx) => ctx.game.stepElapsedMs() < PLAYBACK_MS && 'The battle is still playing back.')
        .execute((_args, ctx) => {
          ctx.game.levelUps += 1;
        }),
    );
    this.registerAction(Action.create('commit').execute(() => {}));
    this.setFlow({
      root: eachPlayer<PlaybackTurnGame>({ do: actionStep({ name: 'turn', actions: ['levelUp', 'commit'], timeLimitMs: 120_000 }) }),
    });
  }
}

export const playbackTurnDefinition = twoSeat(PlaybackTurnGame, 'timed-step-playback-turn');
