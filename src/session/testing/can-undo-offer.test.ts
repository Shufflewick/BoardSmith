/**
 * #373: THE UNDO A SEAT IS OFFERED IS THE UNDO THE SERVER WILL TAKE.
 *
 * `canUndo` in a seat's state drives the Undo button and the "Undo last action"
 * menu item. It used to be computed from turn eligibility alone, so a game whose
 * checkpoint or undo policy refuses the undo still showed an enabled control,
 * and every click came back as an error. Each case below reads `canUndo` from
 * the state a seat is actually sent, then sends the undo, and requires the two
 * to agree: offered means it succeeds, not offered means it is refused.
 *
 * The stateless executor (`executeOp`, the path the platform and `boardsmith
 * dev` run) is driven through `createHeadlessSession`, and the stateful
 * `GameSession` through its own undo.
 */
import { describe, expect, it } from 'vitest';

import type { GameDefinitionLike } from '../stateless-ops.js';
import { createHeadlessSession, type HeadlessOp } from '../headless-session.js';
import { GameSession } from '../game-session.js';
import type { PlayerGameState } from '../types.js';
import {
  ScumGame,
  fencedScumDefinition,
  fencedSimulScumDefinition,
  fencedUncheckpointedScumDefinition,
  uncheckpointedScumDefinition,
  unfencedScumDefinition,
} from './fixtures/random-scumming-fixture.js';
import { undoFenceFixtureDefinition } from './fixtures/undo-fence-fixture.js';
import { executeBarrierFixtureDefinition } from './fixtures/execute-barrier-fixture.js';

/** Keeps one checkpoint, so a turn two actions long has none at its start. */
const shortWindowDefinition: GameDefinitionLike = {
  ...unfencedScumDefinition,
  gameType: 'scum-short-window',
  checkpoints: { max: 1 },
};

/**
 * A stateless session through `createHeadlessSession`, which runs the real
 * `executeOp` and clones every broadcast as the production boundary would.
 */
function statelessSession(def: GameDefinitionLike, gameOptions: { playerCount: number; seed: string }) {
  const session = createHeadlessSession(def, gameOptions);
  return {
    start: () => session.start(),
    /** The state seat `seat` was last broadcast. */
    stateOf(seat: number): PlayerGameState {
      const views = session.broadcasts.at(-1) as Array<{ state: PlayerGameState }>;
      return views[seat - 1].state;
    },
    send: (seat: number, op: HeadlessOp) => session.send(seat, op),
  };
}

type Session = ReturnType<typeof statelessSession>;

async function play(s: Session, seat: number, ...actions: string[]) {
  for (const actionName of actions) {
    const res = await s.send(seat, { type: 'action', actionName, player: seat, args: {} });
    expect(res.success, `${actionName} by seat ${seat}: ${res.error}`).toBe(true);
  }
}

/** The offer and the outcome must agree, and the offer must be `offered`. */
async function expectOfferMatchesUndo(s: Session, seat: number, offered: boolean) {
  expect(s.stateOf(seat).canUndo).toBe(offered);
  const undo = await s.send(seat, { type: 'undo', player: seat });
  expect(undo.success, undo.error).toBe(offered);
}

const solo = { playerCount: 1, seed: 'can-undo' };

describe('#373: canUndo agrees with the undo it offers (stateless executor)', () => {
  it('CONTROL: a game with no policy offers the undo, and it succeeds', async () => {
    const s = statelessSession(unfencedScumDefinition, solo);
    await s.start();
    await play(s, 1, 'gamble');
    await expectOfferMatchesUndo(s, 1, true);
  });

  it('does not offer an undo when the game turns checkpoints off', async () => {
    const s = statelessSession(uncheckpointedScumDefinition, solo);
    await s.start();
    await play(s, 1, 'move');
    await expectOfferMatchesUndo(s, 1, false);
  });

  it('does not offer an undo across a random draw when the game fences it', async () => {
    const s = statelessSession(fencedScumDefinition, solo);
    await s.start();
    await play(s, 1, 'move', 'gamble');
    await expectOfferMatchesUndo(s, 1, false);
  });

  it('still offers an undo the random fence does not cover', async () => {
    const s = statelessSession(fencedScumDefinition, solo);
    await s.start();
    await play(s, 1, 'move', 'note');
    await expectOfferMatchesUndo(s, 1, true);
  });

  it('does not offer an undo when the fenced game keeps no checkpoints', async () => {
    const s = statelessSession(fencedUncheckpointedScumDefinition, solo);
    await s.start();
    await play(s, 1, 'move');
    await expectOfferMatchesUndo(s, 1, false);
  });

  it("does not offer an undo whose turn start has fallen out of the game's checkpoint window", async () => {
    const s = statelessSession(shortWindowDefinition, solo);
    await s.start();
    await play(s, 1, 'move', 'note');
    await expectOfferMatchesUndo(s, 1, false);
  });

  it('does not offer an undo across a seat-drawn random value in a simultaneous step', async () => {
    const s = statelessSession(fencedSimulScumDefinition, { playerCount: 2, seed: 'simul' });
    await s.start();
    await play(s, 2, 'note', 'gamble');
    await expectOfferMatchesUndo(s, 2, false);
  });

  it('does not offer an undo across a notUndoable action', async () => {
    const s = statelessSession(undoFenceFixtureDefinition, { playerCount: 2, seed: 'lock' });
    await s.start();
    await play(s, 1, 'play', 'lock');
    await expectOfferMatchesUndo(s, 1, false);
  });

  it('does not offer an undo that would cross an irreversible execute()', async () => {
    const s = statelessSession(executeBarrierFixtureDefinition, solo);
    await s.start();
    await play(s, 1, 'act1', 'act2', 'act2');
    await expectOfferMatchesUndo(s, 1, false);
  });
});

describe('#373: canUndo agrees with the undo it offers (stateful GameSession)', () => {
  function session(policy: Pick<GameDefinitionLike, 'checkpoints' | 'undo'>) {
    return GameSession.create<ScumGame>({
      gameType: 'scum',
      GameClass: ScumGame,
      playerCount: 1,
      playerNames: ['Solo'],
      seed: 'can-undo',
      ...policy,
    });
  }

  async function expectSessionOffer(s: GameSession<ScumGame>, offered: boolean) {
    expect(s.buildPlayerState(1).canUndo).toBe(offered);
    const undo = await s.undoToTurnStart(1);
    expect(undo.success, undo.error).toBe(offered);
  }

  it('CONTROL: a game with no policy offers the undo, and it succeeds', async () => {
    const s = session({});
    expect((await s.performAction('gamble', 1, {})).success).toBe(true);
    await expectSessionOffer(s, true);
  });

  it('does not offer an undo when the game turns checkpoints off', async () => {
    const s = session({ checkpoints: { enabled: false } });
    expect((await s.performAction('move', 1, {})).success).toBe(true);
    await expectSessionOffer(s, false);
  });

  it('does not offer an undo across a random draw when the game fences it', async () => {
    const s = session({ undo: { fenceRandomRewind: true } });
    expect((await s.performAction('gamble', 1, {})).success).toBe(true);
    await expectSessionOffer(s, false);
  });
});
