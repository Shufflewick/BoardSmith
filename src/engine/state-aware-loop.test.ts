/**
 * `stateAwareLoop` can serve the shape its own docs cite (#35).
 *
 * The builder exists to encode "this loop must not exit while async game state
 * is still unresolved", and its documented example is MERC-shaped. But its body
 * was a bare `actionStep` with no composite body, no `player` override and no
 * `skipIf` — and every loop in MERC with exactly this shape needs at least one
 * of the three, so none could adopt it. The pattern the builder was added for
 * was the one pattern it could not express.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  stateAwareLoop,
  sequence,
  actionStep,
  execute,
  type FlowContext,
  type GameOptions,
} from './index.js';
import { GameRunner } from '../runtime/runner.js';

class PhaseGame extends Game<PhaseGame, Player> {
  pendingCombat: string | null = null;
  resolved: string[] = [];
  actionsLeft = 2;
  drained: string[] = [];
  /** Counts loop iterations, so a test whose body is skipped still terminates. */
  iterations = 0;

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<PhaseGame>('strike').prompt('Strike').execute((_a, ctx) => {
        const game = ctx.game as PhaseGame;
        game.actionsLeft--;
        game.resolved.push(`strike:${ctx.player.seat}`);
        if (game.actionsLeft === 1) game.pendingCombat = 'ambush';
      }),
      Action.create<PhaseGame>('hold').prompt('Hold').execute((_a, ctx) => {
        (ctx.game as PhaseGame).actionsLeft--;
      }),
    );
  }
}

/** The MERC shape: a composite body, a fixed actor, and a skip. */
function buildFlow(options: { skip?: boolean } = {}) {
  return defineFlow({
    root: stateAwareLoop({
      name: 'rebel-phase',
      maxIterations: 12,
      while: (ctx) => {
        const game = ctx.game as PhaseGame;
        // A skipped body never decrements actionsLeft, so the loop needs a
        // bound of its own or `skipIf: true` would spin to the cap.
        if (options.skip) return game.iterations++ < 2;
        return game.actionsLeft > 0;
      },
      pendingStates: (ctx) => [(ctx.game as PhaseGame).pendingCombat],
      skipIf: () => options.skip === true,
      // A sequence, not a single actionStep — the case that blocked adoption.
      // With a composite body the steps own their own actors, so `player` goes
      // on the step that needs it.
      do: sequence(
        actionStep({
          actions: ['strike', 'hold'],
          player: (ctx) => ctx.game.getPlayer(2)!,
        }),
        execute((ctx) => {
          const game = ctx.game as PhaseGame;
          if (game.pendingCombat) {
            game.drained.push(game.pendingCombat);
            game.pendingCombat = null;
          }
        }),
      ),
    }),
  });
}

function run(options: { skip?: boolean } = {}) {
  const runner = new GameRunner({
    GameClass: PhaseGame,
    gameType: 'phase',
    gameOptions: { playerCount: 2, playerNames: ['A', 'B'], seed: 'phase' },
  });
  // The flow is supplied per test, so each case gets its own shape.
  runner.game.setFlow(buildFlow(options));
  runner.start();
  return runner;
}

describe('a composite body', () => {
  it('runs the whole sequence each iteration, not just an action step', () => {
    const runner = run();
    runner.performAction('strike', 2, {});
    // The execute() half of the body drained the pending state the action set.
    expect(runner.game.drained).toEqual(['ambush']);
  });

  it('keeps looping while a pending state is set, whatever `while` says', () => {
    const runner = run();
    runner.performAction('strike', 2, {});
    runner.performAction('strike', 2, {});
    // actionsLeft hit 0, so `while` is false — but the loop still ran the body
    // that drained the pending state rather than exiting with it unresolved.
    expect(runner.game.actionsLeft).toBe(0);
    expect(runner.game.pendingCombat).toBeNull();
  });
});

describe('a player override on the simple form', () => {
  /** The simple form: the builder makes the actionStep, so it takes the actor. */
  function simple(seat: number) {
    const runner = new GameRunner({
      GameClass: PhaseGame,
      gameType: 'phase',
      gameOptions: { playerCount: 2, playerNames: ['A', 'B'], seed: 'who' },
    });
    runner.game.setFlow(
      defineFlow({
        root: stateAwareLoop({
          actions: ['strike', 'hold'],
          maxIterations: 12,
          while: (ctx: FlowContext) => (ctx.game as PhaseGame).actionsLeft > 0,
          player: (ctx) => ctx.game.getPlayer(seat)!,
        }),
      })
    );
    runner.start();
    return runner;
  }

  it('asks the named seat, not the enclosing context\'s', () => {
    expect(simple(2).getFlowState()?.currentPlayer).toBe(2);
  });

  it('refuses the seat the loop did not name', () => {
    expect(simple(2).performAction('strike', 1, {}).success).toBe(false);
  });

  it('passes skipIf through to the step it builds', () => {
    const runner = new GameRunner({
      GameClass: PhaseGame,
      gameType: 'phase',
      gameOptions: { playerCount: 2, playerNames: ['A', 'B'], seed: 'skip' },
    });
    runner.game.setFlow(
      defineFlow({
        root: stateAwareLoop({
          actions: ['strike', 'hold'],
          maxIterations: 12,
          while: (ctx: FlowContext) => (ctx.game as PhaseGame).iterations++ < 2,
          skipIf: () => true,
        }),
      })
    );
    runner.start();
    expect(runner.game.resolved).toEqual([]);
  });
});

describe('skipIf', () => {
  it('skips the body entirely when it returns true', () => {
    const runner = run({ skip: true });
    expect(runner.game.resolved).toEqual([]);
    expect(runner.getFlowState()?.awaitingInput ?? false).toBe(false);
  });

  it('runs the body when it returns false', () => {
    const runner = run({ skip: false });
    expect(runner.getFlowState()?.awaitingInput).toBe(true);
  });
});

describe('the simple form still works exactly as before', () => {
  it('takes a bare actions list with no body, player or skip', () => {
    const runner = new GameRunner({
      GameClass: PhaseGame,
      gameType: 'phase',
      gameOptions: { playerCount: 2, playerNames: ['A', 'B'], seed: 'simple' },
    });
    runner.game.setFlow(
      defineFlow({
        root: stateAwareLoop({
          actions: ['strike', 'hold'],
          maxIterations: 12,
          while: (ctx: FlowContext) => (ctx.game as PhaseGame).actionsLeft > 0,
          pendingStates: (ctx) => [(ctx.game as PhaseGame).pendingCombat],
        }),
      })
    );
    runner.start();
    expect(runner.getFlowState()?.awaitingInput).toBe(true);
    expect(runner.performAction('hold', 1, {}).success).toBe(true);
  });

  it('refuses both a body and an actions list — they are two ways to say one thing', () => {
    expect(() =>
      stateAwareLoop({
        actions: ['strike'],
        do: actionStep({ actions: ['hold'] }),
      } as never)
    ).toThrow(/actions.*do|do.*actions/i);
  });

  it('refuses neither', () => {
    expect(() => stateAwareLoop({} as never)).toThrow(/actions|do/i);
  });
});
