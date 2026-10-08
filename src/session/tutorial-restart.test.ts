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

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow(
      defineFlow({
        root: sequence(
          execute((ctx) => {
            ctx.game.openings++;
          }),
          loop({ maxIterations: 20, do: eachPlayer({ do: actionStep({ actions: ['pass'] }) }) }),
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
  });
});
