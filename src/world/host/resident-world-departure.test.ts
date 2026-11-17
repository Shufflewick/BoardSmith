// A DEPARTED SEAT COMES BACK CLEAN (ShufflewickPub #813).
//
// The game's `world.vacate` hook decides what becomes of the holdings; the
// engine then clears the seat's Player element and frees the chair, in the same
// dispatch, so a host can neither free a chair the hook has not run for nor
// hand a newcomer what the last player left on it.
import { expect, it } from 'vitest';

import { Game, Player, PlayerFacingError, Space, type GameOptions } from '../../engine/index.js';
import { worldAction, worldBudgets, type WorldDefinition } from '../index.js';
import { ResidentWorld, type WorldStore } from './index.js';
import { createMemoryWorldStore } from '../../testing/memory-world-store.js';
import { TEST_WORLD_ELEMENT_ID_KEY } from '../../engine/element/world-element-id-key.test-helper.js';

class Wanderer extends Player<Hall, Wanderer> {
  purse = 0;
}

class Den extends Space<Hall> {
  hoard = 0;
  locked = false;
}

class Hall extends Game<Hall, Wanderer> {
  static override PlayerClass = Wanderer;
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Den]);
  }
}

const den = (seat: number): string => `den:${seat}`;
const denOf = (ctx: { world: { partition(name: string): unknown }; player: Wanderer }): Den =>
  ctx.world.partition(den(ctx.player.seat)) as Den;

/** Leaves something of this player on the seat's Player element and in its den. */
const earn = worldAction<Hall>('earn')
  .needs(({ player }) => [den(player.seat)])
  .execute((_args, ctx) => {
    ctx.player.purse += 5;
    ctx.player.status = 'eliminated';
    ctx.player.color = '#000000';
    Object.assign(ctx.player, { title: 'Baron' });
    denOf(ctx).hoard += 5;
  });

const lock = worldAction<Hall>('lock')
  .needs(({ player }) => [den(player.seat)])
  .execute((_args, ctx) => {
    denOf(ctx).locked = true;
  });

/** What this seat's holder sees of their own Player and den. */
const tell = worldAction<Hall>('tell')
  .needs(({ player }) => [den(player.seat)])
  .execute((_args, ctx) => {
    ctx.world.emit(den(ctx.player.seat), {
      purse: ctx.player.purse,
      status: ctx.player.status,
      color: ctx.player.color ?? null,
      title: (ctx.player as Wanderer & { title?: string }).title ?? null,
      hoard: denOf(ctx).hoard,
    });
  });

/** THE HOOK. It gives the den back and leaves the Player element alone. */
const leave = worldAction<Hall>('leave')
  .needs(({ player }) => [den(player.seat)])
  .execute((_args, ctx) => {
    if (denOf(ctx).locked) throw new PlayerFacingError('Your den is locked, so you cannot leave yet.');
    denOf(ctx).hoard = 0;
  });

function hallBundle() {
  const world: WorldDefinition = {
    maxPlayers: 2,
    actions: [earn, lock, tell, leave],
    view: (seat: number) => [den(seat)],
    vacate: 'leave',
    genesis: (game: Game) => {
      const roots: Record<string, Den> = {};
      for (const seat of [1, 2]) {
        const room = game.create(Den, `den-${seat}`);
        // A REFERENCE TO THE CHAIR, which is handed on with it.
        room.player = game.getPlayer(seat);
        roots[den(seat)] = room;
      }
      return roots;
    },
  };
  return { gameClass: Hall, gameType: 'hall', displayName: 'Hall', world };
}

async function openHall(wrap: (store: WorldStore) => WorldStore = (store) => store) {
  const budgets = worldBudgets();
  const store = wrap(createMemoryWorldStore(TEST_WORLD_ELEMENT_ID_KEY, budgets));
  const vacated: { seat: number; player: string }[] = [];
  const world = new ResidentWorld({
    definition: hallBundle() as ConstructorParameters<typeof ResidentWorld>[0]['definition'],
    seed: 'departure',
    budgets,
    store,
    clock: { now: () => 1_700_000_000_000, arm: () => {}, yieldTurn: () => Promise.resolve() },
    presence: () => [],
    mintId: () => 'unused',
    onVacated: (vacancy) => vacated.push({ ...vacancy }),
  });
  await world.start();
  let orders = 0;
  const send = async (player: string, action: string) => {
    orders += 1;
    const outcome = await world.command({ player, order: { id: `o${orders}`, at: 1_700_000_000_000 }, action });
    if (outcome.kind !== 'committed') throw new Error(`"${action}" was not committed`);
    return outcome.events;
  };
  const told = async (player: string) => (await send(player, 'tell'))[0]?.payload;
  return { world, store, vacated, send, told };
}

it('hands the next player a seat with nothing of the departed one on it, though the hook leaves the Player alone', async () => {
  const { world, store, vacated, send, told } = await openHall();
  world.seat('player-a', 1);
  const fresh = await told('player-a');
  await send('player-a', 'earn');
  expect(await told('player-a')).toMatchObject({ purse: 5, status: 'eliminated', title: 'Baron', hoard: 5 });

  await send('player-a', 'leave');

  expect(vacated).toEqual([{ seat: 1, player: 'player-a' }]);
  expect(store.seats()).toEqual([]);
  world.seat('player-b', 1);
  expect(await told('player-b')).toEqual(fresh);
  // The departed player is not in this world any more.
  await expect(send('player-a', 'tell')).rejects.toMatchObject({ code: 'unknown-player' });
  await world.close();
});

it('keeps the seat held, and not reusable, when the hook refuses', async () => {
  const { world, store, vacated, send, told } = await openHall();
  world.seat('player-a', 1);
  await send('player-a', 'earn');
  await send('player-a', 'lock');

  await expect(send('player-a', 'leave')).rejects.toThrow(/den is locked/);

  expect(vacated).toEqual([]);
  expect(store.seats().map((row) => [row.player, row.seat])).toEqual([['player-a', 1]]);
  expect(() => world.seat('player-b', 1)).toThrow(expect.objectContaining({ code: 'seat-conflict' }));
  expect(await told('player-a')).toMatchObject({ purse: 5, title: 'Baron', hoard: 5 });
  await world.close();
});

it('keeps the seat held when the host cannot finish a departure the hook ran for', async () => {
  let unreachable = false;
  const { world, store, vacated, send } = await openHall((inner) => ({
    ...inner,
    nextSeq: () => {
      if (unreachable) throw new Error('The event store did not answer.');
      return inner.nextSeq();
    },
  }));
  world.seat('player-a', 1);
  await send('player-a', 'earn');

  unreachable = true;
  await expect(send('player-a', 'leave')).rejects.toThrow(/did not answer/);
  unreachable = false;

  expect(vacated).toEqual([]);
  expect(store.seats().map((row) => [row.player, row.seat])).toEqual([['player-a', 1]]);
  expect(() => world.seat('player-b', 1)).toThrow(expect.objectContaining({ code: 'seat-conflict' }));
  await expect(send('player-a', 'tell')).resolves.toBeDefined();
  await world.close();
});
