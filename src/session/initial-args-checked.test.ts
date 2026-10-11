/**
 * A client's `initialArgs` are picks, and are checked as picks (#658).
 *
 * A selection step that starts a pending action may carry `initialArgs`: the
 * picks the client made before the one it is sending (the UI collects picks
 * locally and only routes a pick with `onSelect`, or a repeating one, to the
 * server). The session used to copy them into the pending action unchecked
 * and jump straight to the named pick, so a client could leave out an earlier
 * required pick, or send a value the game never offered, and the later picks'
 * choices and the action's `execute` saw that.
 *
 * Each earlier pick is now made exactly as a player's own step makes it, in
 * order. A held follow-up's published args are the engine's, not the
 * client's: they bind first, and a pick they answer is not taken from the
 * client.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Piece, Space, Action, actionStep, type GameOptions } from '../engine/index.js';
import { GameRunner } from '../runtime/index.js';
import { PendingActionManager } from './pending-action-manager.js';
import { ErrorCode } from './types.js';

const NO_LONGER_AVAILABLE =
  'That choice is no longer available. Things changed while you were choosing, so please choose again.';

class Gem extends Piece<ShopGame> {}
class Shelf extends Space<ShopGame> {}

interface Purchase {
  color?: string;
  gem?: string;
  wrap?: string;
  pay?: string;
  note?: string;
  finish?: string;
}

class ShopGame extends Game<ShopGame, Player> {
  shelf!: Shelf;
  bin!: Shelf;
  /** What each completed purchase ran with. */
  purchases: Purchase[] = [];
  /** The picks whose onSelect or onCancel ran, in order. */
  selected: string[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.shelf = this.create(Shelf, 'shelf');
    this.bin = this.create(Shelf, 'bin');
    this.shelf.create(Gem, 'Ruby');
    this.shelf.create(Gem, 'Opal');
    this.bin.create(Gem, 'Coal');

    this.registerActions(
      Action.create<ShopGame>('buy')
        .chooseFrom('color', {
          choices: ['red', 'blue'],
          onSelect: (value) => { this.selected.push(`color:${value}`); },
          onCancel: () => { this.selected.push('cancel:color'); },
        })
        .chooseElement('gem', { elementClass: Gem, filter: (gem) => gem.name !== 'Coal' })
        .chooseFrom('wrap', { choices: ['paper'], optional: true })
        // Blue pays silver; anything else gold. A missing color must never get here.
        .chooseFrom('pay', { choices: (ctx) => (ctx.args.color === 'blue' ? ['silver'] : ['gold']) })
        .execute((args) => {
          this.purchases.push({
            color: args.color,
            gem: args.gem?.name,
            wrap: args.wrap,
            pay: args.pay,
          });
        }),
      Action.create<ShopGame>('polish').execute(() => ({
        success: true,
        followUp: { action: 'finishGem', args: { gem: this.first(Gem, 'Ruby')!.id, note: 'engine' } },
      })),
      Action.create<ShopGame>('finishGem')
        .followUpArgs<{ note: string }>()
        .condition({ 'held as a follow-up': () => false })
        .chooseElement('gem', { elementClass: Gem })
        .chooseFrom('finish', { choices: (ctx) => [`${ctx.args.note}-gloss`] })
        .execute((args) => {
          this.purchases.push({ gem: args.gem?.name, note: args.note, finish: args.finish });
        }),
    );

    this.setFlow({
      root: actionStep({ actions: ['buy', 'polish'], player: (ctx) => ctx.game.getPlayer(1)! }),
    });
  }
}

function shop() {
  const runner = new GameRunner({
    GameClass: ShopGame,
    gameType: 'shop',
    gameOptions: { playerCount: 1, playerNames: ['Alice'], seed: 'test' },
  });
  runner.start();
  const game = runner.game as ShopGame;
  const gemId = (name: string) => game.first(Gem, name)!.id;
  return { runner, game, gemId, manager: new PendingActionManager(runner, 1) };
}

