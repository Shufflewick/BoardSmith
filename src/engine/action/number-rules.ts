/**
 * THE RULES A NUMBER SELECTION IS JUDGED BY, IN ONE PLACE.
 *
 * The twin of `text-rules.ts`, and here for the same reason (#237). The engine
 * validates a submitted number; the Action Panel has to tell the player why the
 * number they typed will not be accepted BEFORE they submit it, because a
 * submit button that moves and does nothing is a dead end rather than a rule.
 * Until this module existed the panel simply `return`ed on a value outside
 * `min`/`max` -- the identical defect #229 fixed on the text field, on the pick
 * two lines above it.
 *
 * Two callers of one rule set. A second copy would be a fork: the panel would
 * refuse in its own words while the engine refused in others, and neither would
 * be wrong about its own copy.
 *
 * WHAT IS NOT HERE, exactly as in `text-rules.ts`: the type check, which the
 * engine does on a value off the wire and the panel's number field cannot
 * produce; and `validate`, a game's own closure over game state that never
 * reaches a client. The engine remains the authority. This is the subset a
 * client can honestly check for itself, and it is exactly the subset the wire
 * carries.
 */

/**
 * Every reason this number fails the rules, worded as the engine words them.
 *
 * Empty when it passes. `name` is the selection's argument name, which is what
 * the engine's own refusals have always named -- so the sentence the panel
 * shows before submitting and the sentence the server would answer with are the
 * same sentence.
 *
 * "a whole number" rather than "an integer", for the reason #234 chose "whole
 * numbers" for the hint: this string is read by a player, not by a programmer,
 * and the two sentences about the same rule should not use two words for it.
 */
export function numberRuleErrors(
  name: string,
  value: number,
  rules: { min?: number; max?: number; integer?: boolean },
): string[] {
  const errors: string[] = [];
  if (rules.min !== undefined && value < rules.min) {
    errors.push(`${name} must be at least ${rules.min}`);
  }
  if (rules.max !== undefined && value > rules.max) {
    errors.push(`${name} must be at most ${rules.max}`);
  }
  if (rules.integer && !Number.isInteger(value)) {
    errors.push(`${name} must be a whole number`);
  }
  return errors;
}
