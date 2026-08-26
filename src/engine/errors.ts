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
