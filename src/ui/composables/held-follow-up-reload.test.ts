// @vitest-environment jsdom
/**
 * A page that reloads while its seat holds a follow-up picks it back up (#494).
 *
 * A follow-up reaches the client in the result of the action that returned it.
 * A page that never saw that result, because it reloaded, would otherwise show
 * a seat the flow is holding for its follow-up with nothing to do. The seat's
 * own published state carries the follow-up, and the table wiring starts it.
 *
 * Drives the live session host: the seat acts through the table directly (the
 * result goes nowhere), then a fresh table is mounted on the seat's state.
 *
 * A page that reloads part way through an action the server holds for its seat
 * starts that action again, and finishes it with the picks made on the new page
 * (#1556).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ref } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import { Game, Player, Action, loop, eachPlayer, actionStep, type GameOptions } from '../../engine/index.js';
import { historyLabels } from '../../session/testing/history-labels.js';
import { createBoardInteraction } from './useBoardInteraction.js';
import { mountTableWiring, settle, startTable } from './table-wiring.test-helper.js';

class ScoutGame extends Game<ScoutGame, Player> {
  scouted: number[] = [];
  looted: string[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      // Once per seat, so after scouting the step offers the seat nothing else.
      Action.create<ScoutGame>('scout')
        .prompt('Scout')
        .condition({ 'has not scouted': (ctx) => !(ctx.game as ScoutGame).scouted.includes(ctx.player.seat) })
        .chooseFrom('then', { choices: ['loot', 'haul'], optional: true })
        .execute((args, ctx) => {
          (ctx.game as ScoutGame).scouted.push(ctx.player.seat);
          return { success: true, followUp: { action: args.then === 'haul' ? 'haul' : 'loot', args: { by: ctx.player.seat } } };
        }),
      Action.create<ScoutGame>('loot')
        .prompt('Loot')
        .chooseFrom('where', { choices: ['north', 'south'] })
        .chooseFrom('what', { choices: ['gold', 'gems'] })
        .execute((args, ctx) => { (ctx.game as ScoutGame).looted.push(`${String(args.where)} ${String(args.what)}`); }),
      // Not offered by the flow: started by a test seat that already scouted.
      Action.create<ScoutGame>('haul')
        .prompt('Haul')
        .chooseFrom('cart', { choices: ['small', 'big'] })
        .chooseFrom('loads', { choices: ['gold', 'gems', 'done'], repeat: { until: (_ctx, load) => load === 'done' } })
        .execute((args, ctx) => {
          (ctx.game as ScoutGame).looted.push(`${String(args.cart)} ${(args.loads as string[]).join(' ')}`);
        }),
    );
    this.setFlow({
      root: loop({ maxIterations: 2, while: (ctx) => (ctx.game as ScoutGame).scouted.length < 2, do: eachPlayer({ do: actionStep({ actions: ['scout'], turnScope: 'restart' }) }) }),
    });
  }
}

/** Offers `haul` itself, so a page makes its plain pick locally and sends it with the repeating pick's first step. */
class HaulGame extends Game<HaulGame, Player> {
  hauled: string[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<HaulGame>('haul')
        .prompt('Haul')
        .chooseFrom('cart', { choices: ['small', 'big'] })
        .chooseFrom('loads', { choices: ['gold', 'gems', 'done'], repeat: { until: (_ctx, load) => load === 'done' } })
        .execute((args, ctx) => {
          (ctx.game as HaulGame).hauled.push(`${String(args.cart)} ${(args.loads as string[]).join(' ')}`);
        }),
    );
    this.setFlow({ root: actionStep({ actions: ['haul'], player: (ctx) => ctx.game.getPlayer(1)! }) });
  }
}

let mounted: VueWrapper | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

