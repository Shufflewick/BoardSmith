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
 * A `pattern` and the sentence a player is shown when their text does not
 * match it (#394). One value, so a pattern cannot be declared without saying
 * what it wants: "does not match required pattern" told a player nothing they
 * could act on.
 */
export interface TextPattern {
  regex: RegExp;
  message: string;
}

/** The rules a text value is judged by: the declaration's, as a client receives them. */
interface TextRules {
  minLength?: number;
  maxLength?: number;
  /** The most UTF-8 bytes the text may add to a partition, see {@link textStoredBytes}. */
  maxBytes?: number;
  /** A multiline field admits line feed and tab; a single-line field neither. */
  multiline?: boolean;
  pattern?: TextPattern;
}

/**
 * THE CHARACTERS NO TEXT ARGUMENT MAY CARRY (#394): C0 controls, DEL, C1
 * controls, and UTF-16 surrogates that are not half of a pair.
 *
 * Invisible, never typed on purpose, and trouble in every place the text goes
 * next: logs, rendering, and strict UTF-8 re-encoding, where a lone surrogate
 * becomes a replacement character. They also weigh six bytes each in a
 * partition's JSON (`\u0001`), so a field sized in characters for a byte
 * budget holds six times what it was sized for. Line feed and tab are the two
 * controls prose uses, and a multiline field admits them.
 */
const UNSTORABLE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const LINE_BREAK_OR_TAB = /[\n\t]/;

/**
 * What `value` adds to a world partition, in the units the partition store
 * refuses a partition in: UTF-8 bytes of its JSON, not counting the quotes.
 *
 * `JSON.stringify` of the text is how it sits inside a partition's JSON, with
 * `"` and `\` escaped, and `partitionBytes` measures that JSON as UTF-8. So
 * `maxBytes` bounds exactly the bytes this text costs the partition that holds
 * it, and an emoji (two characters, four bytes) or a CJK character (one
 * character, three bytes) is counted at what it costs rather than at its length.
 * `text-rules.test.ts` holds it equal to the partition store's own measure.
 */
export function textStoredBytes(value: string): number {
  return new TextEncoder().encode(JSON.stringify(value)).length - 2;
}

/**
 * Every reason this value fails the rules, worded as the engine words them.
 *
 * Empty when it passes. `name` is the selection's argument name, which is what
 * the engine's own refusals have always named -- so the sentence the panel shows
 * before submitting and the sentence the server would answer with are the same
 * sentence.
 *
 * A value carrying a character no text may store is refused for that alone:
 * its length and its bytes are not what the player has to fix.
 */
export function textRuleErrors(name: string, value: string, rules: TextRules): string[] {
  if (hasUnstorableCharacters(value, rules.multiline === true)) {
    return [
      `${name} contains characters that can't be stored, such as invisible control characters. ` +
        'Remove them and try again.',
    ];
  }
  return [
    lengthError(name, value, rules),
    bytesError(name, value, rules.maxBytes),
    rules.pattern && !rules.pattern.regex.test(value) ? rules.pattern.message : undefined,
  ].filter((error): error is string => error !== undefined);
}

function hasUnstorableCharacters(value: string, multiline: boolean): boolean {
  return UNSTORABLE.test(value) || (!multiline && LINE_BREAK_OR_TAB.test(value));
}

function lengthError(name: string, value: string, rules: TextRules): string | undefined {
  if (rules.minLength !== undefined && value.length < rules.minLength) {
    return `${name} must be at least ${rules.minLength} characters`;
  }
  if (rules.maxLength !== undefined && value.length > rules.maxLength) {
    return `${name} must be at most ${rules.maxLength} characters`;
  }
  return undefined;
}

function bytesError(name: string, value: string, maxBytes: number | undefined): string | undefined {
  if (maxBytes === undefined) return undefined;
  const bytes = textStoredBytes(value);
  if (bytes <= maxBytes) return undefined;
  return (
    `${name} is too long to store: it takes ${bytes} bytes and the limit is ${maxBytes}. ` +
    'Some characters, such as emoji and accented letters, take more room than others. ' +
    'Shorten it and try again.'
  );
}
