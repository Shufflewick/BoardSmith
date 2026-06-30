import type { Game } from '../element/game.js';
import { serializeValue } from './serializer.js';

/**
 * Options for buildActionArgs.
 */
export interface BuildActionArgsOptions {
  /**
   * Output format for element/player values.
   *
   * - `'in-process'` (default): returns element objects as-is; suitable for
   *   passing directly to `runner.performAction` in the same process.
   * - `'wire'`: converts element objects to `{ __elementId }` (or
   *   `{ __elementRef }` / `{ __playerRef }`) references; suitable for
   *   JSON serialisation and cross-process transmission.
   */
  format?: 'in-process' | 'wire';
}

/**
 * Build validated, ready-to-submit action args from plain selection values.
 *
 * Callers supply a `selectionValues` record whose keys are selection names and
 * whose values are plain JS values (element objects, strings, numbers, …).
 * `buildActionArgs` validates every supplied key against the action's declared
 * selections, then returns the args in the requested format.
 *
 * **In-process (default)**: element objects are returned as-is. The result can
 * be passed directly to `runner.performAction`.
 *
 * **Wire format**: element objects are converted to `{ __elementId }` / `{
 * __playerRef }` references via `serializeValue`. The result is
 * JSON.stringify-safe.
 *
 * @param actionName    - Registered action name on the game.
 * @param selectionValues - Record of selection name → plain JS value.
 * @param game          - The game instance owning the action.
 * @param seat          - The player seat (1-indexed). Must resolve to an existing
 *                        player in the game.
 * @param options       - Format option; defaults to `{ format: 'in-process' }`.
 * @returns A new record ready for `runner.performAction` or wire transmission.
 * @throws If the action is unknown, if the seat has no player, if any key in
 *         `selectionValues` does not match a declared selection name, or if any
 *         required (non-optional) selection is missing.
 */
export function buildActionArgs(
  actionName: string,
  selectionValues: Record<string, unknown>,
  game: Game,
  seat: number,
  options?: BuildActionArgsOptions,
): Record<string, unknown> {
  // 1. Validate seat resolves to an existing player.
  const player = game.getPlayer(seat);
  if (!player) {
    throw new Error(
      `buildActionArgs: seat ${seat} has no player in this game. ` +
      `Provide a valid 1-indexed seat number.`,
    );
  }

  // 3. Resolve the action definition — validate the action name.
  const actionDef = game.getAction(actionName);
  if (!actionDef) {
    throw new Error(
      `buildActionArgs: unknown action "${actionName}". ` +
      `Registered actions: ${game.getActionNames().join(', ') || '(none)'}.`,
    );
  }

  // 4. Build a fast-lookup set of valid selection names for this action.
  const validNames = new Set(actionDef.selections.map(s => s.name));

  // 5. Validate every key supplied by the caller.
  for (const key of Object.keys(selectionValues)) {
    if (!validNames.has(key)) {
      throw new Error(
        `buildActionArgs: unknown selection "${key}" for action "${actionName}". ` +
        `Valid selections: ${[...validNames].join(', ') || '(none)'}.`,
      );
    }
  }

  // 6. Validate all required (non-optional) selections are present.
  const requiredSelections = actionDef.selections.filter(s => !s.optional);
  for (const sel of requiredSelections) {
    if (!(sel.name in selectionValues)) {
      throw new Error(
        `buildActionArgs: required selection "${sel.name}" not provided for action "${actionName}". ` +
        `Required selections: ${requiredSelections.map(s => s.name).join(', ')}.`,
      );
    }
  }

  // 7. Produce the output record in the requested format.
  const format = options?.format ?? 'in-process';

  if (format === 'in-process') {
    // Return a shallow copy; element objects are accepted directly by runner.performAction.
    return { ...selectionValues };
  }

  // Wire format: convert element/player objects to serialised references.
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(selectionValues)) {
    result[key] = serializeValue(value, game, { useBranchPaths: false });
  }
  return result;
}
