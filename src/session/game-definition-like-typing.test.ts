/**
 * Issue #138: `GameDefinitionLike.gameClass` was typed
 * `new (...args: unknown[]) => unknown`. No real game class is structurally
 * assignable to that (a constructor taking `GameOptions` cannot accept
 * `...unknown[]`), so every call site had to cast the class before it could
 * build a definition — an assertion that erases the very type the field exists
 * to state. `GameDefinition.gameClass` already had the right type
 * (`GameClass`), so a `GameDefinitionLike` was not actually a structural subset
 * of the thing it is named after.
 *
 * The TYPE guarantee below is enforced by `tsc`: the definition literal is
 * written with NO cast on `gameClass`, and with a `GameDefinition` assigned
 * straight into a `GameDefinitionLike` parameter. Both are compile errors until
 * the field is typed so a real game class is assignable.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, loop, type GameOptions } from '../engine/index.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import type { GameDefinition } from './types.js';

class PlainGame extends Game<PlainGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 100,
          do: actionStep({
            actions: ['pass'],
            player: (ctx) => ctx.game.getPlayer(1)!,
            repeatUntil: () => false,
          }),
        }),
      }),
    );
  }
}

/** A game class whose constructor names only the options it actually reads. */
class NarrowOptionsGame extends Game<NarrowOptionsGame, Player> {
  constructor(options: { playerCount: number; playerNames?: string[]; seed?: string }) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 100,
          do: actionStep({
            actions: ['pass'],
            player: (ctx) => ctx.game.getPlayer(1)!,
            repeatUntil: () => false,
          }),
        }),
      }),
    );
  }
}

// No cast: these compile only once `gameClass` is typed for real game classes.
const plainDef: GameDefinitionLike = {
  gameClass: PlainGame,
  gameType: 'plain',
  minPlayers: 1,
  maxPlayers: 1,
};

const narrowDef: GameDefinitionLike = {
  gameClass: NarrowOptionsGame,
  gameType: 'narrow',
  minPlayers: 1,
  maxPlayers: 1,
};

// A full GameDefinition must be usable wherever a GameDefinitionLike is asked
// for — that structural relationship is the point of the "Like" suffix.
const fullDef: GameDefinition = {
  gameClass: PlainGame,
  gameType: 'plain-full',
  minPlayers: 1,
  maxPlayers: 1,
};
const asLike: GameDefinitionLike = fullDef;

describe('GameDefinitionLike.gameClass accepts a real game class (#138)', () => {
  it('runs an op from a definition built with no cast', async () => {
    const result = await executeOp(plainDef, { playerCount: 1, seed: 'plain' }, null, null, {
      type: 'start',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a game class that names only the options it reads', async () => {
    const result = await executeOp(narrowDef, { playerCount: 1, seed: 'narrow' }, null, null, {
      type: 'start',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a full GameDefinition where a GameDefinitionLike is expected', async () => {
    const result = await executeOp(asLike, { playerCount: 1, seed: 'full' }, null, null, {
      type: 'start',
    });
    expect(result.success).toBe(true);
  });
});