describe('initialArgs are checked as picks (#658)', () => {
  it('refuses initialArgs that leave out an earlier required pick', async () => {
    const { manager, game, gemId } = shop();

    const step = await manager.processSelectionStep(1, 'pay', 'gold', 'buy', { gem: gemId('Ruby') });

    expect(step).toMatchObject({ success: false, error: 'Missing required selection: color', errorCode: ErrorCode.INVALID_PICK });
    expect(game.purchases).toEqual([]);
    expect(manager.getPendingAction(1)).toBeUndefined();
  });

  it('refuses an initial choice the game never offered', async () => {
    const { manager, game, gemId } = shop();

    const step = await manager.processSelectionStep(1, 'pay', 'gold', 'buy', { color: 'purple', gem: gemId('Ruby') });

    expect(step).toMatchObject({ success: false, error: NO_LONGER_AVAILABLE, errorCode: ErrorCode.INVALID_PICK });
    expect(game.purchases).toEqual([]);
    expect(manager.getPendingAction(1)).toBeUndefined();
  });

  it('refuses an initial element the game never offered', async () => {
    const { manager, game, gemId } = shop();

    const step = await manager.processSelectionStep(1, 'pay', 'gold', 'buy', { color: 'red', gem: gemId('Coal') });

    expect(step).toMatchObject({ success: false, error: NO_LONGER_AVAILABLE, errorCode: ErrorCode.INVALID_PICK });
    expect(game.purchases).toEqual([]);
  });

  it('runs onCancel for an earlier pick whose onSelect ran when a later initial pick is refused', async () => {
    const { manager, game, gemId } = shop();

    const step = await manager.processSelectionStep(1, 'pay', 'gold', 'buy', { color: 'red', gem: gemId('Coal') });

    expect(step.success).toBe(false);
    // onSelect ran for color, as it does for a player's step; the refusal
    // cancelled the pending action, so its onCancel undid it.
    expect(game.selected).toEqual(['color:red', 'cancel:color']);
    expect(manager.getPendingAction(1)).toBeUndefined();
  });

  it('accepts the earlier picks the UI sends, its own pick included, and skips an absent optional one', async () => {
    const { manager, game, gemId } = shop();

    // The UI sends every pick it has collected, the one it is sending among them.
    const step = await manager.processSelectionStep(1, 'pay', 'silver', 'buy', {
      color: 'blue',
      gem: gemId('Opal'),
      pay: 'silver',
    });

    expect(step).toMatchObject({ success: true, actionComplete: true });
    expect(game.purchases).toEqual([{ color: 'blue', gem: 'Opal', wrap: undefined, pay: 'silver' }]);
    expect(game.selected).toEqual(['color:blue']);
  });

  it("takes a held follow-up's published args from the engine, not from the client", async () => {
    const { runner, manager, game, gemId } = shop();
    expect(runner.performAction('polish', 1, {}).success).toBe(true);

    // The follow-up answered `gem` and `note`; the client's values for them
    // are not read, and the later pick's choices see the engine's `note`.
    const step = await manager.processSelectionStep(1, 'finish', 'engine-gloss', 'finishGem', {
      gem: gemId('Opal'),
      note: 'client',
    });

    expect(step).toMatchObject({ success: true, actionComplete: true });
    expect(game.purchases).toEqual([{ gem: 'Ruby', note: 'engine', finish: 'engine-gloss' }]);
  });

  it('binds a held follow-up\'s published args when the client sends none', async () => {
    const { runner, manager, game } = shop();
    expect(runner.performAction('polish', 1, {}).success).toBe(true);

    const step = await manager.processSelectionStep(1, 'finish', 'engine-gloss', 'finishGem');

    expect(step).toMatchObject({ success: true, actionComplete: true });
    expect(game.purchases).toEqual([{ gem: 'Ruby', note: 'engine', finish: 'engine-gloss' }]);
  });
});
