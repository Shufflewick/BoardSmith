import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, loop, type GameOptions } from '../../engine/index.js';
import { executeOp, type GameDefinitionLike } from '../../session/index.js';
import { createDevSession } from './bridge.js';

// #450: the reply to a `resolve_choices` request is what the ASKING seat may
// see -- the pick's answer and nothing else. It used to be the whole op result:
// every seat's view, the spectator view and the unredacted snapshot, so a seat
// could read another seat's withheld attributes off the wire.

class SecretPlayer extends Player<SecretGame, SecretPlayer> {
  static override visibleAttributes = ['publicScore'];
  publicScore = 0;
  secretRole = 'none';
}

class SecretGame extends Game<SecretGame, SecretPlayer> {
  static override PlayerClass = SecretPlayer;
  constructor(options: GameOptions) {
    super(options);
    this.getPlayer(1)!.secretRole = 'SEAT-ONE-SECRET-ROLE';
    this.getPlayer(2)!.secretRole = 'seat-two-own-role';
    this.registerAction(
      Action.create('pick')
        .chooseFrom('color', { choices: ['red', 'blue'] })
        .execute(() => ({ success: true })),
    );
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 100,
          do: actionStep({ actions: ['pick'], player: (ctx) => ctx.game.getPlayer(2)!, turnScope: 'restart' }),
        }),
      }),
    );
  }
}

const def: GameDefinitionLike = { gameClass: SecretGame, gameType: 'secret', minPlayers: 2, maxPlayers: 2 };

async function askChoicesAsSeat2(): Promise<Record<string, unknown>> {
  const responses: Array<{ seat: number; response: Record<string, unknown> }> = [];
  const session = createDevSession({
    playerCount: 2,
    executeOp: (snap, pend, op) =>
      executeOp(def, op.type === 'start' ? { playerCount: 2, seed: 'bs450' } : { playerCount: 2 }, snap, pend, op),
    postGameState: () => {},
    postServerResponse: (seat, _requestId, response) => responses.push({ seat, response }),
  });
  await session.start();
  await session.handleServerRequest(2, 'req-1', 'resolve_choices', {
    actionName: 'pick',
    selectionName: 'color',
    args: {},
  });
  expect(responses).toHaveLength(1);
  expect(responses[0].seat).toBe(2);
  return responses[0].response;
}

describe('dev host resolve_choices reply carries only the asking seat\'s answer (#450)', () => {
  it('answers the pick', async () => {
    const reply = await askChoicesAsSeat2();
    expect(reply.success).toBe(true);
    expect((reply.choices as Array<{ value: unknown }>).map((c) => c.value)).toEqual(['red', 'blue']);
  });

  it('never carries another seat\'s withheld attribute', async () => {
    const reply = await askChoicesAsSeat2();
    expect(JSON.stringify(reply)).not.toContain('SEAT-ONE-SECRET-ROLE');
  });

  it('carries no snapshot, flow state or seat views at all', async () => {
    const reply = await askChoicesAsSeat2();
    for (const key of ['snapshot', 'flowState', 'playerViews', 'spectatorView', 'pendingState', 'flowDebugInfo']) {
      expect(reply, key).not.toHaveProperty(key);
    }
  });
});
