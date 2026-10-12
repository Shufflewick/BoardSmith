/**
 * A sampled world is what the search asks about next (#631).
 *
 * A pick's choices are reused while the game's state version stands still,
 * and a `determinize` sampler writes the redacted attributes of the bot's
 * sandbox directly. So sampling has to advance the version: a pick that
 * offered nothing while the attribute was withheld must offer the sampled
 * value once it is written.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Game, Player, Action, actionStep, type GameOptions } from '../engine/index.js';
import { createSnapshot } from '../engine/utils/index.js';
import { applyDeterminization } from './determinization.js';

const devMode = vi.hoisted(() => ({ override: null as boolean | null }));
vi.mock('../utils/dev.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/dev.js')>();
  return { ...actual, isDevMode: () => devMode.override ?? actual.isDevMode() };
});

afterEach(() => {
  devMode.override = null;
});

class Keeper extends Player<SafeGame, Keeper> {
  static override visibleAttributes: string[] = [];
  /** The safe's code, withheld from every other seat. */
  code = 0;
}

class SafeGame extends Game<SafeGame, Keeper> {
  static override PlayerClass = Keeper;

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<SafeGame>('dial')
        .chooseFrom('code', {
          // The guarded read the redaction docs recommend.
          choices: (ctx) => {
            const keeper = ctx.game.getPlayer(2)!;
            return keeper.isAttributeRedacted('code') ? [] : [keeper.code];
          },
        })
        .execute(() => ({ success: true })),
    );
    this.setFlow({ root: actionStep({ actions: ['dial'], player: (ctx) => ctx.game.getPlayer(1)! }) });
  }
}

describe('determinization and reused choices (#631)', () => {
  it('a pick asked before the sampler ran offers the sampled value after it', () => {
    devMode.override = false;
    const game = new SafeGame({ playerCount: 2, seed: 'bs631' });
    game.getPlayer(2)!.code = 7;
    game.startFlow();

    // The seat's redacted sandbox, restored as the bot restores it.
    const snapshot = createSnapshot(game, 'safe', [], undefined, { forSeat: 1 });
    const sandbox = new SafeGame(snapshot.gameOptions as GameOptions);
    sandbox.loadSerializedState(snapshot.state);
    sandbox.restoreFlowState(snapshot.flowState!);
    const codes = () =>
      sandbox.getActionExecutor().getChoices(sandbox.getAction('dial')!.selections[0], sandbox.getPlayer(1)!, {}, 'dial').map((c) => c.value);
    expect(codes()).toEqual([]);

    applyDeterminization(sandbox, 1, (world) => {
      (world.getPlayer(2) as Keeper).code = 3;
    }, () => 0.5);
    expect(codes()).toEqual([3]);
  });
});
