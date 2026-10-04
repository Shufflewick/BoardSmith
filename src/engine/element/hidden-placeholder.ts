/**
 * The attribute a per-seat view puts on an element the seat cannot see.
 *
 * `toJSONForPlayer` replaces such an element with a placeholder carrying this
 * marker, safe layout keys and nothing else. It is engine metadata rather than
 * a game attribute (hence the `_` prefix, which keeps it out of the generic
 * attribute loops), and it is what tells a restore that EVERY game attribute
 * this element would otherwise carry was withheld (#147).
 *
 * This module has no imports so the UI can read the marker without pulling in
 * the engine.
 */
export const HIDDEN_PLACEHOLDER_ATTRIBUTE = '__hidden';

/**
 * Whether a node of a per-seat view is a hidden placeholder. This is the one
 * check for it: the marker lives in `attributes`, never at the top level, so
 * reading any other place misses every placeholder the engine sends (#491).
 */
export function isHiddenPlaceholder(
  node: { attributes?: Record<string, unknown> } | null | undefined,
): boolean {
  return node?.attributes?.[HIDDEN_PLACEHOLDER_ATTRIBUTE] === true;
}
