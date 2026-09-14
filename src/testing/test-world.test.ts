/**
 * `TestWorld`: constructing and driving a resident world from a test (#262).
 *
 * The claims here are the ones a game author depends on the moment they write
 * a world's first test:
 *
 *   1. A world is LAUNCHED by construction -- genesis has run and every seat is
 *      on the roster, because a harness whose easy path leaves an empty world
 *      is a harness that teaches the wrong habit.
 *   2. A seat's frame is the PRUNED one: the commons and its own vault, and no
 *      trace anywhere of another seat's. This is the thing a table game cannot
 *      produce and the thing the DOM gate needs.
 *   3. The world can be DRIVEN -- an offer taken changes what the next frame
 *      says, and only for the seat it was about.
 *   4. A world has no turn, so `isMyTurn` is "this seat holds an offer it can
 *      take", and it moves when the offer does.
 *   5. The clock is a test's to move, and what falls due runs at its own due.
 *   6. `unredactedElements` is the whole world, which is what the gate diffs a
 *      frame against.
 */
import { describe, it, expect } from 'vitest';
import { createTestWorld, TestWorld } from './test-world.js';
import {
  codewordOf,
  SEATS,
  vaultBundle,
  vaultWorldBlock,
  VaultWorld,
  type Vault,
} from './test-world.test-helper.js';
import { worldAction, worldClockAction, type WorldDefinition } from '../world/index.js';

const bundle = (world?: WorldDefinition) => ({ ...vaultBundle(), ...(world ? { world } : {}) });

/** Everything a frame carries, as one string. What a leak scan would search,
 *  and what a claim about absence has to be made against. */
const bytesOf = (value: unknown): string => JSON.stringify(value);

