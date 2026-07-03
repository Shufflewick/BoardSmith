import { describe, it, expect, beforeEach } from 'vitest';
import { Game, Player, Piece } from '../index.js';

// Regression test for audit finding F2 (SEC-02): `static visibleAttributes` is
// declared (game-element.ts:140) but read nowhere in `filterElement`
// (`Game.toJSONForPlayer`'s per-viewer redaction chokepoint) -- a documented
// no-op security control. This suite proves the fix: a non-owner's view of an
// element with `static visibleAttributes` redacts any attribute NOT in the
// whitelist, while the OWNER's own view keeps everything. `Player` is a
// special case (Pitfall 4): a top-level Player has no `getEffectiveOwner()`
// (that only resolves via a `.player` back-reference set on a CHILD element),
// so ownership for a Player must compare `element.seat === visibilityPosition`
// directly, or a player would be unable to see their own restricted
// attributes.

class RestrictedPiece extends Piece<TestGame> {
  static override visibleAttributes = ['publicField'];
  publicField = 'visible-to-all';
  secretField = 'owner-only-secret';
}

class OpenPiece extends Piece<TestGame> {
  // No visibleAttributes declared -- public-by-default (go-fish `bookCount` style).
  bookCount = 3;
}

class SecretPlayer extends Player<TestGame, SecretPlayer> {
  static override visibleAttributes = ['publicScore'];
  publicScore = 0;
  secretRole = 'undercover';
}

class TestGame extends Game<TestGame, SecretPlayer> {
  static override PlayerClass = SecretPlayer;
}

function findByName(children: any[] | undefined, name: string): any {
  return children?.find((c: any) => c.name === name);
}

describe('static visibleAttributes filtering (SEC-02 / F2)', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
  });

  it('redacts non-whitelisted attributes from a non-owner view', () => {
    const piece = game.create(RestrictedPiece, 'restricted-1');
    piece.player = game.getPlayer(1)!;

    const nonOwnerView = game.toJSONForPlayer(2);
    const pieceJson = findByName(nonOwnerView.children, 'restricted-1');

    expect(pieceJson).toBeDefined();
    expect(pieceJson.attributes.publicField).toBe('visible-to-all');
    expect(pieceJson.attributes.secretField).toBeUndefined();
  });

  it('keeps ALL attributes visible to the owner of the element', () => {
    const piece = game.create(RestrictedPiece, 'restricted-2');
    piece.player = game.getPlayer(1)!;

    const ownerView = game.toJSONForPlayer(1);
    const pieceJson = findByName(ownerView.children, 'restricted-2');

    expect(pieceJson.attributes.publicField).toBe('visible-to-all');
    expect(pieceJson.attributes.secretField).toBe('owner-only-secret');
  });

  it('shows spectators the most restrictive (non-owner) view', () => {
    const piece = game.create(RestrictedPiece, 'restricted-3');
    piece.player = game.getPlayer(1)!;

    const spectatorView = game.toJSONForPlayer(null);
    const pieceJson = findByName(spectatorView.children, 'restricted-3');

    expect(pieceJson.attributes.publicField).toBe('visible-to-all');
    expect(pieceJson.attributes.secretField).toBeUndefined();
  });

  it('public-by-default: an element with no visibleAttributes exposes all custom attributes to everyone', () => {
    game.create(OpenPiece, 'open-1');

    const p2View = game.toJSONForPlayer(2);
    const spectatorView = game.toJSONForPlayer(null);

    expect(findByName(p2View.children, 'open-1').attributes.bookCount).toBe(3);
    expect(findByName(spectatorView.children, 'open-1').attributes.bookCount).toBe(3);
  });

  it('Player owns itself (Pitfall 4): the OWNING seat sees a restricted Player attribute, all others do not', () => {
    const owner = game.getPlayer(1)! as SecretPlayer;
    owner.secretRole = 'spy';

    const ownerView = game.toJSONForPlayer(1);
    const otherSeatView = game.toJSONForPlayer(2);
    const spectatorView = game.toJSONForPlayer(null);

    // Locate the owner's own Player node in each view by matching id (Player nodes
    // are unnamed by default).
    const findPlayerNode = (view: typeof ownerView) =>
      view.children?.find((c: any) => c.className === 'SecretPlayer' && c.id === owner.id);

    const ownerNode = findPlayerNode(ownerView);
    const otherSeatNode = findPlayerNode(otherSeatView);
    const spectatorNode = findPlayerNode(spectatorView);

    expect(ownerNode?.attributes.publicScore).toBe(0);
    expect(ownerNode?.attributes.secretRole).toBe('spy');

    expect(otherSeatNode?.attributes.publicScore).toBe(0);
    expect(otherSeatNode?.attributes.secretRole).toBeUndefined();

    expect(spectatorNode?.attributes.publicScore).toBe(0);
    expect(spectatorNode?.attributes.secretRole).toBeUndefined();
  });
});
