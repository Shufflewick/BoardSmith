import { describe, it, expect } from 'vitest';
import { Game, Player, Action, actionStep, loop, type GameOptions } from '../engine/index.js';
import { GameRunner } from '../runtime/runner.js';
import { ErrorCode } from '../types/protocol.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import { boundaryKeyOf } from './testing/boundary-stamp.js';
import { succeeded, refused } from './op-result.test-helper.js';

/** A choice value the state codec cannot store: a class instance. */
class Token {
  constructor(readonly label: string) {}
}

const offeredToken = new Token('offered');

/**
 * Seat 1 takes a number, stashes a token the game offers but cannot store, or
 * opens a chest whose follow-up offers that token only through its held args.
 */
class PickGame extends Game<PickGame, Player> {
  total = 0;

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<PickGame>('take')
        .chooseFrom('value', { choices: [1, 2, 3] })
        .execute((args, ctx) => {
          ctx.game.total += args.value as number;
          return { success: true };
        }),
    );
    this.registerAction(
      Action.create<PickGame>('stash')
        .chooseFrom('token', { choices: [offeredToken] })
        .execute(() => ({ success: true })),
    );
    this.registerAction(
      Action.create<PickGame>('open')
        .execute(() => ({ success: true, followUp: { action: 'loot', args: { chest: 'tokens' } } })),
    );
    this.registerAction(
      Action.create<PickGame>('loot')
        .followUpArgs<{ chest: string }>()
        .chooseFrom('item', { choices: (ctx): (Token | number)[] => (ctx.args.chest === 'tokens' ? [offeredToken] : [1]) })
        .execute(() => ({ success: true })),
    );
    this.setFlow({
      root: loop({
        maxIterations: 100,
        do: actionStep({ actions: ['take', 'stash', 'open'], player: (ctx) => ctx.game.getPlayer(1)! }),
      }),
    });
  }
}

const options = { playerCount: 2, seed: 'unencodable' };

function startedRunner(): GameRunner<PickGame> {
  const runner = new GameRunner({ GameClass: PickGame, gameType: 'pick', gameOptions: options });
  runner.start();
  return runner;
}

describe('a pick the engine cannot encode (#1070)', () => {
  it('is refused as an invalid pick when the game does not offer it, changing nothing', () => {
    const runner = startedRunner();
    const before = JSON.stringify(runner.getSnapshot());

    const result = runner.performAction('take', 1, { value: new Date(0) });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(ErrorCode.INVALID_PICK);
    expect(result.error).toMatch(/^Cannot serialize action 'take': Date at property 'args\.value'/);
    expect(runner.actionHistory).toHaveLength(0);
    expect(JSON.stringify(runner.getSnapshot())).toBe(before);
  });

  it('still throws when the game itself offered the value: that is the game at fault', () => {
    const runner = startedRunner();

    expect(() => runner.performAction('stash', 1, { token: offeredToken })).toThrow(
      /Cannot serialize action 'stash'.*at property 'args\.token'/,
    );
  });

  it('still throws when a held follow-up offered the value through its own args', () => {
    const runner = startedRunner();
    expect(runner.performAction('open', 1, {}).success).toBe(true);

    expect(() => runner.performAction('loot', 1, { item: offeredToken })).toThrow(
      /Cannot serialize action 'loot'.*at property 'args\.item'/,
    );
  });

  it('reaches a host as the refusal, with INVALID_PICK', async () => {
    const def: GameDefinitionLike = { gameClass: PickGame, gameType: 'pick', minPlayers: 2, maxPlayers: 2 };
    const started = succeeded(await executeOp(def, options, null, null, { type: 'start' }));

    const result = refused(await executeOp(def, options, started.snapshot, null, {
      type: 'action', actionName: 'take', player: 1, args: { value: new Date(0) }, boundaryKey: boundaryKeyOf(started.snapshot),
    }));

    expect(result.errorCode).toBe(ErrorCode.INVALID_PICK);
    expect(result.error).toMatch(/^Cannot serialize action 'take': Date at property 'args\.value'/);
  });
});
