/**
 * Cross-layer proof that a `.disabled()` reason survives every boundary
 * between the rule the designer wrote and the tooltip the player reads
 * (issue #4).
 *
 * The layers this walks: action definition → engine (`getDisabledActions`) →
 * session (`buildPlayerState.disabledActions`) → snapshot (`createPlayerView`,
 * the payload a reconnecting or spectating client gets). The UI end of the
 * chain is covered in `ui/components/auto-ui/ActionPanel.test.ts`.
 *
 * The regression this specifically guards: `disabledActions` used to be
 * populated ONLY inside the `if (tutorial)` branch, so an ordinary game's
 * reasons never reached the wire at all.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
} from '../engine/index.js';
import { GameRunner } from '../runtime/runner.js';
import { createPlayerView } from '../engine/utils/snapshot.js';
import { buildPlayerState } from './utils.js';

const NO_WOOD = 'You need 3 wood to build; you have 0.';

class ForgeGame extends Game<ForgeGame, Player> {
  wood = 0;

  constructor(options: { playerCount: number; playerNames?: string[]; seed?: string }) {
    super(options);

    this.registerActions(
      Action.create<ForgeGame>('build')
        .prompt('Build')
        .disabled(ctx =>
          ctx.game.wood < 3 ? `You need 3 wood to build; you have ${ctx.game.wood}.` : false
        )
        .execute(() => {}),
      Action.create<ForgeGame>('pass').prompt('Pass').execute(() => {}),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          while: () => true,
          maxIterations: 20,
          do: eachPlayer({ do: actionStep({ actions: ['build', 'pass'] }) }),
        }),
      })
    );
  }
}

describe('disabled-action reasons reach the client without a tutorial', () => {
  let runner: GameRunner<ForgeGame>;
  const playerNames = ['Alice', 'Bob'];

  beforeEach(() => {
    runner = new GameRunner<ForgeGame>({
      GameClass: ForgeGame,
      gameType: 'forge-test',
      gameOptions: { playerCount: 2, playerNames, seed: 'test' },
    });
    runner.start();
  });

  it('buildPlayerState carries the reason for the active seat', () => {
    const state = buildPlayerState(runner, playerNames, 1);

    expect(state.disabledActions).toEqual({ build: NO_WOOD });
  });

  it('the disabled action is still OFFERED — the player sees it, greyed out', () => {
    const state = buildPlayerState(runner, playerNames, 1);

    expect(state.availableActions).toContain('build');
  });

  it('createPlayerView carries the same reason (snapshot/reconnect parity)', () => {
    const view = createPlayerView(runner.game, 1);

    expect(view.disabledActions).toEqual({ build: NO_WOOD });
  });

  it('omits the field entirely once nothing is disabled', () => {
    runner.game.wood = 5;

    expect(buildPlayerState(runner, playerNames, 1).disabledActions).toBeUndefined();
    expect(createPlayerView(runner.game, 1).disabledActions).toBeUndefined();
  });

  it('sends nothing to a spectator, who has no actions to disable', () => {
    expect(buildPlayerState(runner, playerNames, 0).disabledActions).toBeUndefined();
    expect(createPlayerView(runner.game, 0).disabledActions).toBeUndefined();
  });
});
