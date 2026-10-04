// @vitest-environment jsdom
/**
 * A page that reloads while its seat holds a follow-up picks it back up (#494).
 *
 * A follow-up reaches the client in the result of the action that returned it.
 * A page that never saw that result, because it reloaded, would otherwise show
 * a seat the flow is holding for its follow-up with nothing to do. The seat's
 * own published state carries the follow-up, and the table wiring starts it.
 *
 * Drives a real GameSession: the seat acts through the session directly (the
 * result goes nowhere), then a fresh table is mounted on the seat's state.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ref } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import { Game, Player, Action, defineFlow, loop, eachPlayer, actionStep, type GameOptions } from '../../engine/index.js';
import { GameSession } from '../../session/game-session.js';
import { createBoardInteraction } from './useBoardInteraction.js';
import { mountTableWiring, settle } from './table-wiring.test-helper.js';

class ScoutGame extends Game<ScoutGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<ScoutGame>('scout').prompt('Scout').execute((_a, ctx) => ({
        success: true,
        followUp: { action: 'loot', args: { by: ctx.player.seat } },
      })),
      Action.create<ScoutGame>('loot')
        .prompt('Loot')
        .chooseFrom('where', { choices: ['north', 'south'] })
        .chooseFrom('what', { choices: ['gold', 'gems'] })
        .execute(() => {}),
    );
    this.setFlow(defineFlow({
      root: loop({ maxIterations: 2, do: eachPlayer({ do: actionStep({ actions: ['scout'], turnScope: 'restart' }) }) }),
    }));
  }
}

let mounted: VueWrapper | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

describe('a reloaded page resumes the follow-up its seat holds', () => {
  it('starts it from the seat state, with its pre-filled args', async () => {
    const session = GameSession.create<ScoutGame>({
      gameType: 'scout', GameClass: ScoutGame, playerCount: 2, playerNames: ['A', 'B'], seed: 'reload',
    });
    expect((await session.performAction('scout', 1, {})).success).toBe(true);

    const seatState = ref(session.buildPlayerState(1, { includeActionMetadata: true }));
    const { wiring, wrapper } = mountTableWiring({
      session: () => session,
      seat: 1,
      seatState,
      boardInteraction: createBoardInteraction(),
      autoEndTurn: false,
    });
    mounted = wrapper;
    await settle();

    expect(wiring.controller.currentAction.value).toBe('loot');
    expect(wiring.controller.pendingOnServer.value).toBe(true);
    expect(wiring.controller.currentArgs.value.by).toBe(1);
  });

  it('starts nothing for a seat that holds no follow-up', async () => {
    const session = GameSession.create<ScoutGame>({
      gameType: 'scout', GameClass: ScoutGame, playerCount: 2, playerNames: ['A', 'B'], seed: 'reload',
    });
    await session.performAction('scout', 1, {});

    const seatState = ref(session.buildPlayerState(2, { includeActionMetadata: true }));
    const { wiring, wrapper } = mountTableWiring({
      session: () => session,
      seat: 2,
      seatState,
      boardInteraction: createBoardInteraction(),
      autoEndTurn: false,
    });
    mounted = wrapper;
    await settle();

    expect(wiring.controller.currentAction.value).toBe(null);
  });
});
