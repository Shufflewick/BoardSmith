/**
 * THE RULES A TEXT SELECTION IS JUDGED BY, IN ONE PLACE.
 *
 * The engine validates a submitted string; the Action Panel has to tell the
 * player why the string they typed will not be accepted BEFORE they submit it,
 * because a submit button that moves and does nothing is not a rule, it is a
 * dead end (#229). Those are two callers of one rule set, and a second copy of
 * the rule set is a fork: the panel would say "at least 10 characters" while the
 * engine refused for a reason the panel had never heard of, and neither would be
 * wrong about its own copy.
 *
 * So this module owns the rules and both callers import it. The panel reaches
 * for it the way `action-panel-helpers.ts` already reaches for
 * `MAX_FLAT_CHOICE_CANDIDATES`: a deep import of an engine value, not a new
 * public export, because it is BoardSmith's own plumbing and not API a game
 * calls.
 *
 * WHAT IS NOT HERE: `validate`. A game's custom validator is a closure over the
 * game's own state, it never reaches a client, and the panel cannot run it. The
 * engine remains the authority; this is the subset a client can honestly check
 * for itself, and it is exactly the subset the wire carries.
 */

/**
 * Every reason this value fails the rules, worded as the engine words them.
 *
 * Empty when it passes. `name` is the selection's argument name, which is what
 * the engine's own refusals have always named -- so the sentence the panel shows
 * before submitting and the sentence the server would answer with are the same
 * sentence.
 *
 * `pattern` is a `RegExp` even though the wire carries its `source` as a string,
 * because a caller holding the string has to compile it either way and a
 * compiled pattern is the only form the rule can be applied in.
 */
export function textRuleErrors(
  name: string,
  value: string,
  rules: { minLength?: number; maxLength?: number; pattern?: RegExp },
): string[] {
  const errors: string[] = [];
  if (rules.minLength !== undefined && value.length < rules.minLength) {
    errors.push(`${name} must be at least ${rules.minLength} characters`);
  }
  if (rules.maxLength !== undefined && value.length > rules.maxLength) {
    errors.push(`${name} must be at most ${rules.maxLength} characters`);
  }
  if (rules.pattern && !rules.pattern.test(value)) {
    errors.push(`${name} does not match required pattern`);
  }
  return errors;
}
