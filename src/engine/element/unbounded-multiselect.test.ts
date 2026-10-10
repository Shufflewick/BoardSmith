/**
 * An unbounded `multiSelect` (`{ min: 1 }`, no `max`) must reach the wire with
 * `max` ABSENT. Metadata travels as JSON, where `Infinity` becomes `null` and
 * the action panel reads `null` as a cap of nothing (ShufflewickPub #378,
 * BoardSmith #508).
 */
import { describe, it, expect } from 'vitest';
import {
  Game, Player, Piece, Space, Action, loop, eachPlayer, actionStep,
  type GameOptions,
} from '../index.js';
import { buildActionMetadata } from './action-metadata.js';
import { resolveMultiSelect } from '../utils/resolve-multiselect.js';

class UnboundedGame extends Game<UnboundedGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    const board = this.create(Space<UnboundedGame>, 'board');
    board.create(Piece<UnboundedGame>, 'token-a');
    board.create(Piece<UnboundedGame>, 'token-b');

    this.registerAction(
      Action.create<UnboundedGame>('pickChoice')
        .chooseFrom('flavor', { prompt: 'Flavors', choices: ['a', 'b', 'c'], multiSelect: { min: 1 } })
        .execute(() => ({ success: true })),
    );
    this.registerAction(
      Action.create<UnboundedGame>('pickElements')
        .chooseElements('items', {
          prompt: 'Tokens',
          elements: (ctx) => [...(ctx.game as UnboundedGame).first(Space)!.all(Piece)],
          multiSelect: { min: 1 },
        })
        .execute(() => ({ success: true })),
    );
    this.registerAction(
      Action.create<UnboundedGame>('pickFn')
        .chooseFrom('flavor', { prompt: 'Flavors', choices: ['a', 'b'], multiSelect: () => ({ min: 2 }) })
        .execute(() => ({ success: true })),
    );
    this.setFlow({
      root: loop({
        maxIterations: 3,
        do: eachPlayer({ do: actionStep({ actions: ['pickChoice', 'pickElements', 'pickFn'] }) }),
      }),
    });
  }
}

function make() {
  const game = new UnboundedGame({ playerCount: 2, playerNames: ['A', 'B'], seed: 'unbounded' });
  game.startFlow();
  return game;
}

const wire = (v: unknown) => JSON.parse(JSON.stringify(v));

describe('unbounded multiSelect omits max on the wire (#508)', () => {
  it.each(['pickChoice', 'pickElements', 'pickFn'])('buildActionMetadata: %s has no max key after JSON', (name) => {
    const game = make();
    const meta = buildActionMetadata(game, game.getPlayer(1)!, [name]);
    const ms = wire(meta[name]!.selections[0]!.multiSelect);
    expect(ms).toBeDefined();
    expect('max' in ms).toBe(false);
  });

  it.each(['pickChoice', 'pickElements', 'pickFn'])('getActionSpace: %s has no max key after JSON', (name) => {
    const game = make();
    const action = game.getActionSpace(1).actions.find((a) => a.name === name)!;
    const ms = wire(action.selections[0]!.multiSelect);
    expect(ms).toBeDefined();
    expect('max' in ms).toBe(false);
  });

  it('resolveMultiSelect leaves max absent when unbounded and keeps a given max', () => {
    const game = make();
    const ctx = { game, player: game.getPlayer(1)!, args: {} };
    const sel = (n: string) => (game as any)._actions.get(n).selections[0];
    const unbounded = resolveMultiSelect(sel('pickChoice'), ctx)!;
    expect('max' in unbounded).toBe(false);
    expect(unbounded.min).toBe(1);
    expect(resolveMultiSelect({ multiSelect: 3 } as any, ctx)).toEqual({ min: 1, max: 3 });
  });
});
