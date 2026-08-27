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
