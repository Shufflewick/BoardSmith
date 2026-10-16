/**
 * Element candidate labels: two candidates sharing a name are told apart, by
 * their notation when they carry one (#766).
 */
import { describe, it, expect } from 'vitest';
import { Game, Piece, Player, Space, type GameElement } from '../index.js';
import { formatElementCandidates } from './pick-candidates.js';
import type { ElementSelection } from '../action/types.js';

class LabelGame extends Game<LabelGame, Player> {}
class Square extends Space<LabelGame> {
  code?: string;
  get notation(): string | undefined {
    return this.code;
  }
}

function labelsOf(elements: GameElement[], game: LabelGame): Array<string | undefined> {
  const selection = { type: 'element', name: 'square' } as ElementSelection;
  const ctx = { game, player: game.getPlayer(1)!, args: {} };
  return formatElementCandidates(elements.map((value) => ({ value, disabled: false as const })), selection, ctx, [], game).map((e) => e.display);
}

describe('labels for element candidates (#766)', () => {
  it('labels same-named candidates by their notation', () => {
    const game = new LabelGame({ playerCount: 2, seed: 'labels' });
    const a1 = game.create(Square, 'Square', { code: 'a1' });
    const b2 = game.create(Square, 'Square', { code: 'b2' });
    expect(labelsOf([a1, b2], game)).toEqual(['a1', 'b2']);
  });

  it('numbers same-named candidates that carry no notation', () => {
    const game = new LabelGame({ playerCount: 2, seed: 'labels' });
    const one = game.create(Square, 'Square');
    const two = game.create(Square, 'Square');
    expect(labelsOf([one, two], game)).toEqual(['Square #1', 'Square #2']);
  });

  it('numbers candidates whose notation is shared too', () => {
    const game = new LabelGame({ playerCount: 2, seed: 'labels' });
    const one = game.create(Square, 'Square', { code: 'x' });
    const two = game.create(Square, 'Square', { code: 'x' });
    const other = game.create(Piece, 'Square');
    expect(labelsOf([one, two, other], game)).toEqual(['x #1', 'x #2', 'Square']);
  });
});
