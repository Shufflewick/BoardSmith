/**
 * `resolveChoices` answers only a seat the flow would let take the action now
 * (#714). It used to check only that the seat and action exist, so a seat could
 * ask out of turn, or for an action whose condition fails, and read the
 * choices' display strings, which may name cards only another seat can see.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Space,
  Card,
  Action,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import { ErrorCode } from './types.js';
import { succeeded } from './op-result.test-helper.js';
import { boundaryKeyOf } from './testing/boundary-stamp.js';

class SecretCard extends Card<SpyGame> {
  rank!: string;
}

class SpyGame extends Game<SpyGame, Player> {
  energy = [0, 1, 1];

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([SecretCard]);
    for (const player of this.all(Player)) {
      const hand = this.create(Space, `hand-${player.seat}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      hand.create(SecretCard, `card-${player.seat}`, { rank: `ACE-of-seat-${player.seat}` });
    }
    this.registerActions(
      Action.create<SpyGame>('pass').execute(() => ({ success: true })),
      Action.create<SpyGame>('spy')
        .condition({ 'never': () => false })
        .chooseElement<'card', SecretCard>('card', {
          elementClass: SecretCard,
          filter: (card, ctx) => card.parent?.name !== `hand-${ctx.player.seat}`,
          display: (card) => card.rank,
        })
        .execute(() => ({ success: true })),
      // Digging east spends the seat's only energy, ending the condition.
      Action.create<SpyGame>('dig')
        .condition({ 'you have energy left': (ctx) => ctx.game.energy[ctx.player.seat] > 0 })
        .chooseFrom('spot', {
          choices: ['east', 'stop'],
          repeat: {
            until: (_ctx, last) => last === 'stop',
            onEach: (ctx, pick) => {
              if (pick === 'east') (ctx.game as SpyGame).energy[ctx.player.seat] -= 1;
            },
          },
        })
        .execute(() => ({ success: true })),
      Action.create<SpyGame>('scry')
        .condition({ 'you have energy left': (ctx) => ctx.game.energy[ctx.player.seat] > 0 })
        .chooseFrom('omen', { choices: ['storm', 'calm'] })
        .execute(() => ({ success: true })),
    );
    this.setFlow({
      root: loop({
        maxIterations: 10,
        do: eachPlayer({ do: actionStep({ actions: ['pass', 'spy', 'dig', 'scry'] }) }),
      }),
    });
  }
}

const definition: GameDefinitionLike = { gameClass: SpyGame, gameType: 'spy', minPlayers: 2, maxPlayers: 2 };
const options = { playerCount: 2, seed: 'bs714' };

async function started() {
  return succeeded(await executeOp(definition, options, null, null, { type: 'start' })).snapshot;
}

describe('resolveChoices refuses a seat that may not take the action now (#714)', () => {
  it("refuses a seat asking out of turn, without another seat's hidden card", async () => {
    const snapshot = await started();

    const res = await executeOp(definition, options, snapshot, null, {
      type: 'resolveChoices', actionName: 'spy', selectionName: 'card', player: 2, args: {},
    });

    expect(res).toMatchObject({ success: false, errorCode: ErrorCode.NOT_YOUR_TURN });
    expect(JSON.stringify(res)).not.toContain('ACE-of-seat-1');
  });

  it('refuses the seat on turn an action the flow does not offer, its condition failing', async () => {
    const snapshot = await started();

    const res = await executeOp(definition, options, snapshot, null, {
      type: 'resolveChoices', actionName: 'spy', selectionName: 'card', player: 1, args: {},
    });

    expect(res).toMatchObject({
      success: false,
      errorCode: ErrorCode.ACTION_NOT_AVAILABLE,
      error: "'spy' is not one of your actions right now.",
    });
    expect(JSON.stringify(res)).not.toContain('ACE-of-seat-2');
  });

  it("answers a repeating pick whose own earlier pick ended the condition", async () => {
    const snapshot = await started();
    const step = succeeded(await executeOp(definition, options, snapshot, null, {
      type: 'selectionStep', player: 1, selectionName: 'spot', value: 'east', actionName: 'dig',
      boundaryKey: boundaryKeyOf(snapshot),
    }));
    expect(step.done).toBe(false);

    const res = succeeded(await executeOp(definition, options, step.snapshot, step.pendingState ?? null, {
      type: 'resolveChoices', actionName: 'dig', selectionName: 'spot', player: 1, args: {},
    }));

    expect(res.choices?.map((c) => c.value)).toEqual(['east', 'stop']);
  });

  it("refuses another action whose condition the open pending action's picks ended", async () => {
    const snapshot = await started();
    const step = succeeded(await executeOp(definition, options, snapshot, null, {
      type: 'selectionStep', player: 1, selectionName: 'spot', value: 'east', actionName: 'dig',
      boundaryKey: boundaryKeyOf(snapshot),
    }));

    const res = await executeOp(definition, options, step.snapshot, step.pendingState ?? null, {
      type: 'resolveChoices', actionName: 'scry', selectionName: 'omen', player: 1, args: {},
    });

    expect(res).toMatchObject({
      success: false,
      errorCode: ErrorCode.ACTION_NOT_AVAILABLE,
      error: "'scry' is not available to you right now: 'you have energy left' does not hold.",
    });
  });
});