describe('TestWorld: a resident world a test can construct', () => {
  it('is launched and seated by the time `createTestWorld` resolves', async () => {
    const world = await createTestWorld({ definition: bundle() });

    expect(world.seatCount).toBe(SEATS);
    // Genesis ran: there is a world to look at, rather than a store waiting to
    // be told to launch.
    const view = await world.getPlayerView(1);
    expect(bytesOf(view.state)).toContain('The commons is quiet.');
    // And every seat is on the durable roster, so every seat has a view.
    for (let seat = 1; seat <= SEATS; seat++) {
      await expect(world.getPlayerView(seat)).resolves.toBeDefined();
    }
    await world.close();
  });

  it('projects the pruned per-seat frame: my vault and the commons, nobody else’s', async () => {
    const world = await createTestWorld({ definition: bundle() });

    const mine = await world.getPlayerView(2);
    const bytes = bytesOf(mine.state);

    expect(bytes).toContain(codewordOf(2));
    // THE CLAIM THAT ONLY A WORLD CAN MAKE: another seat's room is not redacted
    // in this frame, it is ABSENT from it -- the projection never named it.
    expect(bytes).not.toContain(codewordOf(1));
    expect(bytes).not.toContain(codewordOf(3));
    expect(bytes).not.toContain('vault-1');

    await world.close();
  });

  it('drives the world forward: an offer taken moves that seat’s frame and no other', async () => {
    const world = await createTestWorld({ definition: bundle() });

    expect((await world.getPlayerView(1)).offers.map((offer) => offer.name)).toEqual(
      expect.arrayContaining(['stash', 'post']),
    );

    await world.take(1, 'stash');
    await world.take(1, 'stash');

    expect(coinsIn(await world.getPlayerView(1))).toBe(2);
    // Seat 2's own vault is untouched, and seat 2 never sees seat 1's.
    expect(coinsIn(await world.getPlayerView(2))).toBe(0);

    // A shared room moves for everybody.
    await world.take(3, 'post');
    expect(bytesOf((await world.getPlayerView(1)).state)).toContain('Seat 3 was here.');

    await world.close();
  });

  it('raises the world’s own refusal when a seat takes something it cannot', async () => {
    const world = await createTestWorld({ definition: bundle() });
    await expect(world.take(1, 'no-such-verb')).rejects.toThrow(/no-such-verb/);
    await world.close();
  });

  it('moves the revision when a command commits, so a frame can be placed in time', async () => {
    const world = await createTestWorld({ definition: bundle() });
    const before = (await world.getPlayerView(1)).revision;
    await world.take(1, 'stash');
    expect((await world.getPlayerView(1)).revision).toBe(before + 1);
    await world.close();
  });

  it('reports a disabled offer the way the world shell does: on the panel, with its reason', async () => {
    // A WORLD HAS NO TURN, so `isMyTurn` is the shell's `mayAct` -- seated and
    // listening -- and it stays true even when every verb is shut. Whether a
    // verb can actually be taken travels separately, which is what the panel
    // greys and what `canAct` answers.
    const locked = worldAction<VaultWorld>('locked')
      .prompt('A verb nobody may take yet')
      .needs(() => ['commons'])
      .disabled(() => 'The vault door is shut.')
      .execute(() => {});
    const world = await createTestWorld({
      definition: bundle({ ...vaultWorldBlock(), actions: [locked] } as WorldDefinition),
    });

    const view = await world.getPlayerView(1);
    expect(view.offers.map((offer) => offer.name)).toEqual(['locked']);
    // On the panel, as the shell puts it there, with the reason beside it.
    expect(view.availableActions).toEqual(['locked']);
    expect(view.disabledActions).toEqual({ locked: 'The vault door is shut.' });
    expect(view.canAct).toBe(false);
    expect(view.isMyTurn).toBe(true);

    await world.close();
  });

  it('runs what falls due when the test moves the clock, at its own due time', async () => {
    let ranAt: number[] = [];
    const tickWorld = timedVaultWorld(() => ranAt);
    const world = await createTestWorld({ definition: bundle(tickWorld), now: 1_000 });

    await world.take(1, 'arm');
    ranAt = [];
    expect(ranAt).toEqual([]);

    // Not yet due: the clock moved, nothing fired.
    await world.advanceClock(4_000);
    expect(ranAt).toEqual([]);

    // Due: it runs, and its handler is told ITS OWN due rather than the instant
    // the clock happened to arrive at.
    await world.advanceClock(2_000);
    expect(ranAt).toEqual([1_000 + 5_000]);

    await world.close();
  });

  it('answers the whole world for `unredactedElements`, which no single seat can see', async () => {
    const world = await createTestWorld({ definition: bundle() });
    const bytes = bytesOf(await world.unredactedElements());

    for (let seat = 1; seat <= SEATS; seat++) expect(bytes).toContain(codewordOf(seat));

    await world.close();
  });

  it('survives a wake: everything on the next frame came back out of the store', async () => {
    const world = await createTestWorld({ definition: bundle() });
    await world.take(2, 'stash');
    await world.wake();

    const view = await world.getPlayerView(2);
    expect(coinsIn(view)).toBe(1);
    expect(bytesOf(view.state)).toContain(codewordOf(2));

    await world.close();
  });
});

/** How many coins this frame says are in the seat's own vault. */
function coinsIn(view: { state: unknown }): number {
  const found = JSON.stringify(view.state).match(/"tally":"(\**)"/);
  return found === null ? -1 : found[1]!.length;
}

/** The vault world plus one armable beat, for the clock case. `ranAt` is read
 *  lazily so the handler reports into whichever array the test is holding. */
function timedVaultWorld(ranAt: () => number[]): WorldDefinition {
  const base = vaultWorldBlock();
  const arm = worldAction<VaultWorld>('arm')
    .prompt('Arm a beat')
    .needs(() => ['commons'])
    .execute((_args, ctx) => {
      ctx.world.schedule({ delayMs: 5_000, action: 'tick', args: {} });
    });
  const tick = worldClockAction<VaultWorld>('tick')
    .prompt('The beat')
    .needs(() => ['commons'])
    .execute((_args, ctx) => {
      ranAt().push(ctx.world.now);
    });
  return { ...base, actions: [...base.actions, arm, tick] } as WorldDefinition;
}

/** Named so the class import above is not type-only, which would make the
 *  fixture's element registration invisible to a reader. */
export type { TestWorld, Vault };
