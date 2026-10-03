/**
 * #487: `boardsmith dev` never pushes a page a `game_state` identical to the
 * last one it sent that page.
 *
 * In the fixture's simultaneous deployment, seat 1's `placePack` changes
 * nothing seat 2 may see (and plays an animation only seat 1 may see), so a
 * frame to seat 2's page would only tell it seat 1 acted. The host clock moves
 * between moves, so every frame's `serverNow` differs: the frames are compared
 * without it.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { executeOp } from '../../session/index.js';
import { secretDeploymentDefinition } from '../../session/testing/fixtures/secret-deployment-fixture.js';
import type { WorldHostClock } from './node-world-clock.js';
import { MultiplayerHost, type HostOutbound } from './multiplayer-host.js';
import { createDevHostClientMemory } from './test-client-memory.js';

const clients = createDevHostClientMemory();
beforeEach(() => clients.reset());

/** A host clock that only moves when told to, and never fires a timer. */
function steppingClock(): WorldHostClock & { advance(ms: number): void } {
  let now = 1_700_000_000_000;
  return {
    now: () => now,
    yieldTurn: async () => {},
    arm: () => {},
    advance(ms) {
      now += ms;
    },
  };
}

/** Seat 1 is page `A`, seat 2 is page `B`; the bot that covers seat 2 until `B` sits never moves. */
async function secretTable() {
  const clock = steppingClock();
  const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
  const host = new MultiplayerHost({
    playerCount: 2,
    minPlayers: 2,
    maxPlayers: 2,
    makeSeed: () => 'bs487',
    clock,
    executeOp: (gameOptions, snap, pend, op, hostOptions) =>
      executeOp(secretDeploymentDefinition, gameOptions, snap, pend, op.type === 'botTurn' ? { ...op, seats: [] } : op, hostOptions),
    send: (clientId, msg) => {
      sent.push({ clientId, msg });
      clients.remember(clientId, msg);
    },
  });
  await host.handleMessage('A', { type: 'hello' });
  await host.handleMessage('B', { type: 'hello' });
  await host.handleMessage('B', { type: 'join', seat: 2 });

  const framesTo = (clientId: string) =>
    sent.filter((e) => e.clientId === clientId && e.msg.type === 'game_state').length;
  let request = 0;
  const act = async (clientId: string, actionName: string) => {
    clock.advance(1_000);
    const requestId = `${actionName}-${++request}`;
    await host.handleMessage(clientId, {
      type: 'server_request',
      requestId,
      op: 'action',
      payload: { actionName, args: {}, boundaryKey: clients.key(clientId) },
    });
    const answer = sent.find((e) => e.msg.type === 'server_response' && e.msg.requestId === requestId)?.msg as
      | Extract<HostOutbound, { type: 'server_response' }>
      | undefined;
    expect((answer?.result as { success?: boolean } | undefined)?.success).toBe(true);
  };
  return { host, sent, framesTo, act };
}

describe('boardsmith dev pushes no game_state identical to the last one a page was sent (#487)', () => {
  it.each([
    { moves: ['placePack', 'placePack'], toB: 0, why: 'secret moves send seat 2 nothing' },
    { moves: ['signal'], toB: 1, why: 'a public animation reaches seat 2' },
    { moves: ['signal', 'placePack'], toB: 1, why: 'a secret move that drains a public animation sends nothing' },
    { moves: ['placePack', 'done'], toB: 1, why: 'a public move reaches seat 2' },
  ])('$why', async ({ moves, toB }) => {
    const { framesTo, act } = await secretTable();
    const a = framesTo('A');
    const b = framesTo('B');
    for (const move of moves) await act('A', move);
    // Every one of seat 1's own moves changes what seat 1 sees.
    expect(framesTo('A')).toBe(a + moves.length);
    expect(framesTo('B')).toBe(b + toB);
  });

  it('a page that reloads is sent the full state, and is then held to it like any other', async () => {
    const { host, framesTo, act } = await secretTable();
    await act('A', 'placePack');
    host.disconnect('B');
    const b = framesTo('B');
    await host.handleMessage('B', { type: 'hello' });
    expect(framesTo('B')).toBe(b + 1);

    await act('A', 'placePack');
    expect(framesTo('B')).toBe(b + 1);
  });

  it('a seat changing hands is published to every page when it happens, not on the next move', async () => {
    const { sent } = await secretTable();
    // B took seat 2 from the bot, so no seat is a bot's any more.
    const lastTo = (clientId: string) =>
      sent.filter((e) => e.clientId === clientId && e.msg.type === 'game_state').at(-1)?.msg as
        | { view: { state: { hasBotPlayers?: boolean } } }
        | undefined;
    expect(lastTo('A')?.view.state.hasBotPlayers).toBeUndefined();
    expect(lastTo('B')?.view.state.hasBotPlayers).toBeUndefined();
  });

  it("a page's own getState is answered, and does not reopen the gate", async () => {
    const { host, sent, framesTo, act } = await secretTable();
    await host.handleMessage('B', { type: 'getState', requestId: 'look' });
    expect(sent.at(-1)?.msg).toMatchObject({ type: 'game_state', requestId: 'look' });
    const b = framesTo('B');

    await act('A', 'placePack');
    expect(framesTo('B')).toBe(b);
  });
});
