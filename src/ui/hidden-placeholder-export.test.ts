/**
 * Custom boards need the same hidden-placeholder check the built-in renderers
 * use, so boardsmith/ui exports it (#491).
 */
import { describe, it, expect } from 'vitest';
import { isHiddenPlaceholder } from './index.js';
import {
  hiddenOpponentCard,
  ownCardOfSeat1,
} from './components/auto-ui/hidden-hand-game.test-helper.js';

describe('isHiddenPlaceholder from boardsmith/ui', () => {
  it("is true for the placeholder a seat is sent for an opponent's card", () => {
    expect(isHiddenPlaceholder(hiddenOpponentCard())).toBe(true);
  });

  it("is false for the seat's own visible card", () => {
    expect(isHiddenPlaceholder(ownCardOfSeat1())).toBe(false);
  });
});
