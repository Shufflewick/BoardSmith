import { devWarn } from '../utils/dev.js';

/**
 * Engine errors whose message is written FOR the person who will read it.
 *
 * The action boundary refuses to put an arbitrary throw on the wire (#47): a
 * runtime `TypeError: Cannot read properties of undefined (reading 'suit')`
 * leaks implementation detail and gives the reader nothing to act on, so it is
 * logged where the game runs and replaced with a generic sentence.
 *
 * That is exactly wrong for the engine's own policy refusals, whose messages
 * are the actionable next step and were written to be read. Extending this
 * class is how such an error says "my message is the point — pass it through".
 *
 * Games may extend it too, for a throw whose message they wrote for a reader:
 * a rules violation, a structural invariant, a refusal the player can act on.
 * Throwing a plain `Error` is the easy path and gets sanitized, which is the
 * right default; carrying text to the wire is the deliberate one.
 *
 * The bar for extending it: the message must name what to do next, and must
 * never contain a stack trace, a file path, an internal identifier, or the
 * text of an exception the author did not write.
 */
export class PlayerFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlayerFacingError';
  }
}

/**
 * Thrown by a game's `execute()` to say: this move is legal, and I cannot
 * resolve it from the information state I have been given (#31).
 *
 * A bot's MCTS sandbox is rebuilt from its OWN seat's redacted view — which is
 * right, a bot must search what it can know — but a move's `execute()`
 * frequently needs the very state redaction removed. Without a way to say so, a
 * game had two options and both were bad: let `execute()` throw an ordinary
 * error, which logs a stack per rollout (measured at 198 MB in 15 seconds on
 * one game) while the search silently degenerates to whatever moves happen not
 * to touch hidden state; or fabricate the missing state so `execute()`
 * succeeds, which is the engine's own documented anti-pattern — choices derived
 * from state the caller cannot see must yield no move, not a guess — applied
 * one layer too late.
 *
 * Throwing this is neither. The move is dropped from the search as unexpandable,
 * nothing is logged, and no value is invented.
 *
 * It is NOT a general "this failed" signal. In an authoritative game the state
 * is all there, so reaching this is itself a bug and it reports like any other
 * failed action.
 *
 * @example
 * ```typescript
 * .execute((args, ctx) => {
 *   const map = ctx.game.mapSeed;
 *   if (map === undefined) {
 *     throw new NotSimulableError('travel needs the map, which this seat cannot see');
 *   }
 *   // ... resolve the move for real
 * })
 * ```
 */
export class NotSimulableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotSimulableError';
  }
}

/**
 * Why a copy of the game was not told an attribute.
 *
 * These are different facts and an author chasing one must not be sent looking
 * for another:
 *
 * - `'attribute-whitelist'` (#19) - the element itself is visible, but
 *   `static visibleAttributes` kept this attribute from a non-owner.
 * - `'hidden-element'` (#147) - the whole element is a placeholder. The seat
 *   cannot see the element (`showOnlyTo` / `hideFrom` / a hidden, count-only
 *   or owner-only zone), so it was serialized with no game attributes at all.
 *   Nothing the game can declare on the class widens this: the fix, when a
 *   fact is meant to be public, is to stop hiding the element.
 * - `'game-root'` (#148) - the game root's own `static visibleAttributes`
 *   withheld the field from this seat.
 */
export type RedactionReason = 'attribute-whitelist' | 'hidden-element' | 'game-root';

/** The clause naming what withheld the attribute, per {@link RedactionReason}. */
const REDACTION_CAUSE: Record<RedactionReason, (className: string) => string> = {
  'attribute-whitelist': (className) =>
    `${className}.visibleAttributes withheld it when this game state was serialized for another seat`,
  'hidden-element': (className) =>
    `this ${className} is a hidden placeholder: the seat this game state was serialized for ` +
    `cannot see the element, so it was sent with none of its game attributes`,
  'game-root': (className) =>
    `${className}.visibleAttributes withheld this root field when the game state was ` +
    `serialized for this seat`,
};

