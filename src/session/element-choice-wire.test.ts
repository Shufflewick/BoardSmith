/**
 * A chooseFrom candidate that is a game element goes to the seat as
 * `{ id, className }` (#1789): what the seat sends back is then a reference the
 * engine resolves and the state codec encodes, so a refused pick answers with
 * the game's own message, and an element's contents never ride along with it.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Space, Card, Piece, Action, loop, eachPlayer, actionStep, type GameOptions } from '../engine/index.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import { succeeded, refused } from './op-result.test-helper.js';
import { boundaryKeyOf } from './testing/boundary-stamp.js';

class Stone extends Piece<StoneGame> {}

class StoneGame extends Game<StoneGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    for (const player of this.all(Player)) {
      const hand = this.create(Space, `hand-${player.seat}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      this.create(Stone, `stone-${player.seat}`).player = player;
    }
    this.first(Space, 'hand-2')!.create(Card, 'AS');
    this.registerActions(
      Action.create<StoneGame>('place')
        .chooseFrom<'stones', Stone>('stones', {
          choices: (ctx) => ctx.game.all(Stone),
          multiSelect: { min: 0, max: 2 },
          validate: (picked: Stone[]) => picked.length === 2 || 'Pick exactly 2.',
        })
        .execute(() => ({ success: true })),
      Action.create<StoneGame>('peek')
        .chooseFrom<'hand', Space>('hand', { choices: (ctx) => ctx.game.all(Space) })
        .execute(() => ({ success: true })),
    );
    this.setFlow({ root: loop({ maxIterations: 3, do: eachPlayer({ do: actionStep({ actions: ['place', 'peek'] }) }) }) });
  }
}

const definition: GameDefinitionLike = { gameClass: StoneGame, gameType: 'stones', minPlayers: 2, maxPlayers: 2 };
const options = { playerCount: 2, seed: 'i1789' };

async function offered(actionName: string, selectionName: string) {
  const start = succeeded(await executeOp(definition, options, null, null, { type: 'start' }));
  const res = succeeded(await executeOp(definition, options, start.snapshot, null, {
    type: 'resolveChoices', actionName, selectionName, player: 1, args: {},
  }));
  // As the seat holds them: they crossed the wire.
  const choices = JSON.parse(JSON.stringify(res.choices)) as { value: unknown; display: string }[];
  return { start, choices };
}

describe('a chooseFrom of game elements on the wire (#1789)', () => {
  it("answers a refused multiSelect of the offered values with the pick's own message", async () => {
    const { start, choices } = await offered('place', 'stones');

    const result = refused(await executeOp(definition, options, start.snapshot, null, {
      type: 'action', actionName: 'place', player: 1, args: { stones: [choices[0]!.value] },
      boundaryKey: boundaryKeyOf(start.snapshot),
    }));

    expect(result.error).toContain('Pick exactly 2.');
  });

  it('takes the offered values when the pick accepts them', async () => {
    const { start, choices } = await offered('place', 'stones');

    succeeded(await executeOp(definition, options, start.snapshot, null, {
      type: 'action', actionName: 'place', player: 1, args: { stones: choices.map((c) => c.value) },
      boundaryKey: boundaryKeyOf(start.snapshot),
    }));
  });

  it("offers an element by reference, never carrying what is inside it", async () => {
    const { choices } = await offered('peek', 'hand');

    expect(choices.map((c) => c.value)).toEqual([
      { id: expect.any(Number), className: 'Space' },
      { id: expect.any(Number), className: 'Space' },
    ]);
    expect(choices.map((c) => c.display)).toEqual(['hand-1', 'hand-2']);
    expect(JSON.stringify(choices)).not.toContain('AS');
  });
});
