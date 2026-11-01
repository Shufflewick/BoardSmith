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

  it('opens the step afresh on a start from a saved position, which is a new game', async () => {
    const saved = succeeded(await executeOp(playbackDefinition, gameOptions, null, null, { type: 'start' }, { now: START }));
    const DAY = 86_400_000;
    const restarted = succeeded(await executeOp(playbackDefinition, gameOptions, null, null, { type: 'start' }, {
      now: START + DAY,
      seedSnapshot: saved.snapshot,
    }));
    expect((restarted.playerViews[0] as View).state.disabledActions).toEqual({ levelUp: REASON });
    refused(await levelUp(restarted.snapshot, START + DAY + PLAYBACK_MS - 1));
  });

  it('keeps the step open from its opening instant on a start that carries the same game (#1535)', async () => {
    const saved = succeeded(await executeOp(playbackDefinition, gameOptions, null, null, { type: 'start' }, { now: START }));
    const carried = succeeded(await executeOp(playbackDefinition, gameOptions, null, null, { type: 'start' }, {
      now: START + PLAYBACK_MS,
      seedSnapshot: saved.snapshot,
      keepStepClock: true,
    }));
    expect((carried.playerViews[0] as View).state.disabledActions).toBeUndefined();
    succeeded(await levelUp(carried.snapshot, START + PLAYBACK_MS));
  });

  it('reports on the snapshot when an offer greyed by the step clock lapses, and offers again at that instant (#1536)', async () => {
    const started = succeeded(await executeOp(playbackDefinition, gameOptions, null, null, { type: 'start' }, { now: START }));
    expect(started.snapshot.reofferAt).toBe(START + PLAYBACK_MS);

    const reoffered = succeeded(await executeOp(playbackDefinition, gameOptions, started.snapshot, null, { type: 'reoffer' }, { now: START + PLAYBACK_MS }));
    expect((reoffered.playerViews[0] as View).state.disabledActions).toBeUndefined();
    expect(reoffered.snapshot.reofferAt).toBeUndefined();
    expect(reoffered.snapshot.actionHistory).toEqual(started.snapshot.actionHistory);
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

  it('puts the instant an offer lapses on the turn boundary, and reoffer() publishes the offer again then (#1536)', async () => {
    let now = START;
    const session = createHeadlessSession(playbackDefinition, { ...gameOptions, now: () => now });
    await session.start();
    expect(session.metas.at(-1)!.turnBoundary.reofferAt).toBe(START + PLAYBACK_MS);

    now = START + PLAYBACK_MS;
    await session.host.reoffer();
    expect(session.metas.at(-1)).toMatchObject({ cause: 'republish' });
    expect(session.metas.at(-1)!.turnBoundary.reofferAt).toBeUndefined();
    expect((session.broadcasts.at(-1) as View[])[0].state.disabledActions).toBeUndefined();
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