/**
 * Thrown when game code READS an attribute this copy of the game was never
 * told (#19).
 *
 * `static visibleAttributes` withholds an attribute from every seat but its
 * owner, a hidden element is replaced wholesale by a placeholder that carries
 * none of its game attributes (#147), and a snapshot taken `forSeat` carries
 * either redaction. The restore
 * rebuilds the tree from that JSON, so a withheld attribute has no value to
 * assign — and for years it silently kept whatever the class field was
 * initialized to. `0` is a real map square, `[]` is a real empty pack, `false`
 * is a real answer: redaction quietly became "this is definitely zero", and a
 * bot searching that clone reasoned confidently about a world that does not
 * exist.
 *
 * So a withheld attribute now holds nothing at all, and reading it says so.
 * Ask {@link GameElement.isAttributeRedacted} (or read
 * {@link GameElement.redactedAttributes}) before reading an attribute a rule
 * may have to evaluate inside a bot's search sandbox.
 *
 * It extends {@link NotSimulableError} because it IS that answer, arrived at
 * without the game having to say it: the information state does not support
 * this rule. Move enumeration drops the action, `execute()` drops the move,
 * and nothing is logged per rollout. In an authoritative game nothing is ever
 * redacted, so this can never fire there.
 */
export class RedactedAttributeError extends NotSimulableError {
  constructor(
    readonly attribute: string,
    readonly className: string,
    readonly elementId: number,
    readonly reason: RedactionReason,
  ) {
    super(
      `"${attribute}" on ${className} #${elementId} is not known here. ` +
      REDACTION_CAUSE[reason](className) +
      `. This copy holds no value for it: not a default, nothing.\n\n` +
      `  Ask first: element.isAttributeRedacted('${attribute}') says whether this copy knows it, ` +
      `and element.redactedAttributes lists everything withheld.\n` +
      `  A rule that runs inside a bot's search (an action's condition, choices, disabled or validate) ` +
      `must treat a withheld attribute as unknown rather than assume a value — the move is then dropped ` +
      `from the search instead of being scored against a world that was made up.`
    );
    this.name = 'RedactedAttributeError';
  }
}

/**
 * Says, once per action and seat, that the action gives the seat no move
 * because a rule it runs read what this copy of the game was not told: move
 * listing and a step's offer both answer that way (#19, #1431).
 */
export function warnNoMoveFromWhatThisCopyKnows(actionName: string, seat: number, error: NotSimulableError): void {
  devWarn(
    `redacted-enumeration-skip:${actionName}:${seat}`,
    `Action "${actionName}" gave seat ${seat} no move because a rule it runs read information ` +
      `this copy of the game does not have: ${error.message.split('\n')[0]} ` +
      `This is expected inside a bot's search sandbox for a seat other than its own. If this ` +
      `action should be searchable there, derive its condition, choices, disabled and validate ` +
      `from public information, or check element.isAttributeRedacted(key) before reading.`,
  );
}

/**
 * `check`'s answer for `actionName`, or `noMove`'s when a rule it runs read an
 * attribute this copy withholds, which only a bot's search copy does: a step's
 * offer and a seat's disabled reasons both answer that way (#1431, #1432).
 */
export function orNoMoveWhenWithheld<T>(
  actionName: string,
  seat: number,
  check: () => T,
  noMove: (error: RedactedAttributeError) => T,
): T {
  try {
    return check();
  } catch (error) {
    if (!(error instanceof RedactedAttributeError)) throw error;
    warnNoMoveFromWhatThisCopyKnows(actionName, seat, error);
    return noMove(error);
  }
}

/**
 * Thrown by `enumerateLegalMoves` when one action has more moves than
 * enumeration will build (#691). An action's moves are the product of its
 * selections, so a few listable selections in a row can hold billions of
 * moves; enumeration stops at its budget rather than build them, and says so
 * rather than return a list that is not all of them. Catch it to drive that
 * action another way, such as picking each selection at random. The budget
 * counts a multiSelect's combinations and a repeating selection's picks like
 * any other values (#692).
 */
export class MoveListTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoveListTooLargeError';
  }
}

/**
 * A stored partition proves the world's id allocation stamp stale (#224). Its
 * own class so the world engine recognises it by type, not by its sentence (#793).
 */
export class StaleAllocationStampError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleAllocationStampError';
  }
}
