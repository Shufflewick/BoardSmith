/**
 * WHAT A NUMBER PICK'S VALUES ARE CALLED, AND WHEN A GAME MAY NAME THEM (#258).
 *
 * The choice kinds take a `display` and evaluate it per candidate, because a
 * choice pick HAS candidates. A number pick has a range, and the value the label
 * is about is the one the player is still typing -- so there is exactly one
 * honest place to evaluate a numeric `display`: at offer time, once for every
 * value the field can hold, shipped with the pick. A callback does not cross the
 * wire, and a round trip per keystroke is not a label.
 *
 * That is why a labelled range must be ENUMERABLE -- `min`, `max` and
 * `integer: true` -- and why it is capped. Both are refused at declaration time,
 * in the builder, so a game that cannot be labelled finds out when it is written
 * rather than when a player opens the panel.
 *
 * The twin of `number-rules.ts` in spirit but not in job: that module is the
 * rules a SUBMITTED number is judged by, shared with the panel so both refuse in
 * the same words. This one is about the declaration and the labels it produces,
 * and it is shared between the builder (which refuses) and the metadata builder
 * (which enumerates), so the rule that decides a range is labellable and the
 * code that walks it cannot disagree about which values exist.
 */

import { numberRuleErrors } from './number-rules.js';

/**
 * THE MOST VALUES ONE NUMBER PICK MAY SHIP A LABEL FOR.
 *
 * A label per value is state the host serializes into every offer, for every
 * seat -- the same cost `DEFAULT_TEXT_MAX_LENGTH` exists to bound on the text
 * pick -- so an unbounded one is a payload that grows with a game's arithmetic
 * rather than with its design.
 *
 * 200, which is deliberately far above the Action Panel's flat-button ceiling of
 * 24 and equal to a world host's own `maxCandidatesPerSelection`. It is higher
 * than the button cap on purpose and the difference is the whole point: 24 is
 * how many labels a player can READ AT ONCE as a row of pills, while these are
 * read ONE AT A TIME -- only the value in the field is ever shown -- so the
 * reading limit does not apply and only the payload limit does.
 *
 * A range wider than this is not a field with labels; it is a scale, and the
 * game should label the band rather than the value.
 */
export const MAX_LABELLED_NUMBER_VALUES = 200;

/** A number pick's range, as the builder and the metadata builder both see it. */
interface NumberRange {
  min?: number;
  max?: number;
  integer?: boolean;
}

/**
 * Every value the field can hold, in order -- or `null` when the range is not
 * enumerable at all.
 *
 * The one walk of a number pick's range. `assertLabellableRange` refuses
 * everything this would return `null` for, so by the time labels are built the
 * array is guaranteed.
 */
function labellableValues(range: NumberRange): number[] | null {
  const { min, max, integer } = range;
  if (min === undefined || max === undefined || integer !== true) return null;
  const values: number[] = [];
  for (let value = min; value <= max; value++) values.push(value);
  return values;
}

/**
 * Refuse a `display` the library could not honestly answer, in the words a game
 * author can act on.
 *
 * Called from `enterNumber`, so the refusal lands on the line that wrote the
 * declaration.
 */
export function assertLabellableRange(name: string, range: NumberRange): void {
  const values = labellableValues(range);
  if (values === null) {
    const missing: string[] = [];
    if (range.min === undefined) missing.push('min');
    if (range.max === undefined) missing.push('max');
    if (range.integer !== true) missing.push('integer: true');
    throw new Error(
      `enterNumber('${name}') declares display(), but its range is not enumerable: ` +
        `it is missing ${missing.join(', ')}. A number's label is computed once for every ` +
        `value the field can hold and sent with the pick, because a callback cannot reach ` +
        `the player's browser. Give the pick ${missing.join(', ')}, or drop display() and ` +
        `say the meaning in the prompt.`,
    );
  }
  if (values.length > MAX_LABELLED_NUMBER_VALUES) {
    throw new Error(
      `enterNumber('${name}') declares display() over ${values.length} values ` +
        `(${range.min} to ${range.max}), and at most ${MAX_LABELLED_NUMBER_VALUES} may be ` +
        `labelled: every label is sent with the pick, to every seat. Narrow the range, or ` +
        `drop display() and ask for the band with chooseFrom() instead.`,
    );
  }
}

/**
 * Refuse a starting value the pick's own rules would reject, in the engine's own
 * words.
 *
 * `numberRuleErrors` rather than a second set of comparisons: a field that opens
 * on a value the very same pick refuses at submit is the worst version of this
 * feature, and there is only one rule set that can say so.
 */
export function assertUsableInitial(name: string, initial: number, range: NumberRange): void {
  const errors = numberRuleErrors(name, initial, range);
  if (errors.length === 0) return;
  throw new Error(
    `enterNumber('${name}') opens on ${initial}, which its own rules refuse: ` +
      `${errors.join('; ')}. A field cannot start on a value it will not accept.`,
  );
}

/**
 * What each value in the range is called, keyed by the value as a string.
 *
 * Keyed by string because this is JSON on the wire; a numeric key would come
 * back as a string anyway, and a reader that assumed otherwise would look up
 * nothing.
 */
export function numberValueLabels(
  name: string,
  range: NumberRange,
  display: (value: number) => string,
): Record<string, string> {
  const values = labellableValues(range);
  if (values === null) {
    // Unreachable through the builder, which refuses this at declaration time.
    throw new Error(
      `enterNumber('${name}') has a display() but no enumerable range. This is a BoardSmith ` +
        `bug: the range is checked when the action is declared.`,
    );
  }
  const labels: Record<string, string> = {};
  for (const value of values) {
    try {
      labels[String(value)] = display(value);
    } catch (error) {
      throw new Error(
        `The display() of number selection '${name}' threw on the value ${value}. Fix the ` +
          `display callback -- a value it cannot label would otherwise reach the player as a ` +
          `blank field.\nOriginal error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return labels;
}
