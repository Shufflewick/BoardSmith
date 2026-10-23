/**
 * The built-in "Show action help" item in the controls menu, shared by the
 * table and world shells so both read one stored value (#1449).
 */
import { definePlayerPreferences } from '../player-preferences.js';

const declarations = {
  actionHelp: { label: 'Show action help', default: true },
} as const;
let helpPreference: ReturnType<typeof definePlayerPreferences<typeof declarations>> | undefined;

/**
 * Saved once for every BoardSmith game in this browser, like Reduce motion.
 * Defined on first use, so importing reads no storage.
 */
export function actionHelpPreference() {
  helpPreference ??= definePlayerPreferences('boardsmith', declarations);
  return helpPreference;
}

/**
 * Whether the toggle has anything to reveal: the same condition ActionPanel
 * uses to draw an action's "?" (help text or a disabled reason).
 */
export function hasActionHelp(
  availableActions: readonly string[],
  actionMetadata: Record<string, { help?: string }> | undefined,
  disabledActions: Record<string, string> | undefined,
): boolean {
  return availableActions.some((name) => !!actionMetadata?.[name]?.help || !!disabledActions?.[name]);
}
