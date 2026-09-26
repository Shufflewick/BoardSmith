/**
 * ShufflewickPub #521 through the HOST CORE: `ResidentWorld` over the memory
 * store, the loop `boardsmith dev` and a test both run.
 *
 * `notice-box.test.ts` pins what the engine answers. This pins what a host
 * does with it: the box lands in the checkpoint's own write, a refused command
 * leaves every box as it was, the arrival hook moves a seat's notices into its
 * state, and `TestWorld.noticeBox` shows a game's own tests what is waiting.
 */
import { describe, expect, it } from 'vitest';
import { Game, Space, type GameElement, type GameOptions } from '../engine/index.js';
import { worldAction, worldClockAction, type WorldRunnerOptions } from '../world/index.js';
import { createTestWorld } from './test-world.js';

class Den extends Space<Pack> {
  log: string[] = [];
}

class Pack extends Game<Pack> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Den]);
  }
}

const den = (seat: number): string => `den:${seat}`;

/** Every other seat is told; nobody's den is loaded. */
const howl = worldAction<Pack>('howl')
  .needs(({ player }) => [den(player.seat)])
  .execute((_args, { world, player }) => {
    (world.partition(den(player.seat)) as Den).log.push('howled');
    for (let seat = 1; seat <= 3; seat++) {
      if (seat === player.seat) continue;
      world.notify(seat, { payload: { from: player.seat }, line: `Seat ${player.seat} howls.`, whenFull: 'dropOldest' });
    }
  });

/** A letter to seat 3, refused if seat 3's box is full. */
const letter = worldAction<Pack>('letter')
  .needs(({ player }) => [den(player.seat)])
  .noticeBox(() => 3)
  .execute((_args, { world, player }) => {
    (world.partition(den(player.seat)) as Den).log.push('wrote');
    world.notify(3, { payload: 'letter', line: 'A letter.', whenFull: 'refuse' });
  });

/** The arrival hook: what was waiting moves into the arriving seat's den. */
const arrive = worldClockAction<Pack>('arrive')
  .needs(({ args }) => [den(Number(args.seat))])
  .noticeBox(({ args }) => Number(args.seat))
  .execute((args, { world }) => {
    const log = (world.partition(den(Number(args.seat))) as Den).log;
    for (const entry of world.takeNotices(Number(args.seat)).entries) log.push(entry.text ?? '');
  });

const definition = {
  gameClass: Pack,
  gameType: 'pack',
  world: {
    maxPlayers: 3,
    notices: { perSeat: 2 },
    actions: [howl, letter, arrive],
    presence: { onArrive: 'arrive' },
    genesis: (game: Game) =>
      Object.fromEntries(
        [1, 2, 3].map((seat) => [den(seat), game.create(Den, `den${seat}`)]),
      ) as Record<string, GameElement>,
    view: (seat: number) => [den(seat)],
  },
} as WorldRunnerOptions['definition'];

async function denLog(world: Awaited<ReturnType<typeof createTestWorld>>, seat: number) {
  const view = await world.getPlayerView(seat);
  return JSON.stringify(view.state);
}

describe('#521 — a host keeps each seat a notice box beside the partitions', () => {
  it('lands a notice in the recipient box with the command that sent it', async () => {
    const world = await createTestWorld({ definition });
    await world.take(1, 'howl');

    expect(world.noticeBox(2).entries.map((entry) => entry.text)).toEqual(['Seat 1 howls.']);
    expect(world.noticeBox(3).entries.map((entry) => entry.text)).toEqual(['Seat 1 howls.']);
    expect(world.noticeBox(1)).toEqual({ entries: [], dropped: 0 });
    await world.close();
  });

  it('drops the oldest past the limit and counts it, for a dropOldest notice', async () => {
    const world = await createTestWorld({ definition });
    await world.take(1, 'howl');
    await world.take(2, 'howl');
    await world.take(1, 'howl');

    const box = world.noticeBox(3);
    expect(box.entries.map((entry) => entry.text)).toEqual(['Seat 2 howls.', 'Seat 1 howls.']);
    expect(box.dropped).toBe(1);
    await world.close();
  });

  it('refuses a letter to a full box and leaves the world and every box as they were', async () => {
    const world = await createTestWorld({ definition });
    await world.take(1, 'howl');
    await world.take(2, 'howl');
    const before = world.noticeBox(3);

    await expect(world.take(1, 'letter')).rejects.toMatchObject({ code: 'notice-box-full' });
    expect(world.noticeBox(3)).toEqual(before);
    expect(await denLog(world, 1)).not.toContain('wrote');
    await world.close();
  });

  it('moves what was waiting into the arriving seat state and empties the box', async () => {
    const world = await createTestWorld({ definition });
    await world.take(1, 'howl');
    await world.arrive(2);

    expect(world.noticeBox(2)).toEqual({ entries: [], dropped: 0 });
    expect(await denLog(world, 2)).toContain('Seat 1 howls.');
    await world.close();
  });
});
