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
  scouted: number[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      // Once per seat, so after scouting the step offers the seat nothing else.
      Action.create<ScoutGame>('scout')
        .prompt('Scout')
        .condition({ 'has not scouted': (ctx) => !(ctx.game as ScoutGame).scouted.includes(ctx.player.seat) })
        .execute((_a, ctx) => {
          (ctx.game as ScoutGame).scouted.push(ctx.player.seat);
          return { success: true, followUp: { action: 'loot', args: { by: ctx.player.seat } } };
        }),
      Action.create<ScoutGame>('loot')
        .prompt('Loot')
        .chooseFrom('where', { choices: ['north', 'south'] })
        .chooseFrom('what', { choices: ['gold', 'gems'] })
        .execute(() => {}),
    );
    this.setFlow(defineFlow({
      root: loop({ maxIterations: 2, while: (ctx) => (ctx.game as ScoutGame).scouted.length < 2, do: eachPlayer({ do: actionStep({ actions: ['scout'], turnScope: 'restart' }) }) }),
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

  it('a player who cancels it while the step offers nothing else can start it again and finish it', async () => {
    const session = GameSession.create<ScoutGame>({
      gameType: 'scout', GameClass: ScoutGame, playerCount: 2, playerNames: ['A', 'B'], seed: 'reload',
    });
    await session.performAction('scout', 1, {});
    const seatState = ref(session.buildPlayerState(1, { includeActionMetadata: true }));
    const { wiring, wrapper } = mountTableWiring({
      session: () => session,
      seat: 1,
      seatState,
      boardInteraction: createBoardInteraction(),
      autoEndTurn: false,
      withPickStep: true,
    });
    mounted = wrapper;
    await settle();
    const { controller } = wiring;
    expect(controller.currentAction.value).toBe('loot');

    controller.cancel();
    seatState.value = session.buildPlayerState(1, { includeActionMetadata: true });
    await settle();
    expect(controller.currentAction.value).toBe(null);
    expect(seatState.value.availableActions).toEqual([]);
    expect(controller.heldFollowUp.value?.action).toBe('loot');

    await controller.resumeFollowUp();
    expect(controller.currentAction.value).toBe('loot');
    await controller.fill('where', 'north');
    await settle();
    await controller.fill('what', 'gold');
    await settle();

    expect(session.runner.getFlowState()?.currentPlayer).toBe(2);
    expect(session.runner.actionHistory.map((a) => `${a.name}:${a.player}`)).toEqual(['scout:1', 'loot:1']);
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
