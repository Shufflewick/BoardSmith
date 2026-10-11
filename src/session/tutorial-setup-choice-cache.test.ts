/**
 * A tutorial's `setup` is game code that changes the game (#631).
 *
 * A pick's choices are reused while the game's state version stands still.
 * Starting a tutorial restores the game, runs the tutorial's `setup` on it,
 * and restarts the flow, which asks every action's choices again. Those
 * answers must describe the board `setup` left, not the one it was handed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Game, Player, Action, actionStep, loop, type GameOptions, type TutorialDefinition } from '../engine/index.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import { succeeded } from './op-result.test-helper.js';

const devMode = vi.hoisted(() => ({ override: null as boolean | null }));
vi.mock('../utils/dev.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/dev.js')>();
  return { ...actual, isDevMode: () => devMode.override ?? actual.isDevMode() };
});

afterEach(() => {
  devMode.override = null;
});

class LockedGame extends Game<LockedGame, Player> {
  /** Until it is set, `open` has no choices and is not offered. */
  unlocked = false;

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<LockedGame>('open')
        .chooseFrom('door', { choices: (ctx) => (ctx.game.unlocked ? ['left'] : []) })
        .execute(() => ({ success: true })),
    );
    this.registerAction(Action.create<LockedGame>('wait').execute(() => ({ success: true })));
    this.setFlow({
      root: loop({
        maxIterations: 10,
        do: actionStep({ actions: ['open', 'wait'], player: (ctx) => ctx.game.getPlayer(1)!, turnScope: 'restart' }),
      }),
    });
  }
}

const lockedDef: GameDefinitionLike & { tutorial: TutorialDefinition } = {
  gameClass: LockedGame,
  gameType: 'locked',
  minPlayers: 1,
  maxPlayers: 1,
  tutorial: {
    setup: (game) => {
      (game as LockedGame).unlocked = true;
    },
    steps: [{ id: 'open', gate: { action: 'open' }, content: [{ text: 'Open the door.' }] }],
  },
};

describe('starting a tutorial (#631)', () => {
  it("offers the actions the tutorial's setup made available", async () => {
    devMode.override = false;
    const options = { playerCount: 1, seed: 'bs631' };
    const started = succeeded(await executeOp(lockedDef, options, null, null, { type: 'start' }));
    expect(started.snapshot.flowState?.availableActions).toEqual(['wait']);

    const tutorial = succeeded(
      await executeOp(lockedDef, options, started.snapshot, null, { type: 'startTutorial', player: 1 }),
    );
    expect(tutorial.snapshot.flowState?.availableActions).toEqual(['open', 'wait']);
  });
});
