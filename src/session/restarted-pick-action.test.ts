/**
 * A client that lost track of its seat's open pick-by-pick action (a page
 * reload, a second controller for the seat) starts that action again at its
 * first pick. The server restarts the action from that pick instead of refusing
 * it, so the player can finish it (#1556).
 *
 * Driven through a long-lived PendingActionManager and the live session host
 * (`SnapshotSessionHost` over `executeOp`), with the action both offered
 * directly and held as a follow-up, the shape MERC's hire takes.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Piece, Space, Action, actionStep, type GameOptions } from '../engine/index.js';
import { GameRunner } from '../runtime/index.js';
import { PendingActionManager } from './pending-action-manager.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import { SnapshotSessionHost } from './snapshot-session-host.js';
import { boundaryKeyOfHost } from './testing/boundary-stamp.js';
import { snapshotTree } from '../engine/utils/index.js';

class Token extends Piece<HireGame> {}
class Zone extends Space<HireGame> {}

class HireGame extends Game<HireGame, Player> {
  pool!: Zone;
  team!: Zone;
  hired: Array<Record<string, unknown>> = [];

  constructor(options: GameOptions) {
    super(options);
    this.pool = this.create(Zone, 'pool');
    this.team = this.create(Zone, 'team');
    for (const name of ['ann', 'bob']) this.pool.create(Token, name);
    const hire = (action: Action<HireGame>) =>
      action
        .chooseFrom('merc', {
          choices: ['ann', 'bob'],
          onSelect: (merc) => { this.pool.first(Token, merc as string)?.putInto(this.team); },
          onCancel: () => { for (const merc of this.team.all(Token)) merc.putInto(this.pool); },
        })
        .chooseFrom('gear', { choices: ['rifle', 'medkit'] })
        .execute((args) => { this.hired.push({ ...args }); });
    this.registerActions(
      hire(Action.create<HireGame>('hire')),
      hire(Action.create<HireGame>('hireOffer').condition({ 'only as a follow-up': () => false })),
      Action.create<HireGame>('haul')
        .chooseFrom('cart', { choices: ['small', 'big'] })
        .chooseFrom('loads', { choices: ['gold', 'gems', 'done'], repeat: { until: (_ctx, load) => load === 'done' } })
        .execute((args) => { this.hired.push({ ...args }); }),
      Action.create<HireGame>('scout').execute((_args, ctx) => ({
        success: true,
        followUp: { action: 'hireOffer', args: { by: ctx.player.seat } },
      })),
    );
    this.setFlow({
      root: actionStep({ actions: ['hire', 'haul', 'scout'], player: (ctx) => ctx.game.getPlayer(1)! }),
    });
  }
}

const options = { playerCount: 2, seed: 'i1556' };
const definition: GameDefinitionLike = { gameClass: HireGame, gameType: 'hire', minPlayers: 2, maxPlayers: 2 };

interface Table { team: string[]; pool: string[]; hired: unknown }

interface Seat {
  pick(selection: string, value: string, initialArgs?: Record<string, unknown>): Promise<{ success: boolean; error?: string; actionComplete?: boolean }>;
  table(): Table;
  /** Take `scout`, whose follow-up holds `hireOffer` for the seat. */
  scout(): Promise<{ success: boolean }>;
}

function sessionSeat(action: string): Seat {
  const runner = new GameRunner({ GameClass: HireGame, gameType: 'hire', gameOptions: options });
  runner.start();
  const manager = new PendingActionManager(runner);
  const names = (zone: Zone) => zone.all(Token).map((token) => token.name!);
  return {
    pick: (selection, value, initialArgs) => manager.processSelectionStep(1, selection, value, action, initialArgs),
    table: () => ({ team: names(runner.game.team), pool: names(runner.game.pool), hired: runner.game.hired }),
    scout: async () => runner.performAction('scout', 1, {}),
  };
}

