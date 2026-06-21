import { describe, it, expect } from 'vitest';
import { Game, Space, Player } from '../index.js';

/**
 * Regression test: a `notation` getter must be serialized into toJSON()
 * attributes. The auto-UI renderers read element.attributes.notation and
 * notation-keyed board refs match on it (Pitfall 6). Getters live on the
 * prototype, so without explicit handling the own-key serialization loop drops
 * them and notation-only refs (Checkers squares, Hex cells) can never match the
 * client element — leaving the board unplayable.
 */
class NotationGame extends Game<NotationGame, Player> {}

class Square extends Space<NotationGame> {
  row!: number;
  col!: number;
  get notation(): string {
    return `${String.fromCharCode(97 + this.col)}${8 - this.row}`;
  }
}

class Plain extends Space<NotationGame> {}

describe('notation getter serialization', () => {
  it('serializes a notation getter into attributes', () => {
    const game = new NotationGame({ playerCount: 2 });
    const square = game.create(Square, 'sq', { row: 4, col: 3 }); // d4
    const json = square.toJSON();
    expect(json.attributes.notation).toBe('d4');
    // The underlying coordinate attributes are still serialized too.
    expect(json.attributes.row).toBe(4);
    expect(json.attributes.col).toBe(3);
  });

  it('does not invent a notation attribute for elements without the getter', () => {
    const game = new NotationGame({ playerCount: 2 });
    const plain = game.create(Plain, 'p');
    expect(plain.toJSON().attributes.notation).toBeUndefined();
  });
});
