/**
 * A PLATFORM REFUSAL CANNOT BE CAUGHT AWAY (BoardSmith #288).
 *
 * "A command declares its partitions from its arguments and seat alone" is a
 * hard constraint, and the engine enforces it by refusing a reach into a
 * partition the command did not declare. In sotf (Shufflewick/sotf#35) the
 * rules wrapped that reach in a try/catch, carried on, and the command
 * succeeded: the refusal was recorded and then ignored because the action
 * reported success. A constraint the rules can catch is not enforced, so a
 * refusal a facility raised now refuses the command whether or not the rules
 * caught it.
 */
import { describe, expect, it } from 'vitest';
import { Game, Player, Space, type GameOptions } from '../engine/index.js';
import { worldAction, type WorldDefinition } from './index.js';
import { createTestWorld } from '../testing/test-world.js';

class Room extends Space<PeekWorld> {
  // fallow-ignore-next-line unused-class-member
  visits = '';
}

class PeekWorld extends Game<PeekWorld, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Room]);
  }
}

const roomOf = (seat: number): string => `room:${seat}`;

/** Declares only the acting seat's room, then reaches the neighbour's and
 *  swallows the refusal before writing to its own room. */
const peek = worldAction<PeekWorld>('peek')
  .prompt('Peek next door')
  .needs((ctx) => [roomOf(ctx.player.seat)])
  .execute((_args, ctx) => {
    try {
      ctx.world.partition(roomOf(ctx.player.seat === 1 ? 2 : 1));
    } catch {
      // The pattern under test: the rules treat the refusal as control flow.
    }
    const own = ctx.world.partition(roomOf(ctx.player.seat)) as Room;
    own.visits += '*';
  });

function peekBundle() {
  const world: WorldDefinition = {
    maxPlayers: 2,
    actions: [peek],
    view: (seat: number) => [roomOf(seat)],
    genesis: (game: Game) => ({
      [roomOf(1)]: game.create(Room, 'room-1'),
      [roomOf(2)]: game.create(Room, 'room-2'),
    }),
  } as WorldDefinition;
  return { gameClass: PeekWorld, gameType: 'peek-world', displayName: 'Peek World', world };
}

describe('a refusal the rules caught still refuses the command', () => {
  it('refuses with undeclared-partition and leaves the world unchanged', async () => {
    const world = await createTestWorld({ definition: peekBundle() });

    await expect(world.take(1, 'peek')).rejects.toMatchObject({ code: 'undeclared-partition' });

    const state = JSON.stringify((await world.getPlayerView(1)).state);
    expect(state).not.toContain('*');
    await world.close();
  });
});