async function hostSeat(action: string): Promise<Seat> {
  const host = new SnapshotSessionHost({
    playerCount: options.playerCount,
    executeOp: (snap, pend, op) => executeOp(definition, options, snap, pend, op),
    push: () => {},
    record: () => {},
    persist: () => {},
  });
  await host.start();
  const boundaryKey = () => boundaryKeyOfHost(host);
  return {
    pick: (selection, value, initialArgs) =>
      host.handleOp(1, { type: 'selectionStep', player: 1, selectionName: selection, value, actionName: action, initialArgs, boundaryKey: boundaryKey() }),
    table: () => {
      const tree = snapshotTree(host.snapshot!);
      const names = (zone: string) => (tree.children!.find((child) => child.name === zone)!.children ?? []).map((child) => child.name!);
      return { team: names('team'), pool: names('pool'), hired: tree.attributes.hired };
    },
    scout: () => host.handleOp(1, { type: 'action', actionName: 'scout', player: 1, args: {}, boundaryKey: boundaryKey() }),
  };
}

const routes = { session: async (action: string) => sessionSeat(action), host: hostSeat };

describe('a restarted pick-by-pick action answers its first pick again (#1556)', () => {
  for (const [name, route] of Object.entries(routes)) {
    for (const [action, followUp] of [['hire', false], ['hireOffer', true]] as const) {
      it(`restarts '${action}' from its first pick, undoing the dropped pick's onSelect, on the ${name} route`, async () => {
        const seat = await route(action);
        if (followUp) expect((await seat.scout()).success).toBe(true);
        expect((await seat.pick('merc', 'ann')).success).toBe(true);
        expect(seat.table().team).toEqual(['ann']);

        // The reloaded page starts the action again at its first pick.
        const again = await seat.pick('merc', 'bob');

        expect(again).toMatchObject({ success: true, actionComplete: false });
        expect(seat.table()).toMatchObject({ team: ['bob'], pool: ['ann'] });
        const done = await seat.pick('gear', 'medkit');
        expect(done).toMatchObject({ success: true, actionComplete: true });
        expect(seat.table().hired).toEqual([
          { merc: 'bob', gear: 'medkit', ...(followUp && { by: 1 }) },
        ]);
      });
    }

    it(`keeps the open action as it was when the restarting pick is refused, on the ${name} route`, async () => {
      const seat = await route('hire');
      expect((await seat.pick('merc', 'ann')).success).toBe(true);

      expect((await seat.pick('merc', 'zed')).success).toBe(false);

      expect(seat.table()).toMatchObject({ team: ['ann'], pool: ['bob'] });
      expect(await seat.pick('gear', 'rifle')).toMatchObject({ success: true, actionComplete: true });
      expect(seat.table().hired).toEqual([{ merc: 'ann', gear: 'rifle' }]);
    });

    it(`restarts 'haul' at its repeating pick when the step holds fewer of its answers, on the ${name} route`, async () => {
      const seat = await route('haul');
      expect((await seat.pick('loads', 'gold', { cart: 'small', loads: [] })).success).toBe(true);

      // The reloaded page made its plain pick again and starts the repeat afresh.
      expect((await seat.pick('loads', 'gems', { cart: 'big', loads: [] })).success).toBe(true);
      expect(await seat.pick('loads', 'done', { cart: 'big', loads: ['gems'] })).toMatchObject({ success: true, actionComplete: true });

      expect(seat.table().hired).toEqual([{ cart: 'big', loads: ['gems', 'done'] }]);
    });

    it(`goes on with 'haul' when the step holds every answer its repeating pick took, on the ${name} route`, async () => {
      const seat = await route('haul');
      expect((await seat.pick('loads', 'gold', { cart: 'small', loads: [] })).success).toBe(true);
      expect((await seat.pick('loads', 'gems', { cart: 'small', loads: ['gold'] })).success).toBe(true);
      expect(await seat.pick('loads', 'done', { cart: 'small', loads: ['gold', 'gems'] })).toMatchObject({ success: true, actionComplete: true });

      expect(seat.table().hired).toEqual([{ cart: 'small', loads: ['gold', 'gems', 'done'] }]);
    });
  }
});
