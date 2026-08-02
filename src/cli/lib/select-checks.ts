/**
 * Resolve which sub-checks a multi-check command should run from its selector
 * flags.
 *
 * The rule, shared by `boardsmith lint` and `boardsmith audit`: with NO
 * selector flag set, everything applicable runs — the bare command is the
 * thorough one, so nobody has to know the sub-checks exist to get them. Setting
 * any flag narrows to exactly the flags that are set.
 *
 * @param flags selector flags keyed by check name, straight from commander
 * @returns a predicate answering "should this check run?"
 */
export function selectChecks<K extends string>(
  flags: Partial<Record<K, boolean>>,
): (key: K) => boolean {
  const anySelected = Object.values(flags).some(Boolean);
  return (key) => (anySelected ? Boolean(flags[key]) : true);
}
