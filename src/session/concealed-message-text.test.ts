import { describe, it, expect } from 'vitest';
import { Game, Player, Card, Deck, Hand, Space, Action, actionStep, loop, type GameOptions } from '../engine/index.js';
import { GameRunner } from '../runtime/runner.js';
import { buildPlayerState } from './utils.js';

// #1165: the message text a seat receives names a card it cannot see by the outermost container concealing it.

class DrawGame extends Game<DrawGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    const deck = this.create(Deck, 'Deck');
    deck.create(Card, 'Ace of Spades');
    const hand = this.create(Hand, 'Hand');
    hand.player = this.getPlayer(1)!;
    hand.contentsVisibleToOwner();
    const table = this.create(Space, 'Table');
    this.registerAction(
      Action.create('draw').execute((_args, ctx) => {
        const card = deck.first(Card)!;
        card.putInto(hand);
        this.message('{{player}} drew {{card}}', { player: ctx.player, card });
      }),
    );
    this.registerAction(Action.create('play').execute(() => hand.first(Card)!.putInto(table)));
    this.setFlow({ root: loop({ while: () => true, maxIterations: 10, do: actionStep({ actions: ['draw', 'play'], turnScope: 'continue', player: (ctx) => ctx.game.getPlayer(1)! }) }) });
  }
}

describe("a seat's message text names a card it cannot see by its concealer (#1165)", () => {
  it('reads the hand for seat 2 and the spectator, and the card for its owner', () => {
    const runner = new GameRunner({ GameClass: DrawGame, gameType: 'draw', gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'bs1165' } });
    runner.start();
    expect(runner.performAction('draw', 1, {}).success).toBe(true);

    const textFor = (seat: number) => buildPlayerState(runner, ['Alice', 'Bob'], seat).messages?.map((m) => m.text);
    expect(textFor(1)).toEqual(['Alice drew Ace of Spades']);
    expect(textFor(2)).toEqual(['Alice drew Hand']);
    expect(textFor(0)).toEqual(['Alice drew Hand']);
  });

  it('keeps the text each seat was written once the card is played face up', () => {
    const runner = new GameRunner({ GameClass: DrawGame, gameType: 'draw', gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'bs1165' } });
    runner.start();
    expect(runner.performAction('draw', 1, {}).success).toBe(true);
    expect(runner.performAction('play', 1, {}).success).toBe(true);
    expect(buildPlayerState(runner, ['Alice', 'Bob'], 2).messages?.map((m) => m.text)).toEqual(['Alice drew Hand']);
  });
});
