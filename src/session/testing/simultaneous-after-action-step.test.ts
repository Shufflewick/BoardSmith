/**
 * #321 at the session layer: what each seat is actually SENT once a
 * simultaneous step follows an action step. Every seat's broadcast carries the
 * whole-game `flowState`, and GameShell falls back to its `availableActions`
 * for a seat with no live entry in `awaitingPlayers` -- so a leftover action
 * list there is a stale prompt on screen, not only a wrong number in a test.
 */

import { describe, it, expect } from 'vitest';
import { createHeadlessSession } from '../headless-session.js';
import { playThenAcknowledgeFixtureDefinition } from './fixtures/play-then-acknowledge-fixture.js';

interface SeatView {
  flowState: { currentPlayer?: number; availableActions?: string[] };
  state: { currentPlayer?: number; availableActions?: string[]; isMyTurn: boolean };
}

function send(
  session: ReturnType<typeof createHeadlessSession>,
  seat: number,
  actionName: string,
  args: Record<string, unknown> = {},
) {
  return session.send(seat, { type: 'action', actionName, player: seat, args } as never);
}

function lastViews(session: ReturnType<typeof createHeadlessSession>): SeatView[] {
  return session.broadcasts[session.broadcasts.length - 1] as SeatView[];
}

describe('#321: the broadcast once a simultaneous step follows an action step', () => {
  it('sends no seat the seat or actions of the action step before it', async () => {
    const session = createHeadlessSession(playThenAcknowledgeFixtureDefinition, { playerCount: 2, seed: 'x' });
    await session.start();
    expect((await send(session, 1, 'playCard', { card: 1 })).success).toBe(true);
    expect((await send(session, 2, 'playCard', { card: 2 })).success).toBe(true);
    expect((await send(session, 1, 'acknowledgeScore')).success).toBe(true);

    const [seat1, seat2] = lastViews(session);
    for (const view of [seat1, seat2]) {
      expect(view.flowState.currentPlayer).toBeUndefined();
      expect(view.flowState.availableActions).toBeUndefined();
      expect(view.state.currentPlayer).toBeUndefined();
    }

    // Seat 1 has acknowledged: nothing left to offer it.
    expect(seat1.state.isMyTurn).toBe(false);
    expect(seat1.state.availableActions ?? []).toEqual([]);
    // Seat 2 still owes its acknowledgement, and only that.
    expect(seat2.state.isMyTurn).toBe(true);
    expect(seat2.state.availableActions).toEqual(['acknowledgeScore']);
    expect(session.metas[session.metas.length - 1].turnBoundary.dueSeats).toEqual([2]);
  });
});
