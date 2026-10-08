/**
 * Teaching tools on the live host: what the host's own teaching cases in
 * snapshot-session-host.test.ts and stateless-ops.test.ts leave out.
 *
 * - A hint, a heatmap and demo narration are the host's transient state. They
 *   are merged into the views it publishes and never enter what it stores.
 * - A debug rewind, like an undo, drops a hint chosen for a position that no
 *   longer exists.
 * - A visible heatmap follows the turn: it is emptied (still toggled on) while
 *   its seat is off turn and recomputed when the seat is on turn again.
 */

import { describe, it, expect } from 'vitest';
import { TwoPlayerPickGame } from './testing/fixtures/two-player-pick-fixture.js';
import { createHeadlessSession } from './headless-session.js';
import type { BotStrategy } from '../bot/index.js';

// Every move scores the same; each pick names its option as the hint target,
// so a heatmap of the three options is never empty.
const pickBot: BotStrategy = {
  objectives: () => ({ moves: { checker: () => 0.5, weight: 1 } }),
  hintTargetFromMove: (move) => {
    const option = (move.args as { option?: string }).option;
    return option ? { notation: option } : undefined;
  },
};

const def = {
  gameClass: TwoPlayerPickGame,
  gameType: 'two-player-pick',
  minPlayers: 2,
  maxPlayers: 2,
  bot: pickBot,
};

async function table() {
  const session = createHeadlessSession(def, { playerCount: 2, seed: 'teaching', playerNames: ['Alice', 'Bob'] });
  await session.start();
  return session;
}

// A hint and a heatmap each run a bot search, so a busy machine can take a
// while; this is a ceiling for a hung search, not a budget.
const SEARCH_CEILING = { timeout: 60_000 };

async function pick(session: Awaited<ReturnType<typeof table>>, seat: number) {
  const result = await session.send(seat, { type: 'action', actionName: 'pick', player: seat, args: { option: 'a' } });
  if (!result.success) throw new Error(result.error);
}

function expectNoTeachingFields(stored: unknown): void {
  const text = JSON.stringify(stored);
  expect(text).not.toContain('"hint"');
  expect(text).not.toContain('"heatmap"');
  expect(text).not.toContain('"narration"');
}

describe('teaching state is never stored', () => {
  it('the durable state holds no hint, heatmap or narration while seat 1 sees both', SEARCH_CEILING, async () => {
    const session = await table();
    expect((await session.send(1, { type: 'hint', seat: 1 })).success).toBe(true);
    expect((await session.send(1, { type: 'heatmapToggle', seat: 1, visible: true })).success).toBe(true);

    const seat1 = session.playerState(1);
    expect(seat1.hint).toBeDefined();
    expect(seat1.heatmap?.visible).toBe(true);

    expectNoTeachingFields(session.host.durableState());
  });
});

describe('a rewind drops a stale hint', () => {
  it('the rewind publishes seat 2 no hint', SEARCH_CEILING, async () => {
    const session = await table();
    await pick(session, 1);
    expect((await session.send(2, { type: 'hint', seat: 2 })).success).toBe(true);
    expect(session.playerState(2).hint).toBeDefined();

    const rewound = await session.send(2, { type: 'debugRewind', actionIndex: 0 });
    if (!rewound.success) throw new Error(rewound.error);

    expect(session.playerState(2).hint).toBeUndefined();
  });
});

describe('a visible heatmap follows the turn (R-11)', () => {
  it('is emptied while its seat is off turn and recomputed when the seat is on turn again', SEARCH_CEILING, async () => {
    const session = await table();
    expect((await session.send(1, { type: 'heatmapToggle', seat: 1, visible: true })).success).toBe(true);
    expect(session.playerState(1).heatmap!.entries.length).toBeGreaterThan(0);

    // Seat 1 picks, so it is seat 2's turn: seat 1's heatmap is stale.
    await pick(session, 1);
    expect(session.playerState(1).heatmap!.visible).toBe(true);
    expect(session.playerState(1).heatmap!.entries).toHaveLength(0);

    // Seat 2 picks, so seat 1 is on turn again and its heatmap is recomputed.
    await pick(session, 2);
    expect(session.playerState(1).heatmap!.visible).toBe(true);
    expect(session.playerState(1).heatmap!.entries.length).toBeGreaterThan(0);
  });
});
