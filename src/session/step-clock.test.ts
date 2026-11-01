import { describe, it, expect } from 'vitest';
import { executeOp } from './stateless-ops.js';
import type { GameStateSnapshot } from '../engine/utils/index.js';
import { createHeadlessSession } from '../testing/headless-session.js';
import { succeeded, refused } from './op-result.test-helper.js';
import { boundaryKeyOf } from './testing/boundary-stamp.js';
import { PLAYBACK_MS, PlaybackGame, playbackDefinition } from './testing/fixtures/timed-step-fixture.js';

/**
 * The host stamps each op with its instant (`hostOptions.now`, #1532), and the
 * game's rules measure the open timed step against it: the offer each seat is
 * sent and the refusal of a submission agree, and a snapshot carried from one
 * op to the next measures from the moment the step opened.
 */

const gameOptions = { playerCount: 2, seed: 'step-clock-session' };
const START = 1_700_000_000_000;
const REASON = 'The battle is still playing back.';

type View = { state: { disabledActions?: Record<string, string> } };

function levelUp(snapshot: GameStateSnapshot, now: number) {
  return executeOp(playbackDefinition, gameOptions, snapshot, null, {
    type: 'action',
    actionName: 'levelUp',
    player: 1,
    args: {},
    boundaryKey: boundaryKeyOf(snapshot),
  }, { now });
}

describe('executeOp hostOptions.now', () => {
  it('offers the action greyed at the instant the step opened', async () => {
    const started = succeeded(await executeOp(playbackDefinition, gameOptions, null, null, { type: 'start' }, { now: START }));
    expect((started.playerViews[0] as View).state.disabledActions).toEqual({ levelUp: REASON });
  });

  it('refuses the submission before the playback ends and lands it after, across op snapshots', async () => {
    const started = succeeded(await executeOp(playbackDefinition, gameOptions, null, null, { type: 'start' }, { now: START }));

    const early = refused(await levelUp(started.snapshot, START + PLAYBACK_MS - 1));
    expect(early.error).toContain(REASON);

    const landed = succeeded(await levelUp(started.snapshot, START + PLAYBACK_MS));
    expect((landed.playerViews[0] as View).state.disabledActions).toBeUndefined();
  });

  it('refuses to run a game that reads the step clock when the host stamped no instant, saying how to stamp one', async () => {
    const failed = refused(await executeOp(playbackDefinition, gameOptions, null, null, { type: 'start' }));
    expect(failed.error).toContain('hostOptions.now');
  });
});

describe('createHeadlessSession now', () => {
  it('stamps every op from the clock it is given', async () => {
    let now = START;
    const session = createHeadlessSession(playbackDefinition, { ...gameOptions, now: () => now });
    await session.start();
    expect((session.broadcasts.at(-1) as View[])[0].state.disabledActions).toEqual({ levelUp: REASON });

    now = START + PLAYBACK_MS;
    const key = session.metas.at(-1)!.turnBoundary.key;
    succeeded(await session.send(1, { type: 'action', actionName: 'levelUp', player: 1, args: {}, boundaryKey: key }));
  });

  it('lets a bot seat search a game that reads the step clock, at the instant of the op', async () => {
    const definition = { ...playbackDefinition, gameClass: PlaybackGame };
    const session = createHeadlessSession(definition, { ...gameOptions, now: () => START }, [{ seat: 2, level: 'easy' }]);
    await session.start();
    await session.send(1, { type: 'action', actionName: 'commit', player: 1, args: {} });

    // The bot committed in this round and the next, never levelling up: it was greyed at the instant it searched.
    expect(session.readGame().commits).toBe(3);
    expect(session.readGame().levelUps).toBe(0);
  });
});