describe('a reloaded page resumes the follow-up its seat holds', () => {
  it('starts it from the seat state, with its pre-filled args', async () => {
    const session = await startTable(ScoutGame, 'reload');
    expect((await session.send(1, { type: 'action', actionName: 'scout', player: 1, args: {} })).success).toBe(true);

    const seatState = ref(session.playerState(1));
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
    const session = await startTable(ScoutGame, 'reload');
    await session.send(1, { type: 'action', actionName: 'scout', player: 1, args: {} });
    const seatState = ref(session.playerState(1));
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
    seatState.value = session.playerState(1);
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

    expect(session.host.flowState?.currentPlayer).toBe(2);
    const history = await session.send(1, { type: 'debugHistory' });
    if (!history.success) throw new Error(history.error);
    expect(historyLabels(history.actionHistory)).toEqual(['scout:1', 'loot:1']);
  });

  /** Seat 1's page after it scouted into `followUp`, wired with the selection-step transport. */
  async function scoutedPage<G extends Game>(session: Awaited<ReturnType<typeof startTable<G>>>) {
    const seatState = ref(session.playerState(1));
    const { wiring, wrapper } = mountTableWiring({
      session: () => session,
      seat: 1,
      seatState,
      boardInteraction: createBoardInteraction(),
      autoEndTurn: false,
      withPickStep: true,
    });
    mounted?.unmount();
    mounted = wrapper;
    await settle();
    return { controller: wiring.controller, seatState };
  }

  it('a page reloaded part way through the follow-up starts it again and finishes it with its new picks (#1556)', async () => {
    const session = await startTable(ScoutGame, 'reload');
    await session.send(1, { type: 'action', actionName: 'scout', player: 1, args: {} });
    const before = await scoutedPage(session);
    await before.controller.fill('where', 'north');
    await settle();
    expect(session.playerState(1).pendingAction?.heldPicks).toContain('where');

    const { controller } = await scoutedPage(session);
    expect(controller.currentAction.value).toBe('loot');
    await controller.fill('where', 'south');
    await settle();
    expect(controller.lastError.value).toBe(null);
    await controller.fill('what', 'gold');
    await settle();

    expect(controller.lastError.value).toBe(null);
    expect(session.readGame().looted).toEqual(['south gold']);
  });

  it('a page reloaded part way through a repeating pick starts the action again, dropping the loads it no longer shows (#1556)', async () => {
    const session = await startTable(ScoutGame, 'reload');
    await session.send(1, { type: 'action', actionName: 'scout', player: 1, args: { then: 'haul' } });
    const before = await scoutedPage(session);
    expect(before.controller.currentAction.value).toBe('haul');
    await before.controller.fill('cart', 'small');
    await settle();
    await before.controller.fill('loads', 'gold');
    await settle();
    expect(session.playerState(1).pendingAction?.repeating?.iterationCount).toBe(1);

    const { controller } = await scoutedPage(session);
    await controller.fill('cart', 'big');
    await settle();
    await controller.fill('loads', 'gems');
    await settle();
    await controller.fill('loads', 'done');
    await settle();

    expect(controller.lastError.value).toBe(null);
    expect(session.readGame().looted).toEqual(['big gems done']);
  });

  it('a page reloaded part way through a repeating pick it was offered starts it again, keeping no load from before (#1556)', async () => {
    const session = await startTable(HaulGame, 'reload');
    const before = await scoutedPage(session);
    await before.controller.start('haul');
    await before.controller.fill('cart', 'small');
    await before.controller.fill('loads', 'gold');
    await settle();
    expect(session.playerState(1).pendingAction?.repeating?.iterationCount).toBe(1);

    const { controller } = await scoutedPage(session);
    await controller.start('haul');
    await controller.fill('cart', 'small');
    await controller.fill('loads', 'gems');
    await settle();
    await controller.fill('loads', 'done');
    await settle();

    expect(controller.lastError.value).toBe(null);
    expect(session.readGame().hauled).toEqual(['small gems done']);
  });

  it('starts nothing for a seat that holds no follow-up', async () => {
    const session = await startTable(ScoutGame, 'reload');
    await session.send(1, { type: 'action', actionName: 'scout', player: 1, args: {} });

    const seatState = ref(session.playerState(2));
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
