/**
 * WHAT A SEAT MAY READ FROM A GAME CALLBACK (#1293).
 *
 * A game's callbacks are handed the real element even when the acting seat
 * cannot see it, because a rule may decide on a card the player picked blind.
 * But text such a callback writes for the player (a label, a disabled reason, a
 * refusal, a prompt, an `unavailable` sentence) could name that card. So when
 * the callback was handed one, the seat reads the engine's own text and the
 * author's goes to the dev log.
 */
import { isDevThrowEnabled } from '../../utils/dev.js';
import { isElement } from '../element/game-element.js';

/** The reason a seat reads for a choice it cannot take when the game's own reason may name a hidden card. */
export const NEUTRAL_DISABLED = 'You cannot choose this one right now. Choose another.';

/** Whether `value` is, or holds in an array or plain object, an element `seat` cannot see. */
export function hidesFrom(seat: number, value: unknown): boolean {
  if (isElement(value)) return !value.isVisibleTo(seat);
  if (Array.isArray(value)) return value.some((one) => hidesFrom(seat, one));
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.values(value).some((one) => hidesFrom(seat, one));
  }
  return false;
}

/**
 * The text the seat reads: the author's, or `neutral` when the callback that
 * wrote it was handed an element the seat cannot see.
 *
 * @param source - The callback, such as `display for selection 'card'`, named in the dev log.
 */
export function seatText<N extends string | undefined>(
  authored: string,
  neutral: N,
  handedHidden: boolean,
  source: string,
): string | N {
  if (!handedHidden) return authored;
  if (isDevThrowEnabled()) {
    console.warn(
      `[BoardSmith] ${source} was handed a card the player cannot see, so the player read the engine's text ` +
        `instead of "${authored}". Text a player reads cannot depend on a card they cannot see (#1293).`,
    );
  }
  return neutral;
}
