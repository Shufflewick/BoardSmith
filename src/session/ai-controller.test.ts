/**
 * AIController.checkAndPlay() — onBeforeMove hook tests (Phase 107 Task 1)
 *
 * Tests:
 * - onBeforeMove is called exactly once per move
 * - onBeforeMove fires BEFORE onMove (call-order proof)
 * - onMove waits for onBeforeMove to resolve before executing
 * - Error in onBeforeMove propagates and resets #thinking (isThinking() false afterward)
 * - Omitting onBeforeMove leaves move execution unchanged (default path)
 */

import { describe, it, expect, vi } from 'vitest';
import { Game, Player, Action, defineFlow, loop, eachPlayer, actionStep, type GameOptions } from '../engine/index.js';
import { AIController } from './ai-controller.js';

// Two-player game with 3 choices so MCTS won't short-circuit the single-move path.
class TwoPlayerPickGame extends Game<TwoPlayerPickGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create('pick')
        .chooseFrom('option', {
          prompt: 'Pick an option',
          choices: ['a', 'b', 'c'],
        })
        .execute(() => {})
    );

    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 20,
          do: eachPlayer({
            do: actionStep({ actions: ['pick'] }),
          }),
        }),
      })
    );
  }
}

function makeControllerAndRunner() {
  const controller = new AIController(
    TwoPlayerPickGame,
    'two-player-pick',
    2,
    { players: [1], level: 'easy' }
  );

  const game = new TwoPlayerPickGame({
    playerCount: 2,
    playerNames: ['Bot', 'Human'],
    seed: 'test',
  });
  game.startFlow();

  const runner = {
    game,
    getFlowState: () => game.getFlowState(),
    actionHistory: [] as import('../engine/index.js').SerializedAction[],
  } as Parameters<typeof controller.checkAndPlay>[0];

  return { controller, runner };
}

describe('AIController.checkAndPlay — onBeforeMove hook', () => {
  it('onBeforeMove is called exactly once when provided', async () => {
    const { controller, runner } = makeControllerAndRunner();

    const onBeforeMove = vi.fn().mockResolvedValue(undefined);
    const onMove = vi.fn().mockResolvedValue(true);

    await controller.checkAndPlay(runner, [], onMove, onBeforeMove);

    expect(onBeforeMove).toHaveBeenCalledTimes(1);
  });

  it('onBeforeMove fires before onMove (call-order proof via recording array)', async () => {
    const { controller, runner } = makeControllerAndRunner();

    const callOrder: string[] = [];

    const onBeforeMove = vi.fn(async () => {
      callOrder.push('onBeforeMove');
    });
    const onMove = vi.fn(async () => {
      callOrder.push('onMove');
      return true;
    });

    await controller.checkAndPlay(runner, [], onMove, onBeforeMove);

    expect(callOrder).toEqual(['onBeforeMove', 'onMove']);
  });

  it('onMove waits for onBeforeMove delay before executing', async () => {
    const { controller, runner } = makeControllerAndRunner();

    const resolution: string[] = [];

    const onBeforeMove = vi.fn(async () => {
      // Simulate an async delay
      await new Promise<void>(resolve => setTimeout(resolve, 10));
      resolution.push('beforeMove-done');
    });
    const onMove = vi.fn(async () => {
      resolution.push('onMove-called');
      return true;
    });

    await controller.checkAndPlay(runner, [], onMove, onBeforeMove);

    // After checkAndPlay resolves, both must have run, in order
    expect(resolution).toEqual(['beforeMove-done', 'onMove-called']);
  });

  it('error in onBeforeMove propagates and #thinking resets (isThinking() false afterward)', async () => {
    const { controller, runner } = makeControllerAndRunner();

    const onBeforeMove = vi.fn(async () => {
      throw new Error('announce failed');
    });
    const onMove = vi.fn().mockResolvedValue(true);

    await expect(
      controller.checkAndPlay(runner, [], onMove, onBeforeMove)
    ).rejects.toThrow('announce failed');

    // finally block must have reset #thinking
    expect(controller.isThinking()).toBe(false);
    // onMove must NOT have been called since onBeforeMove threw
    expect(onMove).not.toHaveBeenCalled();
  });

  it('omitting onBeforeMove leaves move execution unchanged (no extra calls)', async () => {
    const { controller, runner } = makeControllerAndRunner();

    const onMove = vi.fn().mockResolvedValue(true);

    const result = await controller.checkAndPlay(runner, [], onMove);

    // Move should succeed normally without onBeforeMove
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(result?.action).toBe('pick');
  });

  it('onBeforeMove receives (action, player, args) from bot.play()', async () => {
    const { controller, runner } = makeControllerAndRunner();

    let capturedAction: string | undefined;
    let capturedPlayer: number | undefined;
    let capturedArgs: Record<string, unknown> | undefined;

    const onBeforeMove = vi.fn(async (action: string, player: number, args: Record<string, unknown>) => {
      capturedAction = action;
      capturedPlayer = player;
      capturedArgs = args;
    });
    const onMove = vi.fn().mockResolvedValue(true);

    await controller.checkAndPlay(runner, [], onMove, onBeforeMove);

    expect(capturedAction).toBe('pick');
    expect(capturedPlayer).toBe(1);
    expect(capturedArgs).toHaveProperty('option');
  });
});
