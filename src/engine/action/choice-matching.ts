/**
 * ONE definition of "does this submitted value name that choice?".
 *
 * The engine and the browser both have to answer that question, and until #219
 * they answered it differently: the engine compared objects structurally, the
 * action controller compared them by identity. A JSON choice reconstructed from
 * a game view -- which is every choice a custom UI holds, since object identity
 * cannot survive the wire -- was displayed correctly and then refused when
 * selected, while the same object executed cleanly through the native runner.
 *
 * So the matcher lives here, in the engine, and the controller imports it.
 * A second implementation is how the two came to disagree.
 */

/** A choice as either side holds it: a value, and whatever else it carries. */
interface MatchableChoice {
  value: unknown;
}

/**
 * Structural equality. Objects compare by JSON serialization, which is sound
 * for choice values: they are plain JSON by construction (they cross the wire),
 * and an author writes their keys in one order in one place.
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object' && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/**
 * Resolve a SHORTHAND to the choice it names -- an element id, a stable string
 * id, a display string, or an object carrying only the identifying fields --
 * for the common case of a UI that holds an identifier rather than the whole
 * choice object.
 *
 * Returns the matched choice so callers can enforce `disabled`: a
 * smart-resolved value must never bypass a disabled or tutorial-gated choice
 * (CR-01).
 */
export function trySmartResolveChoice<C extends MatchableChoice>(
  value: unknown,
  choices: readonly C[],
): C | undefined {
  return byNumericKey(value, choices)
    ?? byStringId(value, choices)
    ?? byDisplayText(value, choices)
    ?? byIdentifyingSubset(value, choices);
}

/** An element id, or the `value` half of a `{value, display}` choice. */
function byNumericKey<C extends MatchableChoice>(
  value: unknown,
  choices: readonly C[],
): C | undefined {
  if (typeof value !== 'number') return undefined;
  return choices.find((choice) => {
    const actual = choice.value;
    if (!actual || typeof actual !== 'object') return false;
    return ('id' in actual && (actual as { id: unknown }).id === value)
      || ('value' in actual && (actual as { value: unknown }).value === value);
  });
}

/**
 * A stable string id. An `id` is an IDENTIFIER, so it matches exactly and
 * case-sensitively -- that is the whole reason an author keys a choice by one.
 */
function byStringId<C extends MatchableChoice>(
  value: unknown,
  choices: readonly C[],
): C | undefined {
  if (typeof value !== 'string') return undefined;
  return choices.find((choice) => {
    const actual = choice.value;
    return !!actual && typeof actual === 'object' && 'id' in actual
      && (actual as { id: unknown }).id === value;
  });
}

/**
 * Display text, where a case difference is a typo rather than a different
 * thing -- so exact first, then case-insensitively.
 */
function byDisplayText<C extends MatchableChoice>(
  value: unknown,
  choices: readonly C[],
): C | undefined {
  if (typeof value !== 'string') return undefined;
  const lowerValue = value.toLowerCase();
  const textMatches = (candidate: unknown): boolean =>
    candidate === value
    || (typeof candidate === 'string' && candidate.toLowerCase() === lowerValue);

  return choices.find((choice) => {
    const actual = choice.value;
    if (typeof actual === 'string') return textMatches(actual);
    if (!actual || typeof actual !== 'object') return false;
    const obj = actual as Record<string, unknown>;
    return DISPLAY_PROPS.some((prop) => obj[prop] !== undefined && textMatches(obj[prop]));
  });
}

const DISPLAY_PROPS = ['value', 'display', 'name', 'label'] as const;

/**
 * An object carrying only the identifying fields, omitting presentation-only
 * metadata the server bakes into the choice value (e.g. board-highlight refs).
 *
 * Resolves only when the submitted object is a subset of EXACTLY ONE choice. A
 * non-unique or zero match resolves to nothing, so the caller still rejects
 * ambiguous input with a clear error rather than silently picking the wrong
 * choice.
 */
function byIdentifyingSubset<C extends MatchableChoice>(
  value: unknown,
  choices: readonly C[],
): C | undefined {
  if (!isPlainObject(value)) return undefined;
  const matches = choices.filter((c) => isObjectSubset(value, c.value));
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * The choice a submitted value names: the structurally equal one, or the one
 * its shorthand resolves to. Undefined when the value names nothing on offer.
 */
export function findMatchingChoice<C extends MatchableChoice>(
  value: unknown,
  choices: readonly C[],
): C | undefined {
  for (const choice of choices) {
    if (valuesEqual(choice.value, value)) return choice;
  }
  return trySmartResolveChoice(value, choices);
}

/** A serialized game element, which is never a plain data object. */
function isSerializedElement(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.id === 'number' && typeof obj.className === 'string';
}

/** True for a plain data object (not null, not array, not a serialized element). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && !isSerializedElement(value)
  );
}

/**
 * True when every own key of `subset` exists on `full` and deep-equals it.
 * `full` may carry extra keys (the presentation-only metadata). Both must be
 * plain objects for a subset relationship to be meaningful.
 */
function isObjectSubset(subset: unknown, full: unknown): boolean {
  if (!isPlainObject(subset) || !isPlainObject(full)) return false;
  for (const key of Object.keys(subset)) {
    if (!(key in full)) return false;
    if (!valuesEqual(subset[key], full[key])) return false;
  }
  return true;
}
