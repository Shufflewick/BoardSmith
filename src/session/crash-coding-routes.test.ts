/**
 * A crash in the rules and a flow halt are coded ENGINE_ERROR on every route an action can take:
 * a single-step action, a whole submission, a pick-by-pick pending action and its completion
 * (#1141, #1142, #1143). A throwing onSelect leaves the game as it was before the action (#1142).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Game, Player, Piece, Space, Action, actionStep, execute, loop, sequence, type GameOptions } from '../engine/index.js';
import { rulesErrorSentence } from '../engine/action/rules-error.js';
import { GameRunner } from '../runtime/index.js';
import { PendingActionManager } from './pending-action-manager.js';
import { ErrorCode } from './types.js';

class Token extends Piece<CrashGame> {}
class Zone extends Space<CrashGame> {}

const crash = (): never => {
  throw new TypeError("Cannot read properties of undefined (reading 'suit')");
};

class CrashGame extends Game<CrashGame, Player> {
  from!: Zone;
  to!: Zone;
  haltAfter = false;

  constructor(options: GameOptions) {
    super(options);
    this.from = this.create(Zone, 'from');
    this.to = this.create(Zone, 'to');
    this.from.create(Token, 'one');
    this.from.create(Token, 'two');
    const move = (name: string) => this.from.first(Token, name)!.putInto(this.to);

    this.registerActions(
      Action.create('crash').chooseFrom('x', { choices: ['a'] }).execute(crash),
      Action.create('halt').chooseFrom('x', { choices: ['a'] }).execute(() => { this.haltAfter = true; }),
      Action.create('moveThenThrow')
        .chooseFrom('first', { choices: ['a'], onSelect: () => move('one') })
        .chooseFrom('second', { choices: ['b'], onSelect: () => { move('two'); crash(); } })
        .execute(() => {}),
      Action.create('throwFirst')
        .chooseFrom('first', { choices: ['a'], onSelect: crash })
        .chooseFrom('second', { choices: ['b'] })
        .execute(() => {}),
      Action.create('gather')
        .chooseFrom('items', { choices: ['a', 'done'], repeat: { onEach: () => { move('one'); crash(); }, until: () => false } })
        .execute(() => {}),
    );
    this.setFlow({
      root: loop({
        maxIterations: 5,
        do: sequence(
          actionStep({ player: (ctx) => ctx.game.getPlayer(1)!, actions: ['crash', 'halt', 'moveThenThrow', 'throwFirst', 'gather'] }),
          execute((ctx) => { if ((ctx.game as CrashGame).haltAfter) crash(); }),
        ),
      }),
    });
  }
}

function setup() {
  const runner = new GameRunner({ GameClass: CrashGame, gameType: 'crash', gameOptions: { playerCount: 1, seed: 'crash' } });
  runner.start();
  return { runner, manager: new PendingActionManager(runner, 1), game: runner.game };
}

const where = (game: CrashGame) => game.to.all(Token).map((token) => token.name);

afterEach(() => vi.restoreAllMocks());

describe('crash and halt coding across routes', () => {
  it('codes a crash in execute and a flow halt alike after a single-step and a multi-step action (#1143)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const name of ['crash', 'halt']) {
      const single = setup().runner.performAction(name, 1, { x: 'a' });
      const multi = await setup().manager.processSelectionStep(1, 'x', 'a', name);
      expect(multi).toMatchObject({ success: false, errorCode: ErrorCode.ENGINE_ERROR, error: single.error });
      expect(single).toMatchObject({ success: false, errorCode: ErrorCode.ENGINE_ERROR });
    }
  });

  it('codes a crash in a whole submission of a repeating pick as a rules error, without a pick prefix (#1141)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { runner, game } = setup();
    const result = runner.performAction('gather', 1, { items: ['a', 'done'] });
    expect(result.errorCode).toBe(ErrorCode.ENGINE_ERROR);
    expect(result.error?.startsWith(rulesErrorSentence('gather'))).toBe(true);
    expect(where(game)).toEqual([]);
  });

  it('codes a crash in a pending pick as a rules error, not a bad pick (#1142)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const repeating = await setup().manager.processSelectionStep(1, 'items', 'a', 'gather');
    expect(repeating).toMatchObject({ success: false, errorCode: ErrorCode.ENGINE_ERROR });

    const { manager } = setup();
    expect((await manager.processSelectionStep(1, 'first', 'a', 'moveThenThrow')).success).toBe(true);
    const regular = await manager.processSelectionStep(1, 'second', 'b');
    expect(regular).toMatchObject({ success: false, errorCode: ErrorCode.ENGINE_ERROR });

    const initial = await setup().manager.processSelectionStep(1, 'second', 'b', 'throwFirst', { first: 'a' });
    expect(initial).toMatchObject({ success: false, errorCode: ErrorCode.ENGINE_ERROR });
  });

  it('leaves the game as it was when an onSelect changes it and then throws (#1142)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { runner, game } = setup();
    const result = runner.performAction('moveThenThrow', 1, { first: 'a', second: 'b' });
    expect(where(game)).toEqual([]);
    expect(result).toMatchObject({ success: false, errorCode: ErrorCode.ENGINE_ERROR });
    expect(runner.actionHistory).toHaveLength(0);
  });
});
