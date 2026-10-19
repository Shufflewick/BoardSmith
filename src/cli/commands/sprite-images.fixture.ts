/**
 * Fixture games for validate's sprite image check (#1021). Their sprite data is
 * cast past the type, the way plain JS or JSON game data reaches the engine
 * unchecked, so the check sees what a real game would hand it.
 */
import { Card, Deck, Game, Player, type GameOptions } from '../../engine/index.js';
import type { ImageRef } from '../../engine/element/types.js';

const SHEET = 'cards/deck-sprite.svg';
const FULL = { sprite: SHEET, x: 0, y: 0, width: 238, height: 333, sheetWidth: 3094, sheetHeight: 1665 };
const NO_SHEET_SIZE = { sprite: SHEET, x: 238, y: 0, width: 238, height: 333 } as unknown as ImageRef;

/** A deck whose every sprite carries all four sizes. */
export class GoodSpriteGame extends Game<GoodSpriteGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    const deck = this.create(Deck, 'deck');
    deck.create(Card, 'AH', { $images: { face: FULL, back: '/cards/back.svg' } });
    deck.create(Card, 'joker', { $image: { sprite: SHEET } as ImageRef });
  }
}

/** One card's face sprite has no sheetWidth or sheetHeight. */
export class MissingSheetSizeGame extends Game<MissingSheetSizeGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    const deck = this.create(Deck, 'deck');
    deck.create(Card, 'AH', { $images: { face: FULL } });
    deck.create(Card, '2H', { $images: { face: NO_SHEET_SIZE, back: '/cards/back.svg' } });
  }
}

/** A card removed to the pile in setup, whose `$image` has no width. */
export class PiledSpriteGame extends Game<PiledSpriteGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    const deck = this.create(Deck, 'deck');
    const { width: _width, ...noWidth } = FULL;
    deck.create(Card, 'burned', { $image: noWidth as unknown as ImageRef }).remove();
  }
}

/** Only a three-seat table deals the card whose sprite lacks its sheet sizes. */
export class ThreeSeatSpriteGame extends Game<ThreeSeatSpriteGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    const deck = this.create(Deck, 'deck');
    if (options.playerCount === 3) deck.create(Card, '3H', { $image: NO_SHEET_SIZE });
  }
}
