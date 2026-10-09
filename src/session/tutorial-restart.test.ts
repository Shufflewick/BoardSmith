import { describe, it, expect } from 'vitest';
import { createHeadlessSession } from './headless-session.js';
import { Game, Player, Action, defineFlow, actionStep, eachPlayer, loop, sequence, execute, type GameOptions } from '../engine/index.js';
import type { TutorialDefinition } from '../engine/index.js';

/**
 * #546: `startTutorial` on a live game puts the flow back on the learner's
 * turn, through the tutorial's own restart, without running the game's opening
 * again. Driven through the live path: SnapshotSessionHost over executeOp.
 */
class TwoSeatTutorialGame extends Game<TwoSeatTutorialGame, Player> {
  openings = 0;
  turns = 0;

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow(
      defineFlow({
        root: sequence(
          execute((ctx) => {
            ctx.game.openings++;
          }),
          loop({
            maxIterations: 20,
            do: eachPlayer({
              do: sequence(
                actionStep({ actions: ['pass'] }),
                execute((ctx) => {
                  ctx.game.turns++;
                }),
              ),
            }),
          }),
        ),
      }),
    );
  }
}

const tutorial: TutorialDefinition = {
  steps: [{ id: 'pass', gate: { action: 'pass' }, content: [{ text: 'Pass the turn.' }] }],
};

const def = { gameClass: TwoSeatTutorialGame, gameType: 'two-seat-tutorial', minPlayers: 2, maxPlayers: 2, tutorial };

describe('startTutorial mid-game (#546)', () => {
  it("leaves the learner to move, offered actions, with the opening run once", async () => {
    const session = createHeadlessSession(def, { playerCount: 2, seed: 'tutorial-restart' });
    await session.start();
    expect((await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} })).success).toBe(true);
    expect(session.host.flowState?.currentPlayer).toBe(2);

    const result = await session.send(1, { type: 'startTutorial', player: 1 });

    expect(result.success).toBe(true);
    expect(session.host.flowState?.currentPlayer).toBe(1);
    const learner = session.playerState(1);
    expect(learner.isMyTurn).toBe(true);
    expect(learner.availableActions).toEqual(['pass']);
    expect(session.readGame().openings).toBe(1);
    expect(session.readGame().turns).toBe(1);

    // The restarted position is what the snapshot holds: the next move runs
    // from it, and execute nodes run again once the learner has acted.
    expect((await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} })).success).toBe(true);
    expect(session.readGame().turns).toBe(2);
    expect(session.host.flowState?.currentPlayer).toBe(2);
  });

  it('refuses a seat the restarted flow would not prompt, and leaves the game as it was', async () => {
    const session = createHeadlessSession(def, { playerCount: 2, seed: 'tutorial-restart' });
    await session.start();
    expect((await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} })).success).toBe(true);
    const before = structuredClone(session.host.snapshot);

    const result = await session.send(2, { type: 'startTutorial', player: 2 });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot start for seat 2.*seat 1 is to move/s);
    expect(session.host.snapshot).toEqual(before);
    expect(session.host.flowState?.currentPlayer).toBe(2);
    expect(session.playerState(2).isMyTurn).toBe(true);
  });
});
